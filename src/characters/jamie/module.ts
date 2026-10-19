import type { CharacterModule } from "../../engine/characters";
import { finishStandardAIFrame } from "../../engine/ai/StandardAI";
import { advanceJamieFreeze, createJamieState, processJamieContactCancels, requestJamieMove, setJamieHold, updateJamieFighters } from "./combat/actions";
import { releaseJamieCapture } from "./combat/execution";
import { registerJamieContact, resolveJamieIncomingHit } from "./combat/hits";
import { JAMIE_SETTINGS, normalizeJamieSettings } from "./config";
import { describeJamie } from "./presentation";
import { getJamieState } from "./state";
import { JAMIE_SOURCES, JAMIE_VARIANT_BY_ID } from "./moves";
import { createJamieDemonstration } from "./training/createDemonstration";
import { JAMIE_RESOURCE_LIMITS } from "./combat/resources";

export const jamieModule: CharacterModule = {
  id: "jamie",
  metadata: { name: "杰米", tag: "醉拳 · 街舞 · 饮酒成长", description: "寻找饮酒机会，解锁拳脚与连段", color: "#ead17d",
    portrait: "/assets/jamie/official-jamie.png", links: { character: JAMIE_SOURCES.character, moves: JAMIE_SOURCES.moves } },
  settings: JAMIE_SETTINGS, normalizeSettings: normalizeJamieSettings,
  audio: { hitFrequency: 190, hitWave: "triangle" },
  stats: (settings) => ({ maxHp: Number(settings.maxHp), speed: 145, radius: 25 }), ownsElevation: true,
  createState: (settings) => {
    const state = createJamieState(Number(settings.cpuLevel) - 1, Number(settings.aiStyle));
    state.drinkLevel = Number(settings.startDrinkLevel); state.drive = Number(settings.driveBars) * JAMIE_RESOURCE_LIMITS.gaugeUnit; state.super = Number(settings.superBars) * JAMIE_RESOURCE_LIMITS.gaugeUnit;
    state.burnout = state.drive === 0;
    return state;
  },
  step: (frame) => updateJamieFighters(frame.state, frame.config, frame.random, frame.hits, frame.events, frame.aiEnabled),
  afterContacts: (frame) => { if (frame.aiEnabled) processJamieContactCancels(frame.state, frame.random, frame.events); },
  endFrame: (frame) => { if (frame.aiEnabled) for (const fighter of frame.actors) finishStandardAIFrame(getJamieState(fighter)!.standardAI, frame.state.tick); },
  advanceFreeze: (fighter, state, events) => advanceJamieFreeze(state, fighter, events),
  isWorldStopped: (_state, fighter) => {
    const action = getJamieState(fighter)?.action;
    if (!action?.captureTargetId) return false;
    const capture = JAMIE_VARIANT_BY_ID[action.variantId].nativeCapture;
    return Boolean(capture && action.frame - (action.confirmedAtFrame ?? 0) < capture.worldStopFrames);
  },
  stopsRoundTimer: (_state, fighter) => {
    const action = getJamieState(fighter)?.action;
    if (!action) return false;
    const variant = JAMIE_VARIANT_BY_ID[action.variantId];
    const capture = action.throwPunish ? variant.nativePunishCapture ?? variant.nativeCapture : variant.nativeCapture;
    const captured = Boolean(action.captureTargetId && capture);
    const frame = captured ? action.frame - (action.confirmedAtFrame ?? 0) : action.frame + (action.introDuration ?? 0);
    const intervals = captured ? capture!.timerStops : variant.nativeTimerStops;
    return intervals?.some(interval => frame >= interval.from && frame < interval.to) ?? false;
  },
  requestMove: (state, fighter, moveId, variantId, events) => requestJamieMove(state, fighter.id, moveId, variantId, events),
  setHold: (state, fighter, held) => setJamieHold(state, fighter.id, held),
  resolveIncomingHit: resolveJamieIncomingHit, onContact: registerJamieContact,
  releaseCapture: releaseJamieCapture,
  finishBattle: (fighter) => { const state = getJamieState(fighter)!; state.action = null; state.standardAI.currentItemId = null; },
  hasPendingCinematic: (state, fighter, maxTicks) => {
    const action = getJamieState(fighter)?.action;
    return Boolean(action?.captureTargetId && JAMIE_VARIANT_BY_ID[action.variantId].capture === "cinematic" && action.startTick <= maxTicks && state.tick <= action.startTick + action.duration && action.duration <= 600);
  },
  describe: describeJamie,
  training: { create: createJamieDemonstration },
};
