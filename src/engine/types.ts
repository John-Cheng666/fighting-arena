
export type FighterId = "p1" | "p2";
/** Stable seat IDs are deliberately independent from the selected character. */
export type CharacterId = string;
export type BattlePhase = "ready" | "running" | "finished";
export type Vector = { x: number; y: number };

export type CharacterSettings = Record<string, number | string | boolean>;
export interface CharacterSelection { characterId: CharacterId; settings: CharacterSettings; }
export interface BattleConfig {
  seed: number;
  roundTimeSeconds?: number;
  fighters?: [CharacterId | CharacterSelection, CharacterId | CharacterSelection];
}
export interface ResolvedBattleConfig {
  seed: number;
  roundTimeSeconds: number;
  fighters: [CharacterSelection, CharacterSelection];
}

export interface Fighter extends Vector {
  id: FighterId;
  characterId: CharacterId;
  height: number;
  stunUntilTick: number;
  knockdownUntilTick: number;
  settings: CharacterSettings;
  characterState: unknown;
  capture?: { sourceId: FighterId; moveId: string; untilTick: number; phase: "combo" | "finish"; pendingKnockout?: boolean };
  lastHitBy?: FighterId;
  lastHitTick?: number;
  recoverableHp?: number;
  wallSplatUntilTick?: number;
  hardKnockdown?: boolean;
  crouching?: boolean;
  juggleUntilTick?: number;
  juggleStartedTick?: number;
  juggleSourceId?: FighterId;
  pendingHardKnockdown?: boolean;
  juggleHeight?: number;
  previousX: number;
  previousY: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  facing: number;
  speed: number;
  hitUntilTick: number;
  attackUntilTick: number;
  hits: number;
  damageDealt: number;
  healing: number;
}

export interface Projectile extends Vector {
  id: number;
  ownerId: FighterId;
  previousX: number;
  previousY: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  expiresAt: number;
  bounces: number;
  gold: boolean;
}

export interface BattleState {
  tick: number;
  phase: BattlePhase;
  fighters: [Fighter, Fighter];
  projectiles: Projectile[];
  winner: FighterId | null;
  result: "knockout" | "timeout" | "draw" | null;
  superFreezeRemaining?: number;
  superFreezeSourceId?: FighterId | null;
  /** Source actors continue through cinematic world time while the round timer stops. */
  worldStopTicks?: number;
  roundStopTicks?: number;
  worldStopped?: boolean;
}

export interface ContactDetails {
  name?: string;
  counter?: boolean;
  punish?: boolean;
  parry?: boolean;
  perfect?: boolean;
  calculation?: {
    baseDamage: number;
    factors: number[];
    multiplier: number;
    minimum: number;
    rounding: "native" | "round";
  };
}

/** One resolved contact, including blocked chip and zero-damage captures. */
export interface ContactEvent extends ContactDetails {
  type: "contact";
  tick: number;
  sourceId: FighterId;
  targetId: FighterId;
  moveId?: string;
  variantId?: string;
  segment?: number;
  outcome: "hit" | "block";
  damageType: "strike" | "throw" | "projectile" | "chip";
  amount: number;
  hpLoss: number;
  hpBefore: number;
  hpAfter: number;
  armor: boolean;
  recoverable: boolean;
  captured: boolean;
  finish: boolean;
  /** Previously settled lethal damage executes when a capture releases. */
  deferred?: boolean;
}

export type BattleEvent =
  | ContactEvent
  | { type: "started"; tick: number }
  | { type: "cast"; tick: number; fighterId: FighterId; x: number; y: number }
  | { type: "dash"; tick: number; fighterId: FighterId; x: number; y: number }
  | { type: "move"; tick: number; fighterId: FighterId; moveId: string; name: string; variantId?: string; category?: "normal" | "special" | "super" | "system"; x: number; y: number }
  | { type: "cinematic"; tick: number; sourceId: FighterId; targetId: FighterId; moveId: string; phase: "combo" | "finish"; x: number; y: number }
  | { type: "counter"; tick: number; sourceId: FighterId; targetId: FighterId; punish: boolean; x: number; y: number }
  | { type: "wall"; tick: number; fighterId: FighterId; x: number; y: number }
  | { type: "drink"; tick: number; fighterId: FighterId; level: number; x: number; y: number }
  | { type: "block"; tick: number; fighterId: FighterId; perfect: boolean; parry: boolean; x: number; y: number }
  | { type: "interrupt"; tick: number; fighterId: FighterId; moveId: string; label?: string; x: number; y: number }
  | {
      type: "hit";
      tick: number;
      sourceId: FighterId;
      targetId: FighterId;
      amount: number;
      moveId?: string;
      category?: "super";
      x: number;
      y: number;
    }
  | {
      type: "heal";
      tick: number;
      targetId: FighterId;
      amount: number;
      reason?: "recoverable" | "hit";
      hpBefore?: number;
      hpAfter?: number;
      x: number;
      y: number;
    }
  | { type: "death"; tick: number; fighterId: FighterId; x: number; y: number }
  | {
      type: "finished";
      tick: number;
      winner: FighterId | null;
      reason: BattleState["result"];
    };

export interface PendingHit {
  sourceId: FighterId;
  targetId: FighterId;
  damage: number;
  heal: number;
  moveId?: string;
  stun?: number;
  knockdown?: number;
  knockback?: number;
  launch?: number;
  throw?: boolean;
  overhead?: boolean;
  low?: boolean;
  unblockable?: boolean;
  projectile?: boolean;
  driveDamage?: number;
  segment?: number;
  variantId?: string;
  damageWeights?: number[];
  capture?: boolean;
  capturedHit?: boolean;
  finish?: boolean;
  superGain?: number;
  driveGain?: number;
  recoverable?: boolean;
  juggle?: boolean;
  slam?: boolean;
  /** Authored per-contact values, supplied by a character's native data adapter. */
  unscaledDamage?: number;
  damageFactors?: number[];
  damageMultiplier?: number;
  minimumDamage?: number;
  blockSuperGain?: number;
  blockDriveGain?: number;
  blockStun?: number;
  punishDriveLoss?: number;
  hitStopOwner?: number;
  hitStopTarget?: number;
  blockHitStopOwner?: number;
  blockHitStopTarget?: number;
  nativeThrowPunish?: boolean;
  targetSuperGain?: number;
  blockTargetSuperGain?: number;
}

export interface MoveDemonstration {
  characterId: CharacterId;
  variantId: string;
  status: "preparing" | "running" | "complete";
  scenario: "hit" | "block" | "whiff";
  outcome: "pending" | "hit" | "block" | "whiff" | "success" | "unavailable";
  title: string;
  startedAtTick: number;
  completedAtTick?: number;
  hits?: number;
  damage?: number;
  blockCount?: number;
}

export const TICK_RATE = 60;
export const STEP = 1 / TICK_RATE;
export const ARENA = { left: 47, right: 673, top: 153, bottom: 623 } as const;

export function validateConfig(config: BattleConfig): BattleConfig {
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 2147483647) throw new Error("随机种子必须是0至2147483647之间的整数");
  const duration = config.roundTimeSeconds ?? 99;
  if (!Number.isInteger(duration) || duration < 30 || duration > 300) throw new Error("回合时间必须是30至300秒之间的整数");
  if (config.fighters && config.fighters.length !== 2) throw new Error("请选择两名参战角色");
  return { ...config, roundTimeSeconds: duration };
}
