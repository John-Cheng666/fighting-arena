import { describe, expect, it } from "vitest";
import { Battle } from "../../../game/Battle";
import { AISituation } from "../../../engine/ai/StandardAI";
import { BOUNDS } from "../../../engine/systems/movement";
import type { BattleEvent } from "../../../engine/types";
import { requestJamieMove } from "../combat/actions";
import { applyJamieKeys, type JamieAIHost } from "../ai/input";
import { commandCondition, nativeConditionBits } from "../ai/conditions";
import { getJamieSituations, makeJamieAISnapshot } from "../ai/snapshot";
import { getJamieState } from "../state";

const host: JamieAIHost = { canStart: () => true, requestMove: requestJamieMove };
function practice(dx: number, dy: number) {
  const battle = new Battle({ seed: 42 });
  battle.aiEnabled = false;
  const [source, target] = battle.state.fighters;
  source.x = 300; source.y = 400;
  target.x = source.x + dx; target.y = source.y + dy;
  battle.start();
  return battle;
}
function observe(battle: Battle) {
  return makeJamieAISnapshot(battle.state, ...battle.state.fighters, host.canStart);
}
function keys(battle: Battle, direction: number) {
  applyJamieKeys(battle.state, battle.state.fighters[0], observe(battle), { kind: "keys", direction, buttons: 0 }, host, []);
}
function cpuBattle(level: number, seed: number) {
  const selection = () => ({ characterId: "jamie", settings: { cpuLevel: level } });
  return new Battle({ seed, fighters: [selection(), selection()] });
}

describe("Jamie arena spacing", () => {
  it.each([[90, 0], [0, 90], [0, -90], [90 / Math.SQRT2, 90 / Math.SQRT2]])(
    "keeps out-of-normal-range opponents out of the native close band (%s, %s)", (dx, dy) => {
      const snapshot = observe(practice(dx, dy));
      expect(snapshot.arenaDistance).toBeCloseTo(90);
      expect(commandCondition("DSTC", snapshot)).toBe(false);
      expect(nativeConditionBits(snapshot)[0] & 0xf0000n).not.toBe(0x10000n);
    });

  it("recognizes a reachable close opponent without rescaling the physical aim vector", () => {
    const snapshot = observe(practice(30, 40));
    expect(commandCondition("DSTC", snapshot)).toBe(true);
    expect(nativeConditionBits(snapshot)[0] & 0xf0000n).toBe(0x10000n);
    expect(snapshot.arenaDistance).toBe(50);
    expect(snapshot.directionX).toBeCloseTo(0.6);
    expect(snapshot.directionY).toBeCloseTo(0.8);
  });

  it("keeps arena reaction distances in physical units", () => {
    const battle = practice(0, 120);
    battle.state.tick = 10;
    expect(battle.requestMove("p2", "N01", "row-0")).toBe(true);
    const snapshot = observe(battle);
    expect(snapshot.distance).toBeGreaterThan(155);
    expect(getJamieSituations(snapshot)).toContain(AISituation.AntiLand);
  });

  it.each([[0, 150], [0, -100], [100, 100], [-100, -100]])(
    "walks towards a horizontal striking position at normal speed (%s, %s)", (dx, dy) => {
      const battle = practice(dx, dy);
      const [source, target] = battle.state.fighters;
      const before = Math.abs(source.y - target.y);
      keys(battle, 6);
      expect(Math.hypot(source.vx, source.vy)).toBeCloseTo(source.speed);
      if (dx === 0) expect(Math.abs(source.vx)).toBeGreaterThan(0);
      battle.step();
      expect(Math.abs(source.y - target.y)).toBeLessThan(before);
    });

  it.each([[BOUNDS.left, 1], [BOUNDS.right, -1]])(
    "chooses the open side when a vertical pair is at x=%s", (x, facing) => {
      const battle = practice(0, 100);
      const [source, target] = battle.state.fighters;
      source.x = target.x = x;
      source.facing = facing;
      keys(battle, 6);
      expect(Math.sign(source.vx)).toBe(x === BOUNDS.left ? 1 : -1);
      battle.step();
      expect(source.x).toBeGreaterThan(BOUNDS.left);
      expect(source.x).toBeLessThan(BOUNDS.right);
      expect(source.y).toBeGreaterThan(400);
    });

  it("preserves retreat direction, neutral input and walking speed", () => {
    const battle = practice(30, 40);
    const source = battle.state.fighters[0];
    keys(battle, 4);
    expect(source.vx).toBeCloseTo(-0.6 * source.speed);
    expect(source.vy).toBeCloseTo(-0.8 * source.speed);
    keys(battle, 5);
    expect(source.vx).toBe(0);
    expect(source.vy).toBe(0);
  });

  it.each([[0, 50, true], [50, 50, false], [0, 90, false]])(
    "keeps the actual two-dimensional punch reach (%s, %s)", (dx, dy, shouldHit) => {
      const battle = practice(dx, dy);
      const target = battle.state.fighters[1];
      expect(battle.requestMove("p1", "N01", "row-0")).toBe(true);
      const events: BattleEvent[] = [];
      for (let frame = 0; frame < 10; frame++) { battle.step(); events.push(...battle.takeEvents()); }
      expect(events.some(event => event.type === "hit")).toBe(shouldHit);
      expect(target.hp < target.maxHp).toBe(shouldHit);
    });
});

describe("CPU spacing integration", () => {
  it.each([6, 8])("lands an attack from either vertical direction and seat at CPU %s", (level) => {
    for (const dy of [-90, 90]) for (const attackingSeat of [0, 1]) {
      const battle = cpuBattle(level, 428003);
      const source = battle.state.fighters[attackingSeat];
      const target = battle.state.fighters[1 - attackingSeat];
      source.x = target.x = 350;
      source.y = dy < 0 ? 470 : 380;
      target.y = source.y + dy;
      getJamieState(target)!.nextDecisionTick = Number.MAX_SAFE_INTEGER;
      battle.start();
      let hit = false;
      for (let frame = 0; frame < 600 && !hit; frame++) {
        battle.step();
        hit = battle.takeEvents().some(event => event.type === "hit" && event.sourceId === source.id);
      }
      expect(hit, `seat ${attackingSeat}, dy ${dy}`).toBe(true);
      expect(target.hp).toBeLessThan(target.maxHp);
    }
  });

  it("does not return to the seeded vertical whiff loop later in a full CPU 8 match", () => {
    const battle = cpuBattle(8, 42);
    const [source, target] = battle.state.fighters;
    source.x = target.x = 350;
    source.y = 380; target.y = 470;
    let previousContact = 0, longestGap = 0, hits = 0;
    battle.start();
    for (let frame = 0; frame < 12000 && battle.state.phase === "running"; frame++) {
      battle.step();
      for (const event of battle.takeEvents()) if (event.type === "hit" || event.type === "block") {
        longestGap = Math.max(longestGap, event.tick - previousContact);
        previousContact = event.tick;
        if (event.type === "hit") hits++;
      }
    }
    longestGap = Math.max(longestGap, battle.state.tick - previousContact);
    expect(battle.state.result).toBe("knockout");
    expect(hits).toBeGreaterThan(10);
    // The original reproduction went 2,948 simulation frames without contact.
    expect(longestGap).toBeLessThan(900);
  });
});
