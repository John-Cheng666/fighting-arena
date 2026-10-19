import { getJamieState } from "../state";
import { JAMIE_VARIANT_BY_ID } from "../moves";
import { JAMIE_STANDARD_AI_DATA } from "./data";
import type { BattleEvent, BattleState, Fighter } from "../../../engine/types";
import { getJamieSituations, makeJamieAISnapshot, type JamieAIInput, type JamieAISnapshot } from "./snapshot";
import { resolveAISituations, stepStandardAI } from "../../../engine/ai/StandardAI";
import { applyJamieKeys, type JamieAIHost } from "./input";
import { jamieApproachDirection } from "./spacing";

function applyInput(state: BattleState, fighter: Fighter, snapshot: JamieAISnapshot, input: JamieAIInput,
  host: JamieAIHost, events: BattleEvent[]): boolean {
  if (input.kind === "keys") return applyJamieKeys(state, fighter, snapshot, input, host, events);
  if (input.kind === "move") {
    const variant = JAMIE_VARIANT_BY_ID[input.variantId];
    return host.requestMove(state, fighter.id, variant.moveId, variant.id, events);
  }
  if (!snapshot.self.canAct || getJamieState(fighter)!.action) return false;
  const { directionX: dx, directionY: dy } = snapshot;
  if (input.kind === "guard") {
    getJamieState(fighter)!.guardUntilTick = state.tick + 2;
    getJamieState(fighter)!.guardLow = snapshot.opponent.lowAttack;
    fighter.crouching = snapshot.opponent.lowAttack;
    fighter.vx = -dx * 20;
    fighter.vy = -dy * 20;
    fighter.facing = dx >= 0 ? 1 : -1;
  } else if (input.kind === "sidestep" && snapshot.projectile) {
    const speed = Math.hypot(snapshot.projectile.vx, snapshot.projectile.vy) || 1;
    const side = fighter.y > 440 ? -1 : 1;
    fighter.vx = -snapshot.projectile.vy / speed * fighter.speed * side;
    fighter.vy = snapshot.projectile.vx / speed * fighter.speed * side;
  } else {
    const direction = input.kind === "retreat" ? -1 : 1;
    const opponent = state.fighters.find(other => other.id !== fighter.id)!;
    const approach = direction > 0 ? jamieApproachDirection(fighter, opponent) : { x: dx, y: dy };
    fighter.vx = approach.x * fighter.speed * direction;
    fighter.vy = approach.y * fighter.speed * direction;
  }
  return true;
}

/** Both seats sense the same frame before either controller emits input. */
export function updateJamieStandardAI(state: BattleState, random: () => number, events: BattleEvent[], host: JamieAIHost, contactOnly = false): void {
  const snapshots = state.fighters.filter((fighter) => getJamieState(fighter) && fighter.hp > 0).map((fighter) => ({
    fighter, snapshot: makeJamieAISnapshot(state, fighter, state.fighters.find((other) => other.id !== fighter.id)!, host.canStart),
  }));
  for (const { fighter, snapshot } of snapshots) {
    const jamie = getJamieState(fighter)!;
    if (state.tick < jamie.nextDecisionTick) continue; // Explicit training/debug inhibition, not a reaction-delay model.
    if (contactOnly && (!jamie.action || jamie.lastContactTick !== state.tick || !jamie.standardAI.currentItemId)) continue;
    if (!contactOnly && !jamie.action) {
      fighter.vx = fighter.vy = 0;
      if (jamie.guardUntilTick < state.tick) fighter.crouching = false;
    }
    const situations = getJamieSituations(snapshot);
    stepStandardAI(jamie.standardAI, JAMIE_STANDARD_AI_DATA, {
      tick: state.tick, snapshot, situations: situations.includes(28) ? [28] : resolveAISituations(JAMIE_STANDARD_AI_DATA, situations), random,
      allowSelection: !contactOnly,
      damageState: snapshot.self.stunned && !snapshot.self.guarding && !snapshot.self.waking,
      worldStop: state.worldStopped,
      input: (input) => applyInput(state, fighter, snapshot, input, host, events),
    });
    if (!contactOnly && jamie.standardAI.lastInputTick !== state.tick) applyJamieKeys(state, fighter, snapshot, { kind: "keys", direction: 5, buttons: 0 }, host, events);
    if (!jamie.action) {
      const ai = jamie.standardAI;
      const entry = (ai.branchGroup ? JAMIE_STANDARD_AI_DATA.branches[ai.branchGroup] : JAMIE_STANDARD_AI_DATA.items)?.find((item) => item.id === ai.currentItemId);
      jamie.intent = entry?.name ?? "观察 · 等待机会";
    }
  }
}
