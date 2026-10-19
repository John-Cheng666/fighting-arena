import { getJamieState } from "../state";
import { describe, expect, it } from "vitest";
import { Battle } from "../../../game/Battle";
import { createDemonstration } from "../../../game/training";
import { DEFAULT_CONFIG } from "../../../test/fixtures";
import { JAMIE_VARIANT_BY_ID } from "../moves";
import { resolveHits } from "../../../game/combat";
import { processJamieContactCancels } from "../combat/actions";
import { jamieMoveScaling } from "../combat/scaling";
import type { BattleEvent } from "../../../engine/types";

function practice(): Battle {
  const battle = new Battle({ ...DEFAULT_CONFIG, fighters: DEFAULT_CONFIG.fighters });
  battle.aiEnabled = false;
  const [a, b] = battle.state.fighters;
  a.x = 290; a.y = 450; b.x = 340; b.y = 450;
  a.vx = a.vy = b.vx = b.vy = 0;
  battle.start();
  return battle;
}

function logicalFrames(battle: Battle, frames: number): void {
  const until = battle.state.tick + frames;
  for (let steps = 0; battle.state.tick < until && battle.state.phase === "running" && steps < frames + 150; steps += 1) battle.step();
}

function demonstrate(id: string, scenario: "hit" | "block" | "whiff" = "hit") {
  const battle = createDemonstration("jamie", id, DEFAULT_CONFIG, scenario);
  const events: BattleEvent[] = [];
  for (let step = 0; step < 2000 && battle.demonstration?.status !== "complete"; step += 1) {
    battle.step();
    events.push(...battle.takeEvents());
  }
  expect(battle.demonstration?.status).toBe("complete");
  return { battle, events };
}

describe("confirmed supers and complete move execution", () => {
  it("executes a block reversal immediately after accepting it during Bakkai blockstun", () => {
    const battle = practice();
    const [attacker, defender] = battle.state.fighters;
    getJamieState(attacker)!.drinkLevel = 2;
    getJamieState(defender)!.guardUntilTick = 1000;
    defender.facing = -1;
    expect(battle.requestMove("p1", "S07", "row-81")).toBe(true);
    logicalFrames(battle, 25);
    expect(defender.stunUntilTick).toBeGreaterThan(battle.state.tick);
    expect(battle.requestMove("p2", "D02", "row-96")).toBe(true);
    expect(defender.stunUntilTick).toBe(25);
    logicalFrames(battle, 20);
    expect(getJamieState(defender)!.action?.frame).toBe(20);
    expect(getJamieState(defender)!.action?.connected).toBe(true);
    expect(attacker.hp).toBeLessThan(1500);
  });

  it("applies the local LP starter penalty and truncates the following contact's damage", () => {
    const raw = practice();
    raw.requestMove("p1", "S02", "row-39");
    logicalFrames(raw, 13);
    expect(raw.state.fighters[0].damageDealt).toBe(21);
    const combo = practice();
    combo.requestMove("p1", "N01", "row-0");
    logicalFrames(combo, 5);
    const before = combo.state.fighters[0].damageDealt;
    expect(combo.requestMove("p1", "S02", "row-39")).toBe(true);
    expect(getJamieState(combo.state.fighters[0])!.action?.damageScale).toBeCloseTo(0.8);
    logicalFrames(combo, 13);
    expect(combo.state.fighters[0].damageDealt - before).toBe(16);
  });

  it("applies Rush's 15% multiplier to the rushed move and the remainder of the combo", () => {
    const battle = practice();
    const source = battle.state.fighters[0];
    battle.requestMove("p1", "D03", "row-98");
    logicalFrames(battle, 4);
    battle.requestMove("p1", "D04", "row-101");
    logicalFrames(battle, 9);
    expect(battle.requestMove("p1", "N01", "row-0")).toBe(true);
    expect(getJamieState(source)!.action?.damageScale).toBeCloseTo(0.85);
    logicalFrames(battle, 6);
    expect(source.damageDealt).toBe(15);
    expect(battle.requestMove("p1", "S02", "row-39")).toBe(true);
    expect(getJamieState(source)!.action?.damageScale).toBeCloseTo(0.68);
  });

  it("parses each scaling category and preserves raw SA3 damage and its 50% guaranteed minimum", () => {
    const fighter = practice().state.fighters[0];
    const jamie = getJamieState(fighter)!;
    const sa3 = JAMIE_VARIANT_BY_ID["row-89"];
    expect(sa3.scaling.immediate).toBe(0.1);
    expect(sa3.scaling.combo).toBe(0.2);
    expect(JAMIE_VARIANT_BY_ID["row-0"].scaling.starter).toBe(0.2);
    expect(JAMIE_VARIANT_BY_ID["row-101"].scaling.multiplier).toBe(0.15);
    expect(jamieMoveScaling(jamie, sa3, 0).scale).toBe(1);
    jamie.comboUntilTick = 1000;
    jamie.comboMoveCount = 10;
    jamie.comboStarterPenalty = 0.25;
    jamie.comboImmediatePenalty = 0.2;
    jamie.comboMultiplier = 0.85;
    expect(jamieMoveScaling(jamie, sa3, 0).scale).toBe(0.5);
  });

  it("finishes all eight confirmed cinematic hits before a round timeout is declared", () => {
    const battle = practice();
    battle.state.tick = 5390;
    getJamieState(battle.state.fighters[0])!.super = 30000;
    battle.requestMove("p1", "A03", "row-89");
    const events: BattleEvent[] = [];
    for (let step = 0; step < 700 && battle.state.phase === "running"; step += 1) { battle.step(); events.push(...battle.takeEvents()); }
    expect(events.filter((event) => event.type === "hit" && event.moveId === "A03")).toHaveLength(8);
    expect(battle.state.phase).toBe("finished");
    expect(battle.state.tick).toBeGreaterThan(5400);
    expect(battle.state.tick).toBeLessThan(6000);
    expect(battle.state.fighters.every((fighter) => !fighter.capture)).toBe(true);
  });
  it.each([
    ["row-87", [4, 4, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 33]],
    ["row-87-drink", [4, 4, 9, 9, 9, 9, 9, 9, 9, 9, 30]],
    ["row-89", [24, 9, 12, 12, 12, 12, 12, 63]],
    ["row-90", [24, 9, 12, 12, 12, 12, 12, 36, 30, 30, 81]],
  ] as const)("executes %s with the installed per-contact damage and truncation", (id, expectedHits) => {
    const { battle, events } = demonstrate(id);
    // Local damage at drink level 0, with this suite's explicit 20/300 fixture scale.
    const expected = expectedHits.reduce<number>((sum, amount) => sum + amount, 0);
    const hitEvents = events.filter(event => event.type === "hit");
    expect(hitEvents.map(event => event.amount)).toEqual(expectedHits);
    expect(battle.demonstration?.damage).toBe(expected);
    expect(battle.state.fighters[1].maxHp - battle.state.fighters[1].hp).toBe(expected);
    expect(hitEvents.reduce((sum, event) => sum + event.amount, 0)).toBe(expected);
    expect(battle.state.fighters.every((fighter) => !fighter.capture)).toBe(true);
    expect(hitEvents).toHaveLength(expectedHits.length);
  });

  it.each(["row-87", "row-87-drink", "row-89", "row-90"])("never captures or damages a blocked or missed %s", (id) => {
    for (const scenario of ["block", "whiff"] as const) {
      const { battle, events } = demonstrate(id, scenario);
      expect(battle.demonstration?.outcome).toBe(scenario);
      expect(battle.state.fighters[1].hp).toBe(1500);
      expect(events.some((event) => event.type === "cinematic")).toBe(false);
      expect(getJamieState(battle.state.fighters[0])!.super).toBe(30000 - JAMIE_VARIANT_BY_ID[id].superCost);
    }
  });

  it("locks both participants only after SA3 really connects, and releases into the final upward kick", () => {
    const battle = practice();
    const [source, target] = battle.state.fighters;
    getJamieState(source)!.super = 30000;
    expect(battle.requestMove("p1", "A03", "row-89")).toBe(true);
    expect(target.capture).toBeUndefined();
    logicalFrames(battle, 10);
    expect(target.capture?.sourceId).toBe("p1");
    expect(getJamieState(source)!.action?.captureTargetId).toBe("p2");
    expect(battle.requestMove("p2", "N01")).toBe(false);
    expect(battle.requestMove("p1", "N01")).toBe(false);
    target.vx = 900;
    logicalFrames(battle, 100);
    expect(target.capture).toBeDefined();
    expect(target.vx).toBe(0);
    expect(target.hits).toBe(0);
    logicalFrames(battle, 339);
    expect(target.capture).toBeUndefined();
    expect(target.knockdownUntilTick).toBeLessThanOrEqual(battle.state.tick);
    expect(target.height).toBeGreaterThan(100);
    expect(target.juggleUntilTick).toBeGreaterThan(battle.state.tick);
    expect(getJamieState(source)!.action?.cinematicPhase).toBe("finish");
  });

  it("allows a real follow-up after standard SA3, and otherwise applies hard knockdown only on landing", () => {
    const battle = practice();
    const [source, target] = battle.state.fighters;
    getJamieState(source)!.super = 30000;
    battle.requestMove("p1", "A03", "row-89");
    logicalFrames(battle, 458);
    expect(getJamieState(source)!.action).toBeNull();
    expect(target.pendingHardKnockdown).toBe(true);
    const before = target.hp;
    expect(battle.requestMove("p1", "S04", "row-69")).toBe(true);
    logicalFrames(battle, 30);
    expect(target.hp).toBeLessThan(before);
    expect(target.pendingHardKnockdown).toBe(false);
    const other = practice();
    getJamieState(other.state.fighters[0])!.super = 30000;
    other.requestMove("p1", "A03", "row-89");
    logicalFrames(other, 449);
    const landing = other.state.fighters[1].juggleUntilTick!;
    expect(landing).toBeGreaterThan(other.state.tick);
    logicalFrames(other, landing - other.state.tick);
    expect(other.state.fighters[1].height).toBe(0);
    expect(other.state.fighters[1].hardKnockdown).toBe(true);
  });

  it("finishes the confirmed cinematic before declaring an early lethal hit, and clears restart state", () => {
    const battle = practice();
    const [source, target] = battle.state.fighters;
    target.hp = 1;
    getJamieState(source)!.super = 30000;
    battle.requestMove("p1", "A03", "row-89");
    logicalFrames(battle, 11);
    expect(target.hp).toBe(1);
    expect(battle.state.phase).toBe("running");
    logicalFrames(battle, 450);
    expect(target.hp).toBe(0);
    expect(battle.state.phase).toBe("finished");
    expect(battle.state.fighters.every((fighter) => !fighter.capture && !getJamieState(fighter)?.action)).toBe(true);
    const restarted = practice();
    expect(restarted.state.superFreezeRemaining).toBe(0);
    expect(restarted.state.fighters.every((fighter) => !fighter.capture && !getJamieState(fighter)?.action)).toBe(true);
  });

  it("applies SA2's frame 78 activation and frame 111 Drive event during its 124-frame intro", () => {
    const battle = practice();
    const source = battle.state.fighters[0];
    const jamie = getJamieState(source)!;
    jamie.super = 20000;
    jamie.drive = 10000;
    battle.state.projectiles.push({ id: 1, ownerId: "p2", x: 100, y: 200, previousX: 100, previousY: 200, vx: 180, vy: 0, radius: 10, damage: 5, expiresAt: 400, bounces: 1, gold: false });
    battle.requestMove("p1", "A02");
    for (let frame = 0; frame < 77; frame += 1) battle.step();
    expect(battle.state.tick).toBe(0);
    expect(jamie.action?.introFrame).toBe(77);
    expect(jamie.sa2UntilTick).toBe(0);
    battle.step();
    expect(jamie.action?.introFrame).toBe(78);
    expect(jamie.sa2UntilTick).toBe(900);
    expect(jamie.drive).toBe(10000);
    for (let frame = 78; frame < 110; frame += 1) battle.step();
    expect(jamie.drive).toBe(10000);
    battle.step();
    expect(jamie.action?.introFrame).toBe(111);
    expect(jamie.drive).toBe(20000);
    for (let frame = 111; frame < 124; frame += 1) battle.step();
    expect(battle.state.tick).toBe(0);
    expect(jamie.action?.introFrame).toBe(124);
    expect(jamie.action?.frame).toBe(0);
    expect(battle.state.projectiles[0].x).toBe(100);
    expect(jamie.sa2UntilTick).toBe(900);
    logicalFrames(battle, 6);
    expect(getJamieState(source)!.action).toBeNull();
    expect(battle.state.tick).toBe(6);
  });

  it.each([["row-89", 438], ["row-90", 499]] as const)("pauses SA2's timer during %s's local world-stop interval of %s frames", (variantId, stoppedFrames) => {
    const battle = practice();
    const [source, target] = battle.state.fighters;
    getJamieState(source)!.super = 30000;
    if (variantId === "row-90") source.hp = source.maxHp * 0.25;
    getJamieState(target)!.drinkLevel = 1;
    getJamieState(target)!.sa2OriginalDrinkLevel = 1;
    getJamieState(target)!.sa2UntilTick = 20;
    battle.requestMove("p1", "A03", variantId);
    logicalFrames(battle, 10);
    expect(target.capture).toBeDefined();
    expect(getJamieState(target)!.sa2UntilTick - battle.state.tick).toBe(10);
    logicalFrames(battle, stoppedFrames);
    expect(getJamieState(target)!.sa2UntilTick - battle.state.tick).toBe(10);
    expect(getJamieState(target)!.sa2UntilTick).toBe(20 + stoppedFrames);
    logicalFrames(battle, 9);
    expect(getJamieState(target)!.sa2UntilTick).toBeGreaterThan(battle.state.tick);
    logicalFrames(battle, 1);
    expect(getJamieState(target)!.sa2UntilTick).toBe(0);
    expect(getJamieState(target)!.drinkLevel).toBe(1);
  });

  it("selects CA at exactly 25% HP and never charges a rejected form", () => {
    const battle = practice();
    const fighter = battle.state.fighters[0];
    getJamieState(fighter)!.super = 30000;
    fighter.hp = 375;
    expect(battle.requestMove("p1", "A03", "row-89")).toBe(false);
    expect(getJamieState(fighter)!.super).toBe(30000);
    expect(battle.requestMove("p1", "A03", "row-90")).toBe(true);
  });

  it("executes four held drinks individually, with no advance rewards or health recovery", () => {
    const battle = practice();
    const fighter = battle.state.fighters[0];
    fighter.hp = 1100;
    expect(battle.requestMove("p1", "S01", "row-38-hold-4")).toBe(true);
    for (const [frames, expected] of [[48, 0], [1, 1], [48, 2], [48, 3], [48, 4]]) {
      logicalFrames(battle, frames);
      expect(getJamieState(fighter)!.drinkLevel).toBe(expected);
    }
    expect(fighter.hp).toBe(1100);
    expect(getJamieState(fighter)!.action?.drinksApplied).toBe(4);
  });

  it("keeps only completed drinks when a held sequence is interrupted", () => {
    const battle = practice();
    const fighter = battle.state.fighters[0];
    battle.requestMove("p1", "S01", "row-38-hold-4");
    logicalFrames(battle, 97);
    resolveHits(battle.state, [{ sourceId: "p2", targetId: "p1", damage: 5, heal: 0 }], []);
    logicalFrames(battle, 160);
    expect(getJamieState(fighter)!.drinkLevel).toBe(2);
    expect(getJamieState(fighter)!.action).toBeNull();
  });

  it("can release continuous drinking without gaining the remaining queued drinks", () => {
    const battle = practice();
    const fighter = battle.state.fighters[0];
    battle.requestMove("p1", "S01", "row-38-hold-4");
    logicalFrames(battle, 60);
    expect(battle.setHold("p1", false)).toBe(true);
    logicalFrames(battle, 100);
    expect(getJamieState(fighter)!.drinkLevel).toBe(1);
    expect(getJamieState(fighter)!.action).toBeNull();
  });

  it("executes Ransui's longest delay as a Drive-recovery branch without a bonus drink", () => {
    const battle = practice();
    const fighter = battle.state.fighters[0];
    getJamieState(fighter)!.drinkLevel = 4;
    battle.requestMove("p1", "U09", "row-33");
    logicalFrames(battle, 20);
    expect(battle.requestMove("p1", "U09", "row-34")).toBe(true);
    logicalFrames(battle, 30);
    expect(battle.requestMove("p1", "U09", "row-37")).toBe(false);
    logicalFrames(battle, 33);
    expect(battle.requestMove("p1", "U09", "row-37")).toBe(true);
    getJamieState(fighter)!.drive = 20000;
    logicalFrames(battle, 51);
    expect(getJamieState(fighter)!.drive).toBe(30000);
    expect(getJamieState(fighter)!.drinkLevel).toBe(4);
  });

  it("depletes the official Punish Counter Drive amount only once per move", () => {
    const battle = practice();
    const [source, target] = battle.state.fighters;
    battle.requestMove("p1", "N01", "row-0");
    getJamieState(target)!.action = { ...getJamieState(source)!.action!, frame: 20, startTick: -20, variantId: "row-98", moveId: "D03" };
    const hit = { sourceId: "p1" as const, targetId: "p2" as const, damage: 10, heal: 0, moveId: "N01", variantId: "row-0" };
    resolveHits(battle.state, [hit], []);
    const after = getJamieState(target)!.drive;
    expect(after).toBe(60000 - JAMIE_VARIANT_BY_ID["row-0"].punishDriveLoss);
    getJamieState(target)!.punishUntilTick = 100;
    resolveHits(battle.state, [hit], []);
    expect(getJamieState(target)!.drive).toBe(after);
  });

  it("gives AI a real post-contact input phase inside HP's first active frame", () => {
    const battle = practice();
    battle.requestMove("p1", "N05", "row-4");
    logicalFrames(battle, 5);
    expect(getJamieState(battle.state.fighters[0])!.action?.connected).toBe(true);
    // Resume a committed STANDARD AI program, rather than the removed ad-hoc random cancel.
    const ai = getJamieState(battle.state.fighters[0])!.standardAI;
    ai.currentItemId = "sf6:1175";
    ai.branchGroup = "146";
    ai.commandIndex = 2;
    getJamieState(battle.state.fighters[0])!.keyHistory = [{ tick: 3, direction: 2, buttons: 0 }, { tick: 4, direction: 3, buttons: 0 }];
    processJamieContactCancels(battle.state, () => 0, []);
    expect(getJamieState(battle.state.fighters[0])!.action?.moveId).toBe("S02");
    expect(battle.state.tick).toBe(5);
    const late = practice();
    late.requestMove("p1", "N05", "row-4");
    logicalFrames(late, 6);
    expect(late.requestMove("p1", "S02", "row-39")).toBe(false);
  });

  it("drinks after a completed SA1 hold on hit, block or miss, while the held throw requires a grab", () => {
    for (const id of ["row-87-drink", "row-91-drink"]) {
      const { battle } = demonstrate(id);
      expect(getJamieState(battle.state.fighters[0])!.drinkLevel).toBe(1);
      const missed = demonstrate(id, "whiff").battle;
      expect(getJamieState(missed.state.fighters[0])!.drinkLevel).toBe(id === "row-87-drink" ? 1 : 0);
    }
    expect(getJamieState(demonstrate("row-87").battle.state.fighters[0])!.drinkLevel).toBe(0);
  });

  it("ends a held parry when Drive runs out without repeatedly extending recovery", () => {
    const battle = practice();
    const fighter = battle.state.fighters[0];
    getJamieState(fighter)!.drive = 5100;
    expect(battle.requestMove("p1", "D03", "parry-hold")).toBe(true);
    logicalFrames(battle, 40);
    expect(getJamieState(fighter)!.action).toBeNull();
    expect(getJamieState(fighter)!.drive).toBe(0);
    expect(getJamieState(fighter)!.burnout).toBe(true);
  });

  it("absorbs exactly two DI strikes, and makes its wall and punish properties real", () => {
    const battle = practice();
    const [source, target] = battle.state.fighters;
    battle.requestMove("p1", "D01", "row-95");
    getJamieState(source)!.action!.frame = 1;
    const strike = { sourceId: "p2" as const, targetId: "p1" as const, damage: 10, heal: 0 };
    resolveHits(battle.state, [strike], []);
    resolveHits(battle.state, [strike], []);
    expect(getJamieState(source)!.action?.armorHits).toBe(2);
    resolveHits(battle.state, [strike], []);
    expect(getJamieState(source)!.action).toBeNull();
    target.x = 615;
    source.x = 560;
    const events: BattleEvent[] = [];
    resolveHits(battle.state, [{ sourceId: "p1", targetId: "p2", damage: 10, heal: 0, moveId: "D01", variantId: "row-95", knockback: 30 }], events);
    expect(target.wallSplatUntilTick).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "wall")).toBe(true);
  });

  it("recovers Drive Reversal gray damage after the delay and clears it on a normal hit", () => {
    const battle = practice();
    const target = battle.state.fighters[1];
    resolveHits(battle.state, [{ sourceId: "p1", targetId: "p2", damage: 20, heal: 0, recoverable: true }], []);
    logicalFrames(battle, 120);
    expect(target.hp).toBe(1482);
    logicalFrames(battle, 20);
    expect(target.hp).toBe(1500);
    resolveHits(battle.state, [{ sourceId: "p1", targetId: "p2", damage: 20, heal: 0, recoverable: true }], []);
    resolveHits(battle.state, [{ sourceId: "p1", targetId: "p2", damage: 5, heal: 0 }], []);
    expect(target.recoverableHp).toBe(0);
  });
});
