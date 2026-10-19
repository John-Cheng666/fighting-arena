import { describe, expect, it } from "vitest";
import { Battle } from "../../../game/Battle";
import { DEFAULT_MATCH_CONFIG } from "../../../game/config";
import { JAMIE_AI_COMPILE_DIAGNOSTICS, JAMIE_AI_CONFIG, JAMIE_AI_LEVEL_COMPILATION, JAMIE_AI_ROWS, JAMIE_AI_SOURCE, JAMIE_STANDARD_AI_DATA, NATIVE_SITUATION_PRIORITY } from "../ai/data";
import { compileNativeCommands, NATIVE_KEY_CODES } from "../ai/commands";
import { commandCondition, compileMaskCondition } from "../ai/conditions";
import { makeJamieAISnapshot } from "../ai/snapshot";

function snapshot() {
  const battle = new Battle(DEFAULT_MATCH_CONFIG);
  return makeJamieAISnapshot(battle.state, ...battle.state.fighters, () => false);
}
const zero = ["0x0", "0x0", "0x0"];
const flags = { doHitStop: true, doWorldStop: false };

describe("installed Jamie STANDARD AI resource and translation", () => {
  it("uses the verified local resource, all eight level slots and the native single-situation configuration", () => {
    expect(JAMIE_AI_SOURCE.sha256).toBe("0247c3a38e7e410bdcf92bd2e6d887596418a82d428ebc529d79080440e6b1d5");
    expect(JAMIE_AI_ROWS).toHaveLength(1821);
    expect(JAMIE_AI_COMPILE_DIAGNOSTICS).toEqual([]);
    expect(Object.keys(JAMIE_STANDARD_AI_DATA.branches)).toHaveLength(323);
    expect(JAMIE_AI_CONFIG).toMatchObject({ IsMultiSituation: false, IsIgnoreNonSituation: true, CloseDistance: 100, NearDistance: 200, MiddleDistance: 300 });
    expect(NATIVE_SITUATION_PRIORITY).toEqual([13,19,21,20,24,25,22,23,2,14,15,16,7,5,9,8,10,11,12,17,18,3,1,6,4,27]);
    expect(JAMIE_AI_ROWS[625].command).toBe("5(3)2(3)5(3)2+l1?ANON(100)");
    for (const row of JAMIE_AI_ROWS) { expect(row.probability).toHaveLength(8); expect(row.cooldown).toHaveLength(8); }
  });

  it("applies native difficulty-specific branch translation eligibility before any input is emitted", () => {
    expect(JAMIE_AI_LEVEL_COMPILATION.map(level => level.groups)).toEqual([186,186,194,277,289,320,322,321]);
    expect(JAMIE_AI_LEVEL_COMPILATION.map(level => level.rejectedRows.filter(index => JAMIE_AI_ROWS[index].situation !== 30).length)).toEqual([3,3,11,4,5,0,0,0]);
    expect(JAMIE_AI_LEVEL_COMPILATION.map(level => level.rejectedRows.filter(index => JAMIE_AI_ROWS[index].situation === 30).length)).toEqual([51,51,55,24,27,0,0,0]);
  });

  it("preserves native simultaneous buttons, separate frames, ranged durations and parry encoding", () => {
    expect(NATIVE_KEY_CODES).toMatchObject({ l: 0x10, L: 0x80, d: 0x120, D: 0x240 });
    const commands = compileNativeCommands("5+d6+d5(3-7)6+h+H", flags);
    expect(commands.slice(0,4)).toEqual([
      { type: "button", input: { kind: "keys", direction: 5, buttons: 0x120 }, frames: 1, ...flags },
      { type: "button", input: { kind: "keys", direction: 6, buttons: 0x120 }, frames: 1, ...flags },
      { type: "button", input: { kind: "keys", direction: 5, buttons: 0 }, frames: { min: 3, max: 7 }, ...flags },
      { type: "button", input: { kind: "keys", direction: 6, buttons: 0x240 }, frames: 1, ...flags },
    ]);
  });

  it("recognizes the native five-character OSATK condition before reading a quoted branch", () => {
    const commands = compileNativeCommands('!OSATK"50"?BRCH"52"', flags);
    expect(commands).toHaveLength(3);
    expect(commands[0]).toMatchObject({ type: "predicate", group: "50", frames: 0 });
    expect(commands[1]).toMatchObject({ type: "predicate", group: "52" });
  });

  it("compiles a native loop as a sampled iteration count, including zero for an unbounded loop", () => {
    expect(compileNativeCommands("[(20-40)4(3)]", flags)).toMatchObject([
      { type: "nativeLoop", count: { min: 20, max: 40 }, end: 2 },
      { type: "button", frames: 3 }, { type: "endLoop", begin: 0 }, { type: "stop" },
    ]);
    expect(compileNativeCommands("[4]", flags)[0]).toMatchObject({ type: "nativeLoop", count: 0 });
  });
});

describe("native condition boundaries and host observations", () => {
  it("uses disjoint close/near/middle/far ranges", () => {
    const ss = snapshot();
    for (const [distance, matching] of [[100,"DSTC"],[100.1,"DSTN"],[200,"DSTN"],[200.1,"DSTM"],[300,"DSTM"],[300.1,"DSTF"]] as const) {
      ss.distance = distance;
      expect(["DSTC","DSTN","DSTM","DSTF"].filter(code => commandCondition(code, ss))).toEqual([matching]);
    }
  });

  it("keeps positive distance priority and simultaneous positive/NG SA filtering distinct", () => {
    const ss = snapshot(); ss.distance = 150; ss.self.super = 10000;
    expect(compileMaskCondition(["0x20000","0x0","0x0"],["0x20000","0x0","0x0"],[])(ss)).toBe(true);
    expect(compileMaskCondition(["0x2","0x0","0x0"],["0x2","0x0","0x0"],[])(ss)).toBe(false);
  });

  it("requires all selected opponent pose/action bits and the original unique parameter comparison", () => {
    const ss = snapshot();
    const test = compileMaskCondition(["0x0","0x9","0x0"],zero,[[3,2]]);
    ss.self.drinkLevel = 3; ss.opponent.height = 0; ss.opponent.crouching = false;
    expect(test(ss)).toBe(false);
    ss.opponent.attacking = true;
    expect(test(ss)).toBe(true);
    ss.self.drinkLevel = 1;
    expect(test(ss)).toBe(false);
    expect(compileMaskCondition(zero,zero,[[0,4]])(ss)).toBe(true);
    expect(compileMaskCondition(zero,zero,[[1,4]])(ss)).toBe(false);
  });

  it("preserves native NG-only projectile and combo-scale early returns", () => {
    const ss = snapshot();
    ss.projectile = { vx: 100, vy: 0, time: 0.3, distance: 100, height: 20 };
    expect(compileMaskCondition(zero,["0x2000000","0x0","0x0"],[])(ss)).toBe(true);
    ss.self.comboScale = 0.05;
    expect(compileMaskCondition(zero,["0x0","0x0","0x3"],[])(ss)).toBe(true);
  });
});
