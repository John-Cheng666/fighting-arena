import {
  ARENA,
  STEP,
  type BattleState,
  type PendingHit,
  type Projectile,
} from "../types";

export function segmentHitsCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / lengthSquared),
        );
  return (ax + t * dx - cx) ** 2 + (ay + t * dy - cy) ** 2 <= radius * radius;
}

export function moveProjectiles(state: BattleState, hits: PendingHit[]): void {
  const retained: Projectile[] = [];
  for (const projectile of state.projectiles) {
    if (projectile.expiresAt <= state.tick) continue;
    projectile.previousX = projectile.x;
    projectile.previousY = projectile.y;
    projectile.x += projectile.vx * STEP;
    projectile.y += projectile.vy * STEP;
    const target = state.fighters.find(
      (fighter) => fighter.id !== projectile.ownerId,
    )!;
    const hit = segmentHitsCircle(
      projectile.previousX,
      projectile.previousY,
      projectile.x,
      projectile.y,
      target.x,
      target.y - 20,
      target.radius + projectile.radius,
    );
    if (hit && target.hp > 0 && target.height < 46) {
      hits.push({
        sourceId: projectile.ownerId,
        targetId: target.id,
        damage: projectile.damage,
        heal: 0,
        projectile: true,
      });
      continue;
    }
    let bounced = false;
    if (projectile.x < ARENA.left + 8 || projectile.x > ARENA.right - 8) {
      projectile.x = Math.max(
        ARENA.left + 8,
        Math.min(ARENA.right - 8, projectile.x),
      );
      projectile.vx *= -1;
      bounced = true;
    }
    if (projectile.y < ARENA.top + 8 || projectile.y > ARENA.bottom - 8) {
      projectile.y = Math.max(
        ARENA.top + 8,
        Math.min(ARENA.bottom - 8, projectile.y),
      );
      projectile.vy *= -1;
      bounced = true;
    }
    if (bounced) projectile.bounces -= 1;
    if (projectile.bounces >= 0) retained.push(projectile);
  }
  state.projectiles = retained;
}
