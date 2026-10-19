import type { CharacterRegistry } from "../characters";
import type { BattleState, BattleEvent } from "../types";

export function resolveVictory(
  state: BattleState,
  events: BattleEvent[],
  registry: CharacterRegistry,
  maxTicks = 99 * 60,
): void {
  if (state.phase !== "running") return;
  const alive = state.fighters.filter((fighter) => fighter.hp > 0);
  const roundTick = state.tick - (state.roundStopTicks ?? 0);
  if (alive.length === 2 && roundTick < maxTicks) return;
  if (alive.length === 2 && roundTick >= maxTicks) {
    const finiteConfirmedCinematic = state.fighters.some((fighter) => registry.get(fighter.characterId).hasPendingCinematic?.(state, fighter, maxTicks));
    if (finiteConfirmedCinematic) return;
  }
  state.phase = "finished";
  if (alive.length === 1) {
    state.winner = alive[0].id;
    state.result = "knockout";
  } else if (alive.length === 0) {
    state.winner = null;
    state.result = "draw";
  } else {
    const [a, b] = state.fighters;
    const difference = a.hp / a.maxHp - b.hp / b.maxHp;
    state.winner = difference === 0 ? null : difference > 0 ? a.id : b.id;
    state.result = state.winner ? "timeout" : "draw";
  }
  state.projectiles = [];
  state.superFreezeRemaining = 0;
  state.superFreezeSourceId = null;
  for (const fighter of state.fighters) {
    fighter.capture = undefined;
    fighter.juggleUntilTick = 0;
    fighter.juggleSourceId = undefined;
    fighter.pendingHardKnockdown = false;
    registry.get(fighter.characterId).finishBattle?.(fighter);
  }
  events.push({
    type: "finished",
    tick: state.tick,
    winner: state.winner,
    reason: state.result,
  });
}
