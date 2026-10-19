/**
 * Supported ordinary-battle resource rules from the installed SF6 build 25071972.
 * Field flow and source addresses: research/sf6-ai/combat-values/native-rules.json.
 * Scene, command-state, damage-state and recovery eligibility remain caller inputs;
 * training handicaps, World mode modifiers and automatic gauge sentinels are not
 * inferred here.
 */
export const JAMIE_RESOURCE_LIMITS = {
  health: 10000,
  drive: 60000,
  super: 30000,
  gaugeUnit: 10000,
} as const;

export const JAMIE_DRIVE_RECOVERY = {
  normalGround: 40,
  normalAir: 20,
  burnoutGround: 50,
  burnoutAir: 20,
  waitAfterHit: 90,
  waitAfterUse: 120,
  waitAfterUseKind4: 240,
  waitAfterUseKind5: 20,
} as const;

const OFFENSIVE_PERCENT = [90, 95, 100, 105, 110, 105, 105, 105, 105] as const;
const SUPER_GAIN_PERCENT = [100, 100, 100, 100, 100, 0, 0, 0, 0] as const;

function checkedStyleId(styleId: number): number {
  if (!Number.isInteger(styleId) || styleId < 0 || styleId > 8) {
    throw new RangeError(`Unsupported Jamie style ${styleId}`);
  }
  return styleId;
}

export function jamieOffensivePercent(styleId: number): number {
  return OFFENSIVE_PERCENT[checkedStyleId(styleId)];
}

export function jamieSuperGainPercent(styleId: number): number {
  return SUPER_GAIN_PERCENT[checkedStyleId(styleId)];
}

export function jamieResourceStyleId(state: { drinkLevel: number; sa2UntilTick: number }, tick: number): number {
  // Installed styles 5..8 share both offensive and SA gain percentages.
  return state.sa2UntilTick > tick ? 5 : state.drinkLevel;
}

export interface DriveResourceState {
  drive: number;
  burnout: boolean;
  /** Negative: held until the action ends; positive: recovery delay is counting. */
  driveRecoveryWait: number;
}

export interface DriveChangeOptions {
  cause: "use" | "hit" | "other";
  useKind?: number;
  /** Native special parry/damage branch; the caller must establish that branch. */
  preserveOneOnDepletion?: boolean;
}

/** 0x143fc3390: a new delay starts in its negative, action-held phase. */
export function setDriveRecoveryWait(state: DriveResourceState, frames: number, overwrite = false): void {
  const delay = Math.max(0, Math.trunc(frames));
  const next = overwrite ? delay : Math.max(Math.abs(state.driveRecoveryWait), delay);
  state.driveRecoveryWait = next === 0 ? 0 : -next;
}

/** Returns the actual clamped change; negative additions during Burnout do nothing. */
export function applyDriveChange(state: DriveResourceState, amount: number, options: DriveChangeOptions): number {
  const addition = Math.trunc(amount);
  if (state.burnout && addition < 0) return 0;
  const previous = state.drive;
  const next = Math.min(JAMIE_RESOURCE_LIMITS.drive, Math.max(0, previous + addition));
  if (next === 0 && addition < 0 && options.preserveOneOnDepletion) {
    state.drive = 1;
  } else {
    state.drive = next;
    if (next === 0 && addition < 0) state.burnout = true;
  }
  const actual = state.drive - previous;
  if (actual < 0) {
    if (options.cause === "hit") {
      setDriveRecoveryWait(state, JAMIE_DRIVE_RECOVERY.waitAfterHit);
    } else if (options.cause === "use") {
      const delay = options.useKind === 4 ? JAMIE_DRIVE_RECOVERY.waitAfterUseKind4
        : options.useKind === 5 ? JAMIE_DRIVE_RECOVERY.waitAfterUseKind5
          : JAMIE_DRIVE_RECOVERY.waitAfterUse;
      setDriveRecoveryWait(state, delay);
    }
  }
  return actual;
}

export interface DriveRecoveryContext {
  /** False for native scene/actor/world gates that skip the entire invocation. */
  eligible?: boolean;
  airborne: boolean;
  /** WALK, forward act_dir, timer0 zero; no attack or other action. */
  forwardWalking: boolean;
  /** Native routine/state predicate, not merely whether a hit happened recently. */
  damageState: boolean;
  /** ATCK_LAND, ATCK, SPECIAL, SUPER, CATCH or PARRY. */
  holdNegativeWait: boolean;
  /** The native command-state bit 0x8000 must be clear to add Drive. */
  canRegenerate: boolean;
  /** Native canRecovery-state gate, including damage/capture restrictions. */
  canExitBurnout: boolean;
}

/** One eligible native recovery invocation, separate from rendering wall time. */
export function advanceDriveRecovery(state: DriveResourceState, context: DriveRecoveryContext): number {
  if (context.eligible === false) return 0;
  const previous = state.drive;
  if (state.driveRecoveryWait < 0) {
    if (!context.holdNegativeWait) state.driveRecoveryWait = -state.driveRecoveryWait;
  } else if (state.driveRecoveryWait > 0) {
    state.driveRecoveryWait -= 1;
  } else if (context.canRegenerate && state.drive < JAMIE_RESOURCE_LIMITS.drive) {
    // AIR uses NMA/ICA only outside the native damage-state predicate.
    const useAirRate = context.airborne && !context.damageState;
    let rate: number = state.burnout
      ? useAirRate ? JAMIE_DRIVE_RECOVERY.burnoutAir : JAMIE_DRIVE_RECOVERY.burnoutGround
      : useAirRate ? JAMIE_DRIVE_RECOVERY.normalAir : JAMIE_DRIVE_RECOVERY.normalGround;
    if (context.forwardWalking) rate = Math.trunc(rate * 200 / 100);
    if (context.damageState) rate >>= 1;
    state.drive = Math.min(JAMIE_RESOURCE_LIMITS.drive, state.drive + rate);
  }
  if (state.burnout && state.drive >= JAMIE_RESOURCE_LIMITS.drive && context.canExitBurnout) {
    state.burnout = false;
  }
  return state.drive - previous;
}

export interface SuperResourceState {
  super: number;
}

export interface SuperChangeOptions {
  styleId: number;
  comboPercent?: number;
  modePercent?: number;
}

/** 0x144037d00: each positive gain stage divides as an integer; costs skip them. */
export function applySuperChange(state: SuperResourceState, amount: number, options: SuperChangeOptions): number {
  let addition = Math.trunc(amount);
  if (addition > 0) {
    addition = Math.trunc(addition * (options.comboPercent ?? 100) / 100);
    addition = Math.trunc(addition * jamieSuperGainPercent(options.styleId) / 100);
    if (options.modePercent !== undefined) addition = Math.trunc(addition * options.modePercent / 100);
  }
  const previous = state.super;
  state.super = Math.min(JAMIE_RESOURCE_LIMITS.super, Math.max(0, previous + addition));
  return state.super - previous;
}

/**
 * 0x144054780 retains Q32 precision between integer percentage factors and only
 * truncates the combined rate to an integer percent at the end.
 */
export function nativeDamagePercent(factors: readonly number[]): number {
  let numerator = 100n << 32n;
  for (const factor of factors) numerator = numerator * BigInt(Math.trunc(factor)) / 100n;
  return Number(numerator >> 32n);
}

/** Per-contact base damage scaling; the native per-hit minimum is caller-owned. */
export function nativeScaledDamage(baseDamage: number, factors: readonly number[]): number {
  return Number(BigInt(Math.trunc(baseDamage)) * BigInt(nativeDamagePercent(factors)) / 100n);
}
