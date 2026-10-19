import { getJamieState } from "../state";
import { describe, expect, it } from "vitest";
import { Battle } from "../../../game/Battle";
import { createDemonstration } from "../../../game/training";
import { DEFAULT_MATCH_CONFIG } from "../../../test/fixtures";
import { JAMIE_VARIANT_BY_ID } from "../moves";
import { resolveHits } from "../../../game/combat";
import type { BattleEvent } from "../../../engine/types";
import { BOUNDS } from "../../../engine/systems/movement";

function practice() {
  const battle = new Battle(DEFAULT_MATCH_CONFIG);
  battle.aiEnabled = false;
  battle.state.fighters.forEach((fighter, index) => {
    fighter.x = 290 + index * 50; fighter.y = 450; fighter.vx = fighter.vy = 0;
  });
  battle.start();
  return battle;
}
function advance(battle: Battle, frames: number) {
  const end = battle.state.tick + frames;
  for (let step = 0; battle.state.tick < end && step < frames + 150; step++) battle.step();
  expect(battle.state.tick).toBe(end);
}

describe("Jamie fidelity regressions from the REA/IDA audit", () => {
  it.each([75, 76, 77, 78])("allows a crouching opponent to block dive kick row %s", (row) => {
    const battle = createDemonstration("jamie", `row-${row}`, DEFAULT_MATCH_CONFIG, "block");
    const target = battle.state.fighters[1];
    for (let step = 0; step < 1000 && battle.demonstration?.status !== "complete"; step++) {
      getJamieState(target)!.guardLow = true;
      battle.step();
    }
    expect(battle.demonstration?.outcome).toBe("block");
    expect(target.hp).toBe(target.maxHp);
  });

  it.each([[0, 5], [1, 3], [2, 6], [3, 2], [6, 5], [7, 3], [8, 5], [9, -1], [10, 0]])(
    "executes the published first-contact hit advantage of row %s as %+d", (row, advantage) => {
      const battle = practice(), [source, target] = battle.state.fighters;
      const variant = JAMIE_VARIANT_BY_ID[`row-${row}`];
      expect(battle.requestMove(source.id, variant.moveId, variant.id)).toBe(true);
      advance(battle, variant.startup);
      expect(source.hits).toBe(1);
      expect(target.stunUntilTick - (getJamieState(source)!.action!.startTick + getJamieState(source)!.action!.duration)).toBe(advantage);
    },
  );

  it("gains one frame of advantage when LP connects on its second active frame", () => {
    const battle = practice(), [source, target] = battle.state.fighters;
    target.x = source.x + 120;
    battle.requestMove(source.id, "N01", "row-0"); advance(battle, 5);
    expect(source.hits).toBe(0);
    target.x = source.x + 50; advance(battle, 1);
    expect(source.hits).toBe(1);
    expect(target.stunUntilTick - getJamieState(source)!.action!.duration).toBe(6);
  });

  it.each([[0, 0], [1, -1], [2, 2], [3, -3], [4, -3], [5, -5], [6, -1], [7, -3], [8, -1], [9, -6], [10, -8], [11, -11]])(
    "executes the published final-contact block advantage of row %s as %s", (row, advantage) => {
      const battle = practice(), [source, target] = battle.state.fighters;
      const variant = JAMIE_VARIANT_BY_ID[`row-${row}`];
      getJamieState(target)!.guardUntilTick = 1000; getJamieState(target)!.guardLow = variant.low; target.facing = -1;
      battle.requestMove(source.id, variant.moveId, variant.id);
      advance(battle, variant.active.at(-1)![0]);
      expect(getJamieState(source)!.action?.blocked).toBe(true);
      expect(target.stunUntilTick - (getJamieState(source)!.action!.startTick + getJamieState(source)!.action!.duration)).toBe(advantage);
    },
  );

  it("includes Bitter Strikes' extra blocked recovery without changing its -10 block advantage", () => {
    const battle = createDemonstration("jamie", "row-26", DEFAULT_MATCH_CONFIG, "block");
    let sourceFreeTick = 0;
    for (let step = 0; step < 1000 && battle.demonstration?.status !== "complete"; step++) {
      battle.step();
      const action = getJamieState(battle.state.fighters[0])!.action;
      if (action?.variantId === "row-26") sourceFreeTick = action.startTick + action.duration;
    }
    expect(battle.demonstration?.outcome).toBe("block");
    expect(battle.state.fighters[1].stunUntilTick - sourceFreeTick).toBe(-10);
  });

  it.each([["row-87", -60], ["row-87-drink", -93]] as const)("executes %s block advantage as %s", (id, advantage) => {
    const battle = createDemonstration("jamie", id, DEFAULT_MATCH_CONFIG, "block");
    let sourceFreeTick = 0;
    for (let step = 0; step < 1000 && battle.demonstration?.status !== "complete"; step++) {
      battle.step();
      const action = getJamieState(battle.state.fighters[0])!.action;
      if (action?.variantId === id) sourceFreeTick = action.startTick + action.duration;
    }
    expect(battle.demonstration?.outcome).toBe("block");
    expect(battle.state.fighters[1].stunUntilTick - sourceFreeTick).toBe(advantage);
  });

  it("restores full damage for an independent poke after the opponent recovers", () => {
    const battle = practice(), [source, target] = battle.state.fighters;
    battle.requestMove(source.id, "N01", "row-0"); advance(battle, 25);
    const first = source.damageDealt;
    expect(target.stunUntilTick).toBeLessThan(battle.state.tick);
    target.x = source.x + 50; target.vx = target.vy = 0;
    battle.requestMove(source.id, "N01", "row-0"); advance(battle, 5);
    expect(source.damageDealt - first).toBe(first);
    expect(getJamieState(source)!.action!.damageScale).toBe(1);
    expect(getJamieState(source)!.comboMoveCount).toBe(1);
  });

  it("drops old scaling when a move's startup leaves a gap after hitstun", () => {
    const battle = practice(), [source] = battle.state.fighters;
    battle.requestMove(source.id, "N01", "row-0"); advance(battle, 6);
    battle.requestMove(source.id, "S02", "row-39");
    expect(getJamieState(source)!.action!.damageScale).toBeCloseTo(0.8);
    advance(battle, 13);
    expect(getJamieState(source)!.action!.damageScale).toBe(1);
  });

  it("requires Tenshin to recover before linking HP and preserves its +8 follow-up", () => {
    const battle = practice(), [source, target] = battle.state.fighters;
    getJamieState(source)!.drinkLevel = 3;
    battle.requestMove(source.id, "S08", "row-83"); advance(battle, 14);
    expect(battle.requestMove(source.id, "N05", "row-4")).toBe(false);
    advance(battle, 45);
    expect(getJamieState(source)!.action).toBeNull();
    expect(target.stunUntilTick - battle.state.tick).toBe(8);
    expect(battle.requestMove(source.id, "N05", "row-4")).toBe(true);
    advance(battle, 5);
    expect(source.hits).toBe(2);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("cannot tech Tenshin with a normal throw", () => {
    const battle = practice(), [source, target] = battle.state.fighters;
    getJamieState(source)!.drinkLevel = 3;
    battle.requestMove(source.id, "S08", "row-83"); advance(battle, 6);
    battle.requestMove(target.id, "T01", "row-91"); advance(battle, 2);
    expect(getJamieState(source)!.action?.connected).toBe(true);
    expect(getJamieState(target)!.action).toBeNull();
    expect(battle.takeEvents().some((event) => event.type === "block")).toBe(false);
  });

  it("still techs two normal throws and discards the other queued throw hit", () => {
    const battle = practice(), [source, target] = battle.state.fighters;
    battle.requestMove(source.id, "T01", "row-91");
    battle.requestMove(target.id, "T02", "row-92"); advance(battle, 5);
    expect(getJamieState(source)!.action).toBeNull(); expect(getJamieState(target)!.action).toBeNull();
    expect(source.hits + target.hits).toBe(0);
    expect(source.capture || target.capture).toBeUndefined();
  });

  it.each(["jump-neutral", "jump-back", "jump"])("retains %s momentum and facing when starting an aerial normal", (jump) => {
    for (let row = 12; row < 18; row++) {
      const battle = practice(), [source, target] = battle.state.fighters;
      target.x = 580;
      battle.requestMove(source.id, "jump", jump); advance(battle, 9);
      const vx = source.vx, vy = source.vy, facing = source.facing;
      const variant = JAMIE_VARIANT_BY_ID[`row-${row}`];
      expect(battle.requestMove(source.id, variant.moveId, variant.id)).toBe(true);
      advance(battle, 1);
      expect(source.vx).toBeCloseTo(vx); expect(source.vy).toBeCloseTo(vy); expect(source.facing).toBe(facing);
    }
  });

  const diveKickRequests = ["row-75", "row-76", "row-77", "row-78", undefined] as const;

  it.each(diveKickRequests)("requires a forward jump for dive kick %s even after a jumping MP hits", (variantId) => {
    for (const jump of ["jump-neutral", "jump-back"]) {
      const battle = practice(), [source, target] = battle.state.fighters;
      const jamie = getJamieState(source)!;
      source.x = BOUNDS.left; target.x = source.x + 50;
      jamie.drinkLevel = 1;
      expect(battle.requestMove(source.id, "jump", jump)).toBe(true);
      advance(battle, 30);
      expect(battle.requestMove(source.id, "S06", variantId)).toBe(false);
      expect(battle.requestMove(source.id, "N15", "row-14")).toBe(true);
      advance(battle, JAMIE_VARIANT_BY_ID["row-14"].startup);
      expect(source.hits).toBe(1);
      expect(jamie.action?.connected).toBe(true);
      expect(source.height).toBeGreaterThan(15);
      const drive = jamie.drive;
      expect(battle.requestMove(source.id, "S06", variantId)).toBe(false);
      expect(jamie.action?.variantId).toBe("row-14");
      expect(jamie.drive).toBe(drive);
    }
  });

  it.each(diveKickRequests)("allows dive kick %s directly from a forward jump", (variantId) => {
    const battle = practice(), [source, target] = battle.state.fighters;
    target.x = 580;
    getJamieState(source)!.drinkLevel = 1;
    expect(battle.requestMove(source.id, "jump", "jump")).toBe(true);
    advance(battle, 9);
    expect(battle.requestMove(source.id, "S06", variantId)).toBe(true);
    expect(getJamieState(source)!.action?.variantId).toBe(variantId ?? "row-75");
  });

  it.each(diveKickRequests)("allows dive kick %s after a forward-jump MP hits", (variantId) => {
    const battle = practice(), [source, target] = battle.state.fighters;
    const jamie = getJamieState(source)!;
    target.x = source.x + 100;
    jamie.drinkLevel = 1;
    expect(battle.requestMove(source.id, "jump", "jump")).toBe(true);
    advance(battle, 30);
    expect(battle.requestMove(source.id, "N15", "row-14")).toBe(true);
    advance(battle, JAMIE_VARIANT_BY_ID["row-14"].startup);
    expect(source.hits).toBe(1);
    expect(jamie.action?.connected).toBe(true);
    expect(battle.requestMove(source.id, "S06", variantId)).toBe(true);
    expect(jamie.action?.variantId).toBe(variantId ?? "row-75");
  });

  it.each([[12, true], [15, true], [13, false]])("allows only cross-up aerial row %s to hit behind its jump facing", (row, shouldHit) => {
    const battle = practice(), [source, target] = battle.state.fighters;
    battle.requestMove(source.id, "jump", "jump"); advance(battle, 30);
    const variant = JAMIE_VARIANT_BY_ID[`row-${row}`];
    battle.requestMove(source.id, variant.moveId, variant.id); advance(battle, variant.startup);
    expect(source.x).toBeGreaterThan(target.x);
    expect(source.facing).toBe(1);
    expect(source.hits > 0).toBe(shouldHit);
  });

  it("does not push a grounded opponent while jumping over them", () => {
    const battle = practice(), [source, target] = battle.state.fighters;
    battle.requestMove(source.id, "jump", "jump"); advance(battle, 35);
    expect(source.height).toBeGreaterThan(40);
    expect(source.x).toBeGreaterThan(target.x);
    expect(target.x).toBeLessThan(350);
  });

  it("does not grant held Perfect Parry throw invulnerability", () => {
    const battle = practice(), [source, target] = battle.state.fighters;
    battle.requestMove(source.id, "D03", "parry-hold"); advance(battle, 1);
    const events: BattleEvent[] = [];
    resolveHits(battle.state, [{sourceId:target.id,targetId:source.id,damage:10,heal:0,moveId:"N01",variantId:"row-0"}], events);
    expect(events.some((event) => event.type === "block" && event.perfect)).toBe(true);
    expect(getJamieState(source)!.parryInvulnerableUntilTick).toBe(0);
    advance(battle, 1);
    resolveHits(battle.state, [{sourceId:target.id,targetId:source.id,damage:100,heal:0,throw:true,moveId:"S08",variantId:"row-84"}], events);
    expect(source.hp).toBeLessThan(source.maxHp);
    expect(getJamieState(source)!.action).toBeNull();
  });

  it("uses the one-frame strike Perfect Parry recovery before five invincible frames", () => {
    const battle = practice(), [source, target] = battle.state.fighters;
    battle.requestMove(source.id, "D03", "row-98"); advance(battle, 1);
    resolveHits(battle.state, [{sourceId:target.id,targetId:source.id,damage:10,heal:0}], []);
    expect(getJamieState(source)!.action?.duration).toBe(1);
    advance(battle, 1);
    expect(getJamieState(source)!.action).toBeNull();
    expect(getJamieState(source)!.parryInvulnerableUntilTick! - battle.state.tick).toBe(5);
  });

  it("treats a released held-parry input as a tap when it Perfect Parries", () => {
    const battle = practice(), [source, target] = battle.state.fighters;
    battle.requestMove(source.id, "D03", "parry-hold"); advance(battle, 1);
    expect(battle.setHold(source.id, false)).toBe(true);
    resolveHits(battle.state, [{sourceId:target.id,targetId:source.id,damage:10,heal:0}], []);
    expect(getJamieState(source)!.action?.variantId).toBe("row-99");
    expect(getJamieState(source)!.action?.duration).toBe(1);
    expect(getJamieState(source)!.parryInvulnerableUntilTick).toBe(7);
  });
});
