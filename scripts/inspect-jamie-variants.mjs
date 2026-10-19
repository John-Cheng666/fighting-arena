import { createServer } from "vite";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Independent integration audit: every selectable variant runs through the same
// legal demonstration driver as the UI. Rule-specific assertions live in Vitest.
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" });
try {
  const { createDemonstration } = await server.ssrLoadModule("/src/game/training.ts");
  const { JAMIE_VARIANTS } = await server.ssrLoadModule("/src/characters/jamie/moves.ts");
  const { DEFAULT_MATCH_CONFIG } = await server.ssrLoadModule("/src/game/config.ts");
  const { getJamieState } = await server.ssrLoadModule("/src/characters/jamie/state.ts");
  const results = [];
  const failures = [];
  for (const variant of JAMIE_VARIANTS) {
    for (const scenario of ["hit", "block", "whiff"]) {
      const label = `${variant.id} / ${scenario}`;
      try {
        const battle = createDemonstration("jamie", variant.id, DEFAULT_MATCH_CONFIG, scenario);
        const events = [];
        let maximumCaptureTicks = 0;
        let captureTicks = 0;
        let freezeSteps = 0;
        let steps = 0;
        battle.start();
        for (; steps < 1500 && battle.demonstration?.status !== "complete"; steps++) {
          battle.step();
          events.push(...battle.takeEvents());
          const state = battle.state;
          if ((state.superFreezeRemaining ?? 0) > 0) freezeSteps++;
          captureTicks = state.fighters.some(f => f.capture) ? captureTicks + 1 : 0;
          maximumCaptureTicks = Math.max(maximumCaptureTicks, captureTicks);
          for (const fighter of state.fighters) {
            if (![fighter.x, fighter.y, fighter.hp, fighter.height].every(Number.isFinite)) throw new Error("Non-finite fighter state");
            if (fighter.hp < 0 || fighter.hp > fighter.maxHp) throw new Error("HP out of bounds");
            if (getJamieState(fighter) && (getJamieState(fighter).drive < 0 || getJamieState(fighter).drive > 60000 || getJamieState(fighter).super < 0 || getJamieState(fighter).super > 30000 || getJamieState(fighter).drinkLevel < 0 || getJamieState(fighter).drinkLevel > 4)) throw new Error("Jamie resource out of bounds");
          }
          if (captureTicks > 600) throw new Error("Capture did not release within 10 seconds");
          // Local SA2 owns a124-frame intro; retain headroom for setup actions.
          if (freezeSteps > 240) throw new Error("Unbounded super freeze");
        }
        if (battle.demonstration?.status !== "complete") throw new Error(`Demonstration did not complete (${JSON.stringify(battle.demonstration)})`);
        if (battle.demonstration.outcome === "unavailable") throw new Error("Variant could not be legally demonstrated");
        const attack = variant.active.length > 0 && (variant.damage > 0 || variant.throw);
        const expected = scenario === "block" && variant.throw ? "hit" : scenario;
        if (attack && battle.demonstration.outcome !== expected) throw new Error(`Expected ${expected}, received ${battle.demonstration.outcome}`);
        if (!(getJamieState(battle.state.fighters[0])?.movesUsed[variant.id] > 0)) throw new Error("Requested variant was never executed");
        if (battle.state.fighters.some(f => f.capture || getJamieState(f)?.action?.captureTargetId)) throw new Error("Capture remains after demonstration");
        if ((battle.state.superFreezeRemaining ?? 0) > 0) throw new Error("Freeze remains after demonstration");
        results.push({ variantId: variant.id, moveId: variant.moveId, name: variant.name, scenario, outcome: battle.demonstration.outcome, steps, combatFrames: battle.state.tick, freezeSteps, maximumCaptureTicks, hp: battle.state.fighters.map(f => f.hp), drinkLevels: battle.state.fighters.map(f => getJamieState(f)?.drinkLevel), hits: events.filter(e => e.type === "hit").length, blocks: events.filter(e => e.type === "block").length, legalSequence: events.filter(e => e.type === "move").map(e => e.variantId) });
      } catch (error) {
        failures.push({ variantId: variant.id, scenario, error: String(error?.stack ?? error) });
        console.error(`${label}: ${error.message}`);
      }
    }
  }
  const report = { generatedAt: new Date().toISOString(), variants: JAMIE_VARIANTS.length, scenariosPerVariant: 3, cases: results.length + failures.length, passed: results.length, failures, results };
  await writeFile(new URL("../research/jamie-variant-validation.json", import.meta.url), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ variants: report.variants, cases: report.cases, passed: report.passed, failed: failures.length }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await server.close();
}
