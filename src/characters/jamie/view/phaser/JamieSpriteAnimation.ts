import { getJamieState } from "../../state";
import type { Fighter } from "../../../../engine/types";
import type { JamieAction } from "../../types";
import { JAMIE_VARIANT_BY_ID } from "../../moves";

/** Full figures only. Each key identifies an authored complete-person frame. */
export const JAMIE_SPRITE_GROUPS = {
  a: ["idle", "idle-b", "walk-a", "walk-b", "crouch", "guard-high", "guard-low", "jump-tuck", "landing", "hit-recoil", "hit-body", "knockdown"],
  b: ["stand-lp", "stand-lk", "stand-mp", "stand-mk", "stand-hp", "stand-hk", "crouch-lp", "crouch-lk", "crouch-mp", "crouch-mk", "crouch-hp", "crouch-hk"],
  c: ["jump-lp", "jump-lk", "jump-mp", "jump-mk", "jump-hp", "jump-hk", "tensei-kick", "falling-star", "hermit-elbow", "senei-kick", "sway-back", "flying-side-kick"],
  d: ["drink-reach", "drink-pour", "drink-wipe", "freeflow-first", "freeflow-upper", "freeflow-finish", "freeflow-roundhouse", "swagger-palm", "arrow-rise", "dive-kick", "bakkai-split-a", "bakkai-split-b"],
  e: ["tenshin", "hermit-punch", "throw-grab", "throw-knee", "throw-swing", "throw-release", "impact-palm", "reversal-sweep", "parry", "drive-rush", "backflip", "landing-e"],
  f: ["super-focus", "sa1-handstand-a", "sa1-handstand-b", "sa3-beckon", "sa3-wrist", "sa3-coil", "sa3-double-kick", "ca-reach-neck", "ca-neck-pull", "ca-neck-release", "victim-neck-arched", "victim-airborne"],
  g: ["loose-idle", "loose-idle-b", "loose-walk-a", "loose-walk-b", "loose-crouch", "loose-guard-high", "loose-guard-low", "loose-jump-tuck", "loose-landing", "loose-hit-recoil", "loose-hit-body", "loose-knockdown"],
  h: ["loose-super-focus", "loose-sa1-handstand-a", "loose-sa1-handstand-b", "loose-sa3-beckon", "loose-sa3-wrist", "loose-sa3-coil", "loose-sa3-double-kick", "loose-ca-reach-neck", "loose-ca-neck-pull", "loose-ca-neck-release", "loose-victim-neck-arched", "loose-victim-airborne"],
  i: ["loose-stand-lp", "loose-stand-lk", "loose-stand-mp", "loose-stand-mk", "loose-stand-hp", "loose-stand-hk", "loose-crouch-lp", "loose-crouch-lk", "loose-crouch-mp", "loose-crouch-mk", "loose-crouch-hp", "loose-crouch-hk"],
  j: ["loose-jump-lp", "loose-jump-lk", "loose-jump-mp", "loose-jump-mk", "loose-jump-hp", "loose-jump-hk", "loose-tensei-kick", "loose-falling-star", "loose-hermit-elbow", "loose-senei-kick", "loose-sway-back", "loose-flying-side-kick"],
  k: ["loose-drink-reach", "loose-drink-pour", "loose-drink-wipe", "loose-freeflow-first", "loose-freeflow-upper", "loose-freeflow-finish", "loose-freeflow-roundhouse", "loose-swagger-palm", "loose-arrow-rise", "loose-dive-kick", "loose-bakkai-split-a", "loose-bakkai-split-b"],
  l: ["loose-tenshin", "loose-hermit-punch", "loose-throw-grab", "loose-throw-knee", "loose-throw-swing", "loose-throw-release", "loose-impact-palm", "loose-reversal-sweep", "loose-parry", "loose-drive-rush", "loose-backflip", "loose-landing-e"],
} as const;

export function jamieCinematicFrame(action: JamieAction): number {
  const elapsed = (action.visualFrame ?? action.frame) - (action.confirmedAtFrame ?? 0);
  const finish = action.variantId === "row-90" ? 245 : 215;
  const scale = action.cinematicTimeScale ?? 1;
  return elapsed <= finish * scale ? elapsed / scale : finish + elapsed - finish * scale;
}

function drinkPose(frame: number, duration: number): string {
  if (frame < 13) return "drink-reach";
  return frame > duration - 10 ? "drink-wipe" : "drink-pour";
}

function superPose(action: JamieAction): string {
  const intro = (action.introFrame ?? 0) / Math.max(1, action.introDuration ?? 1);
  const introducing = action.frame === 0 && (action.introFrame ?? 0) < (action.introDuration ?? 0);
  if (action.moveId === "A02") {
    if (!introducing) return "drink-wipe";
    return intro < 0.2 ? "drink-reach" : intro < 0.64 ? "drink-pour" : "drink-wipe";
  }
  if (introducing) return "super-focus";
  if (action.moveId === "A01") {
    const frame = action.visualFrame ?? action.frame;
    const variant = JAMIE_VARIANT_BY_ID[action.variantId];
    const last = variant?.active.at(-1)?.[1] ?? 133;
    if (frame < 5) return "landing";
    if (frame < 8) return "bakkai-split-a";
    if (frame <= last) {
      const index = Math.max(0, variant.active.findIndex(([, end]) => frame <= end));
      return ["sa1-handstand-a", "bakkai-split-a", "sa1-handstand-b", "bakkai-split-b"][index % 4];
    }
    if (frame < last + 14) return "backflip";
    if (action.variantId.includes("drink") && frame >= last + 25) return drinkPose(frame - last - 25, action.duration - last - 25);
    return frame < last + 33 ? "landing" : "idle";
  }
  if (action.confirmedAtFrame === undefined) return action.frame < 3 ? "super-focus" : "swagger-palm";
  const t = jamieCinematicFrame(action);
  if (t < 28) return "swagger-palm";
  if (t < 58) return "reversal-sweep";
  if (t < 120) return "sa3-beckon";
  if (t < 143) return "sa3-wrist";
  if (t < 165) return "sway-back";
  if (action.variantId === "row-90") return t < 212 ? "ca-reach-neck" : t < 239 ? "ca-neck-pull" : t < 266 ? "ca-neck-release" : "idle";
  return t < 190 ? "sa3-wrist" : t < 198 ? "sa3-coil" : t <= 215 ? "sa3-double-kick" : t < 235 ? "landing" : "idle";
}

function contactPose(row: number, frame: number, action: JamieAction): string {
  const variant = JAMIE_VARIANT_BY_ID[action.variantId];
  const segment = jamieSpriteHitSegment(variant, frame);
  if (row === 4) return ["stand-hp", "stand-mp", "freeflow-finish"][Math.min(2, segment)];
  if (row === 11 && segment > 0) return "reversal-sweep";
  if (row < 12) return JAMIE_SPRITE_GROUPS.b[row];
  if (row < 18) return JAMIE_SPRITE_GROUPS.c[row - 12];
  const targets: Record<number, string> = {
    18: "tensei-kick", 19: "reversal-sweep", 20: "drink-pour", 21: "falling-star", 22: "hermit-elbow", 23: "senei-kick",
    24: "stand-lp", 25: "stand-lk", 26: "stand-mp", 27: "falling-star", 28: "bakkai-split-a", 29: "drink-pour",
    30: "hermit-elbow", 31: "freeflow-finish", 32: "flying-side-kick", 33: "senei-kick", 34: "sway-back", 35: "hermit-punch", 36: "swagger-palm", 37: "drink-pour",
  };
  if (targets[row]) return targets[row];
  if (row < 47) return "freeflow-first";
  if (row < 53) return "freeflow-upper";
  if (row < 59) return "freeflow-finish";
  if (row < 63) return "freeflow-roundhouse";
  if (row < 67) return frame % 12 < 6 ? "bakkai-split-a" : "bakkai-split-b";
  if (row < 71) return "swagger-palm";
  if (row < 75) return segment === 0 ? "arrow-rise" : segment === 1 ? "flying-side-kick" : "jump-hk";
  if (row < 79) return "dive-kick";
  if (row < 83) return segment % 2 === 0 ? "bakkai-split-a" : "bakkai-split-b";
  if (row < 85) return "tenshin";
  if (row < 87) return "hermit-punch";
  if (row === 92) {
    const t = frame / 30;
    return t < 0.25 ? "throw-knee" : t < 0.5 ? "backflip" : t < 0.74 ? "reversal-sweep" : "flying-side-kick";
  }
  if (row === 91) {
    const t = frame / 30;
    return t < 0.22 ? "throw-grab" : t < 0.43 ? "throw-knee" : t < 0.7 ? "throw-swing" : "throw-release";
  }
  if (row === 95) return "impact-palm";
  if (row === 96 || row === 97) return "reversal-sweep";
  return "parry";
}

function basePose(fighter: Fighter, tick: number, winner: boolean, captureSource?: JamieAction): string {
  if (fighter.capture && captureSource) {
    if (captureSource.variantId === "row-90" && jamieCinematicFrame(captureSource) >= 170) return "victim-neck-arched";
    if (captureSource.moveId === "A03") {
      const t = jamieCinematicFrame(captureSource);
      return t < 28 ? "hit-body" : t < 70 ? "knockdown" : t < 120 ? "landing" : "hit-recoil";
    }
    return captureSource.moveId.startsWith("T") ? "hit-body" : "victim-airborne";
  }
  if (fighter.hp <= 0 || fighter.knockdownUntilTick > tick) return "knockdown";
  if (fighter.height > 15 && (fighter.juggleUntilTick ?? 0) > tick) return "victim-airborne";
  if (fighter.hitUntilTick > tick && fighter.stunUntilTick > tick) return "hit-recoil";
  const action = getJamieState(fighter)?.action;
  if (!action) {
    if (winner) return "drink-pour";
    if ((getJamieState(fighter)?.guardUntilTick ?? 0) > tick) return getJamieState(fighter)?.guardLow ? "guard-low" : "guard-high";
    if (fighter.crouching) return "crouch";
    if (Math.hypot(fighter.vx, fighter.vy) > 15) return Math.floor(tick / 9) % 2 ? "walk-a" : "walk-b";
    return Math.floor(tick / 38) % 2 ? "idle" : "idle-b";
  }
  if (action.moveId.startsWith("A")) return superPose(action);
  const variant = JAMIE_VARIANT_BY_ID[action.variantId];
  if (!variant) return "idle";
  const frame = action.visualFrame ?? action.frame;
  if (variant.behavior === "drink" || [20, 29, 37].includes(variant.row)) return drinkPose(frame, action.duration);
  if (variant.drinkOnCompletion && frame > action.duration - 43 || variant.drinkFrame > 0 && frame > variant.drinkFrame - 20) return drinkPose(frame - (variant.drinkFrame || action.duration) + 43, 43);
  if (variant.behavior === "parry") return "parry";
  if (variant.moveId === "jump") return "jump-tuck";
  if (variant.moveId === "crouch") return "crouch";
  if (variant.moveId.startsWith("walk")) return Math.floor(frame / 8) % 2 ? "walk-a" : "walk-b";
  if (variant.moveId === "backstep") return "walk-b";
  if (variant.behavior === "rush" || variant.moveId === "dash") return "drive-rush";
  if (variant.capture === "throw") return frame < variant.startup * 0.38 ? "idle" : frame >= 27 ? "landing" : contactPose(variant.row, frame, action);
  const first = variant.active[0]?.[0] ?? variant.startup;
  const last = variant.active.at(-1)?.[1] ?? first + 3;
  if (frame < first * 0.38) return variant.posture === "crouch" ? "crouch" : "idle";
  if (frame > last + (action.duration - last) * 0.65) return variant.airborne ? "jump-tuck" : variant.posture === "crouch" ? "crouch" : "idle";
  return contactPose(variant.row, frame, action);
}

export function selectJamieSpritePose(fighter: Fighter, tick: number, winner = false, captureSource?: JamieAction): string {
  const selected = basePose(fighter, tick, winner, captureSource);
  return (getJamieState(fighter)?.drinkLevel ?? 0) >= 4 ? `loose-${selected}` : selected;
}

function jamieSpriteHitSegment(variant: (typeof JAMIE_VARIANT_BY_ID)[string], frame: number): number {
  let segment = 0;
  for (let index = 0; index < variant.active.length; index++) if (frame >= variant.active[index][0]) segment = index;
  return segment;
}

export interface JamieSpriteMotion { x: number; y: number; rotation: number }

/** Whole-figure anticipation, impact and recovery. The original image keeps its
 * proportions; active windows drive each beat instead of a free-running loop.
 * These are authored transitions for the available art, not extracted SF6 motion. */
export function sampleJamieSpriteMotion(fighter: Fighter, tick: number): JamieSpriteMotion {
  const action = getJamieState(fighter)?.action;
  const still = { x: 0, y: 0, rotation: 0 };
  if (!action || fighter.capture || action.captureTargetId || fighter.hp <= 0) return still;
  const variant = JAMIE_VARIANT_BY_ID[action.variantId];
  if (!variant?.active.length || variant.moveId.startsWith("A") || variant.behavior === "parry") return still;
  const frame = action.visualFrame ?? Math.max(action.frame, tick - action.startTick);
  const first = variant.active[0][0], last = variant.active.at(-1)![1];
  const strength = variant.strength === "L" ? 0.6 : variant.strength === "M" ? 0.8 : variant.strength === "OD" ? 1.12 : 1;
  const windup = frame < first ? Math.sin(Math.PI * frame / Math.max(1, first)) : 0;
  let pulse = 0;
  for (const [start, end] of variant.active) pulse = Math.max(pulse, Math.exp(-(((frame - (start + end) / 2) / 2.8) ** 2)));
  const recovery = frame > last ? Math.max(0, 1 - (frame - last) / Math.max(1, action.duration - last)) : 1;
  let rotation = (pulse * 0.045 - windup * 0.025) * strength;
  if (variant.moveId === "S06") {
    const landing = getJamieState(fighter)!.jumpUntilTick - action.startTick;
    const slope = variant.strength === "L" ? 0.1 : variant.strength === "M" ? 0.18 : variant.strength === "H" ? 0.26 : 0.22;
    rotation = slope * Math.max(0, Math.sin(Math.PI * Math.min(1, frame / Math.max(1, landing))));
  } else if (variant.moveId === "S05") rotation = -0.16 * strength * recovery;
  else if (variant.row === 92) rotation = -0.13 * Math.sin(Math.PI * Math.min(1, frame / 30));
  return { x: strength * (pulse * 4 - windup * 2), y: -pulse * strength * 0.8, rotation: rotation * recovery };
}
