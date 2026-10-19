import type { CharacterStatus } from "../../engine/characters";
import type { BattleState, ContactEvent, Fighter } from "../../engine/types";
import { JAMIE_VARIANT_BY_ID, type JamieVariant } from "./moves";
import { getJamieState } from "./state";
import type { JamieAction } from "./types";

export type JamieSuperStyle = "spin" | "install" | "strike" | "critical";

function superStyle(variant: JamieVariant): JamieSuperStyle | undefined {
  if (variant.moveId === "A01") return "spin";
  if (variant.moveId === "A02") return "install";
  if (variant.moveId === "A03") return variant.row === 90 ? "critical" : "strike";
  return undefined;
}

/** Captured attacks append their authored hit indices after the opening boxes. */
function finalSuperSegment(variant: JamieVariant): number {
  if (variant.nativeCapture) {
    const index = variant.nativeCapture.hits.reduce((last, hit, index) => hit.damage > 0 ? index : last, -1);
    return index < 0 ? -1 : variant.active.length + index;
  }
  if (variant.capture === "cinematic") return variant.cinematicHits.reduce((last, hit, index) => hit.weight > 0 ? index : last, -1);
  if (variant.nativeHits) return variant.nativeHits.reduce((last, hit, index) => hit.damage > 0 ? index : last, -1);
  return variant.damage > 0 ? variant.active.length - 1 : -1;
}

/** Contact events survive batched updates even when the source action has ended. */
export function describeJamieSuperContact(event: ContactEvent): { style: JamieSuperStyle; finisher: boolean } | undefined {
  if (event.deferred || event.armor || event.outcome === "hit" && event.amount <= 0) return undefined;
  const variant = event.variantId ? JAMIE_VARIANT_BY_ID[event.variantId] : undefined;
  const style = variant && superStyle(variant);
  if (!variant || !style) return undefined;
  const finalSegment = finalSuperSegment(variant);
  return { style, finisher: event.outcome === "hit" && finalSegment >= 0 && event.segment === finalSegment };
}

export function actionPhaseLabel(action: JamieAction, frozen = false): string {
  const variant = JAMIE_VARIANT_BY_ID[action.variantId];
  if (frozen) return "超必杀冻结";
  if (action.captureTargetId) return action.cinematicPhase === "finish" ? "终结 · 击飞" : "已命中 · 连续演出";
  if (action.frame < variant.startup) return "起手";
  if (variant.active.some(([start, end]) => action.frame >= start && action.frame <= end)) return "有效帧";
  return variant.pose === "drink" ? "饮酒 · 恢复" : "恢复帧";
}

export function describeJamie(state: BattleState, fighter: Fighter): CharacterStatus {
  const jamie = getJamieState(fighter)!;
  const action = jamie.action;
  const result: CharacterStatus = { badge: `CPU ${jamie.standardAI.level + 1}`, intent: jamie.intent, actionName: action?.name ?? "调整步法", actionId: action?.variantId ?? null,
    actionFrame: action?.frame ?? 0, actionDuration: action?.duration ?? 0,
    phaseLabel: action ? actionPhaseLabel(action, (state.superFreezeRemaining ?? 0) > 0 && state.superFreezeSourceId === fighter.id) : jamie.intent,
    hitCount: action?.moveId.startsWith("A") ? action.hitCount ?? 0 : jamie.comboCount,
    subLabel: `饮 ${jamie.drinkLevel}${jamie.sa2UntilTick > state.tick ? " / SA2" : ""}`,
    dashing: action?.pose === "rush" };
  if (!action || !action.moveId.startsWith("A")) return result;
  const variant = JAMIE_VARIANT_BY_ID[action.variantId];
  const style = variant && superStyle(variant);
  if (!style) return result;
  const confirmed = action.confirmedAtFrame !== undefined;
  const finalSegment = finalSuperSegment(variant);
  // Blocked contacts also enter contactSegments, so they cannot prove a finisher.
  const finishing = confirmed && finalSegment >= 0 && Boolean(action.contactSegments?.includes(finalSegment)) && !action.blockedSegments?.includes(finalSegment);
  const captureFrame = ((action.visualFrame ?? action.frame) - (action.confirmedAtFrame ?? 0)) / (action.cinematicTimeScale ?? 1);
  const close = action.moveId === "A03" && Boolean(action.captureTargetId) && action.cinematicPhase === "combo";
  result.foreground = action.variantId === "row-90" && Boolean(action.captureTargetId) && captureFrame >= 170 && captureFrame <= 245;
  const intro = (action.introFrame ?? 0) < (action.introDuration ?? 0);
  result.cinematic = { title: action.name, targetId: action.captureTargetId,
    finalImpact: finishing,
    zoom: close && action.variantId === "row-90" && captureFrame >= 165 ? 1.95 : close ? 1.68 : intro ? 1.3 : action.moveId === "A03" && action.cinematicPhase === "finish" ? 1.12 : action.moveId === "A01" && action.captureTargetId ? 1.2 : 1,
    shade: action.moveId === "A02" ? 0x643907 : 0x080b1c, frame: (action.introFrame ?? 0) + action.frame,
    superArt: {
      key: `${fighter.id}:${action.startTick}:${action.variantId}`, style,
      introFrame: action.introFrame ?? 0, introDuration: action.introDuration ?? 0,
      frame: action.frame, duration: action.duration, confirmed, finishing,
      contactFrame: action.confirmedAtFrame ?? -1, hitCount: action.hitCount ?? 0,
    } };
  return result;
}
