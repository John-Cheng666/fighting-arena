import original from "../data/standard-ai.json";
import { JAMIE_VARIANTS } from "../moves";
import type { Fighter } from "../../../engine/types";
import { BOUNDS } from "../../../engine/systems/movement";

// The native table's distance units are not arena pixels. Keep its authored
// thresholds, while mapping its close band inside the shortest grounded normal.
const shortestNormal = Math.min(...JAMIE_VARIANTS.filter(move => move.row < 12).map(move => move.range));
const JAMIE_AI_CLOSE_DISTANCE = shortestNormal - 6;

export function nativeJamieDistance(arenaDistance: number): number {
  return arenaDistance * original.config.CloseDistance / JAMIE_AI_CLOSE_DISTANCE;
}

/** Walk towards a horizontal striking position, instead of staying in a vertical column. */
export function jamieApproachDirection(fighter: Fighter, opponent: Fighter): { x: number; y: number } {
  const dx = opponent.x - fighter.x;
  const dy = opponent.y - fighter.y;
  const facing = Math.abs(dx) > 0.001 ? Math.sign(dx) : fighter.facing;
  const spacing = fighter.radius + opponent.radius + 2;
  let targetX = opponent.x;
  if (Math.abs(dy) > 12) {
    targetX -= facing * spacing;
    // A vertically aligned pair at a side wall needs the open side of the arena.
    if (targetX < BOUNDS.left || targetX > BOUNDS.right) targetX = opponent.x + facing * spacing;
  }
  const approachX = targetX - fighter.x;
  const length = Math.hypot(approachX, dy) || 1;
  return { x: approachX / length, y: dy / length };
}
