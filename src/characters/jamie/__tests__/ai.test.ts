import { getJamieState } from "../state";
import { describe, expect, it } from "vitest";
import { Battle } from "../../../game/Battle";
import { DEFAULT_CONFIG } from "../../../test/fixtures";
import { JAMIE_VARIANT_BY_ID } from "../moves";
import { JAMIE_STANDARD_AI_DATA } from "../ai/data";
import { resolveHits } from "../../../game/combat";
import { updateJamieFighters } from "../combat/actions";

describe("Jamie STANDARD AI integration", () => {
  it("maps all eight displayed difficulties into separate per-seat controller state", () => {
    for (let level = 1; level <= 8; level += 1) {
      const battle = new Battle({ ...DEFAULT_CONFIG, fighters: DEFAULT_CONFIG.fighters.map(f => ({ ...f, settings: { ...f.settings, cpuLevel: level } })) as unknown as typeof DEFAULT_CONFIG.fighters });
      const [a, b] = battle.state.fighters;
      expect(getJamieState(a)!.standardAI.level).toBe(level - 1);
      expect(getJamieState(b)!.standardAI.level).toBe(level - 1);
      expect(getJamieState(a)!.standardAI.cooldowns).not.toBe(getJamieState(b)!.standardAI.cooldowns);
    }
    for (const invalid of [0, 9, 1.5, NaN]) expect(() => new Battle({ ...DEFAULT_CONFIG, fighters: [{ characterId: "jamie", settings: { cpuLevel: invalid } }, "jamie"] })).toThrow();
  });

  it("keeps every data-table input tied to a real move and every branch predecessor explicit", () => {
    const entries = [...JAMIE_STANDARD_AI_DATA.items, ...Object.values(JAMIE_STANDARD_AI_DATA.branches).flat()];
    expect(new Set(entries.map((item) => item.id)).size).toBe(entries.length);
    for (const item of entries) {
      expect(item.probability).toHaveLength(8);
      expect(item.cooldown).toHaveLength(8);
      for (const command of item.commands) {
        if (command.type === "input" && command.input.kind === "move") expect(JAMIE_VARIANT_BY_ID[command.input.variantId]).toBeDefined();
        if (command.type === "branch") expect(JAMIE_STANDARD_AI_DATA.branches[command.group]).toBeDefined();
      }
    }
  });

  it("executes the original 5252+LP drink program and keeps it committed", () => {
    const battle = new Battle({ ...DEFAULT_CONFIG, fighters: DEFAULT_CONFIG.fighters });
    const [source, target] = battle.state.fighters;
    source.x = 150; target.x = 580; source.y = target.y = 450;
    getJamieState(source)!.standardAI.currentItemId = "sf6:625";
    getJamieState(target)!.nextDecisionTick = Number.MAX_SAFE_INTEGER;
    battle.start(); for (let i = 0; i < 10; i++) battle.step();
    expect(getJamieState(source)!.action?.moveId).toBe("S01");
    const selections = getJamieState(source)!.standardAI.selections;
    for (let i = 0; i < 49; i += 1) battle.step();
    expect(getJamieState(source)!.drinkLevel).toBe(1);
    expect(getJamieState(source)!.standardAI.selections).toBe(selections);
  });

  it("discards interrupted combo state immediately while preserving cooldown and explicit training inhibition", () => {
    const battle = new Battle({ ...DEFAULT_CONFIG, fighters: DEFAULT_CONFIG.fighters });
    battle.start();
    const source = battle.state.fighters[0];
    getJamieState(source)!.nextDecisionTick = Number.MAX_SAFE_INTEGER;
    battle.requestMove("p1", "S01");
    Object.assign(getJamieState(source)!.standardAI, { currentItemId: "sf6:625", commandIndex: 4, cooldowns: { "sf6:625": 45 } });
    resolveHits(battle.state, [{ sourceId: "p2", targetId: "p1", damage: 10, heal: 0, stun: 12 }], []);
    expect(getJamieState(source)!.standardAI.currentItemId).toBeNull();
    expect(getJamieState(source)!.standardAI.cooldowns["sf6:625"]).toBe(45);
    expect(getJamieState(source)!.nextDecisionTick).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("executes a selected wake-up reversal through the existing resource and knockdown gates", () => {
    const battle = new Battle({ ...DEFAULT_CONFIG, fighters: DEFAULT_CONFIG.fighters.map(f => ({ ...f, settings: { ...f.settings, cpuLevel: 8 } })) as unknown as typeof DEFAULT_CONFIG.fighters });
    battle.start(); battle.state.tick = 20;
    const [source, target] = battle.state.fighters;
    source.x = 290; target.x = 350; source.y = target.y = 450;
    source.knockdownUntilTick = 24; source.stunUntilTick = 50;
    getJamieState(target)!.nextDecisionTick = Number.MAX_SAFE_INTEGER;
    Object.assign(getJamieState(source)!.standardAI, { currentItemId: "sf6:349", branchGroup: "501", commandIndex: 1 });
    updateJamieFighters(battle.state, battle.config, () => 0, [], []);
    expect(getJamieState(source)!.action?.variantId).toBe("row-97");
    expect(getJamieState(source)!.drive).toBe(40000);
    expect(source.knockdownUntilTick).toBe(20);
    expect(source.stunUntilTick).toBe(20);
  });
});

