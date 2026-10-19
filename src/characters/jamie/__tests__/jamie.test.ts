import { getJamieState } from "../state";
import { describe, expect, it } from "vitest";
import { Battle } from "../../../game/Battle";
import { DEFAULT_CONFIG } from "../../../test/fixtures";
import { JAMIE_MOVE_CATALOG, JAMIE_NORMAL_MOVES, JAMIE_OFFICIAL_ROWS, JAMIE_VARIANTS } from "../moves";
import { effectiveDrinkLevel, jamieDamageMultiplier, updateJamieFighters } from "../combat/actions";
import { resolveHits } from "../../../game/combat";
import type { BattleEvent } from "../../../engine/types";

function training(): Battle {
  const battle = new Battle({ ...DEFAULT_CONFIG, fighters: DEFAULT_CONFIG.fighters });
  battle.start();
  battle.state.fighters.forEach((fighter, index) => {
    fighter.x = index === 0 ? 150 : 580;
    fighter.y = 450;
    fighter.vx = fighter.vy = 0;
    getJamieState(fighter)!.nextDecisionTick = Number.MAX_SAFE_INTEGER;
  });
  return battle;
}

function advance(battle: Battle, count: number): void {
  const targetTick = battle.state.tick + count;
  for (let frame = 0; battle.state.tick < targetTick && frame < count + 120; frame += 1) {
    for (const fighter of battle.state.fighters) getJamieState(fighter)!.nextDecisionTick = Number.MAX_SAFE_INTEGER;
    battle.step();
  }
}

describe("Jamie rules in the arena", () => {
  it("bundles the 28 official video entries, 18 normals and every frame-table row", () => {
    expect(JAMIE_MOVE_CATALOG).toHaveLength(28);
    expect(JAMIE_NORMAL_MOVES).toHaveLength(18);
    expect(JAMIE_OFFICIAL_ROWS).toHaveLength(103);
    expect(new Set(JAMIE_VARIANTS.map((variant) => variant.row)).size).toBe(103);
    expect(JAMIE_MOVE_CATALOG.every((move) => move.video.startsWith("https://www.streetfighter.com/6/"))).toBe(true);
  });

  it("awards a drink on frame 49, never heals, and cancels an interrupted drink", () => {
    const battle = training();
    const fighter = battle.state.fighters[0];
    fighter.hp = 1200;
    expect(battle.requestMove("p1", "S01")).toBe(true);
    advance(battle, 48);
    expect(getJamieState(fighter)!.drinkLevel).toBe(0);
    advance(battle, 1);
    expect(getJamieState(fighter)!.drinkLevel).toBe(1);
    expect(fighter.hp).toBe(1200);
    advance(battle, 1);
    expect(battle.requestMove("p1", "S01")).toBe(true);
    advance(battle, 48);
    const events: BattleEvent[] = [];
    resolveHits(battle.state, [{ sourceId: "p2", targetId: "p1", damage: 10, heal: 0 }], events);
    expect(getJamieState(fighter)!.action).toBeNull();
    expect(events.some((event) => event.type === "interrupt" && event.moveId === "S01")).toBe(true);
    advance(battle, 60);
    expect(getJamieState(fighter)!.drinkLevel).toBe(1);
    expect(fighter.hp).toBe(1188);
  });

  it("enforces drink gates, OD resources, legal predecessors and the level-four replacement", () => {
    const battle = training();
    const fighter = battle.state.fighters[0];
    const jamie = getJamieState(fighter)!;
    expect(battle.requestMove("p1", "S07", "row-79")).toBe(false);
    expect(battle.requestMove("p1", "S08", "row-83")).toBe(false);
    expect(battle.requestMove("p1", "S09", "row-85")).toBe(false);
    expect(battle.requestMove("p1", "S06", "row-75")).toBe(false);
    jamie.drive = 0;
    expect(battle.requestMove("p1", "S04", "row-70")).toBe(false);
    expect(jamie.drive).toBe(0);
    jamie.drive = 1;
    expect(battle.requestMove("p1", "S04", "row-70")).toBe(true);
    expect(jamie.drive).toBe(0);
    expect(jamie.burnout).toBe(true);
    expect(jamie.driveRecoveryWait).toBe(-120);
    jamie.action = null;
    jamie.drive = 60000;
    jamie.burnout = false;
    jamie.driveRecoveryWait = 0;
    jamie.drinkLevel = 4;
    expect(battle.requestMove("p1", "S02", "row-39")).toBe(false);
    expect(battle.requestMove("p1", "S02")).toBe(true);
    expect(jamie.action).toMatchObject({ variantId: "row-40" });
  });

  it("activates SA2 at its authored intro frame and restores the original level after 900 running frames", () => {
    const battle = training();
    const fighter = battle.state.fighters[0];
    const jamie = getJamieState(fighter)!;
    jamie.drinkLevel = 1;
    jamie.super = 20000;
    expect(battle.requestMove("p1", "A02")).toBe(true);
    expect(jamie.super).toBe(0);
    expect(jamie.drinkLevel).toBe(1);
    expect(effectiveDrinkLevel(fighter, 0)).toBe(1);
    expect(jamieDamageMultiplier(fighter, 0)).toBe(0.95);
    for (let frame = 0; frame < 77; frame += 1) battle.step();
    expect(jamie.sa2UntilTick).toBe(0);
    expect(effectiveDrinkLevel(fighter, 0)).toBe(1);
    battle.step();
    expect(battle.state.tick).toBe(0);
    expect(jamie.sa2UntilTick).toBe(900);
    expect(effectiveDrinkLevel(fighter, 0)).toBe(4);
    expect(jamieDamageMultiplier(fighter, 0)).toBe(1.05);
    for (let frame = 78; frame < 124; frame += 1) battle.step();
    advance(battle, 899);
    expect(effectiveDrinkLevel(fighter, 899)).toBe(4);
    advance(battle, 1);
    expect(jamie.drinkLevel).toBe(1);
    expect(jamie.sa2UntilTick).toBe(0);
    jamie.drinkLevel = 4;
    jamie.super = 20000;
    jamie.drive = 10000;
    expect(battle.requestMove("p1", "A02")).toBe(true);
    expect(jamie.drive).toBe(10000);
    for (let frame = 0; frame < 110; frame += 1) battle.step();
    expect(jamie.drive).toBe(10000);
    battle.step();
    expect(jamie.drive).toBe(40000);
    expect(jamie.sa2UntilTick).toBe(0);
  });

  it("charges a total of one Drive bar for Parry into Rush", () => {
    const battle = training();
    expect(battle.requestMove("p1", "D03", "row-98")).toBe(true);
    advance(battle, 4);
    expect(battle.requestMove("p1", "D04", "row-101")).toBe(true);
    expect(getJamieState(battle.state.fighters[0])!.drive).toBe(50000);
  });

  it("can use a wake-up reversal despite the remaining knockdown stun", () => {
    const battle = training();
    const fighter = battle.state.fighters[0];
    fighter.knockdownUntilTick = 4;
    fighter.stunUntilTick = 30;
    expect(battle.requestMove("p1", "D02", "row-97")).toBe(true);
    expect(fighter.knockdownUntilTick).toBe(0);
    expect(fighter.stunUntilTick).toBe(0);
  });

  it("hits an equal-character opponent once per active segment and never hits its own seat", () => {
    const battle = training();
    const [source, target] = battle.state.fighters;
    target.x = source.x + 55;
    expect(battle.requestMove("p1", "N01", "row-0")).toBe(true);
    advance(battle, 13);
    const hits = battle.takeEvents().filter((event) => event.type === "hit");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sourceId: "p1", targetId: "p2" });
    expect(source.hp).toBe(1500);
    expect(target.hp).toBe(1482);
    expect(source.characterId).toBe(target.characterId);
  });

  it("leaves a command-throw victim available for an actual follow-up combo", () => {
    const battle = training();
    const [source, target] = battle.state.fighters;
    getJamieState(source)!.drinkLevel = 3;
    target.x = source.x + 50;
    expect(battle.requestMove("p1", "S08", "row-83")).toBe(true);
    advance(battle, 14);
    expect(target.knockdownUntilTick).toBeLessThanOrEqual(battle.state.tick);
    expect(battle.requestMove("p1", "N05", "row-4")).toBe(false);
    advance(battle, 45);
    expect(getJamieState(source)!.action).toBeNull();
    expect(target.stunUntilTick - battle.state.tick).toBe(8);
    expect(battle.requestMove("p1", "N05", "row-4")).toBe(true);
    advance(battle, 15);
    expect(target.hp).toBeLessThan(1500);
  });

  it("restricts OD Bakkai super cancels to the seventh connected segment and SA3", () => {
    const battle = training();
    const source = battle.state.fighters[0];
    getJamieState(source)!.drinkLevel = 2;
    getJamieState(source)!.super = 30000;
    expect(battle.requestMove("p1", "S07", "row-82")).toBe(true);
    const action = getJamieState(source)!.action!;
    battle.state.tick = 75;
    action.frame = 75;
    action.connected = true;
    action.hitSegments = [0, 1, 2, 3, 4, 5, 6];
    getJamieState(source)!.lastContactTick = 75;
    expect(battle.requestMove("p1", "A01", "row-87")).toBe(false);
    expect(battle.requestMove("p1", "A03", "row-89")).toBe(true);
  });

  it("holds an aerial normal until landing and prevents another jump in mid-air", () => {
    const battle = training();
    const fighter = battle.state.fighters[0];
    expect(battle.requestMove("p1", "jump", "jump")).toBe(true);
    advance(battle, 10);
    expect(battle.requestMove("p1", "N15", "row-14")).toBe(true);
    advance(battle, 14);
    expect(fighter.height).toBeGreaterThan(80);
    expect(getJamieState(fighter)!.action?.moveId).toBe("N15");
    expect(battle.requestMove("p1", "jump", "jump")).toBe(false);
    advance(battle, 24);
    expect(fighter.height).toBe(0);
    expect(getJamieState(fighter)!.action).toBeNull();
    expect(battle.requestMove("p1", "jump", "jump")).toBe(true);
  });

  it("lets old characters land after a Jamie launch in mixed matches", () => {
    const battle = new Battle({ ...DEFAULT_CONFIG, fighters: DEFAULT_CONFIG.fighters });
    battle.start();
    const target = battle.state.fighters[1];
    resolveHits(battle.state, [{ sourceId: "p1", targetId: "p2", damage: 1, heal: 0, launch: 75 }], []);
    expect(target.height).toBe(75);
    for (let frame = 0; frame < 20; frame += 1) battle.step();
    expect(target.height).toBe(0);
  });

  it("uses Bakkai's exact strength-specific projectile invulnerability windows", () => {
    for (const [row, start, end] of [[79, 3, 24], [80, 4, 26], [81, 5, 33], [82, 3, 28]]) {
      for (const frame of [start - 1, start, end, end + 1]) {
        const battle = training();
        const target = battle.state.fighters[0];
        getJamieState(target)!.drinkLevel = 2;
        expect(battle.requestMove("p1", "S07", `row-${row}`)).toBe(true);
        getJamieState(target)!.action!.frame = frame;
        resolveHits(battle.state, [{ sourceId: "p2", targetId: "p1", damage: 10, heal: 0, projectile: true }], []);
        const startup = JAMIE_VARIANTS[row].startup;
        expect(target.hp).toBe(frame >= start && frame <= end ? 1500 : frame < startup ? 1488 : 1490);
      }
    }
  });

  it("does not give SA1 projectile invulnerability", () => {
    const battle = training();
    const target = battle.state.fighters[0];
    getJamieState(target)!.super = 10000;
    expect(battle.requestMove("p1", "A01", "row-87")).toBe(true);
    getJamieState(target)!.action!.frame = 1;
    resolveHits(battle.state, [{ sourceId: "p2", targetId: "p1", damage: 10, heal: 0, projectile: true }], []);
    expect(target.hp).toBe(1488);
  });

  it("selects the original anti-projectile situation from the projectile trajectory", () => {
    const battle = training();
    const fighter = battle.state.fighters[1];
    getJamieState(fighter)!.nextDecisionTick = 0;
    battle.state.projectiles.push({ id: 1, ownerId: "p1", x: fighter.x - 70, y: fighter.y - 20, previousX: fighter.x - 70, previousY: fighter.y - 20, vx: 180, vy: 0, radius: 10, damage: 35, expiresAt: 400, bounces: 1, gold: false });
    updateJamieFighters(battle.state, battle.config, () => 0.1, [], []);
    expect(getJamieState(fighter)!.action?.moveId).not.toBe("S01");
    expect(getJamieState(fighter)!.standardAI.situations).toEqual([4]);
    expect(getJamieState(fighter)!.standardAI.currentItemId).toMatch(/^sf6:/);
  });

  it("replays identical mirror battles and completes diverse seeds with real damage", () => {
    function run(seed: number) {
      const battle = new Battle({ ...DEFAULT_CONFIG, seed, fighters: DEFAULT_CONFIG.fighters });
      battle.start();
      for (let steps = 0; battle.state.phase === "running" && steps < 18000; steps += 1) battle.step();
      return battle.state;
    }
    expect(run(814)).toEqual(run(814));
    for (const seed of [1, 42, 2026, 428003]) {
      const state = run(seed);
      expect(state.phase).toBe("finished");
      expect(state.tick - (state.roundStopTicks ?? 0)).toBeLessThanOrEqual(5400);
      expect(state.fighters.every((fighter) => Number.isFinite(fighter.hp) && fighter.hp >= 0 && getJamieState(fighter)!.drinkLevel <= 4)).toBe(true);
      expect(state.fighters.every((fighter) => fighter.damageDealt > 0 && fighter.hits > 0)).toBe(true);
    }
  });
});
