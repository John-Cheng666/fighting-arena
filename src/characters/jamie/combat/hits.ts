import { getJamieState } from "../state";
import { ARENA } from "../../../engine/types";
import { JAMIE_VARIANT_BY_ID } from "../moves";
import { beginJamieCapture, releaseJamieCapture, resolveJamieThrowTech } from "./execution";
import { registerJamieScaling } from "./scaling";
import { jamieContactStun } from "./frameData";
import { resetStandardAIProgram } from "../../../engine/ai/StandardAI";
import { applyDriveChange, applySuperChange, jamieResourceStyleId, nativeScaledDamage } from "./resources";

import type { HitContext } from "../../../engine/characters";

export function resolveJamieIncomingHit(context: HitContext): void {
  const { state, hit, events } = context;
  const { alive, damage, healing, finishing, suppressed: throwTeched } = context.ledger;

    if (
      !alive.has(hit.sourceId) ||
      !alive.has(hit.targetId) ||
      hit.sourceId === hit.targetId
    )
      return;
    if (throwTeched.has(hit.sourceId) || throwTeched.has(hit.targetId)) return;
    const target = state.fighters.find(
      (fighter) => fighter.id === hit.targetId,
    )!;
    const source = state.fighters.find(
      (fighter) => fighter.id === hit.sourceId,
    )!;
    const targetJamie = getJamieState(target);
    const sourceJamie = getJamieState(source);
    const action = targetJamie?.action;
    const variant = action && JAMIE_VARIANT_BY_ID[action.variantId];
    const frame = action?.frame ?? 0;
    const sourceAction = sourceJamie?.action;
    const sourceVariant = sourceJamie && (hit.variantId ? JAMIE_VARIANT_BY_ID[hit.variantId] : sourceAction && JAMIE_VARIANT_BY_ID[sourceAction.variantId]);
    context.details = sourceVariant ? { name: sourceVariant.name } : {};
    if (source.capture && !hit.capturedHit) return;
    if (target.capture && target.capture.sourceId !== source.id) return;
    if (action?.captureTargetId && variant?.capture === "cinematic") return;
    if ((targetJamie?.parryInvulnerableUntilTick ?? 0) > state.tick && !hit.capturedHit) return;
    // Invulnerability is limited to the published move windows, never an entire move.
    const fullInvincible = variant && (
      variant.row === 74 && frame <= 9 ||
      ([89, 90].includes(variant.row) || variant.row === 87 && !hit.projectile) && frame <= 12 ||
      variant.row === 96 && frame <= 22 || variant.row === 97 && frame <= 20
    );
    const airInvincible = variant?.moveId === "S05" && source.height > 20 && frame <= ([71, 72, 73, 74].indexOf(variant.row) === 0 ? 12 : variant.row === 72 ? 14 : variant.row === 73 ? 16 : 12);
    const projectileWindow: Record<number, [number, number]> = { 79: [3, 24], 80: [4, 26], 81: [5, 33], 82: [3, 28] };
    const window = variant && projectileWindow[variant.row];
    const projectileInvincible = hit.projectile && window && frame >= window[0] && frame <= window[1];
    const throwInvincible = hit.throw && variant?.row === 94 && frame <= 15;
    if (!hit.capturedHit && (fullInvincible || airInvincible || projectileInvincible || throwInvincible)) return;
    if (hit.throw && target.height > 10) return;
    if (hit.throw && sourceVariant?.capture === "throw" && variant?.capture === "throw" && Math.abs((action?.startTick ?? -100) - state.tick) <= 12) {
      throwTeched.add(source.id);
      throwTeched.add(target.id);
      resolveJamieThrowTech(state, source, target, events);
      return;
    }
    const continuingParry = !!variant?.held && action?.held !== false;
    const parryEnd = continuingParry ? 120 : 12;
    const parry = !!targetJamie && variant?.moveId === "D03" && variant.row === 98 && frame <= parryEnd && !hit.throw && !hit.unblockable;
    const facingSource = (source.x - target.x) * target.facing >= -12;
    const guard = !!targetJamie && targetJamie.guardUntilTick > state.tick && !hit.throw && !hit.unblockable &&
      (!action || variant?.moveId === "D03") && facingSource &&
      (!hit.low || targetJamie.guardLow) && (!hit.overhead || !targetJamie.guardLow);
    if (parry || guard) {
      if (sourceAction && !sourceAction.recoveryAdjusted && (sourceVariant?.row === 26 || sourceVariant?.row === 11 && !sourceVariant.nativeActionId)) {
        sourceAction.duration += sourceVariant.row === 11 ? 1 : 2;
        sourceAction.recoveryAdjusted = true;
      }
      const perfect = parry && frame <= 2 && (hit.projectile || facingSource && (!hit.low || targetJamie!.guardLow));
      context.details.parry = parry;
      context.details.perfect = perfect;
      targetJamie!.lastContactTick = state.tick;
      if (parry) {
        applyDriveChange(targetJamie!, perfect ? 5000 : 3000, { cause: "other" });
        if (perfect) {
          source.stunUntilTick = Math.max(source.stunUntilTick, state.tick + 8);
          targetJamie!.intent = "Perfect Parry · 精准格挡";
          const outcomeId = hit.projectile ? "row-100" : "row-99";
          if (action) action.perfectParryUntilTick = state.tick + JAMIE_VARIANT_BY_ID[outcomeId].duration;
          targetJamie!.movesUsed[outcomeId] = (targetJamie!.movesUsed[outcomeId] ?? 0) + 1;
          targetJamie!.comboStarterPenalty = JAMIE_VARIANT_BY_ID[outcomeId].scaling.starter;
          targetJamie!.comboMoveCount = 0;
          targetJamie!.comboUntilTick = state.tick + 120;
          targetJamie!.parryInvulnerableUntilTick = continuingParry ? 0 : state.tick + (hit.projectile ? 15 : 6);
          if (action && !continuingParry) {
            action.variantId = outcomeId;
            action.name = hit.projectile ? "Perfect Parry (projectile)" : "Perfect Parry (strike)";
            action.startTick = state.tick;
            action.frame = 0;
            action.duration = JAMIE_VARIANT_BY_ID[outcomeId].duration;
          }
          if (sourceJamie && sourceAction) sourceJamie.punishUntilTick = sourceAction.startTick + sourceAction.duration;
        }
      } else {
        applyDriveChange(targetJamie!, -(hit.driveDamage ?? 1200), { cause: "hit" });
        const blockstun = hit.blockStun ?? (sourceAction && sourceVariant ? jamieContactStun(sourceAction, sourceVariant, true) : 8);
        target.stunUntilTick = Math.max(target.stunUntilTick, state.tick + blockstun);
        targetJamie!.guardUntilTick = Math.max(targetJamie!.guardUntilTick, target.stunUntilTick + 2);
      }
      if (sourceJamie?.action) sourceJamie.action.blocked = true;
      if (sourceAction && hit.segment !== undefined) { sourceAction.contactSegments?.push(hit.segment); sourceAction.blockedSegments?.push(hit.segment); }
      if (!parry && sourceVariant?.row === 95) {
        const wall = target.x <= ARENA.left + 62 || target.x >= ARENA.right - 62 || target.y <= ARENA.top + 133 || target.y >= ARENA.bottom - 40;
        if (wall) {
          const duration = targetJamie!.burnout ? 90 : 55;
          target.wallSplatUntilTick = state.tick + duration;
          target.stunUntilTick = Math.max(target.stunUntilTick, target.wallSplatUntilTick);
          targetJamie!.guardUntilTick = 0;
          events.push({ type: "wall", tick: state.tick, fighterId: target.id, x: target.x, y: target.y - 60 });
        }
      }
      if (sourceJamie) sourceJamie.lastContactTick = state.tick;
      if (sourceJamie && hit.blockSuperGain !== undefined) {
        applySuperChange(sourceJamie, perfect ? Math.trunc(hit.blockSuperGain * 80 / 100) : hit.blockSuperGain, { styleId: jamieResourceStyleId(sourceJamie, state.tick) });
      }
      if (sourceJamie && hit.blockDriveGain !== undefined) {
        applyDriveChange(sourceJamie, perfect ? Math.trunc(hit.blockDriveGain * 50 / 100) : hit.blockDriveGain, { cause: "other" });
      }
      if (targetJamie && hit.blockTargetSuperGain !== undefined) {
        applySuperChange(targetJamie, perfect ? Math.trunc(hit.blockTargetSuperGain * 80 / 100) : hit.blockTargetSuperGain, { styleId: jamieResourceStyleId(targetJamie, state.tick) });
      }
      events.push({ type: "block", tick: state.tick, fighterId: target.id, perfect, parry, x: target.x, y: target.y - target.height - 80 });
      context.outcome = { kind: "block", amount: 0, armor: false };
      // Burnout takes a small chip from specials and projectiles.
      if (!parry && targetJamie!.burnout && (hit.projectile || hit.moveId?.startsWith("S"))) {
        const chip = Math.round(hit.damage * 0.1);
        damage.set(target.id, (damage.get(target.id) ?? 0) + chip);
        source.damageDealt += chip;
        context.details.calculation = { baseDamage: hit.damage, factors: [10], multiplier: 1, minimum: 0, rounding: "round" };
      }
      return;
    }
    const punish = !!action && (variant?.moveId === "D03" || frame > Math.max(0, ...variant!.active.map((window) => window[1]))) || (targetJamie?.punishUntilTick ?? 0) > state.tick;
    const counter = !!action && !!variant && frame < variant.startup;
    const counterAllowed = !sourceVariant?.moveId.startsWith("A");
    const normalThrowLatch = Boolean(hit.capture && sourceVariant?.capture === "throw" && !hit.finish);
    if (sourceAction && punish && hit.throw && sourceVariant?.capture === "throw") sourceAction.throwPunish = true;
    if (sourceAction && normalThrowLatch) {
      // Normal/counter captures720/724 expose THROW_ESCAPE; PC/FOLLOW722/726 do not.
      // An opponent's attack startup does not itself disable the normal capture flag.
      sourceAction.normalThrowTechable = !punish && !target.capture &&
        target.stunUntilTick <= state.tick && target.knockdownUntilTick <= state.tick;
    }
    const multiplier = hit.nativeThrowPunish ? 1 : counterAllowed && (punish || sourceAction?.throwPunish) && hit.throw && sourceVariant?.moveId !== "S08" ? 1.7 : counterAllowed && (counter || punish) ? 1.2 : 1;
    const amount = normalThrowLatch ? 0 : hit.unscaledDamage !== undefined && hit.damageFactors
      ? Math.floor(Math.max(hit.minimumDamage ?? 0, nativeScaledDamage(hit.unscaledDamage, [...hit.damageFactors, Math.round(multiplier * 100)])) * (hit.damageMultiplier ?? 1))
      : Math.round(Math.max(0, hit.damage) * multiplier);
    context.details.counter = counter && counterAllowed;
    context.details.punish = (punish || !!sourceAction?.throwPunish) && counterAllowed;
    if (!normalThrowLatch) context.details.calculation = hit.unscaledDamage !== undefined && hit.damageFactors
      ? { baseDamage: hit.unscaledDamage, factors: [...hit.damageFactors, Math.round(multiplier * 100)], multiplier: hit.damageMultiplier ?? 1, minimum: hit.minimumDamage ?? 0, rounding: "native" }
      : { baseDamage: Math.max(0, hit.damage), factors: [Math.round(multiplier * 100)], multiplier: 1, minimum: 0, rounding: "round" };
    if ((counter || punish) && counterAllowed) events.push({ type: "counter", tick: state.tick, sourceId: source.id, targetId: target.id, punish, x: target.x, y: target.y - 90 });
    const punishLoss = punish || Boolean((hit.finish || hit.nativeThrowPunish) && sourceAction?.throwPunish);
    if (punishLoss && !normalThrowLatch && targetJamie && sourceVariant && !sourceAction?.punishApplied) {
      const loss = hit.punishDriveLoss ?? sourceVariant.punishDriveLoss;
      applyDriveChange(targetJamie, -loss, { cause: "hit" });
      if (sourceAction && loss > 0) sourceAction.punishApplied = true;
    }
    damage.set(target.id, (damage.get(target.id) ?? 0) + amount);
    healing.set(
      source.id,
      (healing.get(source.id) ?? 0) + (normalThrowLatch ? 0 : Math.max(0, hit.heal)),
    );
    target.hitUntilTick = state.tick + 7;
    const armor = !!targetJamie && variant?.row === 95 && frame <= 27 && action!.armorHits < 2 && !hit.throw;
    if (armor) action!.armorHits += 1;
    else {
      target.stunUntilTick = Math.max(target.stunUntilTick, state.tick + (hit.stun ?? 12));
      if ((hit.knockdown ?? 0) > 0) target.knockdownUntilTick = Math.max(target.knockdownUntilTick, state.tick + hit.knockdown!);
      if (action && targetJamie) {
        events.push({ type: "interrupt", tick: state.tick, fighterId: target.id, moveId: action.moveId, label: action.moveId === "S01" ? "饮酒被打断" : "动作被打断", x: target.x, y: target.y - target.height - 95 });
        releaseJamieCapture(state, target, false, events);
        targetJamie.action = null;
        target.attackUntilTick = state.tick;
        resetStandardAIProgram(targetJamie.standardAI);
      }
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 1;
      const push = hit.knockback ?? 5;
      target.x = Math.max(ARENA.left + 52, Math.min(ARENA.right - 52, target.x + dx / distance * push));
      target.y = Math.max(ARENA.top + 123, Math.min(ARENA.bottom - 30, target.y + dy / distance * push));
      target.vx = dx / distance * push * 4;
      target.vy = dy / distance * push * 4;
      target.height = Math.max(target.height, hit.launch ?? 0);
      if ((hit.knockdown ?? 0) > 0 && !hit.capturedHit) { target.height = 0; target.juggleUntilTick = 0; target.juggleSourceId = undefined; target.pendingHardKnockdown = false; }
      if (hit.juggle && !hit.slam) {
        target.juggleStartedTick = state.tick;
        target.juggleUntilTick = state.tick + 45;
        target.juggleHeight = Math.max(75, target.height);
        target.juggleSourceId = source.id;
        target.height = target.juggleHeight;
        target.pendingHardKnockdown = true;
        target.knockdownUntilTick = 0;
      }
      if (hit.slam) { target.height = 0; target.juggleUntilTick = 0; target.pendingHardKnockdown = false; target.knockdownUntilTick = state.tick + 45; target.hardKnockdown = true; }
      if (sourceVariant?.row === 10) target.crouching = false;
      if (sourceVariant?.row === 5 && punish && target.height < 1) { target.stunUntilTick = Math.max(target.stunUntilTick, state.tick + 60); target.knockdownUntilTick = 0; }
      if (sourceVariant?.row === 11 && (punish || sourceAction?.punishApplied) && (hit.knockdown ?? 0) > 0) { target.knockdownUntilTick += 20; target.hardKnockdown = true; }
      if (hit.moveId === "T02" && hit.finish) {
        const oldX = target.x;
        const oldY = target.y;
        target.x = source.x;
        target.y = source.y;
        source.x = oldX;
        source.y = oldY;
      }
      const atWall = target.x <= ARENA.left + 57 || target.x >= ARENA.right - 57 || target.y <= ARENA.top + 128 || target.y >= ARENA.bottom - 35;
      const wallMove = hit.moveId === "D01" || sourceVariant?.row === 32 || sourceVariant?.row === 70 && punish;
      if (atWall && wallMove) {
        target.wallSplatUntilTick = state.tick + 55;
        target.stunUntilTick = Math.max(target.stunUntilTick, state.tick + 55);
        target.hardKnockdown = true;
        events.push({ type: "wall", tick: state.tick, fighterId: target.id, x: target.x, y: target.y - 60 });
      }
      if (sourceVariant?.row === 95 && (punish || (sourceAction?.armorHits ?? 0) > 0)) {
        target.stunUntilTick = Math.max(target.stunUntilTick, state.tick + 60);
        target.knockdownUntilTick = target.height > 0 ? state.tick + 60 : 0;
        if (sourceJamie) applySuperChange(sourceJamie, 3000, { styleId: jamieResourceStyleId(sourceJamie, state.tick) });
      }
    }
    target.lastHitBy = source.id;
    target.lastHitTick = state.tick;
    if (!hit.capturedHit && (target.juggleUntilTick ?? 0) > state.tick) target.pendingHardKnockdown = false;
    if (hit.recoverable) target.recoverableHp = Math.min(target.maxHp - target.hp + amount, (target.recoverableHp ?? 0) + amount);
    else if (amount > 0) target.recoverableHp = 0;
    if (hit.finish) finishing.add(target.id);
    if (targetJamie) {
      targetJamie.lastContactTick = state.tick;
      if (counter && counterAllowed) targetJamie.counterHitUntilTick = target.stunUntilTick;
      if (punish && counterAllowed) targetJamie.punishCounterUntilTick = target.stunUntilTick;
      applySuperChange(targetJamie, hit.targetSuperGain ?? Math.round(amount * 8), { styleId: jamieResourceStyleId(targetJamie, state.tick) });
      targetJamie.guardUntilTick = 0;
    }
    context.outcome = { kind: "hit", amount, armor };
    events.push({
      type: "hit",
      tick: state.tick,
      sourceId: source.id,
      targetId: target.id,
      amount,
      ...(hit.moveId ? { moveId: hit.moveId } : {}),
      ...(sourceVariant?.moveId.startsWith("A") ? { category: "super" as const } : {}),
      x: target.x,
      y: target.y - 84,
    });
  
}

export function registerJamieContact(context: HitContext): void {
  if (context.outcome.kind !== "hit") return;
  const { state, hit, source, target, events } = context;
  const { amount, armor } = context.outcome;
  const sourceJamie = getJamieState(source);
  const sourceAction = sourceJamie?.action;
  const sourceVariant = hit.variantId ? JAMIE_VARIANT_BY_ID[hit.variantId] : sourceAction && JAMIE_VARIANT_BY_ID[sourceAction.variantId];
    if (hit.capture && !armor) {
      if (sourceAction) sourceAction.confirmedInitialDamage = amount;
      beginJamieCapture(state, source, target, events);
    }
    if (sourceJamie) {
      if (sourceVariant) registerJamieScaling(sourceJamie, sourceJamie.action, sourceVariant);
      if (sourceJamie.action) {
        sourceJamie.action.connected = true;
        sourceJamie.action.hitCount = (sourceJamie.action.hitCount ?? 0) + 1;
        sourceJamie.action.damageDealt = (sourceJamie.action.damageDealt ?? 0) + amount;
        if (hit.segment !== undefined) sourceJamie.action.contactSegments?.push(hit.segment);
      }
      sourceJamie.lastContactTick = state.tick;
      if (sourceVariant?.row === 83) { sourceJamie.scalingGraceHits = 2; sourceJamie.comboCount = 0; }
      else {
        sourceJamie.comboCount += 1;
        if (amount > 0 && sourceJamie.scalingGraceHits !== undefined) sourceJamie.scalingGraceHits = Math.max(0, sourceJamie.scalingGraceHits - 1);
      }
      if (sourceVariant?.moveId === "D02" && sourceAction && !sourceAction.recoveryAdjusted) { sourceAction.duration += 5; sourceAction.recoveryAdjusted = true; }
      sourceJamie.comboUntilTick = Math.max(target.stunUntilTick, target.capture?.untilTick ?? 0, target.juggleUntilTick ?? 0);
      const normalThrowLatch = hit.capture && sourceVariant?.capture === "throw" && !hit.finish;
      const gaugeGain = normalThrowLatch ? 0 : !hit.nativeThrowPunish && sourceAction?.throwPunish && sourceVariant?.nativeCapture && sourceVariant.capture === "throw"
        ? (hit.superGain ?? 0) * 2 : sourceAction?.throwPunish && hit.finish ? 4000 : hit.superGain ?? Math.round(amount * 12);
      applySuperChange(sourceJamie, gaugeGain, { styleId: jamieResourceStyleId(sourceJamie, state.tick) });
      applyDriveChange(sourceJamie, normalThrowLatch ? 0 : hit.driveGain ?? 450, { cause: "other" });
      if (hit.finish && sourceVariant?.capture === "throw" && sourceAction && sourceAction.frame >= sourceAction.duration) {
        releaseJamieCapture(state, source, true, events);
        sourceJamie.action = null;
        source.attackUntilTick = state.tick;
      }
    }

}
