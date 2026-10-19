import type { Fighter, PendingHit } from "../../../engine/types";
import type { JamieVariant } from "../moves";
import { getJamieState } from "../state";
import type { JamieAction } from "../types";
import type { NativeHit } from "./nativeData";
import { jamieOffensivePercent, jamieResourceStyleId, nativeScaledDamage } from "./resources";

/** Native damage truncates the combined percentage, then each contact's damage. */
export function nativeContactValues(fighter: Fighter, action: JamieAction, variant: JamieVariant, index: number, tick: number, override?: NativeHit): Partial<PendingHit> {
  const hit = override ?? variant.nativeHits?.[index];
  if (!hit) return {};
  const factors = [Math.round((action.damageScale ?? 1) * 100), jamieOffensivePercent(jamieResourceStyleId(getJamieState(fighter)!, tick))];
  const multiplier = Number(fighter.settings.damageScale ?? 1);
  const baseDamage = hit.damage + (hit.recoverableDamage ?? 0);
  const damage = Math.floor(Math.max(hit.minimumDamage, nativeScaledDamage(baseDamage, factors)) * multiplier);
  return {
    damage, unscaledDamage: baseDamage, damageFactors: factors, damageMultiplier: multiplier, minimumDamage: hit.minimumDamage,
    // Native behavior Time includes the contact frame; host UntilTick is exclusive.
    stun: Math.max(0, hit.hitStun - 1), blockStun: Math.max(0, hit.blockStun - 1),
    superGain: hit.superGain, driveGain: hit.driveGain,
    blockSuperGain: hit.blockSuperGain, blockDriveGain: hit.blockDriveGain ?? 0,
    targetSuperGain: hit.targetSuperGain, blockTargetSuperGain: hit.blockTargetSuperGain,
    driveDamage: hit.blockDriveLoss, punishDriveLoss: hit.punishDriveLoss,
    hitStopOwner: Math.max(0, hit.hitStopOwner), hitStopTarget: Math.max(0, hit.hitStopTarget),
    blockHitStopOwner: Math.max(0, hit.blockHitStopOwner), blockHitStopTarget: Math.max(0, hit.blockHitStopTarget),
  };
}
