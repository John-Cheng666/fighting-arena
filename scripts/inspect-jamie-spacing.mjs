import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" });
try {
  const { Battle } = await server.ssrLoadModule("/src/game/Battle.ts");
  const { BOUNDS } = await server.ssrLoadModule("/src/engine/systems/movement.ts");
  const diagonal = 90 / Math.SQRT2;
  const positions = {
    horizontal: [300, 440, 390, 440],
    "horizontal-reversed": [390, 440, 300, 440],
    "vertical-down": [350, 380, 350, 470],
    "vertical-up": [350, 470, 350, 380],
    "diagonal-ne": [320, 460, 320 + diagonal, 460 - diagonal],
    "diagonal-nw": [400, 460, 400 - diagonal, 460 - diagonal],
    "diagonal-sw": [400, 380, 400 - diagonal, 380 + diagonal],
    "diagonal-se": [320, 380, 320 + diagonal, 380 + diagonal],
    "left-wall": [BOUNDS.left, 330, BOUNDS.left, 420],
    "right-wall": [BOUNDS.right, 530, BOUNDS.right, 440],
    "vertical-far-down": [350, BOUNDS.top, 350, BOUNDS.bottom],
    "vertical-far-up": [350, BOUNDS.bottom, 350, BOUNDS.top],
  };
  const results = [];
  for (const level of [6, 8]) for (const seed of [42, 428003]) for (const [geometry, initialPositions] of Object.entries(positions)) {
    const selection = () => ({ characterId: "jamie", settings: { cpuLevel: level } });
    const battle = new Battle({ seed, fighters: [selection(), selection()] });
    const [a, b] = battle.state.fighters;
    [a.x, a.y, b.x, b.y] = initialPositions;
    let firstContactTick = null, lastContactTick = 0, longestContactGap = 0, hits = 0, blocks = 0;
    battle.start();
    for (let steps = 0; steps < 18000 && battle.state.phase === "running"; steps++) {
      battle.step();
      for (const event of battle.takeEvents()) if (event.type === "hit" || event.type === "block") {
        firstContactTick ??= event.tick;
        longestContactGap = Math.max(longestContactGap, event.tick - lastContactTick);
        lastContactTick = event.tick;
        if (event.type === "hit") hits++; else blocks++;
      }
      for (const fighter of [a, b]) {
        if (![fighter.x, fighter.y, fighter.hp, fighter.height].every(Number.isFinite)
          || fighter.x < BOUNDS.left || fighter.x > BOUNDS.right || fighter.y < BOUNDS.top || fighter.y > BOUNDS.bottom) {
          throw new Error(`Invalid arena state ${level}/${seed}/${geometry}`);
        }
      }
    }
    longestContactGap = Math.max(longestContactGap, battle.state.tick - lastContactTick);
    results.push({ level, seed, geometry, initialPositions, firstContactTick, longestContactGap, hits, blocks,
      tick: battle.state.tick, result: battle.state.result, hp: [a.hp, b.hp] });
  }
  const failures = results.filter(result => result.result !== "knockout" || result.hits === 0
    || result.firstContactTick === null || result.firstContactTick > 600 || result.longestContactGap >= 1200);
  const report = { generatedAt: new Date().toISOString(), matches: results.length,
    maxFirstContactTick: Math.max(...results.map(result => result.firstContactTick ?? Infinity)),
    maxContactGap: Math.max(...results.map(result => result.longestContactGap)), failures, results };
  await mkdir(new URL("../research/", import.meta.url), { recursive: true });
  await writeFile(new URL("../research/jamie-spacing-validation.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ matches: report.matches, maxFirstContactTick: report.maxFirstContactTick,
    maxContactGap: report.maxContactGap, failures: report.failures }, null, 2));
  if (failures.length) throw new Error(`${failures.length} spacing regression(s)`);
} finally {
  await server.close();
}
