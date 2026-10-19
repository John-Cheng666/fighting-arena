import type { Battle } from "./Battle";
import type { BattleConfig, BattleEvent, BattleState, CharacterSelection, CharacterSettings, ContactDetails, Fighter, FighterId, PendingHit, ResolvedBattleConfig } from "./types";

export interface CharacterSetting {
  key: string; label: string; default: number | string | boolean;
  kind: "number" | "select";
  min?: number; max?: number; step?: number;
  options?: readonly { value: string | number; label: string }[];
}
export interface CharacterStatus {
  badge?: string;
  intent: string; actionName: string; actionId: string | null; actionFrame: number; actionDuration: number;
  phaseLabel: string; hitCount: number; subLabel?: string; dashing?: boolean; foreground?: boolean;
  cinematic?: {
    title: string; zoom: number; targetId?: FighterId; shade: number; frame: number; finalImpact?: boolean;
    superArt?: {
      key: string; style: "spin" | "install" | "strike" | "critical";
      introFrame: number; introDuration: number; frame: number; duration: number;
      confirmed: boolean; finishing: boolean; contactFrame: number; hitCount: number;
    };
  };
}
export interface CharacterFrame {
  state: BattleState; config: ResolvedBattleConfig; actors: readonly Fighter[];
  random: () => number; hits: PendingHit[]; events: BattleEvent[]; aiEnabled: boolean;
}
export interface HitLedger {
  alive: ReadonlySet<FighterId>; damage: Map<string, number>; healing: Map<string, number>; finishing: Set<string>;
  suppressed: Set<FighterId>;
}
export interface HitContext {
  state: BattleState; hit: PendingHit; source: Fighter; target: Fighter; events: BattleEvent[]; ledger: HitLedger;
  outcome: { kind: "ignored" | "hit" | "block"; amount: number; armor: boolean };
  details?: ContactDetails;
}
export type BattleFactory = (config: BattleConfig) => Battle;
export interface CharacterModule {
  id: string;
  metadata: { name: string; tag: string; description: string; color: string; portrait: string; links?: { character: string; moves: string } };
  settings: readonly CharacterSetting[];
  normalizeSettings(settings?: CharacterSettings): CharacterSettings;
  createState(settings: CharacterSettings): unknown;
  stats(settings: CharacterSettings): { maxHp: number; speed: number; radius: number };
  ownsElevation?: boolean;
  audio?: { hitFrequency: number; hitWave: "sine" | "triangle" | "square" | "sawtooth" };
  step?(frame: CharacterFrame): void;
  afterContacts?(frame: CharacterFrame): void;
  endFrame?(frame: CharacterFrame): void;
  advanceFreeze?(fighter: Fighter, state: BattleState, events: BattleEvent[]): void;
  stopsRoundTimer?(state: BattleState, fighter: Fighter): boolean;
  isWorldStopped?(state: BattleState, fighter: Fighter): boolean;
  requestMove?(state: BattleState, fighter: Fighter, moveId: string, variantId: string | undefined, events: BattleEvent[]): boolean;
  setHold?(state: BattleState, fighter: Fighter, held: boolean): boolean;
  resolveIncomingHit?(context: HitContext): void;
  onContact?(context: HitContext): void;
  releaseCapture?(state: BattleState, fighter: Fighter, knockdown: boolean, events?: BattleEvent[]): void;
  finishBattle?(fighter: Fighter): void;
  hasPendingCinematic?(state: BattleState, fighter: Fighter, maxTicks: number): boolean;
  describe(state: BattleState, fighter: Fighter): CharacterStatus;
  training?: { create(variantId: string, config: BattleConfig, scenario: "hit" | "block" | "whiff", factory: BattleFactory, autoplay?: boolean): Battle };
}

/** Explicit composition; the simulation never imports built-in character modules. */
export class CharacterRegistry {
  private readonly modules = new Map<string, CharacterModule>();
  constructor(modules: readonly CharacterModule[] = []) { modules.forEach((module) => this.register(module)); }
  register(module: CharacterModule): this {
    if (!module.id || this.modules.has(module.id)) throw new Error(`角色模块重复或无效：${module.id}`);
    this.modules.set(module.id, module); return this;
  }
  get(id: string): CharacterModule {
    const module = this.modules.get(id);
    if (!module) throw new Error(`未安装角色模块：${id}`);
    return module;
  }
  list(): readonly CharacterModule[] { return [...this.modules.values()]; }
  normalize(input: string | CharacterSelection): CharacterSelection {
    const id = typeof input === "string" ? input : input.characterId;
    const module = this.get(id);
    return { characterId: id, settings: { ...module.normalizeSettings(typeof input === "string" ? undefined : input.settings) } };
  }
}
