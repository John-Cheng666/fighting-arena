import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const input = new URL("../research/sf6-ai/fidelity/jamie-standard-ai.json", import.meta.url);
const source = JSON.parse(await readFile(input, "utf8"));
const rows = source.rows.map(row => ({
  index: row.index, situation: row.Situation, style: row.Style, branchId: row.BranchID,
  mute: row.Mute, breakAtChange: row.BreakAtChange,
  probability: row.probability, cooldown: row.cooldown,
  conditions: [row.Condition0, row.Condition1, row.Condition2],
  ngConditions: [row.NGCondition0, row.NGCondition1, row.NGCondition2],
  command: row.Command, doHitStop: row.DoHitStop, doWorldStop: row.DoWorld,
  uniqueParams: row.uniqueParams.map(p => [p.Comp, p.Param]),
}));
const mnemonics = JSON.parse(await readFile(new URL("../research/sf6-ai/fidelity/condition-mnemonics.json", import.meta.url), "utf8"));
const output = { source: { resourcePath: source.source.resourcePath, sha256: source.source.sha256 }, config: source.config, situationWeightBias: source.situationWeightBias, commandTypes: Object.fromEntries(mnemonics.rows.map(row => [row.mnemonic, row.type])), rows };
const serialized = JSON.stringify(output) + "\n";
await writeFile(new URL("../src/characters/jamie/data/standard-ai.json", import.meta.url), serialized, "utf8");
console.log(JSON.stringify({ rows: rows.length, resourceSha256: source.source.sha256, generatedSha256: createHash("sha256").update(serialized).digest("hex") }));
