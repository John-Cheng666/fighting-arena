import type { Fighter, Vector } from "../types";
import { BOUNDS } from "./movement";

/** Arena units, shared by every character; these are not SF6 world coordinates. */
export const NORMAL_THROW_DISTANCE = { forward: 170, back: 240 } as const;
export type ThrowReleaseReason = "complete" | "tech" | "interrupted";

/** Consume one confirmed normal throw. Command grabs and cinematics have no such metadata. */
export function releaseNormalThrow(source: Fighter, target: Fighter, reason: ThrowReleaseReason): boolean {
  const capture = target.capture;
  if (capture?.sourceId !== source.id || !capture.normalThrow) return false;
  const { direction, axis } = capture.normalThrow;
  delete capture.normalThrow;
  if (reason !== "complete") return false;

  const length = Math.hypot(axis.x, axis.y);
  const unit: Vector = length > 1e-6 && Number.isFinite(length)
    ? { x: axis.x / length, y: axis.y / length }
    : { x: source.facing < 0 ? -1 : 1, y: 0 };
  if (direction === "back") { unit.x *= -1; unit.y *= -1; }
  let distance: number = NORMAL_THROW_DISTANCE[direction];
  if (Math.abs(unit.x) > 1e-6) distance = Math.min(distance, (BOUNDS.right - BOUNDS.left) / Math.abs(unit.x));
  if (Math.abs(unit.y) > 1e-6) distance = Math.min(distance, (BOUNDS.bottom - BOUNDS.top) / Math.abs(unit.y));
  const dx = unit.x * distance, dy = unit.y * distance;
  // A back throw changes sides exactly once. At a wall, translate the whole
  // pair into bounds so clamping the victim cannot collapse the throw distance.
  const anchor = direction === "back" ? target : source;
  source.x = Math.max(Math.max(BOUNDS.left, BOUNDS.left - dx), Math.min(Math.min(BOUNDS.right, BOUNDS.right - dx), anchor.x));
  source.y = Math.max(Math.max(BOUNDS.top, BOUNDS.top - dy), Math.min(Math.min(BOUNDS.bottom, BOUNDS.bottom - dy), anchor.y));
  target.x = source.x + dx; target.y = source.y + dy;
  source.vx = source.vy = target.vx = target.vy = 0;
  if (Math.abs(unit.x) > 1e-6) source.facing = unit.x > 0 ? 1 : -1;
  target.facing = -source.facing;
  return true;
}
