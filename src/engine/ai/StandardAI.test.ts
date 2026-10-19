import { describe, expect, it, vi } from "vitest";
import { AISituation as S, collectAIEntries, createStandardAIState, selectWeighted, stepStandardAI,
  finishStandardAIFrame, type AIEntry, type AILevels, type StandardAIData } from "./StandardAI";

type Snapshot = { ready: boolean };
const levels = (value: number): AILevels => [value, value, value, value, value, value, value, value];
function entry(id: string, overrides: Partial<AIEntry<Snapshot, string>> = {}): AIEntry<Snapshot, string> {
  return { id, name: id, situation: S.Standard, probability: levels(10), cooldown: levels(0),
    commands: [{ type: "input", input: id }, { type: "wait", frames: 20 }], ...overrides };
}
function data(items: AIEntry<Snapshot, string>[]): StandardAIData<Snapshot, string> {
  return { items, branches: {}, multiSituation: true, checkNGConditions: true };
}

describe("recovered STANDARD AI decision and command semantics", () => {
  it("uses the native uint16 inclusive cumulative boundaries and excludes nonpositive weights", () => {
    const candidates = [{ value: "disabled", weight: 0 }, { value: "A", weight: 1 }, { value: "B", weight: 1 }];
    expect(selectWeighted(candidates, () => 0)).toBe("A");
    expect(selectWeighted(candidates, () => 32767 / 65536)).toBe("A");
    expect(selectWeighted(candidates, () => 32768 / 65536)).toBe("B");
    expect(selectWeighted(candidates, () => 65535 / 65536)).toBe("B");
    const random = vi.fn(() => 0);
    expect(selectWeighted([{ value: "none", weight: -5 }], random)).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });

  it("filters conditions, NG masks, cooldowns and style before the style-zero fallback", () => {
    const ai = createStandardAIState(0, 2);
    ai.cooldowns.cooling = 10;
    const table = data([
      entry("wrong-style", { style: 1 }), entry("cooling"), entry("muted", { mute: true }),
      entry("false-condition", { conditions: [(ss) => ss.ready] }),
      entry("forbidden", { ngConditions: [(ss) => !ss.ready] }), entry("fallback", { style: 0 }),
    ]);
    expect(collectAIEntries(ai, table, { ready: false }, [S.Standard]).map((c) => c.value.id)).toEqual(["fallback"]);
    table.checkNGConditions = false;
    expect(collectAIEntries(ai, table, { ready: false }, [S.Standard]).map((c) => c.value.id)).toEqual(["forbidden"]);
  });

  it("selects the configured difficulty slot and truncates the multi-situation coefficient", () => {
    const item = entry("A", { probability: [1, 2, 3, 4, 5, 6, 7, 8] });
    const table = { ...data([item, entry("air", { situation: S.AntiAir })]), situationWeightBias: { [S.Standard]: 0.6 } };
    expect(collectAIEntries(createStandardAIState(0), table, { ready: true }, [S.Standard])).toEqual([]);
    expect(collectAIEntries(createStandardAIState(7), table, { ready: true }, [S.Standard])[0].weight).toBe(4);
    table.multiSituation = false;
    const result = collectAIEntries(createStandardAIState(7), table, { ready: true }, [S.Standard, S.AntiAir]);
    expect(result.map((c) => [c.value.id, c.weight])).toEqual([["A", 8]]);
  });

  it("gives Start an exclusive candidate pool, with Always added during ordinary situations", () => {
    const table = data([entry("start", { situation: S.Start }), entry("normal"), entry("always", { situation: S.Always })]);
    const ai = createStandardAIState();
    expect(collectAIEntries(ai, table, { ready: true }, [S.Start, S.Standard]).map((c) => c.value.id)).toEqual(["start"]);
    expect(collectAIEntries(ai, table, { ready: true }, [S.Standard]).map((c) => c.value.id)).toEqual(["normal", "always"]);
  });

  it("commits a program without rerolling, counts a cooldown once per tick, and isolates seats", () => {
    const ai = createStandardAIState(7);
    const other = createStandardAIState(7);
    const table = data([entry("A", { cooldown: [80, 70, 60, 50, 40, 30, 20, 10] })]);
    const random = vi.fn(() => 0);
    const input = vi.fn(() => true);
    const frame = { snapshot: { ready: true }, situations: [S.Standard], random, input };
    stepStandardAI(ai, table, { ...frame, tick: 1 });
    stepStandardAI(ai, table, { ...frame, tick: 1, allowSelection: false });
    expect(ai.cooldowns.A).toBe(10);
    finishStandardAIFrame(ai, 1);
    finishStandardAIFrame(ai, 1);
    stepStandardAI(ai, table, { ...frame, tick: 2 });
    stepStandardAI(ai, table, { ...frame, tick: 2, allowSelection: false });
    expect(ai.cooldowns.A).toBe(9);
    finishStandardAIFrame(ai, 2);
    expect(other.cooldowns).toEqual({});
    expect(random).toHaveBeenCalledTimes(1);
    expect(input).toHaveBeenCalledTimes(1);
    stepStandardAI(ai, table, { ...frame, tick: 3, interrupted: true });
    expect(ai.currentItemId).toBeNull();
    expect(ai.cooldowns.A).toBe(8);
  });

  it("resumes a hit-confirm branch on the contact phase without a fresh neutral decision", () => {
    const table = data([entry("jab", { commands: [
      { type: "input", input: "jab" }, { type: "wait", until: (ss) => ss.ready },
      { type: "condition", test: (ss) => ss.ready, yes: 3, no: 4 }, { type: "branch", group: "confirm" }, { type: "stop" },
    ] })]);
    table.branches = { confirm: [entry("special", { situation: S.Branch, commands: [{ type: "input", input: "special" }, { type: "stop" }] })] };
    const ai = createStandardAIState();
    const inputs: string[] = [];
    const random = vi.fn(() => 0);
    const frame = { situations: [S.Standard], random, input: (input: string) => { inputs.push(input); return true; } };
    stepStandardAI(ai, table, { ...frame, tick: 1, snapshot: { ready: false } });
    stepStandardAI(ai, table, { ...frame, tick: 2, snapshot: { ready: false } });
    expect(inputs).toEqual(["jab"]);
    stepStandardAI(ai, table, { ...frame, tick: 2, snapshot: { ready: true }, allowSelection: false });
    stepStandardAI(ai, table, { ...frame, tick: 2, snapshot: { ready: true }, allowSelection: false });
    expect(inputs).toEqual(["jab", "special"]);
    expect(random).toHaveBeenCalledTimes(2); // Root selection and the committed branch, rather than per-frame draws.
  });

  it("holds input for the specified frames across repeated collision phases and executes finite loops", () => {
    const table = data([entry("loop", { commands: [
      { type: "loop", count: 3, end: 2 }, { type: "input", input: "pulse", frames: 2 },
      { type: "endLoop", begin: 0 }, { type: "stop" },
    ] })]);
    const ai = createStandardAIState();
    const input = vi.fn(() => true);
    const frame = { snapshot: { ready: true }, situations: [S.Standard], random: () => 0, input };
    for (let tick = 0; tick < 6; tick += 1) {
      stepStandardAI(ai, table, { ...frame, tick });
      stepStandardAI(ai, table, { ...frame, tick, allowSelection: false });
    }
    expect(input).toHaveBeenCalledTimes(6);
    expect(ai.currentItemId).toBeNull();
    expect(ai.loops).toEqual([]);
  });

  it("bounds invalid branch cycles and input rejection instead of stalling the match", () => {
    const table = data([entry("cycle", { commands: [{ type: "branch", group: "cycle" }] })]);
    table.branches = { cycle: [entry("cycle-branch", { situation: S.Branch, commands: [{ type: "branch", group: "cycle" }] })] };
    const ai = createStandardAIState();
    const random = vi.fn(() => 0);
    stepStandardAI(ai, table, { tick: 0, snapshot: { ready: true }, situations: [S.Standard], random, input: () => true });
    expect(ai.currentItemId).toBeNull();
    expect(random.mock.calls.length).toBeLessThanOrEqual(11);
    const rejected = data([entry("rejected", { commands: [{ type: "input", input: "illegal", timeout: 2 }] })]);
    for (let tick = 1; tick <= 3; tick += 1) stepStandardAI(ai, rejected, {
      tick, snapshot: { ready: true }, situations: [S.Standard], random, input: () => false,
    });
    expect(ai.currentItemId).toBeNull();
  });

  it("can break a movement program when its situation disappears", () => {
    const table = data([entry("approach", { breakAtChange: true }), entry("anti-air", { situation: S.AntiAir })]);
    const ai = createStandardAIState();
    const inputs: string[] = [];
    const frame = { snapshot: { ready: true }, random: () => 0, input: (input: string) => { inputs.push(input); return true; } };
    stepStandardAI(ai, table, { ...frame, tick: 1, situations: [S.Standard] });
    stepStandardAI(ai, table, { ...frame, tick: 2, situations: [S.AntiAir] });
    expect(inputs).toEqual(["approach", "anti-air"]);
  });
});
