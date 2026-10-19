import { Battle } from "../game/Battle";
import { createDemonstration } from "../game/training";
import type { BattleFactory, CharacterStatus } from "../engine/characters";
import { STEP, TICK_RATE, type BattleConfig, type BattleEvent, type BattleState, type CharacterId, type FighterId, type Fighter } from "../engine/types";
import { BattleAudio } from "../view/audio/BattleAudio";
import type { AudioSettings, AudioStatus } from "../view/audio/types";
import { OpeningSequence, type OpeningSnapshot, type OpeningStage } from "./OpeningSequence";

export type BattleAudioSettings = Omit<AudioSettings, "stageId">;
const DEFAULT_AUDIO: BattleAudioSettings = { masterVolume: 0.8, musicVolume: 0.45, effectsVolume: 0.8, voiceVolume: 0.75, voiceEnabled: true, musicMode: "stage" };
function audioSettings(input: Partial<BattleAudioSettings> = {}): BattleAudioSettings {
  const settings = { ...DEFAULT_AUDIO };
  for (const key of ["masterVolume", "musicVolume", "effectsVolume", "voiceVolume"] as const) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) settings[key] = Math.max(0, Math.min(1, value));
  }
  if (typeof input.voiceEnabled === "boolean") settings.voiceEnabled = input.voiceEnabled;
  if (input.musicMode === "jamie" || input.musicMode === "stage") settings.musicMode = input.musicMode;
  return settings;
}
function savedAudioSettings(): BattleAudioSettings {
  try { return audioSettings(JSON.parse(localStorage.getItem("arena-lab-audio") ?? "{}")); }
  catch { return { ...DEFAULT_AUDIO }; }
}

export type RuntimePhase = "ready" | "opening" | "running" | "paused" | "finished";
export interface BattleLog {
  id: number;
  tick: number;
  text: string;
  kind: "neutral" | FighterId | "result";
  category: "damage" | "defense" | "heal" | "action" | "result";
  event: BattleEvent;
}
export interface BattleSummary {
  opening: OpeningSnapshot | null;
  mode: "battle" | "demonstration";
  demonstration: Battle["demonstration"] | null;
  superFreezeRemaining: number;
  superFreezeSourceId: FighterId | null;
  phase: RuntimePhase;
  loaded: boolean;
  elapsed: number;
  roundElapsed: number;
  speed: number;
  sound: boolean;
  audio: BattleAudioSettings & { loading: boolean; state: AudioStatus["state"]; failedClips: number };
  seed: number;
  projectileCount: number;
  winner: FighterId | null;
  result: BattleState["result"];
  fighters: (Fighter & { player: 1 | 2; label: string; status: CharacterStatus })[];
  logs: BattleLog[];
  revision: number;
}

export class BattleRuntime {
  battle: Battle;
  private paused = false;
  private speed = 1;
  private loaded = false;
  private sound = false;
  private accumulator = 0;
  private summaryClock = 0;
  private revision = 0;
  private logId = 0;
  private logs: BattleLog[] = [];
  private events: BattleEvent[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly audio = new BattleAudio();
  private audioSettings = savedAudioSettings();
  private audioStage = "metro";
  private audioTick = 0;
  private audioPreparing = false;
  private audioLoadGeneration = 0;
  private disposed = false;
  private opening: OpeningSequence | null = null;
  private summary: BattleSummary;
  private automaticConfig: BattleConfig;
  private readonly savedCharacterSettings = new Map<string, import("../engine/types").CharacterSettings>();

  constructor(config: BattleConfig, private readonly factory: BattleFactory = (settings) => new Battle(settings)) {
    this.battle = this.factory(config);
    this.automaticConfig = this.battle.config;
    this.audio.setVoiceSeed?.(this.battle.config.seed);
    this.synchronizeAudio();
    this.summary = this.createSummary();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSummary = (): BattleSummary => this.summary;
  getState = (): BattleState => this.battle.state;

  get alpha(): number {
    return Math.min(1, this.accumulator / STEP);
  }
  get isPaused(): boolean {
    return this.paused || this.audioPreparing || this.audioBlocked || this.battle.state.phase !== "running";
  }
  private get audioBlocked(): boolean { return this.sound && this.audio.getStatus().state === "blocked"; }
  get timeScale(): number {
    return this.isPaused ? 0 : this.speed;
  }

  setLoaded(loaded: boolean): void {
    this.loaded = loaded;
    if (!loaded) {
      if (this.battle.state.phase === "running" || this.opening) this.paused = true;
      this.audio.pause();
    }
    this.publish();
  }

  start(): void {
    if (!this.loaded) return;
    this.battle.start();
    this.paused = false;
    this.audio.resume();
    this.publish();
  }

  /** Normal UI entry; direct start() remains available for scripted simulation/training. */
  startWithOpening(): void {
    if (!this.loaded || this.battle.state.phase !== "ready" || this.opening) return;
    if (this.battle.demonstration) { this.start(); return; }
    const stages: OpeningStage[] = [];
    const add = (fighter: Fighter, scene: string, label: string) => {
      const duration = this.audio.voiceSceneDuration(fighter.characterId, scene);
      if (duration > 0) stages.push({ fighterId: fighter.id, characterId: fighter.characterId, scene, label, duration });
    };
    this.battle.state.fighters.forEach(f => add(f, `prefight-${f.id}`, `${f.id === "p1" ? "1P 开场" : "2P 回应"}`));
    if (!stages.length) { this.start(); return; }
    this.opening = new OpeningSequence(stages); this.paused = false; this.audio.resume(); this.synchronizeAudio(); this.publish();
  }

  skipOpening(): void {
    if (!this.opening) return;
    this.audio.stopVoices();
    this.opening = null; this.paused = false; this.accumulator = 0; this.start();
  }

  getOpening(): OpeningSnapshot | null { return this.opening?.snapshot() ?? null; }

  togglePause(): void {
    if (this.battle.state.phase !== "running" && !this.opening) return;
    this.paused = !this.paused;
    this.accumulator = 0;
    if (this.paused) this.audio.pause();
    else this.audio.resume();
    this.publish();
  }

  pause(): void {
    if (!this.paused && (this.battle.state.phase === "running" || this.opening))
      this.togglePause();
    else this.audio.pause();
  }

  restart(config: BattleConfig = this.battle.config, autoplay = true, opening = false): void {
    const demonstration = this.battle.demonstration;
    if (demonstration) {
      this.replaceBattle(createDemonstration(demonstration.characterId, demonstration.variantId, config, demonstration.scenario, this.factory, autoplay), autoplay);
    } else {
      this.automaticConfig = config;
      this.replaceBattle(this.factory(config), autoplay && !opening);
      if (autoplay && opening) this.startWithOpening();
    }
  }

  demonstrate(variantId: string, scenario: "hit" | "block" | "whiff" = "hit", autoplay = true): void {
    if (!this.battle.demonstration) this.automaticConfig = this.battle.config;
    this.replaceBattle(createDemonstration(this.battle.state.fighters[0].characterId, variantId, this.automaticConfig, scenario, this.factory, autoplay), autoplay);
  }

  exitDemonstration(autoplay = true): void {
    this.replaceBattle(this.factory(this.automaticConfig), autoplay);
  }

  private replaceBattle(battle: Battle, autoplay: boolean): void {
    this.audioLoadGeneration += 1;
    this.audioPreparing = false;
    this.audio.reset();
    this.audio.setVoiceSeed?.(battle.config.seed);
    this.opening = null;
    this.audioTick = 0;
    this.battle = battle;
    this.accumulator = 0;
    this.summaryClock = 0;
    this.paused = !autoplay && battle.state.phase === "running";
    this.logs = [];
    this.events = [];
    this.logId = 0;
    this.revision += 1;
    if (autoplay && this.loaded) {
      this.battle.start();
      this.audio.resume();
    } else this.audio.pause();
    this.synchronizeAudio();
    if (this.sound) this.prepareAudio();
    this.publish();
  }

  get characters() { return this.battle.characters; }

  configureFighter(player: 1 | 2, settings: import("../engine/types").CharacterSettings, autoplay = false): void {
    const config = this.battle.demonstration ? this.automaticConfig : this.battle.config;
    const fighters = this.normalizedSelections(config);
    fighters[player - 1] = this.characters.normalize({ characterId: fighters[player - 1].characterId, settings });
    this.savedCharacterSettings.set(`${player}:${fighters[player - 1].characterId}`, { ...fighters[player - 1].settings });
    this.automaticConfig = { ...config, fighters };
    this.replaceBattle(this.factory(this.automaticConfig), autoplay);
  }

  private normalizedSelections(config: BattleConfig): [import("../engine/types").CharacterSelection, import("../engine/types").CharacterSelection] {
    const choices = config.fighters ?? this.battle.config.fighters;
    return [this.characters.normalize(choices[0]), this.characters.normalize(choices[1])];
  }

  selectFighter(player: 1 | 2, characterId: CharacterId): void {
    const config = this.battle.demonstration ? this.automaticConfig : this.battle.config;
    const fighters = this.normalizedSelections(config);
    if (fighters[player - 1].characterId === characterId) return;
    const current = fighters[player - 1];
    this.savedCharacterSettings.set(`${player}:${current.characterId}`, { ...current.settings });
    const saved = this.savedCharacterSettings.get(`${player}:${characterId}`);
    fighters[player - 1] = this.characters.normalize(saved ? { characterId, settings: saved } : characterId);
    this.automaticConfig = { ...config, fighters };
    this.replaceBattle(this.factory(this.automaticConfig), false);
  }

  fighterLabel(id: FighterId): string {
    const index = id === "p1" ? 0 : 1;
    const fighter = this.battle.state.fighters[index];
    return `${index + 1}P ${this.characters.get(fighter.characterId).metadata.name}`;
  }

  setSpeed(speed: number): void {
    if (![0.25, 0.5, 1, 2, 4].includes(speed)) return;
    this.speed = speed;
    this.publish();
  }

  toggleSound(): void {
    this.sound = !this.sound;
    this.audio.setEnabled(this.sound);
    if (this.sound && !this.audio.getStatus().enabled) this.sound = false;
    this.audioLoadGeneration += 1;
    this.audioPreparing = false;
    this.synchronizeAudio();
    if (this.sound) this.prepareAudio();
    if (this.isPaused && this.battle.state.phase !== "ready")
      this.audio.pause();
    this.publish();
  }

  setAudioSettings(settings: Partial<BattleAudioSettings>): void {
    this.audioSettings = audioSettings({ ...this.audioSettings, ...settings });
    try { localStorage.setItem("arena-lab-audio", JSON.stringify(this.audioSettings)); } catch { /* Preferences are optional. */ }
    this.synchronizeAudio();
    this.publish();
  }

  setAudioStage(stageId: string): void {
    if (stageId === this.audioStage) return;
    this.audioStage = stageId;
    this.synchronizeAudio();
  }

  private synchronizeAudio(): void {
    this.audio.configure({ ...this.audioSettings, stageId: this.battle.demonstration && this.audioSettings.musicMode === "stage" ? "training" : this.audioStage });
    this.audio.updateMusic({ phase: this.paused || !this.loaded && this.battle.state.phase !== "ready" ? "paused" : this.opening ? "running" : this.battle.state.phase, fighters: this.battle.state.fighters });
  }

  private prepareAudio(): void {
    const generation = ++this.audioLoadGeneration;
    this.audioPreparing = true;
    this.accumulator = 0;
    void this.audio.warmup().finally(() => {
      if (this.disposed || generation !== this.audioLoadGeneration || !this.sound) return;
      this.audioPreparing = false;
      this.accumulator = 0;
      if (this.paused || !this.loaded && this.battle.state.phase !== "ready") this.audio.pause();
      else this.audio.resume();
      this.synchronizeAudio();
      this.publish();
    });
  }

  advance(realDeltaSeconds: number): BattleEvent[] {
    const events: BattleEvent[] = [];
    const audioEvents: BattleEvent[] = [];
    const realDelta = Number.isFinite(realDeltaSeconds) ? Math.max(0, realDeltaSeconds) : 0;
    if (this.opening) {
      if (this.loaded && !this.paused && !this.audioPreparing && !this.audioBlocked) {
        const stage = this.opening.advance(realDelta);
        if (stage) events.push({ type: "voice", tick: this.audioTick, fighterId: stage.fighterId, characterId: stage.characterId, scene: stage.scene, scope: 'opening', force: true });
        this.recordEvents(events);
        this.audio.consume(events, this.battle.state.fighters, { tick: this.audioTick, speed: 1 });
        this.audioTick += realDelta * TICK_RATE;
        if (this.opening.complete) { this.opening = null; this.battle.start(); this.accumulator = 0; }
      }
      this.synchronizeAudio(); this.publish(); return events;
    }
    if (!this.isPaused && this.loaded) {
      this.accumulator += realDelta * this.speed;
      // Keep elapsed time after a slow render frame. Limit work per call, retaining
      // any backlog, so rendering performance cannot change the simulation rate.
      let steps = 0;
      while (this.accumulator + 1e-9 >= STEP && steps++ < TICK_RATE * 4) {
        this.battle.step();
        this.audioTick += 1;
        this.accumulator = Math.max(0, this.accumulator - STEP);
        const stepEvents = this.battle.takeEvents();
        events.push(...stepEvents);
        for (const event of stepEvents) if (event.type === "audio" || event.type === "audio-stop" || event.type === "voice" || event.type === "voice-stop") audioEvents.push({ ...event, tick: this.audioTick });
        if (this.battle.state.phase === "finished") {
          this.accumulator = 0;
          break;
        }
      }
    } else if (!this.audioPreparing && !this.audioBlocked) {
      events.push(...this.battle.takeEvents());
      for (const event of events) if (event.type === "audio" || event.type === "audio-stop" || event.type === "voice" || event.type === "voice-stop") audioEvents.push({ ...event, tick: this.audioTick });
    }
    this.recordEvents(events);
    const finished = events.some(event => event.type === "finished");
    for (const event of events) if (event.type === "death") {
      const fighter = this.battle.state.fighters.find(f => f.id === event.fighterId)!;
      const voiceId = this.audio.koVoiceRequest?.(fighter.characterId, finished, fighter.height > 10, fighter.knockdownUntilTick > this.battle.state.tick);
      if (voiceId !== undefined) audioEvents.push({ type: "voice", tick: this.audioTick, fighterId: fighter.id, characterId: fighter.characterId, voiceId, force: true });
    }
    if (finished && !this.battle.demonstration && this.battle.state.winner) {
      const winner = this.battle.state.fighters.find(f => f.id === this.battle.state.winner)!;
      const scene = this.audio.victoryVoiceScene?.(winner.characterId, winner.hp, winner.maxHp);
      if (scene) audioEvents.push({ type: "voice", tick: this.audioTick, fighterId: winner.id, characterId: winner.characterId, scene, force: true });
    }
    if (events.some(event => event.type === "finished")) audioEvents.push({ type: "audio-stop", tick: this.audioTick, loopsOnly: true });
    this.audio.consume(audioEvents, this.battle.state.fighters, { tick: this.audioTick, speed: this.speed });
    this.synchronizeAudio();
    this.summaryClock += realDelta;
    if (
      this.summaryClock >= 0.1 ||
      events.some(
        (event) => event.type === "finished" || event.type === "started",
      )
    ) {
      this.summaryClock = 0;
      this.publish();
    }
    return events;
  }

  dispose(): void {
    this.disposed = true;
    this.audioLoadGeneration += 1;
    this.audio.dispose();
    this.listeners.clear();
  }

  exportLog(): string {
    return JSON.stringify({
      version: 1,
      mode: this.battle.demonstration ? "demonstration" : "battle",
      demonstration: this.battle.demonstration ?? null,
      config: this.battle.config,
      phase: this.getSummary().phase,
      tickRate: TICK_RATE,
      tick: this.battle.state.tick,
      winner: this.battle.state.winner,
      result: this.battle.state.result,
      fighters: this.battle.state.fighters.map(fighter => ({ id: fighter.id, characterId: fighter.characterId, label: this.fighterLabel(fighter.id), hp: fighter.hp, maxHp: fighter.maxHp, damageDealt: fighter.damageDealt, hits: fighter.hits, healing: fighter.healing })),
      logs: this.logs,
      events: this.events,
    }, null, 2);
  }

  private recordEvents(events: readonly BattleEvent[]): void {
    this.events.push(...structuredClone(events));
    for (const event of events) {
      const add = (text: string, kind: BattleLog["kind"], category: BattleLog["category"] = "action") => {
        this.logs.push({ id: this.logId++, tick: event.tick, text, kind, category, event: structuredClone(event) });
      };
      if (event.type === "started")
        add(this.battle.demonstration ? "招式演练 · 准备起手条件" : "双方入场，对决开始", "neutral");
      else if (event.type === "dash")
        add(`${this.fighterLabel(event.fighterId)} 发起突袭`, event.fighterId);
      else if (event.type === "drink")
        add(`${this.fighterLabel(event.fighterId)} 饮酒完成 · 酒级 ${event.level}`, event.fighterId);
      else if (event.type === "move")
        add(`${this.fighterLabel(event.fighterId)} · ${event.name}${event.variantId ? ` [${event.variantId}]` : ""}`, event.fighterId);
      else if (event.type === "interrupt")
        add(`${this.fighterLabel(event.fighterId)} ${event.label ?? "动作被打断"}`, event.fighterId);
      else if (event.type === "contact") {
        const label = event.perfect ? "精准格挡" : event.parry ? "格挡" : event.damageType === "chip" ? "防御削血" : event.outcome === "block" ? "防御" : event.punish ? "确反" : event.counter ? "反击" : "命中";
        const outcome = event.deferred ? `捕获收尾 · 执行已结算伤害的 KO · 实扣 ${event.hpLoss} HP` : `${label} · ${event.amount} 伤害`;
        add(`${this.fighterLabel(event.sourceId)} → ${this.fighterLabel(event.targetId)} · ${event.name ?? event.moveId ?? "攻击"}${event.segment !== undefined ? ` · 第 ${event.segment + 1} 段` : ""} · ${outcome}`, event.sourceId, event.amount > 0 || event.outcome === "hit" ? "damage" : "defense");
      } else if (event.type === "heal")
        add(`${this.fighterLabel(event.targetId)} ${event.reason === "recoverable" ? "可恢复生命回复" : "生命回复"} · +${event.amount} HP`, event.targetId, "heal");
      else if (event.type === "wall")
        add(`${this.fighterLabel(event.fighterId)} 撞墙`, event.fighterId);
      else if (event.type === "cinematic")
        add(`${this.fighterLabel(event.sourceId)} → ${this.fighterLabel(event.targetId)} · ${event.moveId} · ${event.phase === "finish" ? "捕获收尾" : "捕获连段"}`, event.sourceId);
      else if (event.type === "death")
        add(`${this.fighterLabel(event.fighterId)} 被击倒 · KO`, event.fighterId, "result");
      else if (event.type === "finished") {
        add(
          this.battle.demonstration
            ? "招式演练结束，可重播或选择下一招"
            : event.winner
            ? `${this.fighterLabel(event.winner)} 获胜！${event.reason === "timeout" ? "（时间到）" : "（KO）"}`
            : "双方势均力敌，本局平局",
          "result", "result",
        );
      }
    }
  }

  private publish(): void {
    this.summary = this.createSummary();
    this.listeners.forEach((listener) => listener());
  }

  private createSummary(): BattleSummary {
    const state = this.battle.state;
    return {
      opening: this.getOpening(),
      mode: this.battle.demonstration ? "demonstration" : "battle",
      demonstration: this.battle.demonstration ? { ...this.battle.demonstration } : null,
      superFreezeRemaining: state.superFreezeRemaining ?? 0,
      superFreezeSourceId: state.superFreezeSourceId ?? null,
      phase: this.paused && (state.phase === "running" || this.opening) ? "paused" : this.opening ? "opening" : state.phase,
      loaded: this.loaded,
      elapsed: state.tick / TICK_RATE,
      roundElapsed: (state.tick - (state.roundStopTicks ?? 0)) / TICK_RATE,
      speed: this.speed,
      sound: this.sound,
      audio: { ...this.audioSettings, loading: this.audioPreparing || this.audio.getStatus().loading > 0, state: this.audio.getStatus().state, failedClips: this.audio.getStatus().failedClips },
      seed: this.battle.config.seed,
      projectileCount: state.projectiles.length,
      winner: state.winner,
      result: state.result,
      fighters: state.fighters.map((fighter, index) => ({
        ...structuredClone(fighter), player: (index + 1) as 1 | 2,
        label: this.fighterLabel(fighter.id), status: this.battle.describe(fighter),
      })),
      logs: [...this.logs].reverse(),
      revision: this.revision,
    };
  }
}
