import { describe, expect, it, vi } from "vitest";
import { AISituation as S, collectAIEntries, createStandardAIState, finishStandardAIFrame, sampleCommandDuration, stepStandardAI, type AIEntry, type AILevels, type StandardAIData } from "./StandardAI";

const levels = (n: number): AILevels => [n,n,n,n,n,n,n,n];
const entry = (id: string, situation = S.Standard, overrides: Partial<AIEntry<boolean,string>> = {}): AIEntry<boolean,string> => ({ id, name: id, situation, probability: levels(1), cooldown: levels(0), commands: [{ type: "wait", frames: 30 }], ...overrides });
const data = (items: AIEntry<boolean,string>[]): StandardAIData<boolean,string> => ({ items, branches: {}, multiSituation: true, checkNGConditions: true });
const frame = { snapshot: true, situations: [S.Standard], random: () => 0, input: () => false };

describe("native execution edge cases from local IDA exports", () => {
  it("collects by situation number while preserving table order and suppresses Always with bit 31", () => {
    const table = data([entry("air",S.AntiAir),entry("base-a"),entry("base-b"),entry("always",S.Always)]);
    const ai = createStandardAIState();
    expect(collectAIEntries(ai,table,true,[S.AntiAir,S.Standard]).map(c=>c.value.id)).toEqual(["base-a","base-b","air","always"]);
    expect(collectAIEntries(ai,table,true,[S.Standard],table.items,0x80000001).map(c=>c.value.id)).toEqual(["base-a","base-b"]);
  });

  it("uses a full bitset for Always changes and exempts punish programs from missing-situation breaks", () => {
    const ai = createStandardAIState(), table=data([entry("always",S.Always,{breakAtChange:true})]);
    stepStandardAI(ai,table,{...frame,tick:1,situations:[S.Standard,S.AntiAir]});
    stepStandardAI(ai,table,{...frame,tick:2,situations:[S.AntiAir,S.Standard]});
    expect(ai.selections).toBe(1);
    const punish=data([entry("punish",S.Punish,{breakAtChange:true})]);
    const second=createStandardAIState();
    stepStandardAI(second,punish,{...frame,tick:1,situations:[S.Punish]});
    stepStandardAI(second,punish,{...frame,tick:2});
    expect(second.currentItemId).toBe("punish");
  });

  it("ends an empty branch and does not use the root style-zero fallback inside a branch", () => {
    const table=data([entry("root",S.Standard,{commands:[{type:"branch",group:"only-zero"},{type:"input",input:"wrong"}]})]);
    table.branches={"only-zero":[entry("zero",S.Branch,{style:0})]};
    const ai=createStandardAIState(5,2), input=vi.fn(()=>true);
    stepStandardAI(ai,table,{...frame,tick:1,input});
    expect(ai.currentItemId).toBeNull(); expect(input).not.toHaveBeenCalled();
  });

  it("draws with independent branch tuple weights after the probability-enabled filter", () => {
    const table=data([entry("root",S.Standard,{commands:[{type:"branch",group:"b"}]})]);
    table.branches={b:[entry("off",S.Branch,{probability:levels(0),branchWeight:1000}),entry("a",S.Branch,{probability:levels(1000),branchWeight:1}),entry("b",S.Branch,{branchWeight:1000})]};
    const ai=createStandardAIState();
    stepStandardAI(ai,table,{...frame,tick:1,random:()=>0.5});
    expect(ai.currentItemId).toBe("b");
  });

  it("emits native buttons even when unaccepted and pauses only the command timer during stops", () => {
    const table=data([entry("held",S.Standard,{cooldown:levels(5),commands:[{type:"button",input:"LP",frames:2},{type:"stop"}]})]);
    const ai=createStandardAIState(), input=vi.fn(()=>false);
    stepStandardAI(ai,table,{...frame,tick:1,input}); finishStandardAIFrame(ai,1);
    stepStandardAI(ai,table,{...frame,tick:2,input,hitStop:true}); finishStandardAIFrame(ai,2);
    expect(input).toHaveBeenCalledTimes(2); expect(ai.commandFrame).toBe(1); expect(ai.cooldowns.held).toBe(3);
    stepStandardAI(ai,table,{...frame,tick:3,input});
    expect(ai.commandIndex).toBe(1);
  });

  it("samples the original rounded uint16 duration endpoints without drawing for degenerate ranges", () => {
    expect(sampleCommandDuration({min:3,max:7},()=>0)).toBe(3);
    expect(sampleCommandDuration({min:3,max:7},()=>65535/65536)).toBe(7);
    const random=vi.fn(()=>0);
    expect(sampleCommandDuration({min:7,max:3},random)).toBe(7); expect(random).not.toHaveBeenCalled();
  });

  it("samples a native predicate's duration on entry even when its condition already succeeds", () => {
    const table=data([entry("condition",S.Standard,{commands:[{type:"predicate",test:()=>true,frames:{min:3,max:7}},{type:"button",input:"LP",frames:1}]})]);
    const ai=createStandardAIState(), random=vi.fn(()=>0);
    stepStandardAI(ai,table,{...frame,tick:1,random});
    expect(random).toHaveBeenCalledTimes(2);
  });

  it("counts a native predicate's first unsuccessful frame immediately and only once per phase", () => {
    const table=data([entry("condition",S.Standard,{commands:[{type:"predicate",test:()=>false,frames:3}]})]);
    const ai=createStandardAIState();
    stepStandardAI(ai,table,{...frame,tick:1});
    stepStandardAI(ai,table,{...frame,tick:1,allowSelection:false});
    expect(ai.commandFrame).toBe(1);
    stepStandardAI(ai,table,{...frame,tick:2});
    stepStandardAI(ai,table,{...frame,tick:3});
    expect(ai.currentItemId).toBeNull();
  });
});
