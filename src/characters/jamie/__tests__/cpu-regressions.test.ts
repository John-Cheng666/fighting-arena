import { describe, expect, it } from "vitest";
import { Battle } from "../../../game/Battle";
import { DEFAULT_CONFIG } from "../../../test/fixtures";
import { resolveHits } from "../../../game/combat";
import type { BattleEvent, PendingHit } from "../../../engine/types";
import { AISituation, collectAIEntries, resolveAISituations } from "../../../engine/ai/StandardAI";
import { getJamieState } from "../state";
import { JAMIE_VARIANT_BY_ID } from "../moves";
import { requestJamieMove, updateJamieFighters } from "../combat/actions";
import { canJamieThrowTech, JAMIE_REACTIVE_THROW_TECH_TICKS, JAMIE_THROW_TECH_RECOVERY_TICKS } from "../combat/execution";
import { applyJamieKeys, type JamieAIHost } from "../ai/input";
import { commandCondition } from "../ai/conditions";
import { JAMIE_STANDARD_AI_DATA } from "../ai/data";
import { getJamieSituations, makeJamieAISnapshot } from "../ai/snapshot";

function practice(facing = 1): Battle {
  const battle = new Battle(DEFAULT_CONFIG);
  battle.aiEnabled = false;
  const [source, target] = battle.state.fighters;
  source.x = facing === 1 ? 200 : 500;
  target.x = facing === 1 ? 550 : 150;
  source.y = target.y = 450;
  source.facing = facing;
  target.facing = -facing;
  battle.start();
  return battle;
}

// Candidate enumeration stays broad here; every attempted move uses the real combat gates.
const host: JamieAIHost = { canStart: () => true, requestMove: requestJamieMove };
function snapshot(battle: Battle) {
  return makeJamieAISnapshot(battle.state, ...battle.state.fighters, host.canStart);
}
function keys(battle: Battle, direction: number, buttons = 0): BattleEvent[] {
  const events: BattleEvent[] = [];
  applyJamieKeys(battle.state, battle.state.fighters[0], snapshot(battle), { kind: "keys", direction, buttons }, host, events);
  return events;
}
function motion(battle: Battle, directions: readonly number[], buttons: number): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (const [index, direction] of directions.entries()) {
    battle.state.tick += 1;
    events.push(...keys(battle, direction, index === directions.length - 1 ? buttons : 0));
  }
  return events;
}
function frames(battle: Battle, count: number): void {
  for (let index = 0; index < count; index += 1) battle.step();
}

describe("CPU super inputs", () => {
  const superCancels = [
    { group: "190", item: "sf6:1270", starterMove: "U06", starter: "row-24", drink: 1, variant: "row-87", hpRatio: 1, motion: [2, 3, 6, 2, 3, 6], buttons: 0x80 },
    { group: "192", item: "sf6:1276", starterMove: "S02", starter: "row-39", drink: 0, variant: "row-89", hpRatio: 1, motion: [2, 3, 6, 2, 3, 6], buttons: 0x40 },
    { group: "192", item: "sf6:1277", starterMove: "S02", starter: "row-39", drink: 0, variant: "row-90", hpRatio: 0.25, motion: [2, 3, 6, 2, 3, 6], buttons: 0x40 },
    { group: "191", item: "sf6:1275", starterMove: "S02", starter: "row-45", drink: 0, variant: "row-88", hpRatio: 1, motion: [2, 1, 4, 2, 1, 4], buttons: 0x20 },
  ] as const;

  function connectedStarter(testCase: typeof superCancels[number], facing = 1): Battle {
    const battle = practice(facing), [source, target] = battle.state.fighters;
    target.x = source.x + facing * 50;
    source.hp = source.maxHp * testCase.hpRatio;
    getJamieState(source)!.drinkLevel = testCase.drink;
    getJamieState(source)!.super = 30000;
    expect(battle.requestMove(source.id, testCase.starterMove, testCase.starter)).toBe(true);
    frames(battle, JAMIE_VARIANT_BY_ID[testCase.starter].startup);
    expect(getJamieState(source)!.action?.connected).toBe(true);
    expect(source.hits).toBeGreaterThan(0);
    battle.takeEvents();
    return battle;
  }

  it.each([
    ["190", "sf6:1270", "row-87", 1], ["191", "sf6:1275", "row-88", 1],
    ["192", "sf6:1276", "row-89", 1], ["192", "sf6:1277", "row-90", 0.25],
  ] as const)("executes installed branch %s as %s/%s with its original abbreviated motion", (group, item, variantId, hpRatio) => {
    for (const facing of [1, -1]) {
      const battle = practice(facing);
      battle.aiEnabled = true;
      const [source, target] = battle.state.fighters;
      const jamie = getJamieState(source)!;
      source.hp = source.maxHp * hpRatio;
      jamie.super = 30000;
      jamie.standardAI.currentItemId = item;
      jamie.standardAI.branchGroup = group;
      getJamieState(target)!.nextDecisionTick = Number.MAX_SAFE_INTEGER;
      frames(battle, 8);
      expect(jamie.action?.variantId).toBe(variantId);
      expect(jamie.super).toBe(30000 - JAMIE_VARIANT_BY_ID[variantId].superCost);
      expect(battle.takeEvents().filter(event => event.type === "move")).toEqual([
        expect.objectContaining({ type: "move", fighterId: "p1", variantId, category: "super" }),
      ]);
    }
  });

  it.each(superCancels)("keeps installed $variant super cancellation ahead of $starter follow-ups", (testCase) => {
    for (const facing of [1, -1]) {
      const battle = connectedStarter(testCase, facing), [source, target] = battle.state.fighters;
      const jamie = getJamieState(source)!;
      jamie.standardAI.currentItemId = testCase.item;
      jamie.standardAI.branchGroup = testCase.group;
      getJamieState(target)!.nextDecisionTick = Number.MAX_SAFE_INTEGER;
      battle.aiEnabled = true;
      frames(battle, 5);
      expect(jamie.action?.variantId).toBe(testCase.variant);
      expect(jamie.super).toBe(30000 - JAMIE_VARIANT_BY_ID[testCase.variant].superCost);
      expect(battle.takeEvents().filter(event => event.type === "move")).toEqual([
        expect.objectContaining({ type: "move", fighterId: source.id, variantId: testCase.variant, category: "super" }),
      ]);
    }
  });

  it.each(superCancels)("keeps a complete $variant motion ahead of $starter follow-ups", (testCase) => {
    const battle = connectedStarter(testCase);
    for (const [index, direction] of testCase.motion.entries()) {
      battle.step();
      keys(battle, direction, index === testCase.motion.length - 1 ? testCase.buttons : 0);
    }
    const jamie = getJamieState(battle.state.fighters[0])!;
    expect(jamie.action?.variantId).toBe(testCase.variant);
    expect(jamie.super).toBe(30000 - JAMIE_VARIANT_BY_ID[testCase.variant].superCost);
  });

  it.each([superCancels[0], superCancels[1]])("keeps the ordinary $starter follow-up without a super motion", (testCase) => {
    const battle = connectedStarter(testCase);
    frames(battle, 5);
    keys(battle, 6, testCase.buttons);
    const jamie = getJamieState(battle.state.fighters[0])!;
    expect(jamie.action?.variantId).toBe(testCase.starter === "row-24" ? "row-25" : "row-47");
    expect(jamie.super).toBe(30000);
  });

  it.each([0, 20000])("keeps a legal Freeflow follow-up when a complete SA3 motion has only %s SA", (superGauge) => {
    const testCase = superCancels[1], battle = connectedStarter(testCase);
    const jamie = getJamieState(battle.state.fighters[0])!;
    jamie.super = superGauge;
    for (const [index, direction] of testCase.motion.entries()) {
      battle.step();
      keys(battle, direction, index === testCase.motion.length - 1 ? testCase.buttons : 0);
    }
    expect(jamie.action?.variantId).toBe("row-47");
    expect(jamie.super).toBe(superGauge);
  });

  it.each([
    [[2, 3, 6, 2, 3, 6], 0x80, "row-87"],
    [[2, 1, 4, 2, 1, 4], 0x20, "row-88"],
    [[2, 3, 6, 2, 3, 6], 0x40, "row-89"],
  ] as const)("retains complete super input %j", (directions, buttons, variantId) => {
    const battle = practice();
    getJamieState(battle.state.fighters[0])!.super = 30000;
    motion(battle, directions, buttons);
    expect(getJamieState(battle.state.fighters[0])!.action?.variantId).toBe(variantId);
  });

  it.each([
    [[2, 3, 6], 0x40], [[2, 6, 2, 6], 0x40], [[2, 3, 6, 4, 6], 0x40],
    [[2, 1, 4], 0x20], [[2, 4, 2, 4], 0x20], [[2, 1, 4, 6, 4], 0x20],
    [[2, 1, 4, 2, 4], 0x80],
  ] as const)("does not reinterpret incomplete, malformed or wrong-button input %j as a super", (directions, buttons) => {
    const battle = practice();
    const jamie = getJamieState(battle.state.fighters[0])!;
    jamie.super = 30000;
    expect(motion(battle, directions, buttons).some(event => event.type === "move" && event.category === "super")).toBe(false);
    expect(jamie.super).toBe(30000);
  });

  it("retains resource, stun and cancel gates for an otherwise valid shortcut", () => {
    for (const gate of ["resource", "stun", "cancel"] as const) {
      const battle = practice();
      const source = battle.state.fighters[0];
      const jamie = getJamieState(source)!;
      jamie.super = gate === "resource" ? 0 : 30000;
      if (gate === "stun") source.stunUntilTick = 100;
      if (gate === "cancel") battle.requestMove(source.id, "N01", "row-0");
      const before = jamie.super;
      expect(motion(battle, [2, 3, 6, 2, 6], 0x40).some(event => event.type === "move" && event.category === "super")).toBe(false);
      expect(jamie.super).toBe(before);
    }
  });

  it("expires the first quarter-circle after the motion-history window", () => {
    const battle = practice();
    const jamie = getJamieState(battle.state.fighters[0])!;
    jamie.super = 30000;
    motion(battle, [2, 3, 6], 0);
    battle.state.tick += 36;
    expect(motion(battle, [2, 6], 0x40).some(event => event.type === "move" && event.category === "super")).toBe(false);
    expect(jamie.super).toBe(30000);
  });
});

describe("CPU Parry inputs and observations", () => {
  it.each([0, 0x20, 0x100])("releases held Parry when its two-button chord becomes %s", (buttons) => {
    const battle = practice();
    const jamie = getJamieState(battle.state.fighters[0])!;
    keys(battle, 5, 0x120);
    frames(battle, 3);
    keys(battle, 5, buttons);
    expect(jamie.action?.held).toBe(false);
    expect(jamie.action?.duration).toBe(36);
    frames(battle, 7);
    keys(battle, 5);
    expect(battle.setHold("p1", false)).toBe(true);
    expect(battle.setHold("p1", true)).toBe(false);
    expect(jamie.action?.duration).toBe(36);
    frames(battle, 25);
    expect(jamie.action).not.toBeNull();
    frames(battle, 1);
    expect(jamie.action).toBeNull();
  });

  it.each([false, true])("reports a held Perfect Parry to AJST and expires its observation (projectile=%s)", (projectile) => {
    const battle = practice();
    const jamie = getJamieState(battle.state.fighters[0])!;
    keys(battle, 4, 0x120);
    frames(battle, 1);
    const events: BattleEvent[] = [];
    resolveHits(battle.state, [{ sourceId: "p2", targetId: "p1", damage: 10, heal: 0, projectile }], events);
    expect(events).toContainEqual(expect.objectContaining({ type: "block", perfect: true, parry: true }));
    expect(jamie.action?.variantId).toBe("parry-hold");
    expect(jamie.action?.held).toBe(true);
    expect(commandCondition("AJST", snapshot(battle))).toBe(true);
    const duration = JAMIE_VARIANT_BY_ID[projectile ? "row-100" : "row-99"].duration;
    frames(battle, duration);
    expect(commandCondition("AJST", snapshot(battle))).toBe(true);
    frames(battle, 1);
    expect(commandCondition("AJST", snapshot(battle))).toBe(false);
    expect(jamie.action?.held).toBe(true);
  });

  it("drops a held Perfect Parry observation immediately on interruption", () => {
    const battle = practice();
    keys(battle, 4, 0x120);
    frames(battle, 1);
    resolveHits(battle.state, [{ sourceId: "p2", targetId: "p1", damage: 10, heal: 0 }], []);
    expect(commandCondition("AJST", snapshot(battle))).toBe(true);
    resolveHits(battle.state, [{ sourceId: "p2", targetId: "p1", damage: 10, heal: 0, throw: true }], []);
    expect(getJamieState(battle.state.fighters[0])!.action).toBeNull();
    expect(commandCondition("AJST", snapshot(battle))).toBe(false);
  });

  it("does not report an ordinary held Parry as Perfect Parry", () => {
    const battle = practice();
    keys(battle, 4, 0x120);
    frames(battle, 3);
    const events: BattleEvent[] = [];
    resolveHits(battle.state, [{ sourceId: "p2", targetId: "p1", damage: 10, heal: 0 }], events);
    expect(events).toContainEqual(expect.objectContaining({ type: "block", perfect: false, parry: true }));
    expect(commandCondition("AJST", snapshot(battle))).toBe(false);
  });
});

describe("CPU jump direction observations", () => {
  it.each([
    ["jump", "forward", 1], ["jump-neutral", "neutral", 0], ["jump-back", "back", -1],
  ] as const)("reports %s before and after an airborne attack without changing its facing or momentum", (id, direction, movement) => {
    for (const facing of [1, -1]) {
      const battle = practice(facing);
      const source = battle.state.fighters[0];
      expect(battle.requestMove(source.id, "jump", id)).toBe(true);
      frames(battle, 9);
      expect(snapshot(battle).self.jumpDirection).toBe(direction);
      expect(Math.sign(source.vx)).toBe(movement * facing || 0);
      const { vx, vy } = source;
      expect(battle.requestMove(source.id, "N13", "row-12")).toBe(true);
      frames(battle, 1);
      expect(snapshot(battle).self.jumpDirection).toBe(direction);
      expect(source.vx).toBeCloseTo(vx);
      expect(source.vy).toBeCloseTo(vy);
      expect(source.facing).toBe(facing);
      expect(Math.sign(getJamieState(source)!.action!.directionX)).toBe(facing);
      frames(battle, 40);
      expect(snapshot(battle).self.jumpDirection).toBe("neutral");
    }
  });
});

describe("CPU normal-throw capture observations", () => {
  it.each(["row-91", "row-92"])("routes %s's captured defender into the native caught-throw situation", (id) => {
    const battle = practice();
    const [source, target] = battle.state.fighters;
    source.x = 290;
    target.x = 340;
    expect(battle.requestMove(source.id, JAMIE_VARIANT_BY_ID[id].moveId, id)).toBe(true);
    frames(battle, 5);
    expect(target.capture?.sourceId).toBe(source.id);
    for (let frame = 5; frame < 20; frame += 1) {
      const observed = makeJamieAISnapshot(battle.state, target, source, host.canStart);
      expect(observed.self.caughtInNormalThrow).toBe(true);
      expect(observed.self.knockedDown).toBe(false);
      expect(observed.self.canAct).toBe(false);
      expect(observed.opponent.recovering).toBe(false);
      expect(resolveAISituations(JAMIE_STANDARD_AI_DATA, getJamieSituations(observed))).toEqual([AISituation.NormalThrowCatched]);
      frames(battle, 1);
    }
  });

  it("does not classify a confirmed cinematic as a techable normal throw", () => {
    const battle = practice();
    const [source, target] = battle.state.fighters;
    source.x = 290;
    target.x = 340;
    getJamieState(source)!.super = 30000;
    battle.requestMove(source.id, "A03", "row-89");
    // The super's introduction freezes the battle clock before its first active frame.
    for (let steps = 0; battle.state.tick < 10 && steps < 100; steps += 1) battle.step();
    expect(target.capture).toBeDefined();
    const observed = makeJamieAISnapshot(battle.state, target, source, host.canStart);
    expect(observed.self.caughtInNormalThrow).toBe(false);
    expect(getJamieSituations(observed)).not.toContain(AISituation.NormalThrowCatched);
    expect(battle.requestMove(target.id, "T01", "row-91")).toBe(false);
  });
});

function capturedThrow(variantId = "row-91", attackerSeat = 0, defenderVariantId?: string) {
  const battle = practice();
  const source = battle.state.fighters[attackerSeat];
  const target = battle.state.fighters[1 - attackerSeat];
  source.x = 290;
  target.x = 340;
  for (const fighter of [source, target]) {
    const jamie = getJamieState(fighter)!;
    jamie.drive = 30000;
    jamie.super = 1000;
    jamie.driveRecoveryWait = 120;
    jamie.nextDecisionTick = Number.MAX_SAFE_INTEGER;
  }
  if (defenderVariantId) {
    const variant = JAMIE_VARIANT_BY_ID[defenderVariantId];
    expect(battle.requestMove(target.id, variant.moveId, variant.id)).toBe(true);
  }
  const variant = JAMIE_VARIANT_BY_ID[variantId];
  expect(battle.requestMove(source.id, variant.moveId, variantId)).toBe(true);
  frames(battle, 5);
  expect(target.capture?.sourceId).toBe(source.id);
  return { battle, source, target };
}

describe("CPU reactive normal-throw tech", () => {
  it.each([0, JAMIE_REACTIVE_THROW_TECH_TICKS - 1, JAMIE_REACTIVE_THROW_TECH_TICKS])("maps the local latch hitstop and THROW_ESCAPE interval at capture age %s", (age) => {
    for (const variantId of ["row-91", "row-92"]) {
      const { battle, target } = capturedThrow(variantId);
      frames(battle, age);
      const legal = age < JAMIE_REACTIVE_THROW_TECH_TICKS;
      expect(canJamieThrowTech(battle.state, target)).toBe(legal);
      expect(battle.requestMove(target.id, "T01", "row-91")).toBe(legal);
      expect(Boolean(target.capture)).toBe(!legal);
    }
  });

  it.each([0, 1])("releases both seats without damage, resource rewards or a delayed finish (attacker seat %s)", (seat) => {
    const { battle, source, target } = capturedThrow("row-91", seat);
    const participants = [source, target].map(fighter => ({
      fighter, jamie: getJamieState(fighter)!, hp: fighter.hp,
      drive: getJamieState(fighter)!.drive, super: getJamieState(fighter)!.super,
    }));
    for (const { jamie } of participants) jamie.standardAI.cooldowns.preserved = 41;
    expect(battle.requestMove(target.id, "N01", "row-0")).toBe(false);
    expect(battle.requestMove(source.id, "N01", "row-0")).toBe(false);
    expect(battle.requestMove(target.id, "T02", "row-92")).toBe(true);
    for (const { fighter, jamie, hp, drive, super: superGauge } of participants) {
      expect(fighter.capture).toBeUndefined();
      expect(fighter.hp).toBe(hp);
      expect(fighter.damageDealt).toBe(0);
      expect(jamie.drive).toBe(drive);
      expect(jamie.super).toBe(superGauge);
      expect(jamie.action).toBeNull();
      expect(jamie.comboCount).toBe(0);
      expect(jamie.standardAI.currentItemId).toBeNull();
      expect(jamie.standardAI.cooldowns.preserved).toBe(41);
      expect(fighter.stunUntilTick).toBe(battle.state.tick + JAMIE_THROW_TECH_RECOVERY_TICKS);
      expect(fighter.knockdownUntilTick).toBe(battle.state.tick);
    }
    expect(battle.requestMove(target.id, "T01", "row-91")).toBe(false);
    frames(battle, JAMIE_VARIANT_BY_ID["row-91"].nativeCapture!.duration + 5);
    expect(source.hp).toBe(source.maxHp);
    expect(target.hp).toBe(target.maxHp);
    expect(source.damageDealt + target.damageDealt).toBe(0);
    expect(battle.takeEvents().some(event => event.type === "hit" && event.amount > 0)).toBe(false);
  });

  it("accepts the native LP+LK chord from the captured CPU key path", () => {
    const { battle, target } = capturedThrow("row-92", 1);
    expect(target.id).toBe("p1");
    const events = keys(battle, 1, 0x90);
    expect(target.capture).toBeUndefined();
    expect(events).toContainEqual(expect.objectContaining({ type: "block", fighterId: target.id, parry: false }));
  });

  it("allows a normal attack's startup counter throw to use the native escape flag", () => {
    const { battle, source, target } = capturedThrow("row-91", 0, "row-5");
    expect(getJamieState(source)!.action?.throwPunish).not.toBe(true);
    expect(getJamieState(source)!.action?.normalThrowTechable).toBe(true);
    expect(canJamieThrowTech(battle.state, target)).toBe(true);
    expect(battle.requestMove(target.id, "T01", "row-91")).toBe(true);
    expect(target.capture).toBeUndefined();
    expect(target.hp).toBe(target.maxHp);
  });

  it("keeps a Punish Counter Parry catch on the native untechable branch", () => {
    const { battle, source, target } = capturedThrow("row-91", 0, "parry-hold");
    expect(getJamieState(source)!.action?.normalThrowTechable).toBe(false);
    expect(canJamieThrowTech(battle.state, target)).toBe(false);
    expect(battle.requestMove(target.id, "T01", "row-91")).toBe(false);
    expect(target.capture).toBeDefined();
  });

  it("defers Punish Counter rewards to the authored contacts and unlocks on the native release frame", () => {
    const { battle, source, target } = capturedThrow("row-91", 0, "parry-hold");
    const sourceJamie = getJamieState(source)!;
    const targetJamie = getJamieState(target)!;
    const capture = JAMIE_VARIANT_BY_ID["row-91"].nativePunishCapture!;
    const confirmedAt = sourceJamie.action!.startTick + sourceJamie.action!.confirmedAtFrame!;
    const positiveHits = capture.hits.filter(hit => hit.damage > 0);
    const firstContact = confirmedAt + Math.min(...positiveHits.map(hit => hit.from));
    const lastContact = confirmedAt + Math.max(...positiveHits.map(hit => hit.from));
    const driveBeforeContacts = targetJamie.drive;
    expect(sourceJamie.action?.throwPunish).toBe(true);
    expect(sourceJamie.action?.punishApplied).not.toBe(true);
    expect(sourceJamie.super).toBe(1000);
    expect(targetJamie.drive).toBeGreaterThan(24000);
    expect(target.hp).toBe(target.maxHp);
    frames(battle, firstContact - battle.state.tick - 1);
    expect(sourceJamie.super).toBe(1000);
    expect(targetJamie.drive).toBe(driveBeforeContacts);
    expect(sourceJamie.action?.punishApplied).not.toBe(true);
    expect(target.hp).toBe(target.maxHp);
    frames(battle, 1);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(sourceJamie.super).toBeGreaterThan(1000);
    frames(battle, lastContact - battle.state.tick);
    // Local PC action 722 uses 350/350/1340, with the increase on its final hit.
    // At 90% and the legacy fixture scale these contacts deal 21+21+80.
    expect(target.hp).toBe(target.maxHp - 122);
    expect(sourceJamie.super).toBe(5000);
    expect(target.capture).toBeDefined();
    frames(battle, confirmedAt + capture.releaseFrame - battle.state.tick);
    expect(target.capture).toBeUndefined();
    expect(sourceJamie.action).not.toBeNull();
    frames(battle, confirmedAt + capture.duration - battle.state.tick);
    expect(sourceJamie.action).toBeNull();
  });

  it.each([["sf6:328", true], ["sf6:327", false]] as const)("runs actual caught-throw program %s through capture, selection and input", (itemId, tech) => {
    const { battle, source, target } = capturedThrow();
    const jamie = getJamieState(target)!;
    jamie.standardAI.level = 7;
    jamie.nextDecisionTick = 0;
    const observed = makeJamieAISnapshot(battle.state, target, source, host.canStart);
    const candidates = collectAIEntries(jamie.standardAI, JAMIE_STANDARD_AI_DATA, observed, [AISituation.NormalThrowCatched]);
    const selectedIndex = candidates.findIndex(candidate => candidate.value.id === itemId);
    expect(selectedIndex).toBeGreaterThanOrEqual(0);
    const precedingWeight = candidates.slice(0, selectedIndex).reduce((sum, candidate) => sum + candidate.weight, 0);
    const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    const selectionRoll = (precedingWeight + candidates[selectedIndex].weight / 2) / totalWeight;
    let rolls = 0;
    const random = () => rolls++ === 0 ? selectionRoll : 0.99999; // Then sample the longest native three-frame delay.
    const events: BattleEvent[] = [];
    for (let index = 0; index < 4; index += 1) {
      battle.state.tick += 1;
      const hits: PendingHit[] = [];
      updateJamieFighters(battle.state, battle.config, random, hits, events);
      resolveHits(battle.state, hits, events);
      if (index < 3) expect(jamie.standardAI.currentItemId).toBe(itemId);
    }
    expect(events.some(event => event.type === "block" && !event.parry)).toBe(tech);
    expect(Boolean(target.capture)).toBe(!tech);
    expect(jamie.standardAI.currentItemId).toBe(tech ? null : itemId);
    expect(source.hp).toBe(source.maxHp);
    expect(target.hp).toBe(target.maxHp);
    expect(getJamieState(source)!.super).toBe(1000);
    expect(jamie.super).toBe(1000);
    if (tech) {
      frames(battle, JAMIE_VARIANT_BY_ID["row-91"].nativeCapture!.duration + 5);
      expect(target.hp).toBe(target.maxHp);
    } else {
      const capture = JAMIE_VARIANT_BY_ID["row-91"].nativeCapture!;
      frames(battle, capture.duration + 5);
      expect(target.hp).toBeLessThan(target.maxHp);
    }
  });
});
