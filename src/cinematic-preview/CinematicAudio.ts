import {
  cinematicAudioManifest, compileAudioTimeline,
  type CinematicAudioManifest, type CinematicMode, type ScheduledCinematicCue,
} from "./audio-timeline";

interface AudioResponse { ok: boolean; status?: number; arrayBuffer(): Promise<ArrayBuffer> }
export interface CinematicAudioDependencies {
  manifest?: CinematicAudioManifest;
  createContext?: () => AudioContext;
  fetch?: (url: string, init: RequestInit) => Promise<AudioResponse>;
  baseUrl?: string;
}
interface PlayingSource { source: AudioBufferSourceNode; gain: GainNode }
interface AudioClock { mode: CinematicMode; frame: number; speed: number; at: number }
const LEAD_SECONDS = 0.012;
const DRIFT_FRAMES = 3;

/** Independent review transport: one audio clock, original voices, repeatable seeks. */
export class CinematicAudio {
  private readonly manifest: CinematicAudioManifest;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private voices: GainNode | null = null;
  private recording: MediaStreamAudioDestinationNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loads = new Map<string, Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private readonly sources = new Set<PlayingSource>();
  private readonly failures = new Map<string, string>();
  private clock: AudioClock | null = null;
  private enabled = true;
  private volume = 0.8;
  private unlocked = false;
  private ready = false;
  private disposed = false;

  constructor(private readonly dependencies: CinematicAudioDependencies = {}) {
    this.manifest = dependencies.manifest ?? cinematicAudioManifest;
  }

  private ensureContext(): AudioContext {
    if (this.disposed) throw new Error("Cinematic audio is disposed");
    if (this.context) return this.context;
    const create = this.dependencies.createContext ?? (() => {
      const Context = globalThis.AudioContext
        ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) throw new Error("Web Audio is unavailable");
      return new Context();
    });
    const context = this.context = create();
    this.master = context.createGain();
    this.effects = context.createGain(); this.voices = context.createGain();
    this.effects.gain.value = 0.65; this.voices.gain.value = 1;
    this.effects.connect(this.master); this.voices.connect(this.master);
    this.master.gain.value = this.enabled ? this.volume : 0;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -3; compressor.knee.value = 6; compressor.ratio.value = 12;
    compressor.attack.value = 0.003; compressor.release.value = 0.12;
    this.master.connect(compressor); compressor.connect(context.destination);
    if (typeof context.createMediaStreamDestination === "function") {
      this.recording = context.createMediaStreamDestination();
      compressor.connect(this.recording);
    }
    return context;
  }

  /** Predecode without starting playback or attempting an autoplay-policy bypass. */
  async warmup(): Promise<void> {
    const context = this.ensureContext();
    const pending = Object.keys(this.manifest.clips);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, pending.length) }, async () => {
      while (next < pending.length) await this.loadBuffer(pending[next++], context);
    }));
    if (!this.disposed) this.ready = this.buffers.size === pending.length;
  }

  private loadBuffer(id: string, context: AudioContext): Promise<void> {
    if (this.buffers.has(id)) return Promise.resolve();
    const prior = this.loads.get(id);
    if (prior) return prior;
    const controller = new AbortController(); this.controllers.add(controller);
    const clip = this.manifest.clips[id];
    const base = (this.dependencies.baseUrl ?? import.meta.env.BASE_URL).replace(/\/?$/, "/");
    const url = /^https?:\/\//.test(clip.url) ? clip.url : base + clip.url.replace(/^\/+/, "");
    const load = (async () => {
      try {
        const fetchAudio = this.dependencies.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
        const response = await fetchAudio(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Audio request failed: ${response.status ?? "unknown"}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!this.disposed) { this.buffers.set(id, buffer); this.failures.delete(id); }
      } catch (error) {
        if (!this.disposed) this.failures.set(id, error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        this.controllers.delete(controller); this.loads.delete(id);
      }
    })();
    this.loads.set(id, load);
    return load;
  }

  /** Invoke directly in a user gesture; await this before advancing the picture clock. */
  async unlock(): Promise<void> {
    const context = this.ensureContext();
    // resume() must be invoked before the first await, while gesture activation exists.
    const resume = context.state === "running" ? Promise.resolve() : context.resume();
    await Promise.all([resume, this.warmup()]);
    if (this.disposed) throw new Error("Cinematic audio is disposed");
    if (context.state !== "running") throw new Error("Audio requires a user gesture");
    this.unlocked = true;
  }

  /** Already decoded/unlocked: scheduling is synchronous, with no late decode surprises. */
  start(mode: CinematicMode, frame = 0, speed = 1): boolean {
    if (this.disposed || this.enabled && (!this.ready || !this.unlocked || this.context?.state !== "running")) return false;
    this.reschedule(mode, frame, speed);
    return true;
  }

  /** Call while the picture is playing. A seek, loop, mode/speed change replaces all old sources. */
  sync(mode: CinematicMode, frame: number, speed = 1): void {
    if (!this.clock || this.disposed) return;
    const now = this.context?.currentTime ?? 0;
    const expected = this.clock.frame + (now - this.clock.at) * this.manifest.framesPerSecond * this.clock.speed;
    if (mode !== this.clock.mode || speed !== this.clock.speed || Math.abs(frame - expected) > DRIFT_FRAMES) {
      this.reschedule(mode, frame, speed);
    }
  }

  private reschedule(mode: CinematicMode, frame: number, speed: number): void {
    if (!Number.isFinite(frame) || !(speed > 0) || !Number.isFinite(speed)) throw new RangeError("Invalid cinematic audio time");
    this.clearSources();
    const track = this.manifest.tracks[mode];
    const position = Math.max(0, Math.min(frame, track.frameCount));
    const context = this.context;
    const at = (context?.currentTime ?? 0) + LEAD_SECONDS;
    this.clock = { mode, frame: position, speed, at };
    if (!this.enabled || !this.ready || !this.unlocked || !context || context.state !== "running") return;
    const elapsed = position / (this.manifest.framesPerSecond * speed);
    for (const cue of compileAudioTimeline(mode, speed, this.manifest)) this.scheduleCue(cue, elapsed, at, context);
  }

  private scheduleCue(cue: ScheduledCinematicCue, elapsed: number, anchor: number, context: AudioContext): void {
    const buffer = this.buffers.get(cue.clipId);
    if (!buffer || cue.until <= elapsed) return;
    const offset = Math.max(0, elapsed - cue.at) * cue.playbackRate;
    if (offset >= buffer.duration) return;
    const when = anchor + Math.max(0, cue.at - elapsed);
    const until = Math.min(anchor + cue.until - elapsed, when + (buffer.duration - offset) / cue.playbackRate);
    if (until <= when) return;
    const source = context.createBufferSource(), gain = context.createGain();
    const node: PlayingSource = { source, gain };
    source.buffer = buffer; source.playbackRate.value = cue.playbackRate;
    source.connect(gain); gain.connect(cue.channel === "voice" ? this.voices! : this.effects!);
    const level = this.manifest.clips[cue.clipId].gain ?? 1;
    const fade = Math.min(cue.releaseSeconds, (until - when) / 2);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, Math.min(when + 0.003, until - fade));
    gain.gain.setValueAtTime(level, until - fade);
    gain.gain.linearRampToValueAtTime(0, until);
    source.onended = () => {
      this.sources.delete(node); source.disconnect(); gain.disconnect();
    };
    this.sources.add(node);
    source.start(when, offset); source.stop(until);
  }

  pause(): void { this.clearSources(); this.clock = null; }
  stop(): void { this.pause(); }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    const clock = this.clock;
    const frame = clock ? clock.frame + ((this.context?.currentTime ?? 0) - clock.at)
      * this.manifest.framesPerSecond * clock.speed : 0;
    this.enabled = enabled;
    if (this.master) this.master.gain.setValueAtTime(enabled ? this.volume : 0, this.context!.currentTime);
    if (!enabled) this.clearSources();
    else if (clock) this.reschedule(clock.mode, frame, clock.speed);
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.setValueAtTime(this.enabled ? this.volume : 0, this.context!.currentTime);
  }

  /** The same post-compressor signal as the speakers; add its audio tracks to the canvas stream. */
  getRecordingStream(): MediaStream | null { this.ensureContext(); return this.recording?.stream ?? null; }

  getState() {
    return { enabled: this.enabled, volume: this.volume, ready: this.ready, unlocked: this.unlocked,
      playing: this.clock !== null, contextState: this.context?.state ?? "uncreated", sources: this.sources.size,
      loaded: this.buffers.size, failures: Object.fromEntries(this.failures) };
  }

  private clearSources(): void {
    for (const node of this.sources) {
      node.source.onended = null;
      try { node.source.stop(); } catch { /* It may already have ended at its authored boundary. */ }
      node.source.disconnect(); node.gain.disconnect();
    }
    this.sources.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.pause();
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear(); this.buffers.clear();
    void this.context?.close().catch(() => undefined);
  }
}
