import { getJamieState } from "../state";
import { JAMIE_VARIANT_BY_ID, type JamieVariant } from "../moves";
import { ARENA, type BattleEvent, type BattleState, type Fighter } from "../../../engine/types";
import type { JamieAction } from "../types";
import { resetStandardAIProgram } from "../../../engine/ai/StandardAI";
import { resetJamieCombo } from "./scaling";

// Local latch AttackData85 stops the source for 6 updates; captured actions720/724
// expose THROW_ESCAPE on raw [0,3). PC/FOLLOW actions722/726 expose no such flag.
// Mapping those two actor-clock intervals into this host's elapsed ticks gives 9
// eligible observations [0,9); the endpoint has not been sampled in a native fight.
const NORMAL_THROW_LATCH_STOP_TICKS = 6;
const NORMAL_THROW_ESCAPE_ACTION_TICKS = 3;
export const JAMIE_REACTIVE_THROW_TECH_TICKS = NORMAL_THROW_LATCH_STOP_TICKS + NORMAL_THROW_ESCAPE_ACTION_TICKS;
// Existing arena recovery adapter; the native recovery duration is not yet verified.
export const JAMIE_THROW_TECH_RECOVERY_TICKS = 14;

/** Shared by the CPU key adapter and the public hold input. Repeated releases are inert. */
export function setJamieActionHold(action: JamieAction, held: boolean): boolean {
  const variant = JAMIE_VARIANT_BY_ID[action.variantId];
  if (!variant.held || ![38, 98].includes(variant.row) || held && action.held === false) return false;
  if (action.held === held) return true;
  action.held = held;
  if (!held) action.duration = variant.row === 98 ? action.frame + 33 : (action.drinksApplied ?? 0) === 0 ? 50 : action.frame + 48;
  return true;
}

export function getJamieNormalThrowSource(state: BattleState, target: Fighter): Fighter | undefined {
  const capture = target.capture;
  if (!capture || capture.phase !== "combo") return;
  const source = state.fighters.find(fighter => fighter.id === capture.sourceId);
  const action = getJamieState(source)?.action;
  if (source && action?.captureTargetId === target.id && action.moveId === capture.moveId &&
    action.confirmedAtFrame !== undefined && !action.finishApplied &&
    JAMIE_VARIANT_BY_ID[action.variantId].capture === "throw") return source;
}

export function canJamieThrowTech(state: BattleState, target: Fighter): boolean {
  const source = getJamieNormalThrowSource(state, target);
  const action = getJamieState(source)?.action;
  if (!source || source.hp <= 0 || target.hp <= 0 || !action?.normalThrowTechable || target.capture?.pendingKnockout) return false;
  const elapsed = state.tick - action.startTick - action.confirmedAtFrame!;
  const latch = JAMIE_VARIANT_BY_ID[action.variantId].nativeHits?.find(hit => hit.collisionType === 2);
  const window = Math.max(0, latch?.hitStopOwner ?? NORMAL_THROW_LATCH_STOP_TICKS) + NORMAL_THROW_ESCAPE_ACTION_TICKS;
  return elapsed >= 0 && elapsed < window;
}

/** A tech terminates the confirmed sequence before its delayed damage or resource rewards. */
export function resolveJamieThrowTech(state: BattleState, source: Fighter, target: Fighter, events: BattleEvent[]): void {
  releaseJamieCapture(state, source, false, events);
  for (const fighter of [source, target]) {
    const jamie = getJamieState(fighter);
    if (jamie) {
      jamie.action = null;
      jamie.bufferedKeys = undefined;
      jamie.keyHistory = [];
      jamie.punishUntilTick = undefined;
      resetJamieCombo(jamie);
      resetStandardAIProgram(jamie.standardAI);
    }
    fighter.stunUntilTick = state.tick + JAMIE_THROW_TECH_RECOVERY_TICKS;
    fighter.knockdownUntilTick = state.tick;
    fighter.hardKnockdown = false;
    fighter.attackUntilTick = state.tick;
    fighter.vx = fighter.vy = 0;
  }
  events.push({ type: "block", tick: state.tick, fighterId: target.id, perfect: false, parry: false, x: target.x, y: target.y - 80 });
}

export function releaseJamieCapture(state: BattleState, source: Fighter, knockdown = false, events?: BattleEvent[]): void {
  const action = getJamieState(source)?.action;
  const target = state.fighters.find((fighter) => fighter.capture?.sourceId === source.id);
  if (target) {
    const capture = target.capture!;
    const pendingKnockout = target.capture?.pendingKnockout;
    target.capture = undefined;
    const launchFinish = action?.variantId === "row-89" && action.cinematicPhase === "finish";
    target.height = launchFinish ? 160 : 0;
    if (launchFinish && action) {
      // Preserve the arena's follow-up spacing when the native unlock key replaces
      // the old final synthetic hit; these are arena coordinates, not SF6 boxes.
      target.x = Math.max(ARENA.left + 52, Math.min(ARENA.right - 52, target.x + action.directionX * 90));
      target.y = Math.max(ARENA.top + 123, Math.min(ARENA.bottom - 30, target.y + action.directionY * 90));
    }
    if (pendingKnockout) {
      if (target.hp > 0) events?.push({
        type: "contact", tick: state.tick, sourceId: source.id, targetId: target.id,
        moveId: capture.moveId, variantId: action?.variantId,
        name: action ? JAMIE_VARIANT_BY_ID[action.variantId].name : capture.moveId,
        outcome: "hit", damageType: "strike", amount: 0,
        hpLoss: target.hp, hpBefore: target.hp, hpAfter: 0,
        armor: false, recoverable: false, captured: true, finish: true, deferred: true,
      });
      target.hp = 0;
    }
    if (launchFinish && target.hp > 0) {
      target.juggleStartedTick = state.tick;
      target.juggleHeight = 160;
      target.juggleUntilTick = state.tick + 115;
      target.juggleSourceId = source.id;
      target.stunUntilTick = state.tick + 115;
      target.knockdownUntilTick = 0;
      target.hardKnockdown = false;
      target.pendingHardKnockdown = true;
    } else if (knockdown && target.hp > 0) {
      target.juggleUntilTick = 0;
      target.juggleSourceId = undefined;
      target.pendingHardKnockdown = false;
      target.knockdownUntilTick = Math.max(target.knockdownUntilTick, state.tick + 45);
      target.hardKnockdown = true;
    }
  }
  if (action) action.captureTargetId = undefined;
}

export function beginJamieCapture(state: BattleState, source: Fighter, target: Fighter, events: BattleEvent[]): void {
  const action = getJamieState(source)?.action;
  if (!action || action.captureTargetId) return;
  const variant = JAMIE_VARIANT_BY_ID[action.variantId];
  if (variant.capture === "none") return;
  action.captureTargetId = target.id;
  action.confirmedAtFrame = action.frame;
  action.cinematicPhase = "combo";
  action.hitCount = 0;
  const nativeCapture = action.throwPunish ? variant.nativePunishCapture ?? variant.nativeCapture : variant.nativeCapture;
  if (nativeCapture) {
    action.duration = action.frame + nativeCapture.duration;
    action.nativeCaptureHits = [];
    if (variant.capture === "cinematic") action.hitSegments = [0];
  } else if (variant.capture === "cinematic") {
    action.duration = action.frame + variant.cinematicHits.at(-1)!.frame * variant.cinematicTimeScale + variant.recovery;
    action.hitSegments = [0];
  }
  const end = nativeCapture ? action.frame + nativeCapture.releaseFrame
    : variant.capture === "cinematic" ? action.duration - variant.recovery : variant.capture === "throw" ? 30 : Math.max(...variant.active.map((window) => window[1]));
  target.capture = { sourceId: source.id, moveId: variant.moveId, untilTick: action.startTick + end, phase: "combo" };
  target.juggleUntilTick = 0;
  target.juggleSourceId = undefined;
  target.pendingHardKnockdown = false;
  target.vx = target.vy = 0;
  target.stunUntilTick = Math.max(target.stunUntilTick, target.capture.untilTick);
  if (getJamieState(target)?.action) {
    releaseJamieCapture(state, target, false, events);
    getJamieState(target)!.action = null;
  }
  events.push({ type: "cinematic", tick: state.tick, sourceId: source.id, targetId: target.id, moveId: variant.moveId, phase: "combo", x: target.x, y: target.y - 70 });
}

export function cumulativeDamage(budget: number, weights: number[], index: number): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const before = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0);
  return Math.round(budget * (before + weights[index]) / total) - Math.round(budget * before / total);
}

/** Both participants follow the same confirmed sequence; no hit detection is bypassed at startup. */
export function poseCapturedPair(_state: BattleState, source: Fighter, target: Fighter, action: JamieAction, variant: JamieVariant): void {
  const frame = (action.frame - (action.confirmedAtFrame ?? 0)) / (action.cinematicTimeScale ?? 1);
  let offset = variant.capture === "cinematic" ? frame < 70 ? 48 : frame < 120 ? 61 : 45 : 53;
  if (variant.capture === "cinematic" && frame >= 170) offset = 40;
  const centerX = Math.max(ARENA.left + 100, Math.min(ARENA.right - 100, source.x));
  const centerY = Math.max(ARENA.top + 125, Math.min(ARENA.bottom - 60, source.y));
  source.x = centerX;
  source.y = centerY;
  target.x = centerX + action.directionX * offset;
  target.y = centerY + action.directionY * offset;
  target.facing = -source.facing;
  target.vx = target.vy = source.vx = source.vy = 0;
  if (variant.capture === "cinematic") {
    target.height = frame < 28 ? 4 : frame < 70 ? 0 : frame < 120 ? Math.sin((frame - 70) / 50 * Math.PI) * 12 : 0;
    const beat = [...variant.cinematicHits].reverse().find((entry) => frame >= entry.frame);
    if (beat) action.pose = beat.pose;
  } else if (variant.moveId === "S05") target.height = 55 + Math.sin(frame / 55 * Math.PI) * 30;
  else if (variant.moveId === "A01") target.height = 18 + Math.abs(Math.sin(frame * 0.18)) * 30;
}
