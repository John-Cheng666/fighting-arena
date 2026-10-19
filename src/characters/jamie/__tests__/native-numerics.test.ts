import { describe, expect, it } from "vitest";
import { Battle } from "../../../game/Battle";
import { getJamieState } from "../state";
import { effectiveDrinkLevel } from "../combat/actions";
import { JAMIE_VARIANT_BY_ID } from "../moves";
import type { BattleEvent } from "../../../engine/types";
import { resolveHits } from "../../../engine/systems/damage";

function practice(settings: Record<string, number> = {}): Battle {
  const battle = new Battle({ seed: 42, fighters: [{ characterId: "jamie", settings }, "jamie"] });
  battle.aiEnabled = false;
  battle.start();
  const [source, target] = battle.state.fighters;
  source.x = 290; target.x = 340; source.y = target.y = 450;
  return battle;
}

function advance(battle: Battle, frames: number): BattleEvent[] {
  const events: BattleEvent[] = [];
  const end = battle.state.tick + frames;
  for (let steps = 0; battle.state.tick < end && steps < frames + 150 && battle.state.phase === "running"; steps += 1) {
    battle.step(); events.push(...battle.takeEvents());
  }
  return events;
}

describe("installed SF6 ordinary-battle numeric integration", () => {
  it("starts both fighters with the local health and gauge maxima at ordinary damage", () => {
    const battle = new Battle({ seed: 42, fighters: ["jamie", "jamie"] });
    for (const fighter of battle.state.fighters) {
      expect(fighter.hp).toBe(10000);
      expect(fighter.maxHp).toBe(10000);
      expect(fighter.settings.damageScale).toBe(1);
      expect(getJamieState(fighter)).toMatchObject({ drive: 60000, super: 0, drinkLevel: 0 });
    }
  });

  it("heals two recoverable health per eligible frame after the local 120-frame wait", () => {
    const battle = new Battle({ seed: 42, fighters: ["jamie", "jamie"] });
    battle.aiEnabled = false;
    battle.start();
    const target = battle.state.fighters[1];
    target.hp = 9900;
    target.recoverableHp = 5;
    target.lastHitTick = 0;
    for (let frame = 0; frame < 119; frame += 1) battle.step();
    expect(target.hp).toBe(9900);
    battle.step();
    expect(target.hp).toBe(9902);
    expect(target.recoverableHp).toBe(3);
    battle.step();
    expect(target.hp).toBe(9904);
    battle.step();
    expect(target.hp).toBe(9905);
    expect(target.recoverableHp).toBe(0);
  });

  it("executes HP's local100/100/700 contacts and exact gauge additions", () => {
    const battle = practice();
    expect(battle.requestMove("p1", "N05", "row-4")).toBe(true);
    const events = advance(battle, 15);
    const hits = events.filter(event => event.type === "hit");
    expect(hits.map(hit => hit.amount)).toEqual([90, 90, 630]);
    expect(hits.map(hit => hit.tick)).toEqual([5, 7, 12]);
    expect(getJamieState(battle.state.fighters[0])!.super).toBe(1600);
    expect(getJamieState(battle.state.fighters[1])!.super).toBe(1120);
    const contacts = events.filter(event => event.type === "contact");
    expect(contacts.map(event => event.amount)).toEqual([90, 90, 630]);
    expect(contacts.map(event => event.segment)).toEqual([0, 1, 2]);
    expect(contacts.map(event => event.hpAfter)).toEqual([9910, 9820, 9190]);
    expect(contacts[0]).toMatchObject({ moveId: "N05", variantId: "row-4", calculation: { baseDamage: 100, factors: [100, 90, 100], multiplier: 1, rounding: "native" } });
  });

  it("records Burnout chip with the attacking move, calculation and actual HP loss", () => {
    const battle = practice();
    const target = battle.state.fighters[1];
    const jamie = getJamieState(target)!;
    jamie.guardUntilTick = 1000; jamie.burnout = true; jamie.drive = 0;
    const events: BattleEvent[] = [];
    resolveHits(battle.state, [{ sourceId: "p1", targetId: "p2", damage: 450, heal: 0, moveId: "S02", variantId: "row-47", segment: 0 }], events, battle.characters);
    expect(events.find(event => event.type === "contact")).toMatchObject({ outcome: "block", damageType: "chip", sourceId: "p1", targetId: "p2", amount: 45, hpLoss: 45, hpBefore: 10000, hpAfter: 9955, calculation: { baseDamage: 450, factors: [10], rounding: "round" } });
    expect(battle.state.fighters[0].damageDealt).toBe(45);
  });

  it.each([[0, 270], [2, 300], [4, 330]])("applies local drink level%s offensive damage%s", (drink, damage) => {
    const battle = practice({ startDrinkLevel: drink });
    battle.requestMove("p1", "N01", "row-0");
    const hits = advance(battle, 5).filter(event => event.type === "hit");
    expect(hits.map(hit => hit.amount)).toEqual([damage]);
    expect(getJamieState(battle.state.fighters[0])!.super).toBe(300);
    expect(getJamieState(battle.state.fighters[1])!.super).toBe(210);
  });

  it("applies the local guard gauge values without awarding damage-based SA", () => {
    const battle = practice();
    const [source, target] = battle.state.fighters;
    getJamieState(target)!.guardUntilTick = 1000;
    battle.requestMove("p1", "N01", "row-0");
    advance(battle, 5);
    expect(target.hp).toBe(10000);
    expect(getJamieState(source)!.super).toBe(150);
    expect(getJamieState(target)!.super).toBe(75);
    expect(getJamieState(target)!.drive).toBe(59500);
    expect(getJamieState(target)!.driveRecoveryWait).toBe(-90);
  });

  it("uses native integer-percent rounding for a raw Drive Rush LP", () => {
    const battle = practice();
    const jamie = getJamieState(battle.state.fighters[0])!;
    jamie.rushUntilTick = 100;
    jamie.rushMultiplier = 0.85;
    battle.requestMove("p1", "N01", "row-0");
    expect(advance(battle, 5).filter(event => event.type === "hit").map(hit => hit.amount)).toEqual([228]);
  });

  it("applies local perfect-parry SA80% and attacker Drive50% contact factors", () => {
    const battle = practice();
    const [source, target] = battle.state.fighters;
    getJamieState(source)!.drive = 30000;
    battle.requestMove("p1", "N01", "row-0");
    advance(battle, 4);
    battle.requestMove("p2", "D03", "row-98");
    const beforeDrive = getJamieState(source)!.drive;
    const events = advance(battle, 1);
    expect(events.some(event => event.type === "block" && event.perfect)).toBe(true);
    expect(getJamieState(source)!.super).toBe(120);
    expect(getJamieState(target)!.super).toBe(60);
    expect(getJamieState(source)!.drive - beforeDrive).toBe(125);
  });

  it("charges OD startup once and allows its native free follow-ups", () => {
    const battle = practice();
    const jamie = getJamieState(battle.state.fighters[0])!;
    jamie.drive = 1;
    expect(battle.requestMove("p1", "S04", "row-70")).toBe(true);
    expect(jamie.drive).toBe(0);
    expect(jamie.burnout).toBe(true);
    expect(jamie.driveRecoveryWait).toBe(-120);
    expect(JAMIE_VARIANT_BY_ID["row-46"].driveCost).toBe(20000);
    expect(JAMIE_VARIANT_BY_ID["row-52"].driveCost).toBe(0);
    expect(JAMIE_VARIANT_BY_ID["row-58"].driveCost).toBe(0);
  });

  it("applies SA2's authored install and Drive events during its124-frame intro", () => {
    const battle = practice({ superBars: 2, driveBars: 3, startDrinkLevel: 1 });
    const source = battle.state.fighters[0], jamie = getJamieState(source)!;
    battle.requestMove("p1", "A02", "row-88");
    for (let frame = 0; frame < 77; frame += 1) battle.step();
    expect(effectiveDrinkLevel(source, 0)).toBe(1);
    battle.step();
    expect(effectiveDrinkLevel(source, 0)).toBe(4);
    expect(jamie.sa2UntilTick).toBe(900);
    for (let frame = 78; frame < 110; frame += 1) battle.step();
    expect(jamie.drive).toBe(30000);
    battle.step();
    expect(jamie.drive).toBe(40000);
    expect(battle.state.tick).toBe(0);
    advance(battle, 6);
    battle.requestMove("p1", "N01", "row-0");
    const hits = advance(battle, 5).filter(event => event.type === "hit");
    expect(hits.map(hit => hit.amount)).toEqual([315]);
    expect(jamie.super).toBe(0);
  });

  it("uses the separate level4 SA1 drinking Drive event at frame178", () => {
    const battle = practice({ superBars: 1, driveBars: 3, startDrinkLevel: 4 });
    const jamie = getJamieState(battle.state.fighters[0])!;
    battle.requestMove("p1", "A01", "row-87-drink");
    advance(battle, 177);
    expect(jamie.drive).toBe(30000);
    advance(battle, 1);
    expect(jamie.drive).toBe(40000);
    expect(jamie.drinkLevel).toBe(4);
  });

  it.each([
    ["row-89", [360, 135, 180, 180, 180, 180, 180, 945], [10, 14, 33, 305, 317, 325, 343, 386], 438, 458],
    ["row-90", [360, 135, 180, 180, 180, 180, 180, 540, 450, 450, 1215], [10, 14, 33, 239, 251, 258, 277, 397, 423, 439, 464], 499, 564],
  ] as const)("executes %s's local captured damage and stops only the round timer", (id, amounts, ticks, stopped, end) => {
    const battle = practice({ superBars: 3 });
    if (id === "row-90") battle.state.fighters[0].hp = 2500;
    battle.requestMove("p1", "A03", id);
    const hits = advance(battle, end).filter(event => event.type === "hit");
    expect(hits.map(hit => hit.amount)).toEqual([...amounts]);
    expect(hits.map(hit => hit.tick)).toEqual([...ticks]);
    expect(battle.state.worldStopTicks).toBe(stopped);
    expect(battle.state.tick - stopped).toBe(end - stopped);
    expect(getJamieState(battle.state.fighters[0])!.action).toBeNull();
    expect(getJamieState(battle.state.fighters[1])!.super).toBe(0);
  });

  it.each([["A03", "row-89"], ["T01", "row-91"]])("logs %s's deferred capture KO without awarding damage twice", (moveId, variantId) => {
    const battle = practice({ superBars: 3 });
    battle.state.fighters[1].hp = 300;
    expect(battle.requestMove("p1", moveId, variantId)).toBe(true);
    const events = advance(battle, 600);
    const contacts = events.filter(event => event.type === "contact");
    expect(battle.state.fighters[1].hp).toBe(0);
    expect(contacts.filter(event => event.deferred)).toMatchObject([{ sourceId: "p1", targetId: "p2", moveId, variantId, amount: 0, hpLoss: 1, hpBefore: 1, hpAfter: 0 }]);
    expect(contacts.reduce((sum, event) => sum + event.hpLoss, 0)).toBe(300);
    expect(contacts.reduce((sum, event) => sum + event.amount, 0)).toBe(battle.state.fighters[0].damageDealt);
    expect(contacts.filter(event => !event.deferred)).toHaveLength(events.filter(event => event.type === "hit").length);
  });
});
