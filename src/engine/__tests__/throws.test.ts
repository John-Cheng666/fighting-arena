import { describe, expect, it } from "vitest";
import { Battle } from "../Battle";
import { CharacterRegistry, type CharacterModule } from "../characters";
import { BOUNDS } from "../systems/movement";
import { NORMAL_THROW_DISTANCE, releaseNormalThrow } from "../systems/throws";
import type { Vector } from "../types";

// Unrelated character modules verify that the shared rule needs no Jamie data.
const character = (id: string): CharacterModule => ({
  id, metadata: { name: id, tag: "", description: "", color: "#fff", portrait: "" },
  settings: [], normalizeSettings: () => ({}), createState: () => ({}),
  stats: () => ({ maxHp: 1000, speed: 100, radius: 25 }),
  describe: () => ({ intent: "", actionName: "", actionId: null, actionFrame: 0, actionDuration: 0, phaseLabel: "", hitCount: 0 }),
});
function captured(direction: "forward" | "back", axis: Vector = { x: 1, y: 0 }) {
  const battle = new Battle({ seed: 1, fighters: ["future-a", "future-b"] }, new CharacterRegistry([character("future-a"), character("future-b")]));
  const [source, target] = battle.state.fighters;
  source.x = 300; source.y = 400; target.x = 350; target.y = 400;
  source.vx = target.vx = 100; source.vy = target.vy = -100;
  target.capture = { sourceId: source.id, moveId: "arbitrary-normal-throw", phase: "combo", untilTick: 100, normalThrow: { direction, axis } };
  return { source, target };
}
function inBounds(point: Vector) {
  expect(point.x).toBeGreaterThanOrEqual(BOUNDS.left - 1e-6);
  expect(point.x).toBeLessThanOrEqual(BOUNDS.right + 1e-6);
  expect(point.y).toBeGreaterThanOrEqual(BOUNDS.top - 1e-6);
  expect(point.y).toBeLessThanOrEqual(BOUNDS.bottom + 1e-6);
}

describe("shared normal-throw release", () => {
  it.each(["forward", "back"] as const)("settles a %s throw exactly once, with back throws landing farther", direction => {
    const { source, target } = captured(direction);
    expect(releaseNormalThrow(source, target, "complete")).toBe(true);
    expect(target.x - source.x).toBe(direction === "back" ? -NORMAL_THROW_DISTANCE.back : NORMAL_THROW_DISTANCE.forward);
    expect(source.x).toBe(direction === "back" ? 350 : 300);
    expect(NORMAL_THROW_DISTANCE.back).toBeGreaterThan(NORMAL_THROW_DISTANCE.forward);
    expect([source.vx, source.vy, target.vx, target.vy]).toEqual([0, 0, 0, 0]);
    expect(source.facing).toBe(direction === "back" ? -1 : 1);
    expect(target.facing).toBe(-source.facing);
    const positions = [source.x, source.y, target.x, target.y];
    expect(releaseNormalThrow(source, target, "complete")).toBe(false);
    expect([source.x, source.y, target.x, target.y]).toEqual(positions);
  });

  it.each(["tech", "interrupted"] as const)("does not push or change sides on %s", reason => {
    const { source, target } = captured("back");
    const positions = [source.x, source.y, target.x, target.y];
    expect(releaseNormalThrow(source, target, reason)).toBe(false);
    expect([source.x, source.y, target.x, target.y]).toEqual(positions);
    expect(releaseNormalThrow(source, target, "complete")).toBe(false);
  });

  it.each(["forward", "back"] as const)("preserves %s spacing and its locked direction at every wall and corner", direction => {
    for (const axis of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 3, y: 4 }, { x: -3, y: -4 }]) {
      for (const x of [BOUNDS.left, BOUNDS.right]) for (const y of [BOUNDS.top, BOUNDS.bottom]) {
        const { source, target } = captured(direction, axis);
        source.x = target.x = x; source.y = target.y = y;
        expect(releaseNormalThrow(source, target, "complete")).toBe(true);
        inBounds(source); inBounds(target);
        const distance = NORMAL_THROW_DISTANCE[direction], sign = direction === "back" ? -1 : 1, length = Math.hypot(axis.x, axis.y);
        expect(target.x - source.x).toBeCloseTo(sign * axis.x / length * distance);
        expect(target.y - source.y).toBeCloseTo(sign * axis.y / length * distance);
      }
    }
  });

  it("does not infer normal throws from move names or touch command grabs/cinematics", () => {
    const { source, target } = captured("forward");
    delete target.capture!.normalThrow;
    target.capture!.moveId = "T02";
    const positions = [source.x, source.y, target.x, target.y];
    expect(releaseNormalThrow(source, target, "complete")).toBe(false);
    expect([source.x, source.y, target.x, target.y]).toEqual(positions);
    expect(target.capture).toBeDefined();
  });

  it("requires the confirmed throw owner and handles a degenerate axis without NaN", () => {
    const { source, target } = captured("forward", { x: 0, y: 0 });
    target.capture!.sourceId = target.id;
    expect(releaseNormalThrow(source, target, "complete")).toBe(false);
    expect(target.capture!.normalThrow).toBeDefined();
    target.capture!.sourceId = source.id; source.facing = -1;
    expect(releaseNormalThrow(source, target, "complete")).toBe(true);
    expect(target.x - source.x).toBe(-NORMAL_THROW_DISTANCE.forward);
    inBounds(source); inBounds(target);
  });
});
