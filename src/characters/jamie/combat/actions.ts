import { getJamieState } from "../state";
import { JAMIE_THROW_DRINK, JAMIE_VARIANTS, JAMIE_VARIANT_BY_ID, type JamieVariant } from "../moves";
import type { BattleConfig, BattleEvent, BattleState, Fighter, FighterId, PendingHit } from "../../../engine/types";
import type { JamieState } from "../types";
import { canJamieThrowTech, cumulativeDamage, getJamieNormalThrowSource, poseCapturedPair, releaseJamieCapture, resolveJamieThrowTech, setJamieActionHold } from "./execution";
import { jamieMoveScaling, refreshJamieCombo, resetJamieCombo } from "./scaling";
import { jamieContactStun } from "./frameData";
import { createStandardAIState } from "../../../engine/ai/StandardAI";
import { updateJamieStandardAI } from "../ai/controller";
import { nativeContactValues } from "./nativeDamage";
import { nativeMoveEvents } from "./nativeData";
import { advanceDriveRecovery, applyDriveChange, applySuperChange, JAMIE_RESOURCE_LIMITS, jamieOffensivePercent, jamieResourceStyleId } from "./resources";
import { advanceJamieAudio, emitJamieDrinkAudio, stopJamieAudio, emitJamieVoice } from "../audio";

export function createJamieState(level = 5, style = 0): JamieState {
  return {
    standardAI: createStandardAIState(level, style),
    drinkLevel: 0, drive: JAMIE_RESOURCE_LIMITS.drive, super: 0, intent: "寻找饮酒机会", comboCount: 0,
    sa2UntilTick: 0, sa2OriginalDrinkLevel: 0, movesUsed: {}, action: null,
    guardUntilTick: 0, guardLow: false, lastContactTick: -1000,
    nextDecisionTick: 0, comboUntilTick: 0,
    burnout: false, driveRecoveryWait: 0, rushUntilTick: 0, jumpStartedTick: 0, jumpUntilTick: 0, diving: false,
  };
}

export function effectiveDrinkLevel(fighter: Fighter, tick: number): number {
  const jamie = getJamieState(fighter);
  return jamie && jamie.sa2UntilTick > tick ? 4 : jamie?.drinkLevel ?? 0;
}

export function jamieDamageMultiplier(fighter: Fighter, tick: number): number {
  const jamie = getJamieState(fighter);
  return jamieOffensivePercent(jamie ? jamieResourceStyleId(jamie, tick) : 0) / 100;
}

function canStart(state: BattleState, fighter: Fighter, variant: JamieVariant): boolean {
  const jamie = getJamieState(fighter);
  const tick = state.tick;
  if (!jamie || fighter.hp <= 0) return false;
  if (jamie.action?.captureTargetId || (state.superFreezeRemaining ?? 0) > 0) return false;
  if (fighter.capture) return variant.capture === "throw" && canJamieThrowTech(state, fighter);
  const waking = fighter.knockdownUntilTick > tick && fighter.knockdownUntilTick - tick <= 5;
  const reversalFromBlock = variant.row === 96 && jamie.guardUntilTick >= tick && jamie.lastContactTick >= tick - 18;
  if (tick < fighter.stunUntilTick && !(variant.row === 97 && waking) && !reversalFromBlock) return false;
  if (tick < fighter.knockdownUntilTick && !(variant.row === 97 && waking)) return false;
  const level = effectiveDrinkLevel(fighter, tick);
  if (level < variant.drinkMin || jamie.drive < (variant.driveNeed ?? variant.driveCost) || jamie.super < variant.superCost) return false;
  if (level === 4 && [39, 41, 43, 45, 47, 48, 49, 51, 53, 54, 55, 57].includes(variant.row)) return false;
  if (variant.id === "row-22" && level >= 3 || variant.id === "row-23" && level >= 4) return false;
  if (jamie.burnout && (variant.driveCost > 0 || variant.moveId.startsWith("D"))) return false;
  if (variant.row === 90 && fighter.hp > fighter.maxHp * 0.25) return false;
  if (variant.row === 89 && fighter.hp <= fighter.maxHp * 0.25) return false;
  if ([99, 100].includes(variant.row)) return false; // Outcomes of a successful timed Parry.
  if (variant.row === 96 && !(jamie.guardUntilTick >= tick && jamie.lastContactTick >= tick - 18)) return false;
  if (variant.row === 97 && !waking) return false;
  const current = jamie.action;
  if (current && (jamie.punishUntilTick ?? 0) > tick) return false;
  const previous = current && JAMIE_VARIANT_BY_ID[current.variantId];
  if (variant.airborne && fighter.height < 15) return false;
  if (variant.moveId === "S06" && (jamie.jumpDirection !== "forward" || jamie.jumpUntilTick <= tick || jamie.diving)) return false;
  if (variant.moveId === "jump" && (fighter.height > 0 || jamie.jumpUntilTick > tick)) return false;
  if (!variant.airborne && fighter.height > 18 && variant.moveId !== "jump") return false;
  if (variant.predecessors.length > 0) {
    if (!current || !previous || !variant.predecessors.includes(previous.row) && !(variant.row === 31 && previous.id === "row-22-lv3") && !(variant.row === 34 && previous.id === "row-23-lv4")) return false;
    const lastActive = Math.max(0, ...previous.active.map((window) => window[1]));
    const allowsWhiff = [47, 48, 49, 51, 53, 54, 55, 57, 34, 35, 36, 37].includes(variant.row);
    if (current.frame < (variant.row === 101 ? 4 : Math.max(previous.startup, Math.min(lastActive + 1, previous.duration - 1)))) return false;
    if (!current.connected && !current.blocked && !allowsWhiff && variant.row !== 101) return false;
    if (variant.row >= 35 && variant.row <= 37) {
      const windows = variant.row === 35 ? [6, 25] : variant.row === 36 ? [31, 55] : [63, 80];
      if (current.frame < windows[0] || current.frame > windows[1]) return false;
    }
    return true;
  }
  if (!current) return variant.row !== 102;
  if (!previous) return false;
  if (previous.moveId === "jump") return variant.airborne && current.frame >= 9;
  if (previous.moveId === "D04" || previous.moveId === "D05") {
    if (current.frame >= (previous.moveId === "D04" ? 9 : 10) && variant.active.length > 0 && !variant.moveId.startsWith("D")) return true;
    return current.frame >= (previous.moveId === "D04" ? 24 : 25) && variant.moveId !== "D03" && !variant.predecessors.length;
  }
  const lastActive = Math.max(0, ...previous.active.map((window) => window[1]));
  const contact = current.connected || current.blocked;
  if (!contact || jamie.lastContactTick < tick - 14) return false;
  if (previous.notes.includes("rapid canceled") && [0, 1, 6, 7].includes(variant.row) && current.frame >= previous.startup + 1 && current.frame <= lastActive + 3) return true;
  if (previous.moveId === "S07" && variant.moveId.startsWith("A")) {
    const requiredSegment = previous.row === 82 ? 6 : previous.active.length - 1;
    return variant.moveId === "A03" && Math.max(...current.hitSegments) === requiredSegment && current.frame >= previous.active[requiredSegment][0];
  }
  const earlyNormal = previous.row === 4 && current.frame <= 5 || previous.row === 10 && current.frame <= 9;
  if ((previous.row === 4 || previous.row === 10) && !earlyNormal) return false;
  if (current.frame < lastActive && !earlyNormal && previous.active.length > 1) return false;
  if (previous.row === 18 && variant.moveId === "jump") return current.connected;
  if (variant.row === 102) return previous.cancel.includes("C");
  if (variant.moveId.startsWith("S") && previous.cancel.includes("C")) return true;
  if (variant.moveId.startsWith("A")) {
    const rank = Number(variant.moveId.slice(1));
    const minimum = previous.cancel === "SA3" ? 3 : previous.cancel === "SA2" ? 2 : previous.cancel === "SA" || previous.cancel.includes("C") ? 1 : 4;
    return rank >= minimum;
  }
  return false;
}

/** Public training entry point. No force flag: the AI and caller obey identical gates. */
export function requestJamieMove(
  state: BattleState,
  fighterId: FighterId,
  moveId: string,
  variantId?: string,
  events: BattleEvent[] = [],
): boolean {
  const fighter = state.fighters.find((candidate) => candidate.id === fighterId);
  const jamie = getJamieState(fighter);
  if (!fighter || !jamie || state.phase !== "running") return false;
  const candidates = variantId ? [JAMIE_VARIANT_BY_ID[variantId]].filter(Boolean) : JAMIE_VARIANTS.filter((variant) => variant.moveId === moveId);
  const variant = candidates.find((candidate) => candidate.moveId === moveId && canStart(state, fighter, candidate));
  if (!variant) return false;
  if (fighter.capture) {
    const source = getJamieNormalThrowSource(state, fighter)!;
    resolveJamieThrowTech(state, source, fighter, events);
    return true;
  }
  const opponent = state.fighters.find((candidate) => candidate.id !== fighterId)!;
  refreshJamieCombo(fighter, opponent, state.tick);
  const dx = opponent.x - fighter.x;
  const dy = opponent.y - fighter.y;
  const distance = Math.hypot(dx, dy) || 1;
  applyDriveChange(jamie, -variant.driveCost, { cause: "use" });
  applySuperChange(jamie, -variant.superCost, { styleId: jamieResourceStyleId(jamie, state.tick) });
  jamie.guardUntilTick = 0;
  if (variant.moveId === "jump") {
    jamie.jumpStartedTick = state.tick;
    jamie.jumpUntilTick = state.tick + 45;
    jamie.diving = false;
    jamie.jumpVelocityX = dx / distance * variant.travel * 60 / variant.duration;
    jamie.jumpVelocityY = dy / distance * variant.travel * 60 / variant.duration;
    jamie.jumpDirectionX = dx / distance;
    jamie.jumpDirectionY = dy / distance;
    jamie.jumpDirection = variant.jumpDirection ?? "forward";
    jamie.jumpFacing = dx >= 0 ? 1 : -1;
  }
  if (variant.moveId === "S06") {
    jamie.diveStartHeight = fighter.height;
    jamie.jumpStartedTick = state.tick;
    jamie.jumpUntilTick = state.tick + (variant.strength === "L" ? 20 : variant.strength === "M" ? 26 : variant.strength === "H" ? 32 : 24);
    jamie.diving = true;
  }
  if (variant.moveId === "D04" || variant.moveId === "D05") { jamie.rushUntilTick = state.tick + 48; jamie.rushMultiplier = 1 - variant.scaling.multiplier; }
  if (variant.row === 96 || variant.row === 97) {
    if (variant.row === 97) fighter.knockdownUntilTick = state.tick;
    fighter.stunUntilTick = state.tick;
  }
  const duration = variant.airborne ? Math.max(variant.duration, jamie.jumpUntilTick - state.tick + (variant.moveId === "S06" ? 13 : 3)) : variant.duration;
  const scalingFromTenshin = jamie.scalingGraceHits !== undefined;
  const scaling = jamieMoveScaling(jamie, variant, state.tick);
  const rushDamageMultiplier = jamie.rushUntilTick > state.tick && variant.active.length > 0 ? jamie.rushMultiplier ?? 0.85 : 1;
  const damageScale = scalingFromTenshin ? Math.max(variant.minimumScaling, scaling.multiplier) : scaling.scale;
  const rushEnhanced = jamie.rushUntilTick > state.tick && variant.row < 38 && variant.active.length > 0;
  if (rushEnhanced) jamie.rushUntilTick = 0;
  stopJamieAudio(state, fighter, events);
  jamie.action = {
    moveId: variant.moveId, name: variant.name, pose: variant.pose, variantId: variant.id,
    frame: 0, duration, startTick: state.tick,
    directionX: variant.airborne ? jamie.jumpDirectionX ?? fighter.facing : dx / distance,
    directionY: variant.airborne ? jamie.jumpDirectionY ?? 0 : dy / distance,
    hitSegments: [], connected: false, blocked: false, drinkApplied: false, armorHits: 0,
    damageScale, damageDealt: 0, drinksApplied: 0, contactSegments: [], blockedSegments: [], visualFrame: 0, hitCount: 0,
    introFrame: 0, introDuration: variant.freezeFrames,
    nativeStyleAtStart: jamieResourceStyleId(jamie, state.tick), nativeEventsApplied: [],
    rushEnhanced,
    rushDamageMultiplier,
    scalingFromTenshin,
    comboIndex: scaling.index, comboMultiplier: scaling.multiplier,
    cinematicTimeScale: variant.cinematicTimeScale,
    cinematicPhase: variant.moveId.startsWith("A") ? "startup" : null,
    held: variant.held,
    ...(variant.row === 34 ? { branchPreference: 35 + state.tick % 3 } : {}),
  };
  jamie.movesUsed[variant.id] = (jamie.movesUsed[variant.id] ?? 0) + 1;
  jamie.intent = variant.pose === "drink" ? "举壶饮酒" : variant.pose === "parry" ? "观察 · Drive Parry" : variant.name;
  fighter.attackUntilTick = state.tick + duration;
  fighter.facing = variant.airborne ? jamie.jumpFacing ?? fighter.facing : dx >= 0 ? 1 : -1;
  fighter.crouching = variant.posture === "crouch";
  if (variant.freezeFrames) {
    state.superFreezeRemaining = variant.freezeFrames;
    state.superFreezeSourceId = fighterId;
  }
  events.push({ type: "move", tick: state.tick, fighterId, moveId, variantId: variant.id, name: variant.name, category: variant.moveId.startsWith("A") ? "super" : variant.moveId.startsWith("S") ? "special" : variant.moveId.startsWith("D") ? "system" : "normal", x: fighter.x, y: fighter.y - fighter.height - 86 });
  advanceJamieAudio(state, fighter, events);
  return true;
}

/** Release is an input, not an interruption: already completed drinks are retained. */
export function setJamieHold(state: BattleState, fighterId: FighterId, held: boolean): boolean {
  const fighter = state.fighters.find((candidate) => candidate.id === fighterId);
  const action = getJamieState(fighter)?.action;
  if (!action || state.phase !== "running" || fighter?.capture) return false;
  const releasing = !held && action.held !== false;
  const accepted = setJamieActionHold(action, held);
  if (accepted && releasing && action.moveId === "S01") {
    // An early release still completes the first drink in this host. Keep its
    // native gulp at local24 (host47) before starting the release track.
    action.audioExitFrame = Math.max(action.duration - 25, action.audioHoldEntered && !action.drinksApplied ? 48 : 0);
  }
  return accepted;
}

function applyDrink(state: BattleState, fighter: Fighter, variant: JamieVariant, events: BattleEvent[]): void {
  const jamie = getJamieState(fighter)!;
  const before = jamie.drinkLevel;
  // SA2 keeps the actual level intact, and restores it when the temporary mode ends.
  if (jamie.sa2UntilTick <= state.tick) jamie.drinkLevel = Math.min(4, before + 1);
  const restore = before === 4 ? variant.row === 38 ? 5000 : 10000 : variant.driveRestore;
  const hasNativeDriveEvent = !variant.held && variant.nativeMove && nativeMoveEvents(variant.nativeMove, jamieResourceStyleId(jamie, state.tick)).some(event => event.ID === 36 && event.Param01 === 4 && event.Param02 > 0);
  const level4Branch = variant.nativeLevel4DriveFrame !== undefined && (jamie.action?.nativeStyleAtStart ?? jamieResourceStyleId(jamie, state.tick)) >= 4;
  if (!hasNativeDriveEvent && !level4Branch) applyDriveChange(jamie, restore, { cause: "other" });
  events.push({ type: "drink", tick: state.tick, fighterId: fighter.id, level: effectiveDrinkLevel(fighter, state.tick), x: fighter.x, y: fighter.y - fighter.height - 110 });
  emitJamieDrinkAudio(state, fighter, before, events);
}

function applyNativeEvents(state: BattleState, fighter: Fighter, authoredFrame: number, events: BattleEvent[]): void {
  const jamie = getJamieState(fighter)!;
  const action = jamie.action;
  if (!action) return;
  const variant = JAMIE_VARIANT_BY_ID[action.variantId];
  if (!variant.nativeMove || variant.held || variant.id === "row-87-drink") return;
  const entries = nativeMoveEvents(variant.nativeMove, action.nativeStyleAtStart ?? jamieResourceStyleId(jamie, state.tick));
  const seen = action.nativeEventsApplied ??= [];
  for (let index = 0; index < entries.length; index += 1) {
    const event = entries[index];
    if (seen.includes(index) || authoredFrame < event.from || event.Param02 < 0) continue;
    seen.push(index);
    if (event.ID === 36 && event.Param01 === 4) applyDriveChange(jamie, event.Param02, { cause: "other" });
    if (event.ID === 26 && event.Param01 === 0 && event.Param02 >= 5) {
      if (jamie.sa2UntilTick <= state.tick) jamie.sa2OriginalDrinkLevel = jamie.drinkLevel;
      jamie.sa2UntilTick = state.tick + event.Param04;
    } else if (event.ID === 26 && event.Param01 === 1) {
      applyDrink(state, fighter, variant, events);
      action.drinkApplied = true;
      action.drinksApplied = (action.drinksApplied ?? 0) + 1;
    }
  }
}

/** Owner animation keys run during the intro world interval; ordinary clocks pause. */
export function advanceJamieFreeze(state: BattleState, fighter: Fighter, events: BattleEvent[]): void {
  const action = getJamieState(fighter)?.action;
  if (!action) return;
  action.introFrame = Math.min(action.introDuration ?? 0, (action.introFrame ?? 0) + 1);
  advanceJamieAudio(state, fighter, events, true);
  applyNativeEvents(state, fighter, action.introFrame, events);
}

function lastArrowFrame(variant: JamieVariant): number {
  return Math.max(variant.startup + 1, ...variant.active.map((window) => window[1]));
}

function advanceNativeCapture(state: BattleState, fighter: Fighter, opponent: Fighter, action: NonNullable<JamieState["action"]>, variant: JamieVariant, hits: PendingHit[], events: BattleEvent[]): void {
  const capture = (action.throwPunish ? variant.nativePunishCapture ?? variant.nativeCapture : variant.nativeCapture)!;
  const elapsed = action.frame - (action.confirmedAtFrame ?? action.frame);
  const seen = action.nativeCaptureHits ??= [];
  for (let index = 0; index < capture.hits.length; index += 1) {
    const hit = capture.hits[index];
    if (elapsed < hit.from || seen.includes(index)) continue;
    seen.push(index);
    // Zero-damage OtherCollision keys carry launch/exit metadata, not damage hits.
    if (hit.damage <= 0) continue;
    const values = nativeContactValues(fighter, action, variant, index, state.tick, hit);
    hits.push({ sourceId: fighter.id, targetId: opponent.id, damage: 0, heal: 0,
      moveId: variant.moveId, variantId: variant.id, segment: variant.active.length + index,
      capturedHit: true, unblockable: true, throw: variant.throw, knockback: 0,
      nativeThrowPunish: Boolean(action.throwPunish && variant.nativePunishCapture),
      ...values,
    });
  }
  if (elapsed >= capture.releaseFrame) {
    action.cinematicPhase = "finish";
    const jamie = getJamieState(fighter)!;
    applySuperChange(jamie, capture.releaseSuperGain, { styleId: jamieResourceStyleId(jamie, state.tick) });
    applyDriveChange(jamie, capture.releaseDriveGain, { cause: "other" });
    releaseJamieCapture(state, fighter, variant.moveId !== "S08", events);
    if (variant.moveId === "S08") opponent.stunUntilTick = state.tick + Math.max(0, capture.releaseStun - 1);
    events.push({ type: "cinematic", tick: state.tick, sourceId: fighter.id, targetId: opponent.id, moveId: variant.moveId, phase: "finish", x: opponent.x, y: opponent.y - 70 });
  }
}

function advanceAction(state: BattleState, _config: BattleConfig, fighter: Fighter, opponent: Fighter, hits: PendingHit[], events: BattleEvent[]): void {
  const jamie = getJamieState(fighter)!;
  const action = jamie.action;
  if (!action) return;
  let variant = JAMIE_VARIANT_BY_ID[action.variantId];
  action.frame = state.tick - action.startTick;
  action.visualFrame = action.frame;
  const frame = action.frame;
  // Capture release precedes the drink branch. Keep the original confirmation
  // clock and contact metadata instead of starting a new standalone S01 action.
  const throwElapsed = action.confirmedAtFrame === undefined ? -1 : frame - action.confirmedAtFrame;
  if (variant.id === "row-91" && action.connected && throwElapsed === JAMIE_THROW_DRINK.branchFrame && effectiveDrinkLevel(fighter, state.tick) < 4) {
    variant = JAMIE_VARIANT_BY_ID["row-91-drink"];
    action.variantId = variant.id;
    action.name = variant.name;
  }
  const throwDrink = variant.id === "row-91-drink" && action.connected && throwElapsed >= JAMIE_THROW_DRINK.branchFrame;
  if (throwDrink) {
    action.pose = "drink";
    action.duration = action.confirmedAtFrame! + JAMIE_THROW_DRINK.branchFrame + JAMIE_THROW_DRINK.recoveryFrame;
    fighter.attackUntilTick = action.startTick + action.duration;
    jamie.intent = "投技命中 · 饮酒";
  }
  applyNativeEvents(state, fighter, frame + (action.introDuration ?? 0), events);
  if (!action.scalingRegistered) {
    const scaling = jamieMoveScaling(jamie, variant, state.tick, action.rushDamageMultiplier ?? 1);
    action.damageScale = action.scalingFromTenshin ? Math.max(variant.minimumScaling, scaling.multiplier) : scaling.scale;
    action.comboIndex = scaling.index;
    action.comboMultiplier = scaling.multiplier;
    action.damageBudget = undefined;
  }
  action.damageBudget ??= Math.round(variant.damage * Number(fighter.settings.damageScale ?? 1) * jamieDamageMultiplier(fighter, state.tick) * (action.damageScale ?? 1));
  fighter.vx = 0;
  fighter.vy = 0;
  const captured = action.captureTargetId === opponent.id && opponent.capture?.sourceId === fighter.id;
  advanceJamieAudio(state, fighter, events);
  if (captured) poseCapturedPair(state, fighter, opponent, action, variant);
  if (captured && variant.nativeCapture) advanceNativeCapture(state, fighter, opponent, action, variant, hits, events);
  if (captured && !variant.nativeCapture && variant.capture === "throw" && frame >= 30 && !action.finishApplied) {
    action.finishApplied = true;
    action.cinematicPhase = "finish";
    opponent.capture!.phase = "finish";
    hits.push({ sourceId: fighter.id, targetId: opponent.id, damage: action.damageBudget, heal: 0, moveId: variant.moveId, variantId: variant.id, capturedHit: true, unblockable: true, finish: true, throw: true, knockdown: 45, knockback: 35, superGain: variant.superGain, driveGain: variant.driveGain });
  }
  if (captured && !variant.nativeCapture && variant.capture === "cinematic") {
    const elapsed = (frame - (action.confirmedAtFrame ?? frame)) / (action.cinematicTimeScale ?? 1);
    const weights = variant.cinematicHits.map((beat, index) => index === 0 ? 0 : beat.weight);
    const remainingDamage = Math.max(0, action.damageBudget - (action.confirmedInitialDamage ?? 0));
    for (let index = 0; index < variant.cinematicHits.length; index += 1) {
      const beat = variant.cinematicHits[index];
      if (elapsed < beat.frame || action.hitSegments.includes(index) || beat.weight === 0) continue;
      action.hitSegments.push(index);
      const finish = index === variant.cinematicHits.length - 1;
      hits.push({ sourceId: fighter.id, targetId: opponent.id, damage: cumulativeDamage(remainingDamage, weights, index), heal: 0, moveId: variant.moveId, variantId: variant.id, segment: index, capturedHit: true, unblockable: true, finish, stun: 30, knockdown: finish ? variant.row === 89 ? 0 : 65 : 0, knockback: finish ? 90 : 0, launch: finish ? variant.launch : 0, superGain: 0, driveGain: 0 });
      if (finish) {
        action.cinematicPhase = "finish";
        opponent.capture!.phase = "finish";
        events.push({ type: "cinematic", tick: state.tick, sourceId: fighter.id, targetId: opponent.id, moveId: variant.moveId, phase: "finish", x: opponent.x, y: opponent.y - 70 });
      }
    }
    if (elapsed > variant.cinematicHits.at(-1)!.frame) releaseJamieCapture(state, fighter, true, events);
  }
  const travelEnd = variant.startup + 10;
  if (!captured && variant.travel !== 0 && frame <= (variant.active.length ? travelEnd : variant.duration)) {
    const travelTicks = variant.active.length ? travelEnd : variant.duration;
    fighter.vx = action.directionX * variant.travel * 60 / travelTicks;
    fighter.vy = action.directionY * variant.travel * 60 / travelTicks;
  }
  if (!captured && variant.airborne && variant.moveId !== "S06" && jamie.jumpUntilTick > state.tick) {
    fighter.vx = jamie.jumpVelocityX ?? 0;
    fighter.vy = jamie.jumpVelocityY ?? 0;
  }
  if (variant.row === 34) {
    fighter.vx = -action.directionX * 42;
    fighter.vy = -action.directionY * 42;
  }
  if (variant.moveId === "S05" && frame >= variant.startup && frame <= lastArrowFrame(variant)) {
    const progress = (frame - variant.startup) / Math.max(1, lastArrowFrame(variant) - variant.startup);
    fighter.height = Math.max(0, Math.sin(progress * Math.PI) * 85);
  }
  const drinksApplied = action.drinksApplied ?? 0;
  if (throwDrink && throwElapsed >= JAMIE_THROW_DRINK.branchFrame + JAMIE_THROW_DRINK.drinkFrame && !action.drinkApplied) {
    applyDrink(state, fighter, variant, events);
    action.drinksApplied = 1;
    action.drinkApplied = true;
  }
  const nativeDrinkEvent = !variant.held && variant.nativeMove && variant.id !== "row-87-drink" && nativeMoveEvents(variant.nativeMove, action.nativeStyleAtStart ?? 0).some(event => event.ID === 26 && event.Param01 === 1);
  if (!nativeDrinkEvent && variant.drinkFrames[drinksApplied] !== undefined && frame >= variant.drinkFrames[drinksApplied] && (!variant.held || action.held || drinksApplied === 0)) {
    applyDrink(state, fighter, variant, events);
    action.drinksApplied = drinksApplied + 1;
    action.drinkApplied = true;
  }
  if (variant.nativeLevel4DriveFrame !== undefined && (action.nativeStyleAtStart ?? 0) >= 4 && frame >= variant.nativeLevel4DriveFrame && !action.nativeLevel4DriveApplied) {
    applyDriveChange(jamie, variant.nativeLevel4DriveRestore ?? 0, { cause: "other" });
    action.nativeLevel4DriveApplied = true;
  }
  if (variant.drinkOnCompletion && frame >= action.duration && !action.drinkApplied && (variant.row === 87 || action.connected)) {
    applyDrink(state, fighter, variant, events);
    action.drinkApplied = true;
    action.drinksApplied = 1;
  }
  if (variant.held && action.held && variant.row === 98 && frame >= 4 && frame <= 120) {
    // Local Parry event 36 subtracts 50 Drive from authored frame four.
    // Its native recovery-wait useKind is not inferred from that event alone.
    applyDriveChange(jamie, -50, { cause: "other" });
    if (jamie.drive === 0) {
      action.duration = frame + variant.recovery;
      action.held = false;
    }
  }
  const lastActive = variant.moveId === "S06" ? jamie.jumpUntilTick - action.startTick : Math.max(0, ...variant.active.map((window) => window[1]));
  if (frame > lastActive && !action.connected && !action.blocked && !action.missRecoveryAdjusted) {
    action.missRecoveryAdjusted = true;
    if (!variant.nativeActionId) action.duration += variant.row === 3 ? 1 : variant.row === 8 ? 2 : 0;
  }
  if (action.captureTargetId && !variant.nativeCapture && variant.capture !== "cinematic" && frame > (variant.capture === "throw" ? 30 : lastActive)) releaseJamieCapture(state, fighter, true, events);
  if (variant.drinkOnCompletion && frame > (variant.capture === "throw" ? 30 : lastActive)) {
    action.pose = "drink";
    action.cinematicPhase = "finish";
  }
  if (!variant.nativeMove && variant.row === 37 && frame >= variant.duration - 1 && !action.drinkApplied) {
    applyDriveChange(jamie, 10000, { cause: "other" });
    action.drinkApplied = true;
  }
  for (let index = 0; index < variant.active.length; index += 1) {
    const nativeHit = variant.nativeHits?.[index];
    const [start, publishedEnd] = variant.active[index];
    const end = variant.moveId === "S06" && index === variant.active.length - 1 ? lastActive : publishedEnd;
    if (frame < start || frame > end || action.hitSegments.includes(index)) continue;
    if (nativeHit && nativeHit.hitId >= 0 && action.hitSegments.some(previous => variant.nativeHits?.[previous]?.hitId === nativeHit.hitId)) continue;
    if (action.confirmedAtFrame !== undefined && variant.capture === "cinematic") continue;
    if (variant.moveId === "D03" || variant.damage === 0 && !variant.throw) continue;
    if (variant.moveId === "S05" && (nativeHit ? nativeHit.hitId !== 0 : index > 0) && !action.connected) continue;
    const continuingTarget = opponent.lastHitBy === fighter.id && (opponent.lastHitTick ?? -100) >= state.tick - 65 && (variant.predecessors.length > 0 || fighter.height > 20);
    if (opponent.knockdownUntilTick > state.tick && !action.connected && !continuingTarget && !captured) continue;
    if (variant.throw && (opponent.height > 10 || opponent.stunUntilTick > state.tick)) continue;
    const dx = opponent.x - fighter.x;
    const dy = opponent.y - fighter.y;
    const distance = Math.hypot(dx, dy);
    const direction = (dx * action.directionX + dy * action.directionY) / (distance || 1);
    const reachesAir = variant.moveId === "S05" || variant.moveId === "U01" || [4, 5, 10, 11].includes(variant.row) || fighter.height > 20 || (opponent.juggleUntilTick ?? 0) > state.tick && opponent.juggleSourceId === fighter.id;
    if (!captured && (distance > variant.range || direction < (variant.crossUp ? -1 : variant.pose === "spin" ? -0.3 : 0.15) || opponent.height > 40 && !reachesAir || fighter.height > 90 && opponent.height < 20)) continue;
    action.hitSegments.push(index);
    const count = variant.active.length || 1;
    const weights = variant.capture === "cinematic" ? variant.cinematicHits.map((beat) => beat.weight) : variant.hitWeights;
    const graceScaling = action.scalingFromTenshin && jamie.scalingGraceHits === 0 ? Math.max(variant.minimumScaling, 1 - Math.max(2, jamie.comboCount) * 0.1) : 1;
    const damage = variant.capture === "throw" ? 0 : Math.round(cumulativeDamage(action.damageBudget, weights, variant.capture === "cinematic" ? 0 : index) * graceScaling);
    const remainingSequence = variant.capture !== "none" ? Math.max(0, lastActive - frame + 3) : 0;
    const nativeValues = nativeContactValues(fighter, action, variant, index, state.tick);
    hits.push({
      sourceId: fighter.id, targetId: opponent.id, damage, heal: 0, moveId: variant.moveId, variantId: variant.id, segment: index,
      knockdown: index === count - 1 ? variant.knockdown : 0,
      knockback: index === count - 1 ? variant.knockdown > 0 ? 30 : 12 : 2,
      launch: variant.launch, throw: variant.throw, low: variant.row === 11 && index === 1 && action.blocked ? false : variant.low, overhead: variant.overhead,
      driveDamage: Math.round(variant.driveBlockLoss / count),
      driveGain: variant.capture === "throw" ? 0 : Math.round(variant.driveGain / count), superGain: variant.capture === "throw" ? 0 : Math.round(variant.superGain / count),
      capture: variant.capture !== "none", capturedHit: captured, finish: index === count - 1 && variant.capture !== "cinematic" && variant.capture !== "throw",
      recoverable: variant.moveId === "D02",
      juggle: variant.row === 18 || [4, 5, 11, 14, 17].includes(variant.row) && opponent.height > 10,
      slam: variant.row === 16 && opponent.height > 10,
      ...nativeValues,
      stun: Math.max(remainingSequence, nativeValues.stun ?? (variant.row === 84 ? 60 : jamieContactStun(action, variant, false))),
    });
  }
  if (frame > lastActive && action.cinematicPhase === "startup") action.cinematicPhase = "finish";
  // The throw's last-frame hit still needs its confirmed PC/resource metadata.
  // onContact releases this action after resolving that hit, on this same tick.
  if (frame >= action.duration && !(captured && variant.capture === "throw" && action.finishApplied)) {
    stopJamieAudio(state, fighter, events);
    releaseJamieCapture(state, fighter, true, events);
    jamie.action = null;
    fighter.crouching = false;
    fighter.attackUntilTick = state.tick;
  }
}

export function updateJamieFighters(state: BattleState, config: BattleConfig, random: () => number, hits: PendingHit[], events: BattleEvent[], aiEnabled = true): void {
  for (const fighter of state.fighters) {
    const jamie = getJamieState(fighter);
    if (!jamie || fighter.hp <= 0) continue;
    const tick = state.tick;
    const opponent = state.fighters.find((candidate) => candidate.id !== fighter.id)!;
    if (state.worldStopped && jamie.sa2UntilTick > tick - 1) jamie.sa2UntilTick += 1;
    refreshJamieCombo(fighter, opponent, tick);
    if (jamie.sa2UntilTick > 0 && jamie.sa2UntilTick <= tick) {
      jamie.drinkLevel = jamie.sa2OriginalDrinkLevel;
      jamie.sa2UntilTick = 0;
      jamie.intent = "临时酒级结束";
    }
    if (fighter.capture) {
      fighter.vx = fighter.vy = 0;
      jamie.intent = fighter.capture.phase === "finish" ? "超必杀 · 击飞" : "超必杀 · 演出中";
      continue;
    }
    const stunned = fighter.stunUntilTick > tick;
    const knockedDown = fighter.knockdownUntilTick > tick;
    const activeVariant = jamie.action && JAMIE_VARIANT_BY_ID[jamie.action.variantId];
    const attacking = Boolean(activeVariant && activeVariant.behavior !== "movement" && activeVariant.behavior !== "parry");
    const parrying = activeVariant?.moveId === "D03";
    const holdingRecovery = attacking || parrying || Boolean(jamie.action?.captureTargetId);
    // Host adapter: native routine/state bits are represented by stun, guard and
    // action state here; the unresolved command-state bit is conservatively gated
    // during attacks/Parry. A captured defender skips this invocation above.
    const wasBurnout = jamie.burnout;
    advanceDriveRecovery(jamie, {
      eligible: !state.worldStopped,
      airborne: fighter.height > 0,
      forwardWalking: !jamie.action && !stunned && !knockedDown && fighter.height <= 0 && (fighter.vx * (opponent.x - fighter.x) + fighter.vy * (opponent.y - fighter.y)) > 0,
      damageState: (stunned || knockedDown) && jamie.guardUntilTick <= tick,
      holdNegativeWait: holdingRecovery,
      canRegenerate: !holdingRecovery,
      canExitBurnout: !stunned && !knockedDown && !jamie.action,
    });
    if (wasBurnout && !jamie.burnout) emitJamieVoice(state, fighter, events, jamie.guardLow ? 21941 : 21940);
    if (jamie.comboUntilTick < tick && !jamie.action?.captureTargetId) {
      resetJamieCombo(jamie);
    }
    if ((fighter.juggleUntilTick ?? 0) > tick) {
      fighter.height = Math.max(0, (fighter.juggleHeight ?? 160) * (fighter.juggleUntilTick! - tick) / Math.max(1, fighter.juggleUntilTick! - (fighter.juggleStartedTick ?? tick)));
    } else if (jamie.jumpUntilTick > tick) {
      const duration = jamie.jumpUntilTick - jamie.jumpStartedTick;
      const progress = (tick - jamie.jumpStartedTick) / duration;
      fighter.height = Math.max(0, jamie.diving ? (jamie.diveStartHeight ?? 90) * (1 - progress) : Math.sin(progress * Math.PI) * 105);
    } else fighter.height = Math.max(0, fighter.height - 5);
    if (fighter.stunUntilTick > tick || fighter.knockdownUntilTick > tick) {
      jamie.intent = fighter.knockdownUntilTick > tick ? "倒地 · 等待起身" : "受击硬直";
      continue;
    }
    advanceAction(state, config, fighter, opponent, hits, events);
  }
  if (aiEnabled) updateJamieStandardAI(state, random, events, { canStart, requestMove: requestJamieMove });
}

/** Collision-confirmed input phase, needed by the published one-active-frame HP cancel. */
export function processJamieContactCancels(state: BattleState, random: () => number, events: BattleEvent[]): void {
  if (state.fighters.some((fighter) => fighter.hp <= 0)) return;
  updateJamieStandardAI(state, random, events, { canStart, requestMove: requestJamieMove }, true);
}
