import { describe, expect, it } from "vitest";
import { Battle } from "../../../game/Battle";
import { DEFAULT_MATCH_CONFIG } from "../../../test/fixtures";
import { BOUNDS } from "../../../engine/systems/movement";
import { NORMAL_THROW_DISTANCE } from "../../../engine/systems/throws";
import type { BattleEvent } from "../../../engine/types";
import { getJamieState } from "../state";

function practice(seat = 0, wall = false) {
  const battle = new Battle(DEFAULT_MATCH_CONFIG);
  battle.aiEnabled = false;
  const source = battle.state.fighters[seat], target = battle.state.fighters[1 - seat];
  source.x = wall ? BOUNDS.right - 50 : seat === 0 ? 300 : 350;
  target.x = wall ? BOUNDS.right : seat === 0 ? 350 : 300;
  source.y = target.y = 450;
  source.vx = source.vy = target.vx = target.vy = 0;
  battle.start();
  return { battle, source, target };
}
function release(seat: number, direction: "forward" | "back", wall = false, punish = false) {
  const fixture = practice(seat, wall), { battle, source, target } = fixture;
  if (punish) expect(battle.requestMove(target.id, "D03", "parry-hold")).toBe(true);
  expect(battle.requestMove(source.id, direction === "back" ? "T02" : "T01", direction === "back" ? "row-92" : "row-91")).toBe(true);
  let confirmed = false;
  for (let frame = 0; frame < 180; frame++) {
    battle.step();
    if (target.capture) { confirmed = true; expect(target.capture.normalThrow?.direction).toBe(direction); }
    if (confirmed && !target.capture) return fixture;
  }
  throw new Error("Normal throw never completed its confirmed release");
}

describe("Jamie normal-throw release integration", () => {
  it.each([0, 1])("applies front/back push and the side change once for seat %s, including PC and walls", seat => {
    for (const direction of ["forward", "back"] as const) for (const wall of [false, true]) for (const punish of [false, true]) {
      const { battle, source, target } = release(seat, direction, wall, punish);
      expect(Math.hypot(target.x - source.x, target.y - source.y)).toBeCloseTo(NORMAL_THROW_DISTANCE[direction]);
      const sign = wall || seat === 0 ? 1 : -1;
      expect(Math.sign(target.x - source.x)).toBe(direction === "back" ? -sign : sign);
      expect(getJamieState(source)!.action?.throwPunish).toBe(punish ? true : undefined);
      const positions = [source.x, source.y, target.x, target.y];
      for (let frame = 0; frame < 100; frame++) battle.step();
      expect([source.x, source.y, target.x, target.y]).toEqual(positions);
      expect(getJamieState(source)!.drinkLevel).toBe(direction === "forward" ? 1 : 0);
    }
  });

  it.each([0, 1])("keeps seat %s's drink clear of an immediate wake-up jab and reproduces the old near-release interruption", seat => {
    for (const oldSpacing of [false, true]) {
      const { battle, source, target } = release(seat, "forward");
      const events: BattleEvent[] = [];
      if (oldSpacing) target.x = source.x + (seat === 0 ? 1 : -1) * 53;
      let attacked = false;
      for (let frame = 0; frame < 100; frame++) {
        if (!attacked && battle.state.tick >= target.knockdownUntilTick && battle.state.tick >= target.stunUntilTick) {
          expect(battle.requestMove(target.id, "N01", "row-0")).toBe(true);
          attacked = true;
        }
        battle.step(); events.push(...battle.takeEvents());
      }
      expect(attacked).toBe(true);
      expect(getJamieState(source)!.drinkLevel).toBe(oldSpacing ? 0 : 1);
      expect(source.hp < source.maxHp).toBe(oldSpacing);
      expect(events.some(event => event.type === "interrupt" && event.fighterId === source.id)).toBe(oldSpacing);
    }
  });

  it("never pushes an escaped throw or a whiff", () => {
    for (const tech of [false, true]) {
      const { battle, source, target } = practice();
      if (!tech) target.x = 600;
      expect(battle.requestMove(source.id, "T01", "row-91")).toBe(true);
      for (let frame = 0; frame < 5; frame++) battle.step();
      if (tech) expect(battle.requestMove(target.id, "T02", "row-92")).toBe(true);
      const positions = [source.x, source.y, target.x, target.y];
      for (let frame = 0; frame < 180; frame++) battle.step();
      expect([source.x, source.y, target.x, target.y]).toEqual(positions);
      expect(getJamieState(source)!.drinkLevel).toBe(0);
    }
  });
});
