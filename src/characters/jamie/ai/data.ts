import original from "../data/standard-ai.json";
import type { AIEntry, AILevels, AISituation, StandardAIData } from "../../../engine/ai/StandardAI";
import { compileNativeCommands } from "./commands";
import { compileMaskCondition } from "./conditions";
import type { JamieAIInput, JamieAISnapshot } from "./snapshot";

export const JAMIE_AI_SOURCE = original.source;
export const JAMIE_AI_CONFIG = original.config;
export const JAMIE_AI_ROWS = original.rows;
// app.StandardAI constructor: verified PE constant 0x150fadcc0.
export const NATIVE_SITUATION_PRIORITY: readonly AISituation[] = [13,19,21,20,24,25,22,23,2,14,15,16,7,5,9,8,10,11,12,17,18,3,1,6,4,27];
type Entry = AIEntry<JamieAISnapshot, JamieAIInput>;
const levelGroups = Array.from({ length: 8 }, (_, level) => new Set(["0", ...original.rows.filter(row => row.situation === 30 && row.branchId > 0 && row.probability[level] !== 0).map(row => String(row.branchId))]));
export const JAMIE_AI_LEVEL_COMPILATION = levelGroups.map((groups, level) => ({
  level: level + 1, groups: groups.size - 1,
  rejectedRows: original.rows.filter(row => row.probability[level] !== 0 && [...row.command.matchAll(/"(\d+)"/g)].some(match => !groups.has(match[1]))).map(row => row.index),
}));
export const JAMIE_AI_COMPILE_DIAGNOSTICS: { index: number; command: string; reason: string }[] = [];
function commands(row: typeof original.rows[number]): Entry["commands"] {
  try { return compileNativeCommands(row.command, row); }
  catch (error) {
    JAMIE_AI_COMPILE_DIAGNOSTICS.push({ index: row.index, command: row.command, reason: String(error) });
    return [{ type: "stop" }];
  }
}
const entries: Entry[] = original.rows.map(row => ({
  id: `sf6:${row.index}`, name: ({ 1: "防备地面进攻", 2: "对空 · 留意跳跃", 4: "应对飞行道具", 8: "寻找确反机会", 9: "命中 · 观察后续", 11: "受击 · 等待恢复", 12: "防御 · 等待反击", 13: "倒地 · 等待起身", 16: "起身 · 防备压制", 30: "连段 · 确认后续" } as Record<number,string>)[row.situation] ?? "观察 · 调整步法", situation: row.situation, style: row.style,
  probability: row.probability as unknown as AILevels, cooldown: row.cooldown as unknown as AILevels,
  branchWeight: row.probability as unknown as AILevels, mute: row.mute, breakAtChange: row.breakAtChange,
  enabledLevels: levelGroups.map(groups => [...row.command.matchAll(/"(\d+)"/g)].every(match => groups.has(match[1]))),
  conditions: [compileMaskCondition(row.conditions, row.ngConditions, row.uniqueParams)],
  commands: commands(row),
}));
for (const diagnostic of JAMIE_AI_COMPILE_DIAGNOSTICS) entries[diagnostic.index].mute = true;
const branches: Record<string, Entry[]> = {};
for (const row of original.rows) if (row.situation === 30 && row.branchId > 0) (branches[String(row.branchId)] ??= []).push(entries[row.index]);
export const JAMIE_STANDARD_AI_DATA: StandardAIData<JamieAISnapshot, JamieAIInput> = {
  multiSituation: original.config.IsMultiSituation, checkNGConditions: original.config.IsCheckNGCondition,
  terminatedByBreakFlagOnly: original.config.IsTerminatedCommandByBreakFlagOnly,
  ignoreNonSituation: original.config.IsIgnoreNonSituation, priorityList: NATIVE_SITUATION_PRIORITY,
  situationWeightBias: Object.fromEntries(original.situationWeightBias.map(row => [row.Situation, row.Coefficient])),
  items: entries.filter(entry => entry.situation !== 30), branches,
};
