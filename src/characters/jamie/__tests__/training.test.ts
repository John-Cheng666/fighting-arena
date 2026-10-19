import { describe, expect, it } from "vitest";
import { createDemonstration } from "../../../game/training";
import { DEFAULT_MATCH_CONFIG } from "../../../test/fixtures";
import type { Battle } from "../../../engine/Battle";
import type { BattleConfig, BattleEvent } from "../../../engine/types";
import { JAMIE_VARIANT_BY_ID } from "../moves";
import { getJamieState } from "../state";

function finish(battle: Battle, events: BattleEvent[] = []): BattleEvent[] {
  for (let step = 0; step < 1500 && battle.demonstration?.status !== "complete"; step++) {
    battle.step();
    events.push(...battle.takeEvents());
  }
  expect(battle.demonstration?.status).toBe("complete");
  return events;
}

describe("Jamie demonstration prerequisites", () => {
  it.each([75, 79, 83, 85, 26, 29, 32, 37])("earns the required drink level before demonstrating row %s", (row) => {
    const variant = JAMIE_VARIANT_BY_ID[`row-${row}`];
    const battle = createDemonstration("jamie", variant.id, DEFAULT_MATCH_CONFIG);
    const source = battle.state.fighters[0];
    expect(getJamieState(source)!.drinkLevel).toBe(0);
    const events = finish(battle);
    const targetIndex = events.findIndex(event => event.type === "move" && event.variantId === variant.id);
    expect(targetIndex).toBeGreaterThan(0);
    const drinks = events.slice(0, targetIndex).filter(event => event.type === "drink");
    expect(drinks.every(event => event.fighterId === source.id)).toBe(true);
    expect(drinks.map(event => event.level)).toEqual(Array.from({ length: variant.drinkMin }, (_, index) => index + 1));
    expect(battle.demonstration?.startedAtTick).toBeGreaterThanOrEqual(drinks.at(-1)!.tick);
    expect(battle.demonstration?.outcome).toBe(variant.damage === 0 && !variant.throw ? "success" : "hit");
  });

  it("keeps a locked move in preparation until drinking and its recovery finish", () => {
    const battle = createDemonstration("jamie", "row-75", DEFAULT_MATCH_CONFIG);
    const source = battle.state.fighters[0];
    for (let step = 0; step < 48; step++) battle.step();
    expect(getJamieState(source)!.drinkLevel).toBe(0);
    expect(getJamieState(source)!.action?.moveId).toBe("S01");
    expect(battle.demonstration?.status).toBe("preparing");
    battle.step();
    expect(getJamieState(source)!.drinkLevel).toBe(1);
    expect(getJamieState(source)!.action?.moveId).toBe("S01");
    expect(getJamieState(source)!.movesUsed["jump"]).toBeUndefined();
    const events = finish(battle);
    const drink = events.find(event => event.type === "drink")!;
    const jump = events.find(event => event.type === "move" && event.variantId === "jump")!;
    expect(jump.tick).toBeGreaterThan(drink.tick);
    expect(battle.demonstration?.outcome).toBe("hit");
  });

  it("retries a drink interrupted before completion instead of skipping the prerequisite", () => {
    const battle = createDemonstration("jamie", "row-79", DEFAULT_MATCH_CONFIG);
    const [source, target] = battle.state.fighters;
    const events: BattleEvent[] = [];
    for (let step = 0; step < 10; step++) battle.step();
    expect(getJamieState(source)!.action?.moveId).toBe("S01");
    expect(battle.requestMove(target.id, "N01", "row-0")).toBe(true);
    finish(battle, events);
    expect(events.some(event => event.type === "interrupt" && event.fighterId === source.id && event.moveId === "S01")).toBe(true);
    const targetIndex = events.findIndex(event => event.type === "move" && event.variantId === "row-79");
    expect(targetIndex).toBeGreaterThan(0);
    expect(events.slice(0, targetIndex).filter(event => event.type === "drink").map(event => event.level)).toEqual([1, 2]);
    expect(battle.demonstration?.outcome).toBe("hit");
  });

  it.each(["hit", "block", "whiff"] as const)("preserves the %s scenario after drinking and attack prerequisites", (scenario) => {
    const battle = createDemonstration("jamie", "row-28", DEFAULT_MATCH_CONFIG, scenario);
    finish(battle);
    expect(battle.demonstration?.outcome).toBe(scenario);
    expect(getJamieState(battle.state.fighters[0])!.movesUsed["row-27"]).toBe(1);
  });

  it("uses a zero-drink practice baseline even when the match is configured at level four", () => {
    const settings = { ...DEFAULT_MATCH_CONFIG.fighters[0].settings, startDrinkLevel: 4 };
    const config: BattleConfig = { ...DEFAULT_MATCH_CONFIG, fighters: [
      { characterId: "jamie", settings }, DEFAULT_MATCH_CONFIG.fighters[1],
    ] };
    const battle = createDemonstration("jamie", "row-39", config);
    expect(getJamieState(battle.state.fighters[0])!.drinkLevel).toBe(0);
    const events = finish(battle);
    expect(events.filter(event => event.type === "drink")).toHaveLength(0);
    expect(battle.demonstration?.outcome).toBe("hit");
    expect(settings.startDrinkLevel).toBe(4);
  });
});
