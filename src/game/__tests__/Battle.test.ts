import { describe, expect, it } from "vitest";
import { Battle } from "../Battle";
import { DEFAULT_CONFIG } from "../../test/fixtures";
import { resolveHits, resolveVictory } from "../combat";
import { moveProjectiles, segmentHitsCircle } from "../../engine/systems/projectiles";
import { ARENA, TICK_RATE, type BattleEvent, type PendingHit } from "../../engine/types";

function runBattle(seed = DEFAULT_CONFIG.seed): Battle {
  const battle = new Battle({ ...DEFAULT_CONFIG, seed });
  battle.start();
  for (let i = 0; i < 12000 && battle.state.phase === "running"; i += 1) {
    battle.step();
    battle.takeEvents();
  }
  return battle;
}

describe("battle simulation", () => {
  it("replays the same configuration and seed exactly", () => {
    expect(runBattle(814).state).toEqual(runBattle(814).state);
  });

  it("always completes a match with a bounded arena and valid HP", () => {
    for (const seed of [0, 1, 5, 42, 2026, 428003]) {
      const battle = runBattle(seed);
      expect(battle.state.phase).toBe("finished");
      // TIMER_STOP pauses the round clock while captured actions still advance.
      // Preserve the existing 600-frame allowance for a confirmed cinematic.
      const roundTicks = battle.state.tick - (battle.state.roundStopTicks ?? 0);
      expect(roundTicks).toBeLessThanOrEqual(battle.config.roundTimeSeconds * TICK_RATE + 600);
      for (const fighter of battle.state.fighters) {
        expect(fighter.hp).toBeGreaterThanOrEqual(0);
        expect(fighter.hp).toBeLessThanOrEqual(fighter.maxHp);
        expect(fighter.x).toBeGreaterThanOrEqual(
          ARENA.left + fighter.radius - 0.0001,
        );
        expect(fighter.x).toBeLessThanOrEqual(
          ARENA.right - fighter.radius + 0.0001,
        );
        expect(fighter.y).toBeGreaterThanOrEqual(
          ARENA.top + fighter.radius - 0.0001,
        );
        expect(fighter.y).toBeLessThanOrEqual(
          ARENA.bottom - fighter.radius + 0.0001,
        );
      }
    }
  });

  it("does not advance before start or after the result", () => {
    const battle = new Battle(DEFAULT_CONFIG);
    battle.step();
    expect(battle.state.tick).toBe(0);
    battle.start();
    battle.state.fighters[1].hp = 0;
    battle.step();
    const tick = battle.state.tick;
    expect(
      battle.takeEvents().filter((event) => event.type === "finished"),
    ).toHaveLength(1);
    battle.step();
    expect(battle.state.tick).toBe(tick);
    expect(battle.takeEvents()).toHaveLength(0);
  });

  it("rejects invalid settings instead of allowing NaN into the simulation", () => {
    expect(
      () => new Battle({ ...DEFAULT_CONFIG, fighters: [{ characterId: "jamie", settings: { maxHp: Number.NaN } }, "jamie"] }),
    ).toThrow();
    expect(() => new Battle({ ...DEFAULT_CONFIG, seed: -1 })).toThrow();
    expect(() => new Battle({ ...DEFAULT_CONFIG, fighters: ["removed-character", "jamie"] })).toThrow();
  });
});

describe("damage resolution", () => {
  it("resolves simultaneous lethal hits as a draw and emits a result once", () => {
    const battle = new Battle(DEFAULT_CONFIG);
    battle.start();
    battle.state.fighters.forEach((fighter) => {
      fighter.hp = 20;
    });
    const events: BattleEvent[] = [];
    resolveHits(
      battle.state,
      [
        { sourceId: "p1", targetId: "p2", damage: 35, heal: 0 },
        { sourceId: "p2", targetId: "p1", damage: 25, heal: 5 },
      ],
      events,
    );
    resolveVictory(battle.state, events);
    resolveVictory(battle.state, events);
    expect(battle.state.fighters.map((fighter) => fighter.hp)).toEqual([0, 0]);
    expect(battle.state.result).toBe("draw");
    expect(events.filter((event) => event.type === "finished")).toHaveLength(1);
  });

  it("clamps recovery at max HP and ignores self hits", () => {
    const battle = new Battle(DEFAULT_CONFIG);
    battle.state.fighters[1].hp = 1498;
    const events: BattleEvent[] = [];
    resolveHits(
      battle.state,
      [
        { sourceId: "p2", targetId: "p1", damage: 20, heal: 5 },
        { sourceId: "p1", targetId: "p1", damage: 1000, heal: 0 },
      ],
      events,
    );
    expect(battle.state.fighters[0].hp).toBe(1480);
    expect(battle.state.fighters[1].hp).toBe(1500);
    expect(events.find((event) => event.type === "heal")).toMatchObject({
      amount: 2,
    });
  });
});

describe("projectile collision", () => {
  it("detects fast bullets crossing a target between simulation frames", () => {
    expect(segmentHitsCircle(0, 50, 300, 50, 150, 50, 10)).toBe(true);
    expect(segmentHitsCircle(0, 0, 300, 0, 150, 50, 10)).toBe(false);
  });

  it("removes a projectile after its first hit to prevent repeated damage", () => {
    const battle = new Battle(DEFAULT_CONFIG);
    const target = battle.state.fighters[1];
    battle.state.projectiles.push({
      id: 1,
      ownerId: "p1",
      x: target.x - 100,
      y: target.y - 20,
      previousX: target.x - 100,
      previousY: target.y - 20,
      vx: 12_000,
      vy: 0,
      radius: 10,
      damage: 35,
      expiresAt: 100,
      bounces: 2,
      gold: false,
    });
    const hits: PendingHit[] = [];
    moveProjectiles(battle.state, hits);
    moveProjectiles(battle.state, hits);
    expect(hits).toHaveLength(1);
    expect(hits[0].targetId).toBe("p2");
    expect(battle.state.projectiles).toHaveLength(0);
  });
});
