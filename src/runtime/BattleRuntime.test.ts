import { getJamieState } from "../characters/jamie/state";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_MATCH_CONFIG } from "../test/fixtures";
import type { BattleConfig } from "../engine/types";
import { BattleRuntime } from "./BattleRuntime";
import { Battle as EngineBattle } from "../engine/Battle";
import { CharacterRegistry } from "../engine/characters";
import { jamieModule } from "../characters/jamie/module";

function running(config: BattleConfig = DEFAULT_CONFIG): BattleRuntime {
  const runtime = new BattleRuntime(config);
  runtime.setLoaded(true);
  runtime.start();
  return runtime;
}

describe("battle clock", () => {
  it("freezes the simulation while paused and resumes without a time jump", () => {
    const runtime = running();
    // Fixed playback steps also include intro freezes, which do not advance tick.
    const step = vi.spyOn(runtime.battle, "step");
    for (let i = 0; i < 60; i += 1) runtime.advance(1 / 60);
    expect(step).toHaveBeenCalledTimes(60);
    const frozen = structuredClone(runtime.getState());
    runtime.togglePause();
    for (let i = 0; i < 120; i += 1) runtime.advance(1 / 60);
    expect(step).toHaveBeenCalledTimes(60);
    expect(runtime.getState()).toEqual(frozen);
    expect(runtime.getSummary().phase).toBe("paused");
    runtime.togglePause();
    runtime.advance(1 / 60);
    expect(step).toHaveBeenCalledTimes(61);
    expect(runtime.getState()).not.toEqual(frozen);
    runtime.dispose();
  });

  it("uses the same fixed steps at 1x and 2x playback", () => {
    const normal = running();
    const fast = running();
    fast.setSpeed(2);
    for (let i = 0; i < 120; i += 1) normal.advance(1 / 60);
    for (let i = 0; i < 60; i += 1) fast.advance(1 / 60);
    expect(normal.getState()).toEqual(fast.getState());
  });

  it("preserves fixed steps across slow and uneven render frames", () => {
    const smooth = running();
    const uneven = running();
    const step = vi.spyOn(uneven.battle, "step");
    for (let frame = 0; frame < 60; frame += 1) smooth.advance(1 / 60);
    for (const delta of [0.2, 0.3, 0.1, 0.4]) uneven.advance(delta);
    expect(step).toHaveBeenCalledTimes(60);
    expect(uneven.getState()).toEqual(smooth.getState());
    smooth.dispose();
    uneven.dispose();
  });

  it("bounds catch-up work and retains the remaining fixed steps", () => {
    const batched = running();
    const smooth = running();
    const step = vi.spyOn(batched.battle, "step");
    for (let frame = 0; frame < 300; frame += 1) smooth.advance(1 / 60);
    batched.advance(5);
    expect(step).toHaveBeenCalledTimes(240);
    expect(batched.alpha).toBeLessThanOrEqual(1);
    batched.advance(0);
    expect(step).toHaveBeenCalledTimes(300);
    expect(batched.getState()).toEqual(smooth.getState());
    batched.dispose();
    smooth.dispose();
  });

  it("ignores non-finite frame deltas without poisoning the clock", () => {
    const runtime = running();
    for (const delta of [NaN, Infinity, -Infinity, -1]) runtime.advance(delta);
    expect(runtime.getState().tick).toBe(0);
    runtime.advance(1 / 60);
    expect(runtime.getState().tick).toBe(1);
    runtime.dispose();
  });

  it("resets all match state while retaining chosen playback speed", () => {
    const runtime = running();
    runtime.setSpeed(2);
    for (let i = 0; i < 90; i += 1) runtime.advance(1 / 60);
    runtime.restart({ ...DEFAULT_CONFIG, seed: 123 }, false);
    expect(runtime.getState().tick).toBe(0);
    expect(runtime.getSummary()).toMatchObject({
      phase: "ready",
      speed: 2,
      seed: 123,
      revision: 1,
      logs: [],
    });
    expect(runtime.getState().projectiles).toHaveLength(0);
    expect(
      runtime.getState().fighters.every((fighter) => fighter.hp === 1500),
    ).toBe(true);
  });
});

describe("Jamie match presentation", () => {
  it("remembers each seat's settings for each plugin when switching characters", () => {
    const second = {
      id: "fixture-plugin", metadata: { ...jamieModule.metadata, name: "Fixture" },
      settings: jamieModule.settings, normalizeSettings: jamieModule.normalizeSettings, stats: jamieModule.stats,
      createState: () => ({}),
      describe: () => ({ intent: "", actionName: "", actionId: null, actionFrame: 0, actionDuration: 0, phaseLabel: "idle", hitCount: 0 }),
    };
    const registry = new CharacterRegistry([jamieModule, second]);
    const runtime = new BattleRuntime(DEFAULT_MATCH_CONFIG, config => new EngineBattle(config, registry));
    runtime.configureFighter(1, { ...runtime.battle.config.fighters[0].settings, cpuLevel: 8 });
    runtime.selectFighter(1, "fixture-plugin");
    runtime.configureFighter(1, { ...runtime.battle.config.fighters[0].settings, cpuLevel: 2 });
    runtime.selectFighter(1, "jamie");
    expect(runtime.battle.config.fighters[0].settings.cpuLevel).toBe(8);
    expect(runtime.battle.config.fighters[1].settings.cpuLevel).toBe(6);
    runtime.selectFighter(1, "fixture-plugin");
    expect(runtime.battle.config.fighters[0].settings.cpuLevel).toBe(2);
    runtime.dispose();
  });

  it("copies STANDARD AI state into summaries and retains difficulty when restarting", () => {
    const runtime = new BattleRuntime(DEFAULT_MATCH_CONFIG);
    runtime.configureFighter(1, { ...runtime.battle.config.fighters[0].settings, cpuLevel: 8 });
    runtime.setLoaded(true);
    runtime.start();
    runtime.advance(0.2);
    const previous = getJamieState(runtime.getSummary().fighters[0])!.standardAI;
    const saved = structuredClone(previous);
    runtime.advance(0.5);
    expect(previous).toEqual(saved);
    expect(getJamieState(runtime.getSummary().fighters[0])!.standardAI).not.toBe(previous);
    runtime.restart(undefined, false);
    expect(runtime.battle.config.fighters[0].settings.cpuLevel).toBe(8);
    expect(getJamieState(runtime.getSummary().fighters[0])!.standardAI.level).toBe(7);
    expect(getJamieState(runtime.getSummary().fighters[0])!.standardAI.selections).toBe(0);
    runtime.dispose();
  });

  it("shows both mirror fighters by player and character with separate resources", () => {
    const runtime = new BattleRuntime(DEFAULT_MATCH_CONFIG);
    const fighters = runtime.getSummary().fighters;
    expect(fighters.map(({ characterId, player, label }) => ({ characterId, player, label }))).toEqual([
      { characterId: "jamie", player: 1, label: "1P 杰米" },
      { characterId: "jamie", player: 2, label: "2P 杰米" },
    ]);
    for (const fighter of fighters) {
      expect(getJamieState(fighter)).toMatchObject({ drinkLevel: 0, drive: 60000, super: 0, action: null });
    }
    expect(getJamieState(fighters[0])).not.toBe(getJamieState(fighters[1]));
    expect(runtime.fighterLabel("p2")).toBe("2P 杰米");
    runtime.dispose();
  });

  it("freezes drink levels and in-flight animation frames while paused", () => {
    const runtime = running(DEFAULT_MATCH_CONFIG);
    for (let i = 0; i < 600; i += 1) {
      runtime.advance(1 / 60);
      if (runtime.getState().fighters.some((fighter) => getJamieState(fighter)?.action)) break;
    }
    expect(runtime.getState().fighters.some((fighter) => getJamieState(fighter)?.action)).toBe(true);
    runtime.pause();
    const frozen = structuredClone(runtime.getState());
    const summary = runtime.getSummary();
    for (let i = 0; i < 120; i += 1) runtime.advance(1 / 60);
    expect(runtime.getState()).toEqual(frozen);
    expect(runtime.getSummary().fighters).toEqual(summary.fighters);
    runtime.togglePause();
    runtime.advance(1 / 60);
    expect(runtime.getState().tick).toBe(frozen.tick + 1);
    expect(getJamieState(summary.fighters[0])).not.toBe(getJamieState(runtime.getState().fighters[0]));
    expect(getJamieState(summary.fighters[0])?.action).toEqual(getJamieState(frozen.fighters[0])?.action);
    runtime.dispose();
  });

  it("produces the same Jamie match at half, double and quadruple speed", () => {
    const normal = running(DEFAULT_MATCH_CONFIG);
    for (let i = 0; i < 1200; i += 1) normal.advance(1 / 60);
    for (const speed of [0.5, 2, 4]) {
      const replay = running(DEFAULT_MATCH_CONFIG);
      replay.setSpeed(speed);
      for (let i = 0; i < 1200 / speed; i += 1) replay.advance(1 / 60);
      expect(replay.getState()).toEqual(normal.getState());
      replay.dispose();
    }
    normal.dispose();
  });

  it("retains selections on restart and clears Jamie resources and action history", () => {
    const runtime = running(DEFAULT_MATCH_CONFIG);
    runtime.setSpeed(2);
    for (let i = 0; i < 300; i += 1) runtime.advance(1 / 60);
    runtime.restart();
    expect(runtime.battle.config.fighters).toEqual(DEFAULT_MATCH_CONFIG.fighters);
    expect(runtime.getSummary()).toMatchObject({ elapsed: 0, speed: 2, logs: [] });
    for (const fighter of runtime.getState().fighters) {
      expect(getJamieState(fighter)).toMatchObject({ drinkLevel: 0, drive: 60000, super: 0, action: null, movesUsed: {} });
    }
    runtime.configureFighter(2, { ...runtime.battle.config.fighters[1].settings, maxHp: 1800, cpuLevel: 2, startDrinkLevel: 3 });
    expect(runtime.getSummary().phase).toBe("ready");
    expect(runtime.getState().tick).toBe(0);
    expect(runtime.getSummary().fighters.map((fighter) => fighter.label)).toEqual(["1P 杰米", "2P 杰米"]);
    expect(runtime.getState().fighters.map(f => f.maxHp)).toEqual([1500, 1800]);
    expect(runtime.battle.config.fighters[0].settings).toEqual(DEFAULT_MATCH_CONFIG.fighters[0].settings);
    runtime.restart();
    expect(getJamieState(runtime.getState().fighters[1])).toMatchObject({ drinkLevel: 3, standardAI: { level: 1 } });
    runtime.dispose();
  });

  it("records every move, drink, interruption and result with mirror identities", () => {
    const runtime = new BattleRuntime(DEFAULT_MATCH_CONFIG);
    vi.spyOn(runtime.battle, "takeEvents").mockReturnValueOnce([
      { type: "move", tick: 1, fighterId: "p1", moveId: "N01", name: "Standing Light Punch", x: 0, y: 0 },
      { type: "move", tick: 20, fighterId: "p1", moveId: "N02", name: "Standing Medium Punch", x: 0, y: 0 },
      { type: "drink", tick: 49, fighterId: "p1", level: 1, x: 0, y: 0 },
      { type: "interrupt", tick: 80, fighterId: "p2", moveId: "S01", label: "饮酒被打断", x: 0, y: 0 },
      { type: "move", tick: 100, fighterId: "p1", moveId: "A01", name: "Breakin'", category: "super", x: 0, y: 0 },
      { type: "finished", tick: 110, winner: "p2", reason: "knockout" },
    ]);
    runtime.advance(0.1);
    const messages = runtime.getSummary().logs.map((log) => log.text);
    expect(messages).toContain("1P 杰米 饮酒完成 · 酒级 1");
    expect(messages).toContain("2P 杰米 饮酒被打断");
    expect(messages).toContain("1P 杰米 · Breakin'");
    expect(messages).toContain("2P 杰米 获胜！（KO）");
    expect(messages).toContain("1P 杰米 · Standing Medium Punch");
    runtime.dispose();
  });
});

function advanceDemonstration(runtime: BattleRuntime, maxFrames = 3000): void {
  for (let i = 0; i < maxFrames && runtime.getState().phase !== "finished"; i += 1) runtime.advance(1 / 60);
  runtime.advance(0.1);
  expect(runtime.getSummary().demonstration?.status).toBe("complete");
}

describe("complete match log", () => {
  it("retains the entire match, reconciles every source, and exports chronological events", () => {
    const runtime = running({ ...DEFAULT_CONFIG, roundTimeSeconds: 30 });
    for (let frame = 0; frame < 6000 && runtime.getState().phase !== "finished"; frame += 1) runtime.advance(1 / 60);
    runtime.advance(0.1);
    expect(runtime.getSummary().phase).toBe("finished");
    const logs = runtime.getSummary().logs;
    expect(logs.length).toBeGreaterThan(7);
    expect(logs.at(-1)?.event.type).toBe("started");
    const exported = JSON.parse(runtime.exportLog());
    expect(exported.config).toEqual(runtime.battle.config);
    expect(exported.logs.map((log: { id: number }) => log.id)).toEqual(logs.map(log => log.id).reverse());
    expect(exported.events.filter((event: { type: string }) => event.type === "move")).toHaveLength(logs.filter(log => log.event.type === "move").length);
    for (const fighter of runtime.getState().fighters) {
      const contacts = logs.flatMap(log => log.event.type === "contact" ? [log.event] : []);
      expect(contacts.filter(event => event.sourceId === fighter.id).reduce((sum, event) => sum + event.amount, 0)).toBe(fighter.damageDealt);
      expect(contacts.filter(event => event.targetId === fighter.id).reduce((sum, event) => sum + event.hpLoss, 0)).toBe(fighter.maxHp - fighter.hp + fighter.healing);
    }
    const snapshot = structuredClone(logs);
    runtime.restart(undefined, false);
    expect(runtime.getSummary().logs).toEqual([]);
    expect(JSON.parse(runtime.exportLog()).events).toEqual([]);
    expect(logs).toEqual(snapshot);
    expect(exported.logs.length).toBeGreaterThan(7);
    runtime.dispose();
  });

  it("records every cinematic segment without throttling and includes defense and healing", () => {
    const runtime = new BattleRuntime(DEFAULT_MATCH_CONFIG);
    runtime.setLoaded(true);
    runtime.demonstrate("row-89");
    advanceDemonstration(runtime);
    const exported = JSON.parse(runtime.exportLog());
    const contacts = runtime.getSummary().logs.flatMap(log => log.event.type === "contact" ? [log.event] : []);
    const hits = exported.events.filter((event: { type: string }) => event.type === "hit");
    expect(contacts.filter(event => event.outcome === "hit").map(event => event.amount).reverse()).toEqual(hits.map((event: { amount: number }) => event.amount));
    expect(contacts.length).toBeGreaterThan(7);
    expect(contacts.every(event => event.variantId && event.name)).toBe(true);
    runtime.demonstrate("row-0", "block");
    advanceDemonstration(runtime);
    expect(runtime.getSummary().logs.some(log => log.category === "defense" && log.event.type === "contact" && log.event.amount === 0)).toBe(true);
    runtime.exitDemonstration(false);
    runtime.start();
    runtime.battle.aiEnabled = false;
    const target = runtime.getState().fighters[1];
    target.hp -= 5; target.recoverableHp = 5; target.lastHitTick = -120;
    runtime.advance(0.1);
    const heals = runtime.getSummary().logs.flatMap(log => log.event.type === "heal" ? [log.event] : []);
    expect(heals.map(event => event.amount).reverse()).toEqual([2, 2, 1]);
    expect(heals.every(event => event.reason === "recoverable" && event.hpAfter! - event.hpBefore! === event.amount)).toBe(true);
    runtime.dispose();
  });
});

describe("move demonstration playback", () => {
  it("prepares the chosen demonstration without advancing until explicitly started", () => {
    const runtime = running(DEFAULT_MATCH_CONFIG);
    runtime.demonstrate("row-0", "block", false);
    expect(runtime.getSummary()).toMatchObject({ mode: "demonstration", phase: "ready", logs: [] });
    expect(runtime.getSummary().demonstration).toMatchObject({ variantId: "row-0", scenario: "block" });
    const prepared = structuredClone(runtime.getState());
    runtime.advance(2);
    expect(runtime.getState()).toEqual(prepared);
    runtime.start();
    advanceDemonstration(runtime);
    expect(runtime.getSummary().demonstration?.outcome).toBe("block");
    runtime.dispose();
  });

  it("restores the chosen automatic matchup without demonstration resources or captured state", () => {
    const config: BattleConfig = { ...DEFAULT_MATCH_CONFIG, seed: 154 };
    const runtime = running(config);
    runtime.setSpeed(0.5);
    runtime.demonstrate("row-89");
    expect(runtime.getSummary().mode).toBe("demonstration");
    expect(runtime.getState().fighters.every((fighter) => fighter.characterId === "jamie")).toBe(true);
    for (let i = 0; i < 240; i += 1) runtime.advance(1 / 60);
    runtime.exitDemonstration(false);
    expect(runtime.battle.config).toEqual(config);
    expect(runtime.getSummary()).toMatchObject({ mode: "battle", phase: "ready", speed: 0.5, elapsed: 0, demonstration: null, superFreezeRemaining: 0, logs: [] });
    expect(getJamieState(runtime.getState().fighters[0])).toMatchObject({ drinkLevel: 0, super: 0, drive: 60000, action: null });
    expect(runtime.getState().fighters.every((fighter) => !fighter.capture)).toBe(true);
    expect(getJamieState(runtime.getState().fighters[1])).toMatchObject({ drinkLevel: 0, super: 0, drive: 60000, action: null });
    runtime.dispose();
  });

  it("pauses super freeze and the confirmed two-fighter cinematic together", () => {
    const runtime = running(DEFAULT_MATCH_CONFIG);
    runtime.demonstrate("row-89");
    for (let i = 0; i < 600 && !(runtime.getState().superFreezeRemaining! > 0); i += 1) runtime.advance(1 / 60);
    expect(runtime.getState().superFreezeRemaining).toBeGreaterThan(0);
    runtime.pause();
    const frozen = structuredClone(runtime.getState());
    for (let i = 0; i < 90; i += 1) runtime.advance(1 / 60);
    expect(runtime.getState()).toEqual(frozen);
    runtime.togglePause();
    for (let i = 0; i < 600 && !runtime.getState().fighters[1].capture; i += 1) runtime.advance(1 / 60);
    expect(runtime.getState().fighters[1].capture).toBeDefined();
    runtime.pause();
    const captured = structuredClone(runtime.getState());
    const summary = runtime.getSummary();
    for (let i = 0; i < 90; i += 1) runtime.advance(1 / 60);
    expect(runtime.getState()).toEqual(captured);
    expect(runtime.getSummary().fighters).toEqual(summary.fighters);
    expect(summary.fighters[1].capture).not.toBe(runtime.getState().fighters[1].capture);
    runtime.togglePause();
    runtime.advance(1 / 60);
    expect(summary.fighters[1].capture).toEqual(captured.fighters[1].capture);
    runtime.dispose();
  });

  it("replays the same complete super at quarter, normal and quadruple speed", () => {
    const replays = [0.25, 1, 4].map((speed) => {
      const runtime = running(DEFAULT_MATCH_CONFIG);
      runtime.setSpeed(speed);
      runtime.demonstrate("row-89");
      advanceDemonstration(runtime, 8000);
      return runtime;
    });
    expect(replays[0].getState()).toEqual(replays[1].getState());
    expect(replays[2].getState()).toEqual(replays[1].getState());
    for (const runtime of replays) runtime.dispose();
  });

  it("reports real hit, block and whiff outcomes and replays the selected variant", () => {
    for (const scenario of ["hit", "block", "whiff"] as const) {
      const runtime = running(DEFAULT_MATCH_CONFIG);
      runtime.setSpeed(4);
      runtime.demonstrate("row-89", scenario);
      const initial = structuredClone(runtime.getState());
      let captured = false;
      for (let i = 0; i < 3000 && runtime.getState().phase !== "finished"; i += 1) {
        runtime.advance(1 / 60);
        captured ||= !!runtime.getState().fighters[1].capture;
      }
      runtime.advance(0.1);
      expect(runtime.getSummary().demonstration).toMatchObject({ variantId: "row-89", status: "complete", scenario, outcome: scenario });
      expect(getJamieState(runtime.getState().fighters[0])?.movesUsed["row-89"]).toBeGreaterThan(0);
      expect(captured).toBe(scenario === "hit");
      if (scenario !== "hit") expect(runtime.getState().fighters[1].hp).toBe(initial.fighters[1].hp);
      runtime.restart();
      expect(runtime.getState()).toEqual(initial);
      expect(runtime.getSummary().mode).toBe("demonstration");
      expect(runtime.getSummary().speed).toBe(4);
      runtime.dispose();
    }
  });
});
