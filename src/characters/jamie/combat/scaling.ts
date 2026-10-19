import { getJamieState } from "../state";
import type { JamieVariant } from "../moves";
import type { Fighter } from "../../../engine/types";
import type { JamieAction, JamieState } from "../types";

export function jamieMoveScaling(jamie: JamieState, variant: JamieVariant, tick: number, committedRush?: number): { scale: number; index: number; multiplier: number } {
  const inWindow = jamie.comboUntilTick >= tick;
  const index = inWindow ? jamie.comboMoveCount ?? 0 : 0;
  const base = index < 2 ? 1 : Math.max(0.1, 1 - index * 0.1);
  const starter = inWindow ? jamie.comboStarterPenalty ?? 0 : 0;
  const prior = inWindow ? jamie.comboImmediatePenalty ?? 0 : 0;
  const entry = index > 0 ? variant.scaling.immediate + variant.scaling.combo : 0;
  const rush = committedRush ?? (jamie.rushUntilTick > tick && variant.active.length > 0 ? jamie.rushMultiplier ?? 0.85 : 1);
  const multiplier = (inWindow ? jamie.comboMultiplier ?? 1 : 1) * rush;
  return { index, multiplier, scale: Math.max(variant.minimumScaling, Math.max(0, base - starter - prior - entry) * multiplier) };
}

export function resetJamieCombo(jamie: JamieState): void {
  jamie.comboUntilTick = 0;
  jamie.comboCount = 0;
  jamie.comboMoveCount = 0;
  jamie.scalingGraceHits = undefined;
  jamie.comboStarterPenalty = 0;
  jamie.comboImmediatePenalty = 0;
  jamie.comboMultiplier = 1;
}

/** A new hit can continue a combo only while this opponent is still trapped.
 * A capture/juggle can outlast ordinary stun; a knockdown by itself is not a combo. */
export function refreshJamieCombo(source: Fighter, target: Fighter, tick: number): void {
  const jamie = getJamieState(source);
  if (!jamie || (jamie.comboMoveCount ?? 0) <= 0) return;
  const trapped = target.lastHitBy === source.id && (
    target.stunUntilTick >= tick || target.capture?.sourceId === source.id ||
    (target.juggleUntilTick ?? 0) >= tick && target.juggleSourceId === source.id
  );
  if (trapped) return;
  resetJamieCombo(jamie);
  if (jamie.action) {
    jamie.action.scalingRegistered = false;
    jamie.action.scalingFromTenshin = false;
  }
}

export function registerJamieScaling(jamie: JamieState, action: JamieAction | null, variant: JamieVariant): void {
  if (!action || action.scalingRegistered) return;
  action.scalingRegistered = true;
  const index = action.comboIndex ?? 0;
  jamie.comboMoveCount = index + 1;
  if (index === 0) {
    jamie.comboStarterPenalty = Math.max(jamie.comboStarterPenalty ?? 0, variant.scaling.starter);
    jamie.comboImmediatePenalty = 0;
  }
  jamie.comboImmediatePenalty = (jamie.comboImmediatePenalty ?? 0) + variant.scaling.immediate + (index > 0 ? variant.scaling.combo : 0);
  jamie.comboMultiplier = action.comboMultiplier ?? 1;
}
