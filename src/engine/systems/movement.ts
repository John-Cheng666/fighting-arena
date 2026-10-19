import { ARENA, STEP, type BattleState } from "../types";
import type { CharacterRegistry } from "../characters";
export const BOUNDS = { left: ARENA.left + 52, right: ARENA.right - 52, top: ARENA.top + 123, bottom: ARENA.bottom - 30 };
export function moveFighters(state: BattleState, characters: CharacterRegistry): void {
  for (const fighter of state.fighters) {
    fighter.previousX = fighter.x; fighter.previousY = fighter.y;
    if (fighter.capture) { fighter.vx = fighter.vy = 0; continue; }
    if (!characters.get(fighter.characterId).ownsElevation) fighter.height = Math.max(0, fighter.height - 5);
    if (fighter.hp <= 0) continue;
    if (state.tick < fighter.stunUntilTick || state.tick < fighter.knockdownUntilTick) { fighter.vx *= 0.8; fighter.vy *= 0.8; }
    fighter.x += fighter.vx * STEP; fighter.y += fighter.vy * STEP;
    if (fighter.x < BOUNDS.left) { fighter.x = BOUNDS.left; fighter.vx = Math.abs(fighter.vx); }
    else if (fighter.x > BOUNDS.right) { fighter.x = BOUNDS.right; fighter.vx = -Math.abs(fighter.vx); }
    if (fighter.y < BOUNDS.top) { fighter.y = BOUNDS.top; fighter.vy = Math.abs(fighter.vy); }
    else if (fighter.y > BOUNDS.bottom) { fighter.y = BOUNDS.bottom; fighter.vy = -Math.abs(fighter.vy); }
    const status = characters.get(fighter.characterId).describe(state, fighter);
    if (!status.actionId && fighter.height === 0) fighter.facing = state.fighters.find((other) => other.id !== fighter.id)!.x >= fighter.x ? 1 : -1;
  }
}

export function separateFighters(state: BattleState): void {
  const [a, b] = state.fighters;
  if (a.capture || b.capture || Math.abs(a.height - b.height) > 40) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const overlap = a.radius + b.radius - distance;
  if (overlap <= 0) return;
  const nx = distance > 0.0001 ? dx / distance : 1;
  const ny = distance > 0.0001 ? dy / distance : 0;
  a.x = Math.max(BOUNDS.left, Math.min(BOUNDS.right, a.x - nx * overlap * 0.5));
  a.y = Math.max(BOUNDS.top, Math.min(BOUNDS.bottom, a.y - ny * overlap * 0.5));
  b.x = Math.max(BOUNDS.left, Math.min(BOUNDS.right, b.x + nx * overlap * 0.5));
  b.y = Math.max(BOUNDS.top, Math.min(BOUNDS.bottom, b.y + ny * overlap * 0.5));
}
