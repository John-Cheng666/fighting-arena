import catalogData from "../../content/audio/catalog.json";
import type { AudioCatalog, AudioClip } from "../../content/audio/types";
import type { BattleEvent, CharacterId, FighterId } from "../../engine/types";
import type { AudioClock, AudioDependencies, AudioSettings, AudioStatus, MusicState } from "./types";
import { VoiceDirector, type VoiceEvent, type VoiceStop } from "./VoiceDirector";

const DEFAULT_SETTINGS: AudioSettings = {
  masterVolume: 0.8, musicVolume: 0.45, effectsVolume: 0.8, voiceVolume: 0.75,
  voiceEnabled: true, musicMode: "stage", stageId: "training",
};
const LEAD_SECONDS = 0.02;
const MAX_LATE_SECONDS = 0.15;
const CROSSFADE_SECONDS = 0.18;
const TICK_RATE = 60;

type SourceEvent = {
  type: "audio"; tick: number; fighterId?: FighterId; clipId: string;
  channel: "sfx" | "voice"; scope?: string; voiceToken?: number;
};
type StopEvent = {
  type: "audio-stop"; tick: number; fighterId?: FighterId; scope?: string; loopsOnly?: boolean;
  clipIds?: readonly string[]; fadeMs?: number;
};
interface Cue {
  event: SourceEvent;
  at: number;
  loop: boolean;
  epoch: number;
  cancelled: boolean;
  stopAt?: number;
  fadeAt?: number;
}
interface Voice {
  clipId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  channel: "sfx" | "voice" | "music";
  fighterId?: FighterId;
  scope?: string;
  loop: boolean;
  at: number;
  stopAt?: number;
  voiceToken?: number;
}
interface Load { promise: Promise<AudioBuffer | null>; controller: AbortController }

/** Plays authored source events only; combat decisions and cue clocks belong to the engine. */
export class BattleAudio {
  private context: AudioContext | null = null;
  private buses: { master: GainNode; music: GainNode; sfx: GainNode; voice: GainNode } | null = null;
  private enabled = false;
  private paused = false;
  private disposed = false;
  private unsupported = false;
  private blocked = false;
  private epoch = 0;
  private musicEpoch = 0;
  private readonly catalog: AudioCatalog;
  private readonly voiceDirector: VoiceDirector;
  private readonly dependencies: AudioDependencies;
  private settings: AudioSettings = { ...DEFAULT_SETTINGS };
  private musicState: MusicState = { phase: "ready", fighters: [] };
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loads = new Map<string, Load>();
  private readonly failures = new Map<string, number>();
  private readonly pending = new Set<Cue>();
  private readonly voices = new Set<Voice>();
  private clock: { tick: number; at: number; speed: number; lastTick: number } | null = null;
  private musicKey = "";
  private pendingMusicKey = "";
  private musicHasStarted = false;
  private introTransition: { introId: string; normalId: string; normal: Voice } | null = null;

  constructor(dependencies: AudioDependencies = {}) {
    this.dependencies = dependencies;
    this.catalog = this.dependencies.catalog ?? catalogData as AudioCatalog;
    this.voiceDirector = new VoiceDirector(this.catalog);
  }

  /** Call synchronously from a user gesture so browsers can unlock the context. */
  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.enabled = enabled;
    if (!enabled) {
      this.invalidate();
      this.synchronizeContext();
      return;
    }
    if (!this.context) {
      try {
        const create = this.dependencies.createContext ?? (() => {
          const Context = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Context) throw new Error("Web Audio is unavailable");
          return new Context();
        });
        this.context = create();
        const master = this.context.createGain();
        const music = this.context.createGain(), sfx = this.context.createGain(), voice = this.context.createGain();
        music.connect(master); sfx.connect(master); voice.connect(master); master.connect(this.context.destination);
        this.buses = { master, music, sfx, voice };
        this.unsupported = false;
        this.applyVolumes();
      } catch {
        void this.context?.close().catch(() => undefined);
        this.context = null;
        this.buses = null;
        this.unsupported = true;
        this.enabled = false;
        return;
      }
    }
    this.blocked = false;
    if (this.paused && this.context.state !== "running") {
      // A paused host must still unlock during this gesture; restore the requested
      // suspension as soon as it resolves.
      const context = this.context;
      try {
        void context.resume().then(() => {
          if (this.context === context && !this.disposed) this.synchronizeContext();
        }).catch(() => { if (this.context === context && this.enabled) this.blocked = true; });
      } catch { this.blocked = true; }
      return;
    }
    this.synchronizeContext();
  }

  configure(settings: Partial<AudioSettings>): void {
    if (this.disposed) return;
    const next = { ...this.settings, ...settings };
    for (const key of ["masterVolume", "musicVolume", "effectsVolume", "voiceVolume"] as const)
      next[key] = Number.isFinite(next[key]) ? Math.min(1, Math.max(0, next[key])) : this.settings[key];
    if (next.musicMode !== "stage" && next.musicMode !== "jamie") next.musicMode = this.settings.musicMode;
    this.settings = next;
    this.applyVolumes();
    if (!next.voiceEnabled) {
      this.voiceDirector.cancel({ type: "voice-stop", tick: 0 });
      for (const cue of this.pending) if (cue.event.channel === "voice") cue.cancelled = true;
      for (const voice of this.voices) if (voice.channel === "voice") this.stopVoice(voice);
    }
    this.synchronizeMusic();
  }

  getStatus(): AudioStatus {
    return {
      enabled: this.enabled,
      state: this.disposed || !this.enabled ? (this.unsupported ? "unsupported" : "off")
        : this.paused ? "paused" : this.blocked || this.context?.state !== "running" ? "blocked" : "ready",
      loading: this.loads.size,
      failedClips: this.failures.size,
    };
  }

  /** Preload effects and only the selected soundtrack. The host can await this before advancing. */
  async warmup(clipIds?: readonly string[]): Promise<void> {
    if (!this.context || this.disposed || !this.enabled) return;
    const epoch = this.epoch;
    const musicIds = new Set(Object.values(this.catalog.bgm).flatMap(track => Object.values(track).filter(id => typeof id === "string" && this.catalog.clips[id])));
    const track = this.selectedTrack();
    const selected = track ? [track.normal, track.danger, track.intro, track.outro].filter((id): id is string => !!id) : [];
    const voiceIds = new Set(Object.values(this.catalog.voices ?? {}).flatMap(v => [...Object.values(v.requests).flatMap(r => r.clips), ...Object.values(v.scenes).flat()]));
    const ids = [...new Set(clipIds ?? [...Object.keys(this.catalog.clips).filter(id => !musicIds.has(id) && (this.settings.voiceEnabled || !voiceIds.has(id))), ...selected])];
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length && epoch === this.epoch && this.enabled && !this.disposed) {
        const id = ids[cursor++];
        await this.load(id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
  }

  consume(
    events: readonly BattleEvent[],
    _fighters: readonly { id: FighterId; characterId: CharacterId }[] = [],
    clock?: AudioClock,
  ): void {
    const context = this.context;
    if (!this.enabled || this.paused || this.disposed || !context || context.state !== "running") return;
    const audioEvents = (events as readonly (BattleEvent | SourceEvent | StopEvent)[]).filter((event): event is SourceEvent | StopEvent | VoiceEvent | VoiceStop => event.type === "audio" || event.type === "audio-stop" || event.type === "voice" || event.type === "voice-stop");
    if (!audioEvents.length) return;
    const firstTick = Math.min(...audioEvents.map(event => event.tick));
    const currentTick = clock?.tick ?? Math.max(...audioEvents.map(event => event.tick));
    const speed = clock && Number.isFinite(clock.speed) && clock.speed > 0 ? clock.speed : 1;
    if (!this.clock || currentTick < this.clock.lastTick || speed !== this.clock.speed)
      this.clock = { tick: firstTick, at: context.currentTime + LEAD_SECONDS, speed, lastTick: currentTick };
    const predicted = this.clock.at + (firstTick - this.clock.tick) / TICK_RATE / speed;
    if (Math.abs(predicted - context.currentTime) > MAX_LATE_SECONDS)
      this.clock = { tick: firstTick, at: context.currentTime + LEAD_SECONDS, speed, lastTick: currentTick };
    this.clock.lastTick = currentTick;
    for (const event of audioEvents) {
      const at = Math.max(context.currentTime, this.clock.at + (event.tick - this.clock.tick) / TICK_RATE / speed);
      if (event.type === "audio-stop") this.stopMatching(event, at);
      else if (event.type === "voice-stop") for (const token of this.voiceDirector.cancel(event)) this.stopVoiceToken(token, at, 0);
      else if (event.type === "voice") {
        if (!this.settings.voiceEnabled) continue;
        const choice = this.voiceDirector.choose(event, at);
        if (!choice) continue;
        if (choice.replaced !== undefined) this.stopVoiceToken(choice.replaced, at, choice.releaseMs / 1000);
        this.queue({ type: "audio", tick: event.tick, fighterId: event.fighterId, clipId: choice.clipId, channel: "voice", scope: event.scope, voiceToken: choice.token }, at);
      }
      else if (event.channel !== "voice" || this.settings.voiceEnabled) this.queue(event, at);
    }
  }

  voiceSceneDuration(characterId: string, scene: string): number { return this.voiceDirector.sceneDuration(characterId, scene); }
  victoryVoiceScene(characterId: string, hp: number, maxHp: number): string | undefined { return this.voiceDirector.victoryScene(characterId, hp, maxHp); }
  koVoiceRequest(characterId: string, finish: boolean, launched: boolean, down: boolean): number | undefined { return this.voiceDirector.koRequest(characterId, finish, launched, down); }
  setVoiceSeed(seed: number): void { this.voiceDirector.reset(seed); }
  stopVoices(): void {
    this.voiceDirector.cancel({ type: "voice-stop", tick: 0 });
    for (const cue of this.pending) if (cue.event.channel === "voice") cue.cancelled = true;
    for (const voice of this.voices) if (voice.channel === "voice") this.stopVoice(voice);
  }

  updateMusic(state: MusicState): void {
    if (this.disposed) return;
    this.musicState = state;
    if (state.phase === "paused") this.pause();
    else this.synchronizeMusic();
  }

  pause(): void {
    if (this.disposed) return;
    this.paused = true;
    this.synchronizeContext();
  }

  resume(): void {
    if (this.disposed) return;
    this.paused = false;
    this.clock = null;
    this.synchronizeContext();
  }

  /** Discard a round's sources and pending requests, retaining decoded reusable buffers. */
  reset(): void {
    if (this.disposed) return;
    this.invalidate();
    this.musicHasStarted = false;
    this.musicState = { phase: "ready", fighters: [] };
  }

  restart(): void { this.reset(); }

  dispose(): void {
    if (this.disposed) return;
    this.enabled = false;
    this.disposed = true;
    this.invalidate();
    const context = this.context;
    this.context = null;
    this.buses = null;
    this.buffers.clear();
    void context?.close().catch(() => undefined);
  }

  private synchronizeContext(): void {
    const context = this.context;
    if (!context || this.disposed) return;
    const running = this.enabled && !this.paused;
    const stateMatches = running ? context.state === "running" : context.state === "suspended";
    if (stateMatches) {
      if (running) this.synchronizeMusic();
      return;
    }
    try {
      // Invoke immediately, inside setEnabled's user gesture, rather than in a promise chain.
      const operation = running ? context.resume() : context.suspend();
      void operation.then(() => {
        if (this.context !== context || this.disposed) return;
        this.blocked = false;
        if ((this.enabled && !this.paused) !== (context.state === "running")) this.synchronizeContext();
        else if (this.enabled && !this.paused) this.synchronizeMusic();
      }).catch(() => {
        if (this.context === context && this.enabled && !this.paused) this.blocked = true;
      });
    } catch { this.blocked = running; }
  }

  private applyVolumes(): void {
    if (!this.context || !this.buses) return;
    const at = this.context.currentTime;
    for (const [bus, value] of [
      [this.buses.master, this.settings.masterVolume], [this.buses.music, this.settings.musicVolume],
      [this.buses.sfx, this.settings.effectsVolume], [this.buses.voice, this.settings.voiceEnabled ? this.settings.voiceVolume : 0],
    ] as const) {
      bus.gain.cancelScheduledValues(at);
      bus.gain.setTargetAtTime(value, at, 0.01);
    }
  }

  private queue(event: SourceEvent, at: number): void {
    const clip = this.catalog.clips[event.clipId];
    if (!clip) return;
    const cue: Cue = { event, at, loop: !!clip.loop, epoch: this.epoch, cancelled: false };
    this.pending.add(cue);
    const play = (buffer: AudioBuffer | null) => {
      this.pending.delete(cue);
      const context = this.context;
      if (!buffer || !context || cue.cancelled || cue.epoch !== this.epoch || !this.enabled || this.paused || this.disposed
        || context.state !== "running" || (event.channel === "voice" && !this.settings.voiceEnabled)
        || context.currentTime - at > MAX_LATE_SECONDS || (cue.stopAt !== undefined && cue.stopAt <= Math.max(at, context.currentTime))
        || (cue.fadeAt !== undefined && cue.fadeAt <= context.currentTime)
        || (event.voiceToken !== undefined && !this.voiceDirector.current(event.voiceToken))) {
        if (event.voiceToken !== undefined) this.voiceDirector.release(event.voiceToken);
        return;
      }
      const voice = this.startVoice(event.clipId, buffer, Math.max(at, context.currentTime), event.channel, !!clip.loop, event);
      if (voice && cue.stopAt !== undefined) {
        if (cue.fadeAt !== undefined) this.fadeVoice(voice, cue.fadeAt, cue.stopAt);
        this.stopVoice(voice, cue.stopAt);
      }
      if (!voice && event.voiceToken !== undefined) this.voiceDirector.release(event.voiceToken);
    };
    const buffer = this.buffers.get(event.clipId);
    if (buffer) play(buffer);
    else void this.load(event.clipId).then(play);
  }

  private stopVoiceToken(token: number, at: number, fade: number): void {
    for (const cue of this.pending) if (cue.event.voiceToken === token) cue.cancelled = true;
    for (const voice of this.voices) if (voice.voiceToken === token) {
      if (fade) this.fadeVoice(voice, at, at + fade);
      this.stopVoice(voice, at + fade);
    }
  }

  private stopMatching(event: StopEvent, at: number): void {
    const matches = (target: { fighterId?: FighterId; scope?: string; clipId: string; loop: boolean }) =>
      (event.fighterId === undefined || target.fighterId === event.fighterId)
      && (event.scope === undefined || target.scope === event.scope)
      && (event.clipIds === undefined || event.clipIds.includes(target.clipId))
      && (!event.loopsOnly || target.loop);
    const fade = Number.isFinite(event.fadeMs) ? Math.max(0, event.fadeMs!) / 1000 : 0;
    for (const cue of this.pending) {
      if (cue.at > at || !matches({ ...cue.event, loop: cue.loop })) continue;
      if (at + fade < (cue.stopAt ?? Infinity)) {
        cue.stopAt = at + fade;
        cue.fadeAt = fade ? at : undefined;
      }
    }
    for (const voice of this.voices) {
      if (voice.channel === "music" || voice.at > at || !matches(voice)) continue;
      if (fade) this.fadeVoice(voice, at, at + fade);
      this.stopVoice(voice, at + fade);
    }
  }

  private startVoice(
    id: string, buffer: AudioBuffer, at: number, channel: Voice["channel"], loop: boolean,
    owner: { fighterId?: FighterId; scope?: string; voiceToken?: number } = {}, fadeIn = false,
  ): Voice | null {
    const context = this.context, buses = this.buses, clip = this.catalog.clips[id];
    if (!context || !buses || !clip) return null;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    if (loop) {
      const bounds = this.loopBounds(clip, buffer);
      source.loopStart = bounds.start;
      source.loopEnd = bounds.end;
    }
    const level = Number.isFinite(clip.gain) ? Math.max(0, clip.gain!) : 1;
    gain.gain.setValueAtTime(fadeIn ? 0 : level, at);
    if (fadeIn) gain.gain.linearRampToValueAtTime(level, at + CROSSFADE_SECONDS);
    source.connect(gain); gain.connect(buses[channel]);
    const voice: Voice = { clipId: id, source, gain, channel, ...owner, loop, at };
    this.voices.add(voice);
    source.onended = () => this.releaseVoice(voice);
    try { source.start(at); } catch { this.releaseVoice(voice); return null; }
    return voice;
  }

  private loopBounds(clip: AudioClip, buffer: AudioBuffer): { start: number; end: number } {
    const start = clip.loop && Number.isFinite(clip.loop.start) ? Math.max(0, Math.min(clip.loop.start, buffer.duration)) : 0;
    const end = clip.loop && Number.isFinite(clip.loop.end) ? Math.min(clip.loop.end, buffer.duration) : buffer.duration;
    return end > start ? { start, end } : { start: 0, end: buffer.duration };
  }

  private stopVoice(voice: Voice, at = this.context?.currentTime ?? 0): void {
    if (voice.stopAt !== undefined && voice.stopAt <= at) return;
    voice.stopAt = at;
    try { voice.source.stop(at); } catch { this.releaseVoice(voice); }
    // Immediate stop can be cleaned up now; scheduled stops stay connected until onended.
    if (at <= (this.context?.currentTime ?? 0)) this.releaseVoice(voice);
  }

  private fadeVoice(voice: Voice, from: number, to: number): void {
    voice.gain.gain.cancelScheduledValues(from);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, from);
    voice.gain.gain.linearRampToValueAtTime(0, to);
  }

  private releaseVoice(voice: Voice): void {
    if (voice.voiceToken !== undefined) this.voiceDirector.release(voice.voiceToken);
    if (!this.voices.delete(voice)) return;
    voice.source.onended = null;
    voice.source.disconnect();
    voice.gain.disconnect();
  }

  private selectedTrack() {
    return this.catalog.bgm[this.settings.musicMode === "jamie" ? "jamie" : this.settings.stageId] ?? this.catalog.bgm.jamie;
  }

  private synchronizeMusic(): void {
    const context = this.context;
    if (!context || context.state !== "running" || !this.enabled || this.paused || this.disposed || this.musicState.phase === "paused") return;
    const track = this.selectedTrack();
    if (!track) return;
    const transition = this.introTransition;
    if (transition && transition.normal.at <= context.currentTime && transition.normal.stopAt === undefined && this.voices.has(transition.normal)) {
      // The queued loop has already begun. Entering battle now should keep its
      // exact position, rather than treating the completed intro as a new switch.
      this.musicKey = `loop:${transition.normalId}`;
      this.introTransition = null;
      if (this.pendingMusicKey === this.musicKey) {
        this.musicEpoch++;
        this.pendingMusicKey = "";
      }
    }
    const finished = this.musicState.phase === "finished";
    const danger = this.musicState.fighters.some(fighter => fighter.maxHp > 0 && fighter.hp / fighter.maxHp <= 0.25);
    const id = finished ? track.outro : danger ? track.danger : track.normal;
    // The intro is a stable ready-state target. musicHasStarted changes after
    // scheduling, so it alone cannot identify whether an intro should continue.
    const continueIntro = this.introTransition?.introId === track.intro && this.introTransition?.normalId === id;
    const introId = !finished && !danger && this.musicState.phase === "ready" && (!this.musicHasStarted || continueIntro) ? track.intro : undefined;
    const key = finished ? `finished:${id ?? "none"}` : introId ? `intro:${introId}:${id}` : `loop:${id}`;
    if (key === this.musicKey) {
      // A rapid health/track reversal must invalidate a different in-flight request.
      if (this.pendingMusicKey && this.pendingMusicKey !== key) {
        this.musicEpoch++;
        this.pendingMusicKey = "";
      }
      return;
    }
    if (key === this.pendingMusicKey) return;
    const generation = ++this.musicEpoch;
    this.pendingMusicKey = key;
    if (!id) {
      this.fadeMusic(context.currentTime);
      this.introTransition = null;
      this.musicKey = key; this.pendingMusicKey = "";
      return;
    }
    const epoch = this.epoch;
    void Promise.all([this.load(id), introId ? this.load(introId) : Promise.resolve(null)]).then(([buffer, intro]) => {
      if (generation !== this.musicEpoch) return;
      this.pendingMusicKey = "";
      if (!buffer || this.epoch !== epoch || !this.enabled || this.paused || this.disposed || this.context !== context || context.state !== "running") return;
      const at = context.currentTime + LEAD_SECONDS;
      this.fadeMusic(at);
      const introVoice = intro && introId ? this.startVoice(introId, intro, at, "music", false, {}, true) : null;
      const normal = this.startVoice(id, buffer, at + (introVoice ? intro!.duration : 0), "music", !finished, {}, !introVoice);
      this.introTransition = introVoice && introId && normal ? { introId, normalId: id, normal } : null;
      this.musicHasStarted = true;
      this.musicKey = introId && !introVoice ? `loop:${id}` : key;
    });
  }

  private fadeMusic(at: number): void {
    for (const voice of this.voices) {
      if (voice.channel !== "music" || voice.stopAt !== undefined) continue;
      if (voice.at > (this.context?.currentTime ?? at)) { this.stopVoice(voice); continue; }
      this.fadeVoice(voice, at, at + CROSSFADE_SECONDS);
      this.stopVoice(voice, at + CROSSFADE_SECONDS);
    }
  }

  private load(id: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(id);
    if (cached) return Promise.resolve(cached);
    const existing = this.loads.get(id);
    if (existing) return existing.promise;
    const clip = this.catalog.clips[id], context = this.context;
    if (!clip || !context || this.disposed || Date.now() - (this.failures.get(id) ?? -Infinity) < 1000) return Promise.resolve(null);
    const controller = new AbortController();
    let cancelDecode!: () => void;
    const cancelled = new Promise<null>(resolve => { cancelDecode = () => resolve(null); });
    controller.signal.addEventListener("abort", cancelDecode, { once: true });
    const fetchAudio = this.dependencies.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
    const base = this.dependencies.baseUrl ?? import.meta.env.BASE_URL;
    const url = /^(?:https?:|data:|blob:)/.test(clip.url) ? clip.url : `${base.replace(/\/?$/, "/")}${clip.url.replace(/^\/+/, "")}`;
    const promise = Promise.resolve().then(async () => {
      try {
        const response = await fetchAudio(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Audio response failed");
        const bytes = await response.arrayBuffer();
        if (controller.signal.aborted || this.context !== context) return null;
        // decodeAudioData itself cannot be aborted; the race releases the old warmup
        // immediately, while the epoch/signal checks discard a decoder's late result.
        const buffer = await Promise.race([context.decodeAudioData(bytes), cancelled]);
        if (!buffer || controller.signal.aborted || this.context !== context || this.disposed) return null;
        this.buffers.set(id, buffer);
        this.failures.delete(id);
        return buffer;
      } catch {
        if (!controller.signal.aborted) this.failures.set(id, Date.now());
        return null;
      } finally {
        controller.signal.removeEventListener("abort", cancelDecode);
        if (this.loads.get(id)?.controller === controller) this.loads.delete(id);
      }
    });
    this.loads.set(id, { promise, controller });
    return promise;
  }

  private invalidate(): void {
    this.voiceDirector.reset();
    this.epoch++;
    this.musicEpoch++;
    this.musicKey = ""; this.pendingMusicKey = "";
    this.introTransition = null;
    this.clock = null;
    for (const cue of this.pending) cue.cancelled = true;
    this.pending.clear();
    for (const voice of this.voices) this.stopVoice(voice);
    for (const load of this.loads.values()) load.controller.abort();
    this.loads.clear();
  }
}
