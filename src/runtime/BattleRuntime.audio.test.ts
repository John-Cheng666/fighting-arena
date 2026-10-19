import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BattleEvent } from "../engine/types";
import { STEP } from "../engine/types";
import type { AudioClock, AudioSettings, MusicState } from "../view/audio/types";
import { DEFAULT_MATCH_CONFIG } from "../test/fixtures";
import { BattleRuntime } from "./BattleRuntime";

interface Warmup { promise: Promise<void>; resolve: () => void }
interface ControlledAudio {
  warmups: Warmup[];
  setEnabled: ReturnType<typeof vi.fn<(enabled: boolean) => void>>;
  configure: ReturnType<typeof vi.fn<(settings: Partial<AudioSettings>) => void>>;
  consume: ReturnType<typeof vi.fn<(events: readonly BattleEvent[], fighters: unknown, clock: AudioClock) => void>>;
  updateMusic: ReturnType<typeof vi.fn<(state: MusicState) => void>>;
  resume: ReturnType<typeof vi.fn<() => void>>;
  pause: ReturnType<typeof vi.fn<() => void>>;
  reset: ReturnType<typeof vi.fn<() => void>>;
  dispose: ReturnType<typeof vi.fn<() => void>>;
}
const players = vi.hoisted(() => [] as ControlledAudio[]);
vi.mock("../view/audio/BattleAudio", () => ({
  BattleAudio: class {
    private enabled = false;
    private paused = false;
    readonly warmups: Warmup[] = [];
    readonly setEnabled = vi.fn((enabled: boolean) => { this.enabled = enabled; });
    readonly configure = vi.fn((_settings: Partial<AudioSettings>) => undefined);
    readonly consume = vi.fn((_events: readonly BattleEvent[], _fighters: unknown, _clock: AudioClock) => undefined);
    readonly updateMusic = vi.fn((_state: MusicState) => undefined);
    readonly resume = vi.fn(() => { this.paused = false; });
    readonly pause = vi.fn(() => { this.paused = true; });
    readonly reset = vi.fn();
    readonly dispose = vi.fn(() => { this.enabled = false; });
    readonly getStatus = () => ({ enabled: this.enabled, state: this.enabled ? this.paused ? "paused" : "ready" : "off", loading: 0, failedClips: 0 });
    readonly warmup = vi.fn(() => {
      let resolve!: () => void;
      const promise = new Promise<void>(yes => { resolve = yes; });
      this.warmups.push({ promise, resolve });
      return promise;
    });
    constructor() { players.push(this); }
  },
}));

const runtimes: BattleRuntime[] = [];
function running() {
  const runtime = new BattleRuntime(DEFAULT_MATCH_CONFIG);
  runtimes.push(runtime);
  runtime.setLoaded(true);
  runtime.start();
  runtime.battle.aiEnabled = false;
  return { runtime, audio: players.at(-1)! };
}
async function settle(warmup: Warmup) {
  warmup.resolve();
  await warmup.promise;
  for (let index = 0; index < 4; index++) await Promise.resolve();
}
beforeEach(() => {
  players.length = 0;
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runtime audio preparation and round lifecycle", () => {
  it("holds simulation during preload and discards waiting wall time without a resume jump", async () => {
    const { runtime, audio } = running();
    const step = vi.spyOn(runtime.battle, "step");
    runtime.advance(STEP / 2);
    runtime.toggleSound();
    expect(runtime.getSummary().audio.loading).toBe(true);
    const initial = structuredClone(runtime.getState());
    runtime.advance(15);
    runtime.advance(15);
    expect(step).not.toHaveBeenCalled();
    expect(runtime.getState()).toEqual(initial);
    expect(runtime.alpha).toBe(0);
    await settle(audio.warmups[0]);
    expect(runtime.getSummary().audio.loading).toBe(false);
    runtime.advance(STEP / 2);
    expect(step).not.toHaveBeenCalled();
    runtime.advance(STEP / 2);
    expect(step).toHaveBeenCalledOnce();
  });

  it("does not let an old enable's warmup release a later enable's gate", async () => {
    const { runtime, audio } = running();
    const step = vi.spyOn(runtime.battle, "step");
    runtime.toggleSound();
    const first = audio.warmups[0];
    runtime.toggleSound();
    expect(runtime.getSummary().sound).toBe(false);
    runtime.toggleSound();
    const second = audio.warmups[1];
    audio.resume.mockClear();
    await settle(first);
    runtime.advance(1);
    expect(runtime.getSummary()).toMatchObject({ sound: true, audio: { loading: true } });
    expect(step).not.toHaveBeenCalled();
    expect(audio.resume).not.toHaveBeenCalled();
    await settle(second);
    expect(audio.resume).toHaveBeenCalledOnce();
    runtime.advance(STEP);
    expect(step).toHaveBeenCalledOnce();
  });

  it("keeps sound disabled when an abandoned warmup completes", async () => {
    const { runtime, audio } = running();
    runtime.toggleSound();
    const first = audio.warmups[0];
    runtime.toggleSound();
    audio.resume.mockClear();
    await settle(first);
    expect(runtime.getSummary()).toMatchObject({ sound: false, audio: { loading: false, state: "off" } });
    expect(audio.resume).not.toHaveBeenCalled();
    expect(audio.setEnabled).toHaveBeenLastCalledWith(false);
    runtime.advance(STEP);
    expect(runtime.getState().tick).toBe(1);
  });

  it("clears the old round's sources and protects a restart's new preload", async () => {
    const { runtime, audio } = running();
    runtime.setAudioSettings({ musicMode: "jamie", musicVolume: 0.2, effectsVolume: 0.35, voiceEnabled: true });
    runtime.toggleSound();
    const first = audio.warmups[0];
    runtime.restart();
    const second = audio.warmups[1];
    expect(audio.reset).toHaveBeenCalledOnce();
    expect(runtime.getSummary()).toMatchObject({ elapsed: 0, sound: true, audio: { loading: true, musicMode: "jamie", musicVolume: 0.2, effectsVolume: 0.35, voiceEnabled: true } });
    const step = vi.spyOn(runtime.battle, "step");
    audio.resume.mockClear();
    await settle(first);
    runtime.advance(1);
    expect(step).not.toHaveBeenCalled();
    expect(audio.resume).not.toHaveBeenCalled();
    expect(runtime.getSummary().audio.loading).toBe(true);
    await settle(second);
    runtime.advance(STEP);
    expect(step).toHaveBeenCalledOnce();
    expect(audio.configure).toHaveBeenLastCalledWith(expect.objectContaining({ musicMode: "jamie", musicVolume: 0.2, effectsVolume: 0.35, voiceEnabled: true }));
  });

  it("never publishes or resumes a disposed runtime when decoding eventually finishes", async () => {
    const { runtime, audio } = running();
    runtime.toggleSound();
    const notification = vi.fn();
    runtime.subscribe(notification);
    runtime.dispose();
    audio.resume.mockClear();
    audio.configure.mockClear();
    await settle(audio.warmups[0]);
    expect(notification).not.toHaveBeenCalled();
    expect(audio.resume).not.toHaveBeenCalled();
    expect(audio.configure).not.toHaveBeenCalled();
    expect(audio.dispose).toHaveBeenCalledOnce();
  });

  it("persists clamped mix preferences, while audio opt-in remains a fresh user gesture", () => {
    const { runtime, audio } = running();
    runtime.setAudioSettings({ masterVolume: 2, musicVolume: -1, effectsVolume: 0.42, voiceVolume: 0.67, voiceEnabled: true, musicMode: "jamie" });
    runtime.restart(undefined, false);
    expect(audio.reset).toHaveBeenCalledOnce();
    const next = new BattleRuntime(DEFAULT_MATCH_CONFIG);
    runtimes.push(next);
    expect(next.getSummary()).toMatchObject({ sound: false, audio: { masterVolume: 1, musicVolume: 0, effectsVolume: 0.42, voiceVolume: 0.67, voiceEnabled: true, musicMode: "jamie" } });
    expect(players.at(-1)?.setEnabled).not.toHaveBeenCalled();
  });
});

describe("runtime authored audio clock", () => {
  it("keeps every fixed step distinct in one render batch even when combat ticks are frozen", async () => {
    const { runtime, audio } = running();
    runtime.toggleSound(); await settle(audio.warmups[0]);
    vi.spyOn(runtime.battle, "step").mockImplementation(() => undefined);
    vi.spyOn(runtime.battle, "takeEvents").mockImplementation(() => [
      { type: "audio", tick: 0, fighterId: "p1", clipId: "test-source", channel: "sfx", scope: "super-intro" },
      { type: "audio-stop", tick: 0, fighterId: "p1", scope: "old-loop", loopsOnly: true },
    ]);
    runtime.setSpeed(4);
    const events = runtime.advance(STEP);
    const [projected, , clock] = audio.consume.mock.calls.at(-1)!;
    expect(projected.map(event => event.tick)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(clock).toEqual({ tick: 4, speed: 4 });
    expect(events.every(event => event.tick === 0)).toBe(true);
    expect(runtime.getState().tick).toBe(0);
    expect(JSON.parse(runtime.exportLog()).events.every((event: BattleEvent) => event.tick === 0)).toBe(true);
    runtime.advance(STEP);
    expect(audio.consume.mock.calls.at(-1)?.[0].map(event => event.tick)).toEqual([5, 5, 6, 6, 7, 7, 8, 8]);
  });

  it("passes quarter speed and quadruple speed through without changing fixed-step cue identities", async () => {
    for (const speed of [0.25, 4]) {
      const { runtime, audio } = running();
      runtime.toggleSound(); await settle(audio.warmups[0]);
      let cueCount = 0;
      vi.spyOn(runtime.battle, "step").mockImplementation(() => { cueCount++; });
      vi.spyOn(runtime.battle, "takeEvents").mockImplementation(() => [{ type: "audio", tick: 0, clipId: `cue-${cueCount}`, channel: "sfx" }]);
      runtime.setSpeed(speed);
      runtime.advance(STEP / speed * 4);
      const [events, , clock] = audio.consume.mock.calls.at(-1)!;
      expect(events.map(event => event.type === "audio" ? event.clipId : "unexpected")).toEqual(["cue-1", "cue-2", "cue-3", "cue-4"]);
      expect(events.map(event => event.tick)).toEqual([1, 2, 3, 4]);
      expect(clock).toEqual({ tick: 4, speed });
    }
  });

  it("gives actual SA1 intro cues separate presentation times while retaining frozen combat timestamps", async () => {
    const { runtime, audio } = running();
    runtime.demonstrate("row-87");
    runtime.toggleSound(); await settle(audio.warmups[0]);
    const pairs: { combat: number; presentation: number; clipId: string }[] = [];
    for (let frame = 0; frame < 80; frame++) {
      const events = runtime.advance(STEP).filter(event => event.type === "audio");
      const projected = audio.consume.mock.calls.at(-1)![0].filter(event => event.type === "audio");
      for (let index = 0; index < events.length; index++) pairs.push({ combat: events[index].tick, presentation: projected[index].tick, clipId: events[index].clipId });
    }
    const frozenGroup = pairs.filter(pair => pair.combat === pairs[0]?.combat);
    expect(frozenGroup.length).toBeGreaterThan(1);
    expect(new Set(frozenGroup.map(pair => pair.presentation)).size).toBeGreaterThan(1);
    expect(frozenGroup.every((pair, index) => index === 0 || pair.presentation >= frozenGroup[index - 1].presentation)).toBe(true);
  });

  it("resets the presentation clock for a new round", async () => {
    const { runtime, audio } = running();
    runtime.toggleSound(); await settle(audio.warmups[0]);
    vi.spyOn(runtime.battle, "takeEvents").mockReturnValue([{ type: "audio", tick: 0, clipId: "test-source", channel: "sfx" }]);
    runtime.advance(STEP * 4);
    expect(audio.consume.mock.calls.at(-1)?.[2].tick).toBe(4);
    runtime.restart();
    await settle(audio.warmups[1]);
    vi.spyOn(runtime.battle, "takeEvents").mockReturnValue([{ type: "audio", tick: 0, clipId: "test-source", channel: "sfx" }]);
    runtime.advance(STEP);
    expect(audio.consume.mock.calls.at(-1)?.[0][0].tick).toBe(1);
    expect(audio.consume.mock.calls.at(-1)?.[2].tick).toBe(1);
  });
});

describe("runtime music routing", () => {
  it("uses the training stage for demonstrations and restores stage or unified Jamie music immediately", () => {
    const { runtime, audio } = running();
    runtime.setAudioStage("temple");
    expect(audio.configure).toHaveBeenLastCalledWith(expect.objectContaining({ stageId: "temple", musicMode: "stage" }));
    runtime.demonstrate("row-0", "hit", false);
    expect(audio.configure).toHaveBeenLastCalledWith(expect.objectContaining({ stageId: "training", musicMode: "stage" }));
    runtime.setAudioStage("beach");
    expect(audio.configure).toHaveBeenLastCalledWith(expect.objectContaining({ stageId: "training", musicMode: "stage" }));
    runtime.setAudioSettings({ musicMode: "jamie" });
    expect(audio.configure).toHaveBeenLastCalledWith(expect.objectContaining({ stageId: "beach", musicMode: "jamie" }));
    runtime.exitDemonstration(false);
    expect(audio.configure).toHaveBeenLastCalledWith(expect.objectContaining({ stageId: "beach", musicMode: "jamie" }));
    runtime.setAudioSettings({ musicMode: "stage" });
    expect(audio.configure).toHaveBeenLastCalledWith(expect.objectContaining({ stageId: "beach", musicMode: "stage" }));
  });

  it("passes actual health and pause state to music without confusing super freeze with a pause", () => {
    const { runtime, audio } = running();
    runtime.getState().fighters[1].hp = runtime.getState().fighters[1].maxHp * 0.25;
    runtime.advance(0);
    expect(audio.updateMusic).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "running", fighters: runtime.getState().fighters }));
    runtime.pause(); runtime.advance(0);
    expect(audio.updateMusic).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "paused" }));
    runtime.togglePause();
    runtime.getState().superFreezeRemaining = 50;
    runtime.advance(0);
    expect(audio.updateMusic).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "running" }));
  });
});
