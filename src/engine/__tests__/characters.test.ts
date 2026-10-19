import { describe, expect, it, vi } from "vitest";
import { Battle } from "../Battle";
import { CharacterRegistry, type CharacterModule } from "../characters";
import { resolveHits } from "../systems/damage";
import { resolveVictory } from "../systems/victory";
import type { BattleEvent } from "../types";

function character(id: string): CharacterModule {
  return {
    id, metadata: { name: id, tag: id, description: id, color: "#ffffff", portrait: "" },
    settings: [{ key: "hp", label: "HP", default: 1000, kind: "number", min: 1, max: 10000, step: 1 }],
    normalizeSettings: (settings = {}) => ({ hp: settings.hp ?? 1000 }),
    stats: (settings) => ({ maxHp: Number(settings.hp), radius: 20, speed: 100 }),
    createState: () => ({ frames: 0 }),
    step: ({ actors }) => { for (const fighter of actors) (fighter.characterState as { frames: number }).frames += 1; },
    describe: (_state, fighter) => ({ intent: fighter.characterId, actionName: "", actionId: null, actionFrame: 0, actionDuration: 0, phaseLabel: "idle", hitCount: 0 }),
  };
}

describe("pluggable character kernel", () => {
  it("runs unrelated modules without built-in character state and calls each selected module once", () => {
    const alpha = character("alpha"), beta = character("beta");
    const a = vi.spyOn(alpha, "step"), b = vi.spyOn(beta, "step");
    const battle = new Battle({ seed: 42, fighters: ["alpha", "beta"] }, new CharacterRegistry([alpha, beta]));
    battle.start(); battle.step();
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0].actors.map(f => f.id)).toEqual(["p1"]);
    expect(b.mock.calls[0][0].actors.map(f => f.id)).toEqual(["p2"]);
    expect(battle.state.fighters.map(f => f.characterState)).toEqual([{ frames: 1 }, { frames: 1 }]);
    expect(battle.describe(battle.state.fighters[1]).intent).toBe("beta");
  });

  it("isolates mirror settings, resource state and the caller's configuration", () => {
    const selection = { characterId: "alpha", settings: { hp: 1200 } };
    const battle = new Battle({ seed: 1, fighters: [selection, selection] }, new CharacterRegistry([character("alpha")]));
    selection.settings.hp = 10;
    battle.state.fighters[0].settings.hp = 50;
    expect(battle.config.fighters.map(f => f.settings.hp)).toEqual([1200, 1200]);
    expect(battle.state.fighters[1].settings.hp).toBe(1200);
    expect(battle.state.fighters[0].characterState).not.toBe(battle.state.fighters[1].characterState);
  });

  it("rejects missing, removed and duplicate modules at composition time", () => {
    const registry = new CharacterRegistry([character("alpha")]);
    expect(() => registry.register(character("alpha"))).toThrow();
    expect(() => new Battle({ seed: 1 }, new CharacterRegistry())).toThrow();
    expect(() => new Battle({ seed: 1, fighters: ["missing", "alpha"] }, registry)).toThrow();
  });

  it("dispatches defense and contact hooks and settles simultaneous lethal hits together", () => {
    const a = character("alpha"), b = character("beta");
    a.onContact = vi.fn(); b.onContact = vi.fn();
    const registry = new CharacterRegistry([a, b]);
    const battle = new Battle({ seed: 1, fighters: ["alpha", "beta"] }, registry);
    battle.start();
    resolveHits(battle.state, [
      { sourceId: "p1", targetId: "p2", damage: 1000, heal: 0 },
      { sourceId: "p2", targetId: "p1", damage: 1000, heal: 100 },
    ], [], registry);
    resolveVictory(battle.state, [], registry);
    expect(battle.state.fighters.map(f => f.hp)).toEqual([0, 0]);
    expect(battle.state.result).toBe("draw");
    expect(a.onContact).toHaveBeenCalledTimes(1); expect(b.onContact).toHaveBeenCalledTimes(1);
    expect(battle.state.fighters.map(f => f.hits)).toEqual([1, 1]);
  });

  it("uses remaining health ratios for timeout with independently configured health", () => {
    const registry = new CharacterRegistry([character("alpha")]);
    const battle = new Battle({ seed: 1, roundTimeSeconds: 30, fighters: [{ characterId: "alpha", settings: { hp: 2000 } }, "alpha"] }, registry);
    battle.start(); battle.state.tick = 1800;
    battle.state.fighters[0].hp = 1000; battle.state.fighters[1].hp = 600;
    resolveVictory(battle.state, [], registry, 1800);
    expect(battle.state.winner).toBe("p2");
  });

  it("attributes same-frame hits and overkill separately from simultaneous healing", () => {
    const registry = new CharacterRegistry([character("alpha")]);
    const battle = new Battle({ seed: 1 }, registry);
    const events: BattleEvent[] = [];
    resolveHits(battle.state, [
      { sourceId: "p1", targetId: "p2", damage: 700, heal: 20, moveId: "first", segment: 0 },
      { sourceId: "p1", targetId: "p2", damage: 600, heal: 0, moveId: "second", segment: 1 },
      { sourceId: "p2", targetId: "p1", damage: 100, heal: 0, moveId: "trade" },
    ], events, registry);
    expect(events.filter(event => event.type === "contact").map(({ moveId, amount, hpLoss, hpBefore, hpAfter }) => ({ moveId, amount, hpLoss, hpBefore, hpAfter }))).toEqual([
      { moveId: "first", amount: 700, hpLoss: 700, hpBefore: 1000, hpAfter: 300 },
      { moveId: "second", amount: 600, hpLoss: 300, hpBefore: 300, hpAfter: 0 },
      { moveId: "trade", amount: 100, hpLoss: 100, hpBefore: 1000, hpAfter: 900 },
    ]);
    expect(events.filter(event => event.type === "heal")).toMatchObject([{ amount: 20, hpBefore: 900, hpAfter: 920 }]);
    expect(battle.state.fighters.map(fighter => fighter.hp)).toEqual([920, 0]);
  });

  it("logs cinematic survival at one HP and the final committed damage", () => {
    const registry = new CharacterRegistry([character("alpha")]);
    const battle = new Battle({ seed: 1 }, registry);
    const target = battle.state.fighters[1];
    target.capture = { sourceId: "p1", moveId: "super", untilTick: 100, phase: "combo" };
    const events: BattleEvent[] = [];
    resolveHits(battle.state, [{ sourceId: "p1", targetId: "p2", damage: 1200, heal: 0, capturedHit: true }], events, registry);
    expect(events.find(event => event.type === "contact")).toMatchObject({ amount: 1200, hpLoss: 999, hpAfter: 1 });
    resolveHits(battle.state, [{ sourceId: "p1", targetId: "p2", damage: 100, heal: 0, finish: true }], events, registry);
    expect(events.filter(event => event.type === "contact").at(-1)).toMatchObject({ amount: 100, hpLoss: 1, hpBefore: 1, hpAfter: 0 });
  });
});
