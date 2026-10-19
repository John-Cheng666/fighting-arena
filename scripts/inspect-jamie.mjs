import { createServer } from "vite";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Exercise the real simulation without rendering; results are observational,
// and never substitute for the rule-specific Vitest cases or browser review.
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" });
try {
  const { Battle } = await server.ssrLoadModule("/src/game/Battle.ts");
  const { DEFAULT_CONFIG } = await server.ssrLoadModule("/src/game/config.ts");
  const { getJamieState } = await server.ssrLoadModule("/src/characters/jamie/state.ts");
  const results = [];
  const allMoves = new Set();
  for (const profile of [[1,1,0,0], [3,6,0,0], [6,6,0,0], [8,8,0,0], [8,1,0,0], [6,6,0,4]]) {
    const fighters = [0,1].map(i => ({ characterId: "jamie", settings: { cpuLevel: profile[i], startDrinkLevel: profile[i+2] } }));
    for (const seed of [1, 42, 814, 2026, 428003]) {
      const battle = new Battle({ ...DEFAULT_CONFIG, fighters, seed });
      const events = {};
      const maximumDrink = [0, 0];
      let airborneTicks = 0;
      let simulationSteps = 0;
      let frozenSteps = 0;
      battle.start();
      // Super cinematics pause the combat clock, so real steps can exceed 5400.
      // The independent cap still detects an unbounded freeze or stuck match.
      for (; simulationSteps < 12000 && battle.state.phase === "running"; simulationSteps++) {
        if ((battle.state.superFreezeRemaining ?? 0) > 0) frozenSteps++;
        battle.step();
        for (const event of battle.takeEvents()) {
          events[event.type] = (events[event.type] ?? 0) + 1;
          if (event.type === "move") allMoves.add(event.moveId);
        }
        battle.state.fighters.forEach((fighter, index) => {
          maximumDrink[index] = Math.max(maximumDrink[index], getJamieState(fighter)?.drinkLevel ?? 0);
          if (fighter.height > 0) airborneTicks++;
          if (![fighter.x, fighter.y, fighter.hp, fighter.height].every(Number.isFinite)) throw new Error(`Non-finite state: ${fighters} / ${seed}`);
          if (fighter.hp < 0 || fighter.hp > fighter.maxHp) throw new Error(`Invalid HP: ${fighters} / ${seed}`);
          if (getJamieState(fighter) && (getJamieState(fighter).drive < 0 || getJamieState(fighter).drive > 60000 || getJamieState(fighter).super < 0 || getJamieState(fighter).super > 30000)) throw new Error(`Invalid resources: ${fighters} / ${seed}`);
        });
      }
      if (battle.state.phase !== "finished") throw new Error(`Unfinished match: ${fighters} / ${seed}`);
      results.push({ fighters, seed, seconds: battle.state.tick / 60, simulationSteps, frozenSteps, result: battle.state.result, winnerSeat: battle.state.winner, hp: battle.state.fighters.map(f => Math.round(f.hp)), maximumDrink, airborneTicks, events, movesUsed: battle.state.fighters.map(f => getJamieState(f)?.movesUsed ?? {}) });
    }
  }
  const report = { generatedAt: new Date().toISOString(), matches: results.length, allFinished: true, moveIdsObserved: [...allMoves].sort(), results };
  await writeFile(new URL("../research/jamie-battle-validation.json", import.meta.url), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ matches: report.matches, allFinished: report.allFinished, moveIdsObserved: report.moveIdsObserved }, null, 2));
} finally {
  await server.close();
}
