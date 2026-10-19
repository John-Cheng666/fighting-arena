import { describe, expect, it, vi } from "vitest";
import type { AudioCatalog } from "../../content/audio/types";
import type { BattleEvent } from "../../engine/types";
import { BattleAudio } from "./BattleAudio";

class Parameter {
  value = 1;
  readonly ramps: { value: number; at: number }[] = [];
  setValueAtTime(value: number, _at: number) { this.value = value; return this; }
  setTargetAtTime(value: number, _at: number, _constant: number) { this.value = value; return this; }
  linearRampToValueAtTime(value: number, at: number) { this.ramps.push({ value, at }); this.value = value; return this; }
  cancelScheduledValues(_at: number) { return this; }
}
class Gain {
  readonly gain = new Parameter();
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}
class Source {
  buffer: (AudioBuffer & { clipId: string }) | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new Parameter();
  onended: (() => void) | null = null;
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  readonly start = vi.fn((_at: number) => undefined);
  readonly stop = vi.fn((_at: number) => undefined);
}
class Context {
  state: AudioContextState = "suspended";
  currentTime = 0;
  readonly destination = {};
  readonly sources: Source[] = [];
  readonly gains: Gain[] = [];
  resumeOperation?: () => Promise<void>;
  suspendOperation?: () => Promise<void>;
  decodeOperation?: (id: string) => Promise<AudioBuffer>;
  readonly resume = vi.fn(() => {
    if (this.resumeOperation) return this.resumeOperation();
    this.state = "running";
    return Promise.resolve();
  });
  readonly suspend = vi.fn(() => {
    if (this.suspendOperation) return this.suspendOperation();
    this.state = "suspended";
    return Promise.resolve();
  });
  readonly close = vi.fn(async () => { this.state = "closed"; });
  readonly decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => {
    const id = new TextDecoder().decode(bytes);
    return this.decodeOperation ? this.decodeOperation(id) : { duration: 10, sampleRate: 48000, length: 480000, clipId: id } as unknown as AudioBuffer;
  });
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const clip = (id: string, loop?: { start: number; end: number }) => ({ url: `audio/${id}.ogg`, seconds: 10, frames: 480000, sampleRate: 48000, channels: 2, loop });
function catalog(music = false): AudioCatalog {
  return {
    schemaVersion: 1,
    clips: {
      hit: clip("hit"), effect: clip("effect"), voice: clip("voice"), sustained: clip("sustained", { start: 0.9230625, end: 8.9230625 }),
      normal: clip("normal", { start: 0.9230625, end: 9.9230625 }), danger: clip("danger"),
      other: clip("other"), otherDanger: clip("otherDanger"), outro: clip("outro"),
    },
    bgm: music ? {
      jamie: { title: "Jamie", normal: "normal", danger: "danger", outro: "outro" },
      metro: { title: "Metro", normal: "other", danger: "otherDanger" },
    } : {},
    feedback: {},
  };
}
const cue = (tick: number, clipId = "hit", extras: Record<string, unknown> = {}) => ({ type: "audio", tick, clipId, channel: "sfx", fighterId: "p1", scope: "p1:action:1", ...extras }) as unknown as BattleEvent;
const stop = (tick: number, extras: Record<string, unknown> = {}) => ({ type: "audio-stop", tick, fighterId: "p1", scope: "p1:action:1", ...extras }) as unknown as BattleEvent;
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function setup(withMusic = false, withIntro = false, withVoices = false) {
  const context = new Context();
  const assets = catalog(withMusic);
  if (withVoices) assets.voices = { test: { language: 'ja', requests: {
    1: { clips:['voice'],priority:50,prioritizeFirst:true,skipRate:0,limit:1,releaseMs:50,avoidRepeat:1 },
    2: { clips:['effect'],priority:100,prioritizeFirst:false,skipRate:0,limit:1,releaseMs:50,avoidRepeat:1 },
  }, scenes: {}, victory: [], ko: { normal:692,finish:693,launched:690,finishLaunched:691,down:694,finishDown:695 } } };
  if (withIntro) {
    assets.clips.intro = clip("intro");
    assets.bgm.jamie.intro = "intro";
  }
  const fetchAudio = vi.fn(async (url: string, _init: RequestInit) => ({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode(url.match(/([^/]+)\.ogg$/)![1]).buffer as ArrayBuffer,
  }));
  const createContext = vi.fn(() => context as unknown as AudioContext);
  const audio = new BattleAudio({ catalog: assets, createContext, fetch: fetchAudio, baseUrl: "/arena/" });
  return { audio, context, fetchAudio, createContext };
}

describe("authored battle audio", () => {
  it("creates one context on a user enable gesture, resolves BASE_URL, and ignores legacy hit/move events", async () => {
    const { audio, context, fetchAudio, createContext } = setup();
    audio.consume([cue(1)]);
    expect(createContext).not.toHaveBeenCalled();
    audio.setEnabled(true);
    expect(context.resume).toHaveBeenCalledOnce();
    await audio.warmup(["hit"]);
    audio.consume([
      { type: "move", tick: 1, fighterId: "p1", moveId: "S01", name: "test", x: 0, y: 0 },
      { type: "hit", tick: 1, sourceId: "p1", targetId: "p2", amount: 100, x: 0, y: 0 },
      cue(1),
    ], [], { tick: 1, speed: 1 });
    expect(context.sources).toHaveLength(1);
    expect(fetchAudio).toHaveBeenCalledWith("/arena/audio/hit.ogg", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    audio.setEnabled(false); audio.setEnabled(true);
    expect(createContext).toHaveBeenCalledOnce();
    audio.dispose();
  });

  it("spreads cues across simulation ticks at 1x and 4x without changing sample playback rate", async () => {
    const { audio, context } = setup();
    audio.setEnabled(true); await audio.warmup(["hit"]);
    audio.consume([cue(1), cue(7)], [], { tick: 7, speed: 1 });
    expect(context.sources[1].start.mock.calls[0][0] - context.sources[0].start.mock.calls[0][0]).toBeCloseTo(0.1, 8);
    audio.reset();
    audio.consume([cue(101), cue(107)], [], { tick: 107, speed: 4 });
    expect(context.sources[3].start.mock.calls[0][0] - context.sources[2].start.mock.calls[0][0]).toBeCloseTo(0.025, 8);
    expect(context.sources.every(source => source.playbackRate.value === 1)).toBe(true);
    // Super intro time is represented by the host's presentation tick even if the combat tick is frozen.
    context.currentTime = 0.05;
    audio.consume([cue(113)], [], { tick: 113, speed: 4 });
    expect(context.sources[4].start.mock.calls[0][0] - context.sources[2].start.mock.calls[0][0]).toBeCloseTo(0.05, 8);
    audio.dispose();
  });

  it("deduplicates a simultaneous preload and several cue decodes", async () => {
    const { audio, context, fetchAudio } = setup();
    const response = deferred<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>();
    fetchAudio.mockReturnValue(response.promise);
    audio.setEnabled(true);
    const warmup = audio.warmup(["hit"]);
    audio.consume([cue(1), cue(2)], [], { tick: 2, speed: 1 });
    await flush();
    expect(fetchAudio).toHaveBeenCalledOnce();
    response.resolve({ ok: true, arrayBuffer: async () => new TextEncoder().encode("hit").buffer as ArrayBuffer });
    await warmup; await flush();
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(2);
    audio.dispose();
  });

  it("preserves finite tails on an action change, and explicit native stops target only named clips", async () => {
    const { audio, context } = setup();
    audio.setEnabled(true); await audio.warmup(["hit", "effect", "sustained"]);
    audio.consume([cue(1, "hit"), cue(1, "effect"), cue(1, "sustained"), cue(1, "sustained", { fighterId: "p2" })]);
    audio.consume([stop(2, { loopsOnly: true })]);
    expect(context.sources[0].stop).not.toHaveBeenCalled();
    expect(context.sources[1].stop).not.toHaveBeenCalled();
    expect(context.sources[2].stop).toHaveBeenCalledOnce();
    expect(context.sources[3].stop).not.toHaveBeenCalled();
    expect(context.sources[2].loopStart).toBe(0.9230625);
    expect(context.sources[2].loopEnd).toBe(8.9230625);
    audio.consume([stop(3, { clipIds: ["effect"], fadeMs: 50 })]);
    expect(context.sources[0].stop).not.toHaveBeenCalled();
    expect(context.sources[1].stop.mock.calls[0][0]).toBeCloseTo(0.02 + 2 / 60 + 0.05, 8);
    audio.dispose();
    expect(context.sources.every(source => source.stop.mock.calls.length > 0)).toBe(true);
  });

  it("enables reviewed voices after master unlock and removes them on opt-out", async () => {
    const { audio, context } = setup();
    audio.setEnabled(true); await audio.warmup(["voice"]);
    audio.consume([cue(1, "voice", { channel: "voice" })]);
    expect(context.sources).toHaveLength(1);
    audio.configure({ voiceEnabled: false });
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    audio.consume([cue(2, "voice", { channel: "voice" })]);
    expect(context.sources).toHaveLength(1);
    audio.dispose();
  });

  it('never resurrects a pending grunt after a higher-priority voice replaces it',async()=>{
    const {audio,context}=setup(false,false,true),old=deferred<AudioBuffer>();
    context.decodeOperation=id=>id==='voice'?old.promise:Promise.resolve({duration:10,clipId:id} as unknown as AudioBuffer);
    audio.setEnabled(true);
    audio.consume([{type:'voice',tick:1,fighterId:'p1',characterId:'test',voiceId:1}]);await flush();
    audio.consume([{type:'voice',tick:2,fighterId:'p1',characterId:'test',voiceId:2}]);await flush();
    old.resolve({duration:10,clipId:'voice'} as unknown as AudioBuffer);await flush();
    expect(context.sources.map(s=>s.buffer?.clipId)).toEqual(['effect']);audio.dispose();
  });
  it('cancels paused opening speech including a decode that completes after skip',async()=>{
    const {audio,context}=setup(false,false,true),old=deferred<AudioBuffer>();context.decodeOperation=()=>old.promise;
    audio.setEnabled(true);audio.consume([{type:'voice',tick:1,fighterId:'p1',characterId:'test',voiceId:1}]);await flush();
    audio.pause();audio.stopVoices();audio.resume();old.resolve({duration:10,clipId:'voice'} as unknown as AudioBuffer);await flush();
    expect(context.sources).toHaveLength(0);audio.dispose();
  });

  it("preserves a native fade for a pending decode, and discards a cue arriving after its stop begins", async () => {
    for (const decodeAt of [0.05, 0.13]) {
      const { audio, context } = setup();
      const decoded = deferred<AudioBuffer>();
      context.decodeOperation = () => decoded.promise;
      audio.setEnabled(true);
      audio.consume([cue(1, "effect"), stop(7, { clipIds: ["effect"], fadeMs: 50 })]);
      await flush();
      context.currentTime = decodeAt;
      decoded.resolve({ duration: 10, clipId: "effect" } as unknown as AudioBuffer);
      await flush();
      if (decodeAt < 0.12) {
        expect(context.sources).toHaveLength(1);
        expect(context.gains.at(-1)?.gain.ramps).toContainEqual({ value: 0, at: 0.17 });
        expect(context.sources[0].stop.mock.calls[0][0]).toBeCloseTo(0.17, 8);
      } else expect(context.sources).toHaveLength(0);
      audio.dispose();
    }
  });

  it("invalidates stale fetch/decode completions after reset, mute, or disposal", async () => {
    for (const operation of ["reset", "mute", "dispose"] as const) {
      const { audio, context } = setup();
      const decoded = deferred<AudioBuffer>();
      context.decodeOperation = () => decoded.promise;
      audio.setEnabled(true);
      audio.consume([cue(1)]);
      await flush();
      expect(context.decodeAudioData).toHaveBeenCalledOnce();
      if (operation === "mute") audio.setEnabled(false);
      else audio[operation]();
      expect(audio.getStatus().loading).toBe(0);
      decoded.resolve({ duration: 10 } as AudioBuffer);
      await flush();
      expect(context.sources).toHaveLength(0);
      audio.dispose();
    }
  });

  it("drops late unloaded effects instead of replaying a backlog, and tolerates failed clips", async () => {
    const { audio, context, fetchAudio } = setup();
    const decoded = deferred<AudioBuffer>();
    context.decodeOperation = () => decoded.promise;
    audio.setEnabled(true); audio.consume([cue(1)]);
    await flush();
    context.currentTime = 1;
    decoded.resolve({ duration: 10 } as AudioBuffer); await flush();
    expect(context.sources).toHaveLength(0);
    fetchAudio.mockRejectedValue(new Error("network"));
    await audio.warmup(["effect"]);
    expect(audio.getStatus().failedClips).toBe(1);
    audio.consume([cue(60, "effect")]); await flush();
    expect(context.sources).toHaveLength(0);
    audio.dispose();
  });

  it("releases an old warmup immediately on restart even when platform decoding cannot be cancelled", async () => {
    const { audio, context } = setup();
    const decoded = deferred<AudioBuffer>();
    context.decodeOperation = () => decoded.promise;
    audio.setEnabled(true);
    let finished = false;
    const preload = audio.warmup(["hit"]).then(() => { finished = true; });
    await flush();
    expect(finished).toBe(false);
    audio.reset(); await flush();
    expect(finished).toBe(true);
    decoded.resolve({ duration: 10 } as AudioBuffer);
    await preload;
    audio.consume([cue(1)]); await flush();
    // A restarted round loads afresh instead of accepting the invalidated decoder's buffer.
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    audio.dispose();
  });

  it("pauses and resumes the same sources without restarting their buffers", async () => {
    const { audio, context } = setup();
    audio.setEnabled(true); await audio.warmup(["hit"]);
    audio.consume([cue(1)]);
    audio.pause(); await flush();
    expect(context.state).toBe("suspended");
    expect(context.sources[0].stop).not.toHaveBeenCalled();
    audio.resume(); await flush();
    expect(context.state).toBe("running");
    expect(context.sources).toHaveLength(1);
    audio.dispose();
  });

  it("unlocks during an enable gesture even when the host is initially paused", async () => {
    const { audio, context } = setup();
    audio.pause(); audio.setEnabled(true);
    expect(context.resume).toHaveBeenCalledOnce();
    await flush();
    expect(context.state).toBe("suspended");
    expect(audio.getStatus().state).toBe("paused");
    audio.resume(); await flush();
    expect(context.state).toBe("running");
    audio.dispose();
  });

  it("recovers the requested final context state when a stale resume resolves after disable", async () => {
    const { audio, context } = setup();
    const resume = deferred<void>();
    context.resumeOperation = async () => { await resume.promise; context.state = "running"; };
    audio.setEnabled(true); audio.setEnabled(false);
    resume.resolve(); await flush();
    expect(context.state).toBe("suspended");
    expect(audio.getStatus().state).toBe("off");
    audio.dispose();
  });

  it("reports unsupported and blocked contexts without throwing into the game", async () => {
    const unsupported = new BattleAudio({ createContext: () => { throw new Error("unsupported"); }, catalog: catalog() });
    expect(() => unsupported.setEnabled(true)).not.toThrow();
    expect(unsupported.getStatus().state).toBe("unsupported");
    const { audio, context } = setup();
    context.resumeOperation = () => Promise.reject(new Error("gesture required"));
    audio.setEnabled(true); await flush();
    expect(audio.getStatus().state).toBe("blocked");
    audio.consume([cue(1)]);
    expect(context.sources).toHaveLength(0);
    context.resumeOperation = undefined;
    audio.setEnabled(true); await flush();
    expect(audio.getStatus().state).toBe("ready");
    audio.dispose();
  });

  it("loops one BGM, switches at either fighter's 25% threshold, and restores the normal branch", async () => {
    const { audio, context } = setup(true);
    audio.configure({ musicMode: "jamie" });
    audio.updateMusic({ phase: "running", fighters: [{ hp: 1000, maxHp: 1000 }, { hp: 1000, maxHp: 1000 }] });
    audio.setEnabled(true); await flush();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer?.clipId).toBe("normal");
    expect(context.sources[0].loop).toBe(true);
    expect(context.sources[0].loopStart).toBe(0.9230625);
    audio.updateMusic({ phase: "running", fighters: [{ hp: 1000, maxHp: 1000 }, { hp: 250, maxHp: 1000 }] });
    await flush();
    expect(context.sources[1].buffer?.clipId).toBe("danger");
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    for (let i = 0; i < 4; i++) audio.updateMusic({ phase: "running", fighters: [{ hp: 1000, maxHp: 1000 }, { hp: 250, maxHp: 1000 }] });
    await flush();
    expect(context.sources).toHaveLength(2);
    audio.updateMusic({ phase: "running", fighters: [{ hp: 251, maxHp: 1000 }, { hp: 251, maxHp: 1000 }] });
    await flush();
    expect(context.sources[2].buffer?.clipId).toBe("normal");
    audio.updateMusic({ phase: "finished", fighters: [] }); await flush();
    expect(context.sources[3].buffer?.clipId).toBe("outro");
    expect(context.sources[3].loop).toBe(false);
    audio.dispose();
  });

  it("cancels stale music loads when health/track selection reverses quickly", async () => {
    const { audio, context } = setup(true);
    const other = deferred<AudioBuffer>();
    audio.configure({ musicMode: "jamie" });
    audio.updateMusic({ phase: "running", fighters: [] }); audio.setEnabled(true); await flush();
    context.decodeOperation = id => id === "other" ? other.promise : Promise.resolve({ duration: 10, clipId: id } as unknown as AudioBuffer);
    audio.configure({ musicMode: "stage", stageId: "metro" }); await flush();
    audio.configure({ musicMode: "jamie" });
    other.resolve({ duration: 10, clipId: "other" } as unknown as AudioBuffer); await flush();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].stop).not.toHaveBeenCalled();
    audio.dispose();
  });

  it("preloads effects and the selected soundtrack without decoding every stage's music", async () => {
    const { audio, fetchAudio } = setup(true);
    audio.configure({ musicMode: "jamie" }); audio.setEnabled(true);
    await audio.warmup();
    const urls = fetchAudio.mock.calls.map(call => call[0]);
    expect(urls).toContain("/arena/audio/normal.ogg");
    expect(urls).toContain("/arena/audio/danger.ogg");
    expect(urls).toContain("/arena/audio/hit.ogg");
    expect(urls).not.toContain("/arena/audio/other.ogg");
    expect(urls).not.toContain("/arena/audio/otherDanger.ogg");
    audio.dispose();
  });

  it("keeps a ready intro stable across repeated status and volume updates", async () => {
    const { audio, context } = setup(true, true);
    audio.configure({ musicMode: "jamie" });
    audio.setEnabled(true); await flush();
    expect(context.sources.map(source => source.buffer?.clipId)).toEqual(["intro", "normal"]);
    expect(context.sources[0].loop).toBe(false);
    expect(context.sources[1].start.mock.calls[0][0]).toBe(10.02);
    for (let frame = 0; frame < 5; frame++) {
      context.currentTime += 0.5;
      audio.updateMusic({ phase: "ready", fighters: [] });
      audio.configure({ musicVolume: 0.25 });
      await flush();
    }
    expect(context.sources).toHaveLength(2);
    expect(context.sources.every(source => source.stop.mock.calls.length === 0)).toBe(true);
    audio.dispose();
  });

  it("enters the fight loop immediately when battle starts before the intro finishes", async () => {
    const { audio, context } = setup(true, true);
    audio.configure({ musicMode: "jamie" }); audio.setEnabled(true); await flush();
    context.currentTime = 1;
    audio.updateMusic({ phase: "running", fighters: [] }); await flush();
    expect(context.sources.map(source => source.buffer?.clipId)).toEqual(["intro", "normal", "normal"]);
    expect(context.sources[2].start.mock.calls[0][0]).toBe(1.02);
    expect(context.sources[2].loop).toBe(true);
    expect(context.sources[0].stop.mock.calls[0][0]).toBeCloseTo(1.2, 8);
    // The original normal was queued after a long intro. Cancel it before its start.
    expect(context.sources[1].stop.mock.calls[0][0]).toBe(1);
    for (let frame = 0; frame < 4; frame++) audio.updateMusic({ phase: "running", fighters: [] });
    await flush();
    expect(context.sources).toHaveLength(3);
    audio.dispose();
  });

  it("keeps the existing normal loop's position when the intro already completed naturally", async () => {
    const { audio, context } = setup(true, true);
    audio.configure({ musicMode: "jamie" }); audio.setEnabled(true); await flush();
    context.currentTime = 10.02;
    context.sources[0].onended?.();
    audio.updateMusic({ phase: "running", fighters: [] }); await flush();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].stop).not.toHaveBeenCalled();
    expect(context.sources[1].start.mock.calls[0][0]).toBe(10.02);
    audio.updateMusic({ phase: "ready", fighters: [] }); await flush();
    expect(context.sources).toHaveLength(2);
    audio.dispose();
  });

  it("invalidates an intro still decoding when the fight starts", async () => {
    const { audio, context } = setup(true, true);
    const intro = deferred<AudioBuffer>();
    context.decodeOperation = id => id === "intro" ? intro.promise : Promise.resolve({ duration: 10, clipId: id } as unknown as AudioBuffer);
    audio.configure({ musicMode: "jamie" }); audio.setEnabled(true); await flush();
    expect(context.sources).toHaveLength(0);
    audio.updateMusic({ phase: "running", fighters: [] }); await flush();
    expect(context.sources.map(source => source.buffer?.clipId)).toEqual(["normal"]);
    intro.resolve({ duration: 20, clipId: "intro" } as unknown as AudioBuffer); await flush();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].stop).not.toHaveBeenCalled();
    audio.dispose();
  });

  it("retains a paused ready intro and switches after resuming directly into battle", async () => {
    const { audio, context } = setup(true, true);
    audio.configure({ musicMode: "jamie" }); audio.setEnabled(true); await flush();
    context.currentTime = 1;
    audio.updateMusic({ phase: "paused", fighters: [] }); await flush();
    expect(context.state).toBe("suspended");
    audio.resume(); audio.updateMusic({ phase: "ready", fighters: [] }); await flush();
    expect(context.sources).toHaveLength(2);
    expect(context.sources.every(source => source.stop.mock.calls.length === 0)).toBe(true);
    audio.updateMusic({ phase: "paused", fighters: [] }); await flush();
    audio.resume(); audio.updateMusic({ phase: "running", fighters: [] }); await flush();
    expect(context.sources.map(source => source.buffer?.clipId)).toEqual(["intro", "normal", "normal"]);
    expect(context.sources[2].start.mock.calls[0][0]).toBe(1.02);
    audio.dispose();
  });

  it("lets danger and outro replace a ready intro, and re-arms the intro only after reset", async () => {
    const { audio, context } = setup(true, true);
    audio.configure({ musicMode: "jamie" }); audio.setEnabled(true); await flush();
    context.currentTime = 1;
    audio.updateMusic({ phase: "ready", fighters: [{ hp: 250, maxHp: 1000 }] }); await flush();
    expect(context.sources[2].buffer?.clipId).toBe("danger");
    expect(context.sources[1].stop).toHaveBeenCalledWith(1);
    audio.updateMusic({ phase: "ready", fighters: [{ hp: 251, maxHp: 1000 }] }); await flush();
    expect(context.sources[3].buffer?.clipId).toBe("normal");
    audio.reset(); audio.updateMusic({ phase: "ready", fighters: [] }); await flush();
    expect(context.sources.slice(-2).map(source => source.buffer?.clipId)).toEqual(["intro", "normal"]);
    audio.updateMusic({ phase: "finished", fighters: [] }); await flush();
    expect(context.sources.at(-1)?.buffer?.clipId).toBe("outro");
    expect(context.sources.at(-1)?.loop).toBe(false);
    expect(context.sources.at(-2)?.stop).toHaveBeenCalled();
    audio.dispose();
  });

  it("cancels a pending early-start switch if the queued normal loop begins before that switch applies", async () => {
    const { audio, context } = setup(true, true);
    audio.configure({ musicMode: "jamie" }); audio.setEnabled(true); await flush();
    context.currentTime = 10.01;
    audio.updateMusic({ phase: "running", fighters: [] });
    // A subsequent host observation can cross the intro boundary before microtasks flush.
    context.currentTime = 10.02;
    audio.updateMusic({ phase: "running", fighters: [] }); await flush();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].stop).not.toHaveBeenCalled();
    audio.dispose();
  });
});
