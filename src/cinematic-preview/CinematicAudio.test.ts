import { describe, expect, it, vi } from "vitest";
import { CinematicAudio } from "./CinematicAudio";
import type { CinematicAudioManifest } from "./audio-timeline";

class Parameter {
  value = 1;
  readonly setValueAtTime = vi.fn((value: number, _at: number) => { this.value = value; return this; });
  readonly linearRampToValueAtTime = vi.fn((value: number, _at: number) => { this.value = value; return this; });
}
class Gain {
  gain = new Parameter();
  connect = vi.fn();
  disconnect = vi.fn();
}
class Source {
  buffer: (AudioBuffer & { clipId: string }) | null = null;
  playbackRate = new Parameter();
  onended: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn();
  start = vi.fn((_at: number, _offset: number) => undefined);
  stop = vi.fn((_at?: number) => undefined);
}
class Context {
  state: AudioContextState = "suspended";
  currentTime = 0;
  destination = {};
  sources: Source[] = [];
  gains: Gain[] = [];
  recording = { stream: { getAudioTracks: () => [{ kind: "audio" }] } };
  resumeOperation?: () => Promise<void>;
  resume = vi.fn(async () => { if (this.resumeOperation) await this.resumeOperation(); this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
  decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => ({ duration: 4,
    clipId: new TextDecoder().decode(bytes) }) as unknown as AudioBuffer);
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain; }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  createMediaStreamDestination() { return this.recording; }
  createDynamicsCompressor() { return { threshold: new Parameter(), knee: new Parameter(), ratio: new Parameter(),
    attack: new Parameter(), release: new Parameter(), connect: vi.fn() }; }
}
function setup() {
  const track = { bodyFrames: 240, tailFrames: 15, frameCount: 255, contacts: [], cues: [
    { id: "composition", frame: 0, actor: "attacker", channel: "sfx", clipId: "se" },
    { id: "line", frame: 30, actor: "attacker", channel: "voice", voiceId: 1 },
    { id: "late", frame: 180, actor: "attacker", channel: "sfx", clipId: "se" },
  ] } as CinematicAudioManifest["tracks"]["SA3"];
  const manifest: CinematicAudioManifest = { schemaVersion: 1, framesPerSecond: 60, language: "ja",
    clips: { se: { url: "/assets/se.ogg", seconds: 4 }, voice: { url: "/assets/voice.ogg", seconds: 2 } },
    voiceRequests: { 1: { clips: ["voice"], priority: 80, prioritizeFirst: false, skipRate: 0,
      limit: 1, releaseMs: 50, avoidRepeat: 1 } }, tracks: { SA3: track, CA: track } };
  const context = new Context();
  const fetchAudio = vi.fn(async (url: string, _init: RequestInit) => ({ ok: true,
    arrayBuffer: async () => new TextEncoder().encode(url.includes("voice") ? "voice" : "se").buffer as ArrayBuffer }));
  const audio = new CinematicAudio({ manifest, createContext: () => context as unknown as AudioContext,
    fetch: fetchAudio, baseUrl: "/arena/" });
  return { audio, context, fetchAudio };
}

describe("cinematic Web Audio transport", () => {
  it("preloads once, calls gesture resume before waiting, and cannot start a locked transport", async () => {
    const { audio, context, fetchAudio } = setup();
    const preload = audio.warmup();
    expect(context.resume).not.toHaveBeenCalled();
    expect(audio.start("SA3", 0)).toBe(false);
    let release!: () => void;
    context.resumeOperation = () => new Promise<void>(resolve => { release = resolve; });
    const unlock = audio.unlock();
    expect(context.resume).toHaveBeenCalledOnce();
    await preload;
    expect(audio.start("SA3", 0)).toBe(false);
    release(); await unlock;
    expect(audio.start("SA3", 0)).toBe(true);
    expect(fetchAudio).toHaveBeenCalledTimes(2);
    expect(fetchAudio).toHaveBeenCalledWith("/arena/assets/voice.ogg", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(audio.getRecordingStream()?.getAudioTracks()).toEqual([{ kind: "audio" }]);
    audio.dispose();
  });

  it("repeated syncs do not restart scheduled cues; seeking restores the active long composition and line", async () => {
    const { audio, context } = setup();
    await audio.unlock(); audio.start("CA", 0);
    const first = [...context.sources];
    for (let frame = 1; frame <= 30; frame++) {
      context.currentTime = 0.012 + frame / 60;
      audio.sync("CA", frame);
    }
    expect(context.sources).toHaveLength(3);
    audio.start("CA", 90);
    for (const source of first) {
      expect(source.stop).toHaveBeenLastCalledWith();
      expect(source.disconnect).toHaveBeenCalledOnce();
    }
    const resumed = context.sources.slice(3);
    expect(resumed).toHaveLength(3);
    const voice = resumed.find(source => source.buffer?.clipId === "voice")!;
    expect(voice.start.mock.calls[0][1]).toBe(1);
    expect(resumed.find(source => source.buffer?.clipId === "se")!.start.mock.calls[0][1]).toBe(1.5);
    expect(voice.playbackRate.value).toBe(1);
    audio.dispose();
  });

  it("cancels future sources on pause and preserves voice pitch across slow review and loop resets", async () => {
    const { audio, context } = setup();
    await audio.unlock(); audio.start("SA3", 60, 0.5);
    const voices = context.sources.filter(source => source.buffer?.clipId === "voice");
    expect(voices[0].playbackRate.value).toBe(1);
    expect(voices[0].start.mock.calls[0][1]).toBe(1);
    expect(context.sources.find(source => source.buffer?.clipId === "se")!.playbackRate.value).toBe(0.5);
    const old = [...context.sources]; audio.pause();
    const count = context.sources.length;
    context.currentTime += 2; audio.sync("SA3", 180, 0.5);
    expect(context.sources).toHaveLength(count);
    expect(old.every(source => source.stop.mock.calls.at(-1)!.length === 0)).toBe(true);
    expect(audio.start("SA3", 0, 0.5)).toBe(true);
    expect(audio.getState().sources).toBe(3);
    audio.dispose();
    expect(audio.getState().sources).toBe(0);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("rebuilds for speed changes, mutes without leaking sources, and restores from the current position", async () => {
    const { audio, context } = setup();
    await audio.unlock(); audio.start("SA3", 30);
    context.currentTime = 0.512;
    audio.sync("SA3", 60, 2);
    expect(audio.getState().sources).toBeGreaterThan(0);
    const old = context.sources.slice(-3);
    audio.setEnabled(false);
    expect(audio.getState().sources).toBe(0);
    expect(old.every(source => source.stop.mock.calls.at(-1)!.length === 0)).toBe(true);
    context.currentTime += 0.25;
    audio.sync("SA3", 90, 2);
    audio.setEnabled(true);
    expect(audio.getState().sources).toBeGreaterThan(0);
    audio.setVolume(9); expect(audio.getState().volume).toBe(1);
    audio.setVolume(-1); expect(audio.getState().volume).toBe(0);
    audio.stop(); expect(audio.getState().playing).toBe(false);
    audio.dispose();
  });

  it("lets a late tail seek finish an existing voice without starting recovery cues", async () => {
    const { audio, context } = setup();
    await audio.unlock();
    audio.start("SA3", 245);
    // The test line has already finished. Only the late SE can still ring in the frozen-picture tail.
    expect(context.sources.every(source => source.buffer?.clipId === "se")).toBe(true);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start.mock.calls[0][1]).toBeCloseTo(65 / 60);
    audio.start("SA3", 255);
    expect(audio.getState().sources).toBe(0);
    audio.dispose();
  });
});
