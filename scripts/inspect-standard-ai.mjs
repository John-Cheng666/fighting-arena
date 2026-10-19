import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" });
try {
  const { Battle } = await server.ssrLoadModule("/src/game/Battle.ts");
  const { DEFAULT_CONFIG } = await server.ssrLoadModule("/src/game/config.ts");
  const { getJamieState } = await server.ssrLoadModule("/src/characters/jamie/state.ts");
  const { JAMIE_AI_COMPILE_DIAGNOSTICS, JAMIE_AI_LEVEL_COMPILATION, JAMIE_AI_ROWS, JAMIE_AI_SOURCE } = await server.ssrLoadModule("/src/characters/jamie/ai/data.ts");
  const results = [];
  for (let level = 1; level <= 8; level++) {
    for (const drink of [0,2,4]) {
      const fighters = [0,1].map(() => ({ characterId: "jamie", settings: { cpuLevel: level, startDrinkLevel: drink } }));
      for (const seed of [42, 428003]) {
        const battle = new Battle({ ...DEFAULT_CONFIG, fighters, seed });
        const events = {};
        const used = new Set();
        let frozenFrames = 0;
        battle.start();
        for (let steps = 0; steps < 12000 && battle.state.phase === "running"; steps++) {
          const frozen = (battle.state.superFreezeRemaining ?? 0) > 0;
          const before = frozen ? JSON.stringify(battle.state.fighters.map((f) => getJamieState(f)?.standardAI)) : "";
          battle.step();
          if (frozen) {
            frozenFrames++;
            if (before !== JSON.stringify(battle.state.fighters.map((f) => getJamieState(f)?.standardAI))) throw new Error("AI advanced during super freeze");
          }
          for (const event of battle.takeEvents()) {
            events[event.type] = (events[event.type] ?? 0) + 1;
            if (event.type === "move") used.add(event.moveId);
          }
          for (const f of battle.state.fighters) {
            if (![f.x, f.y, f.hp, f.height].every(Number.isFinite) || f.hp < 0 || f.hp > f.maxHp) throw new Error(`Invalid fighter state ${level}/${seed}`);
            if (!getJamieState(f)) continue;
            const ai = getJamieState(f).standardAI;
            if (ai.level !== level - 1 || !Number.isFinite(ai.commandFrame) || ai.commandFrame < 0) throw new Error("Invalid controller state");
            if (Object.values(ai.cooldowns).some((count) => !Number.isInteger(count) || count <= 0)) throw new Error("Invalid cooldown");
            if (getJamieState(f).drive < 0 || getJamieState(f).drive > 60000 || getJamieState(f).super < 0 || getJamieState(f).super > 30000 || getJamieState(f).drinkLevel > 4) throw new Error("Resource gate bypassed");
          }
        }
        if (battle.state.phase !== "finished") throw new Error(`Unfinished ${level}/${fighters}/${seed}`);
        results.push({ level, fighters, seed, seconds: battle.state.tick / 60, result: battle.state.result,
          winner: battle.state.winner, hp: battle.state.fighters.map((f) => f.hp), frozenFrames,
          selections: battle.state.fighters.map((f) => getJamieState(f)?.standardAI.selections ?? 0),
          moveIds: [...used].sort(), events });
      }
    }
  }
  const report = { generatedAt: new Date().toISOString(), engine: "STANDARD", levels: 8,
    source: JAMIE_AI_SOURCE, sourceRows: JAMIE_AI_ROWS.length, compilerDiagnostics: JAMIE_AI_COMPILE_DIAGNOSTICS, levelCompilation: JAMIE_AI_LEVEL_COMPILATION,
    adaptation: "Original probabilities/cooldowns/conditions/command strings; host input recognition and geometry adapter.",
    matches: results.length, allFinished: true, results };
  await mkdir(new URL("../research/", import.meta.url), { recursive: true });
  await writeFile(new URL("../research/standard-ai-validation.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ matches: results.length, levels: 8, allFinished: true,
    levelsObserved: [...new Set(results.map((r) => r.level))],
    moveIds: [...new Set(results.flatMap((r) => r.moveIds))].sort(),
    sourceRows: report.sourceRows, compilerDiagnostics: report.compilerDiagnostics, boundedResourcesAndCooldowns: true, superFreezePreservesAI: true }, null, 2));
} finally {
  await server.close();
}
