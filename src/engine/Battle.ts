import { createRandom } from "./random";
import { moveFighters, separateFighters } from "./systems/movement";
import { moveProjectiles } from "./systems/projectiles";
import { resolveHits } from "./systems/damage";
import { resolveVictory } from "./systems/victory";
import { CharacterRegistry, type CharacterFrame } from "./characters";
import { validateConfig, type BattleConfig, type BattleEvent, type BattleState, type Fighter,
  type FighterId, type MoveDemonstration, type PendingHit, type ResolvedBattleConfig } from "./types";

/** Character-agnostic fixed-step match kernel. Modules own behavior, resources and input. */
export class Battle {
  readonly config: ResolvedBattleConfig;
  readonly state: BattleState;
  private readonly random: () => number;
  private events: BattleEvent[] = [];
  aiEnabled = true;
  demonstration?: MoveDemonstration;
  private demonstrationDriver?: (battle: Battle) => void;

  constructor(config: BattleConfig, readonly characters: CharacterRegistry) {
    const valid = validateConfig(config);
    const fallback = characters.list()[0]?.id;
    if (!fallback) throw new Error("对局需要至少一个角色模块");
    const choices = valid.fighters ?? [fallback, fallback];
    this.config = { seed: valid.seed, roundTimeSeconds: valid.roundTimeSeconds ?? 99,
      fighters: [characters.normalize(choices[0]), characters.normalize(choices[1])] };
    this.random = createRandom(this.config.seed);
    const create = (id: FighterId, index: 0 | 1): Fighter => {
      const selection = this.config.fighters[index];
      const module = characters.get(selection.characterId);
      const stats = module.stats(selection.settings);
      const x = index === 0 ? 260 : 442;
      const y = index === 0 ? 432 : 448;
      return { id, characterId: module.id, settings: { ...selection.settings }, characterState: module.createState(selection.settings),
        x, y, previousX: x, previousY: y, vx: 0, vy: 0, radius: stats.radius, speed: stats.speed,
        hp: stats.maxHp, maxHp: stats.maxHp, height: 0, facing: index === 0 ? 1 : -1,
        stunUntilTick: 0, knockdownUntilTick: 0, hitUntilTick: 0, attackUntilTick: 0,
        hits: 0, damageDealt: 0, healing: 0 };
    };
    this.state = { tick: 0, phase: "ready", fighters: [create("p1", 0), create("p2", 1)],
      projectiles: [], winner: null, result: null, superFreezeRemaining: 0, superFreezeSourceId: null };
  }

  start(): void {
    if (this.state.phase !== "ready") return;
    this.state.phase = "running";
    this.events.push({ type: "started", tick: 0 });
  }

  private frames(hits: PendingHit[]): { module: ReturnType<CharacterRegistry["get"]>; frame: CharacterFrame }[] {
    return [...new Set(this.state.fighters.map((fighter) => fighter.characterId))].map((id) => ({
      module: this.characters.get(id), frame: { state: this.state, config: this.config,
        actors: this.state.fighters.filter((fighter) => fighter.characterId === id),
        random: this.random, hits, events: this.events, aiEnabled: this.aiEnabled },
    }));
  }

  step(): void {
    if (this.state.phase !== "running") return;
    this.demonstrationDriver?.(this);
    if (this.state.phase !== "running") return;
    if ((this.state.superFreezeRemaining ?? 0) > 0) {
      this.state.superFreezeRemaining! -= 1;
      const source = this.state.fighters.find((fighter) => fighter.id === this.state.superFreezeSourceId);
      if (source) this.characters.get(source.characterId).advanceFreeze?.(source, this.state, this.events);
      return;
    }
    this.state.worldStopped = this.state.fighters.some(fighter => this.characters.get(fighter.characterId).isWorldStopped?.(this.state, fighter));
    if (this.state.worldStopped) this.state.worldStopTicks = (this.state.worldStopTicks ?? 0) + 1;
    if (this.state.worldStopped || this.state.fighters.some(fighter => this.characters.get(fighter.characterId).stopsRoundTimer?.(this.state, fighter))) {
      this.state.roundStopTicks = (this.state.roundStopTicks ?? 0) + 1;
    }
    this.state.tick += 1;
    for (const fighter of this.state.fighters) {
      if (fighter.knockdownUntilTick <= this.state.tick) fighter.hardKnockdown = false;
      if ((fighter.wallSplatUntilTick ?? 0) <= this.state.tick) fighter.wallSplatUntilTick = 0;
      if ((fighter.juggleUntilTick ?? 0) > 0 && fighter.juggleUntilTick! <= this.state.tick) {
        fighter.juggleUntilTick = 0; fighter.juggleSourceId = undefined; fighter.height = 0;
        if (fighter.pendingHardKnockdown) { fighter.knockdownUntilTick = this.state.tick + 45; fighter.hardKnockdown = true; }
        fighter.pendingHardKnockdown = false;
      }
      // Installed SF6 healing consumer: decrement the 120-frame wait, then heal
      // two health on the invocation that reaches zero and each eligible frame.
      if ((fighter.recoverableHp ?? 0) > 0 && this.state.tick >= (fighter.lastHitTick ?? 0) + 120 && fighter.hp > 0 && !fighter.capture) {
        const amount = Math.min(2, fighter.recoverableHp!, fighter.maxHp - fighter.hp);
        fighter.hp += amount; fighter.recoverableHp! -= amount; fighter.healing += amount;
        if (amount > 0) this.events.push({ type: "heal", tick: this.state.tick, targetId: fighter.id, amount, reason: "recoverable", hpBefore: fighter.hp - amount, hpAfter: fighter.hp, x: fighter.x, y: fighter.y - 80 });
      }
    }
    const hits: PendingHit[] = [];
    const modules = this.frames(hits);
    modules.forEach(({ module, frame }) => module.step?.(frame));
    moveFighters(this.state, this.characters);
    moveProjectiles(this.state, hits);
    separateFighters(this.state);
    resolveHits(this.state, hits, this.events, this.characters);
    modules.forEach(({ module, frame }) => module.afterContacts?.(frame));
    modules.forEach(({ module, frame }) => module.endFrame?.(frame));
    resolveVictory(this.state, this.events, this.characters, this.config.roundTimeSeconds * 60);
    if (this.state.result !== null) this.demonstrationDriver?.(this);
  }

  configureDemonstration(metadata: MoveDemonstration, driver: (battle: Battle) => void): void {
    this.aiEnabled = false; this.demonstration = metadata; this.demonstrationDriver = driver;
  }
  takeEvents(): BattleEvent[] { const result = this.events; this.events = []; return result; }
  requestMove(id: FighterId, moveId: string, variantId?: string): boolean {
    const fighter = this.state.fighters.find((candidate) => candidate.id === id);
    return fighter ? this.characters.get(fighter.characterId).requestMove?.(this.state, fighter, moveId, variantId, this.events) ?? false : false;
  }
  setHold(id: FighterId, held: boolean): boolean {
    const fighter = this.state.fighters.find((candidate) => candidate.id === id);
    return fighter ? this.characters.get(fighter.characterId).setHold?.(this.state, fighter, held) ?? false : false;
  }
  describe(fighter: Fighter) { return this.characters.get(fighter.characterId).describe(this.state, fighter); }
}
