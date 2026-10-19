import { Battle } from "../game/Battle";
import { createDemonstration } from "../game/training";
import type { BattleFactory, CharacterStatus } from "../engine/characters";
import { STEP, TICK_RATE, type BattleConfig, type BattleEvent, type BattleState, type CharacterId, type FighterId, type Fighter } from "../engine/types";
import { BattleAudio } from "../view/audio/BattleAudio";

export type RuntimePhase = "ready" | "running" | "paused" | "finished";
export interface BattleLog {
  id: number;
  tick: number;
  text: string;
  kind: "neutral" | FighterId | "result";
  category: "damage" | "defense" | "heal" | "action" | "result";
  event: BattleEvent;
}
export interface BattleSummary {
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
  private readonly audio = new BattleAudio((id) => this.characters.get(id).audio);
  private summary: BattleSummary;
  private automaticConfig: BattleConfig;
  private readonly savedCharacterSettings = new Map<string, import("../engine/types").CharacterSettings>();

  constructor(config: BattleConfig, private readonly factory: BattleFactory = (settings) => new Battle(settings)) {
    this.battle = this.factory(config);
    this.automaticConfig = this.battle.config;
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
    return this.paused || this.battle.state.phase !== "running";
  }
  get timeScale(): number {
    return this.isPaused ? 0 : this.speed;
  }

  setLoaded(loaded: boolean): void {
    this.loaded = loaded;
    if (!loaded) {
      if (this.battle.state.phase === "running") this.paused = true;
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

  togglePause(): void {
    if (this.battle.state.phase !== "running") return;
    this.paused = !this.paused;
    this.accumulator = 0;
    if (this.paused) this.audio.pause();
    else this.audio.resume();
    this.publish();
  }

  pause(): void {
    if (!this.paused && this.battle.state.phase === "running")
      this.togglePause();
  }

  restart(config: BattleConfig = this.battle.config, autoplay = true): void {
    const demonstration = this.battle.demonstration;
    if (demonstration) {
      this.replaceBattle(createDemonstration(demonstration.characterId, demonstration.variantId, config, demonstration.scenario, this.factory, autoplay), autoplay);
    } else {
      this.automaticConfig = config;
      this.replaceBattle(this.factory(config), autoplay);
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
    if (this.isPaused && this.battle.state.phase !== "ready")
      this.audio.pause();
    this.publish();
  }

  advance(realDeltaSeconds: number): BattleEvent[] {
    const events: BattleEvent[] = [];
    const realDelta = Number.isFinite(realDeltaSeconds) ? Math.max(0, realDeltaSeconds) : 0;
    if (!this.isPaused && this.loaded) {
      this.accumulator += realDelta * this.speed;
      // Keep elapsed time after a slow render frame. Limit work per call, retaining
      // any backlog, so rendering performance cannot change the simulation rate.
      let steps = 0;
      while (this.accumulator + 1e-9 >= STEP && steps++ < TICK_RATE * 4) {
        this.battle.step();
        this.accumulator = Math.max(0, this.accumulator - STEP);
        events.push(...this.battle.takeEvents());
        if (this.battle.state.phase === "finished") {
          this.accumulator = 0;
          break;
        }
      }
    } else {
      events.push(...this.battle.takeEvents());
    }
    this.recordEvents(events);
    this.audio.consume(this.battle.demonstration ? events.filter((event) => event.type !== "finished") : events, this.battle.state.fighters);
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
      mode: this.battle.demonstration ? "demonstration" : "battle",
      demonstration: this.battle.demonstration ? { ...this.battle.demonstration } : null,
      superFreezeRemaining: state.superFreezeRemaining ?? 0,
      superFreezeSourceId: state.superFreezeSourceId ?? null,
      phase: this.paused && state.phase === "running" ? "paused" : state.phase,
      loaded: this.loaded,
      elapsed: state.tick / TICK_RATE,
      roundElapsed: (state.tick - (state.roundStopTicks ?? 0)) / TICK_RATE,
      speed: this.speed,
      sound: this.sound,
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
