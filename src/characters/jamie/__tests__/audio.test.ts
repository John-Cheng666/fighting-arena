import { describe, expect, it } from "vitest";
import { Battle } from "../../../game/Battle";
import { createDemonstration } from "../../../game/training";
import { resolveHits } from "../../../game/combat";
import type { Battle as EngineBattle } from "../../../engine/Battle";
import type { BattleEvent, ContactEvent } from "../../../engine/types";
import type { AudioCatalog, CharacterAudio } from "../../../content/audio/types";
import catalogData from "../../../content/audio/catalog.json";
import audioData from "../data/audio.json";
import { DEFAULT_MATCH_CONFIG } from "../../../test/fixtures";
import { getJamieState } from "../state";

const sounds = audioData as CharacterAudio;
const catalog = catalogData as AudioCatalog;
type AudioEvent = Extract<BattleEvent, { type: "audio" }>;
const isAudio = (event: BattleEvent): event is AudioEvent => event.type === "audio";
const isContact = (event: BattleEvent): event is ContactEvent => event.type === "contact";
// ExtraSE21600 exists only in contact tables, never as an action SEKey. Its
// source chain is native trigger3776759653 -> Wwise event2868938745.
const soundIds = (soundId: number) => new Set(soundId === 21600
  ? Object.keys(catalog.clips).filter(id => id.startsWith("event-2868938745-"))
  : Object.values(sounds.actions).flatMap(action => action.cues.filter(cue => cue.soundId === soundId).map(cue => cue.clipId)));
const bySound = (events: BattleEvent[], soundId: number) => events.filter(isAudio).filter(event => soundIds(soundId).has(event.clipId));
const contacts = (events: BattleEvent[]) => events.filter(isContact);
const contactAudio = (events: BattleEvent[]) => events.filter(isAudio).filter(event => event.scope?.startsWith("contact:"));

function practice() {
  const battle = new Battle(DEFAULT_MATCH_CONFIG);
  battle.aiEnabled = false;
  for (const [index, fighter] of battle.state.fighters.entries()) {
    fighter.x = fighter.previousX = 290 + index * 50;
    fighter.y = fighter.previousY = 450;
    fighter.vx = fighter.vy = 0;
  }
  battle.start();
  return battle;
}

function steps(battle: EngineBattle, count: number, events: BattleEvent[] = []) {
  for (let i = 0; i < count; i++) { battle.step(); events.push(...battle.takeEvents()); }
  return events;
}

function demonstrate(id: string, scenario: "hit" | "block" | "whiff" = "hit") {
  const battle = createDemonstration("jamie", id, DEFAULT_MATCH_CONFIG, scenario);
  const events: BattleEvent[] = [];
  for (let i = 0; i < 2400 && battle.demonstration?.status !== "complete"; i++) {
    battle.step();
    events.push(...battle.takeEvents());
  }
  expect(battle.demonstration?.status).toBe("complete");
  const start = events.findIndex(event => event.type === "move" && event.variantId === id);
  expect(start).toBeGreaterThanOrEqual(0);
  return { battle, events: events.slice(start) };
}

describe("Jamie audio from actual action and collision execution", () => {
  it.each(["row-68", "row-85"])("adds %s's ExtraSE21600 once on contact and never on whiff", id => {
    const landed = demonstrate(id);
    expect(landed.battle.demonstration?.outcome).toBe("hit");
    const hits = contacts(landed.events).filter(event => event.outcome === "hit");
    expect(hits).toHaveLength(1);
    const extra = bySound(landed.events, 21600).filter(event => event.scope?.startsWith("contact:"));
    expect(extra).toHaveLength(1);
    expect(extra[0].tick).toBe(hits[0].tick);
    const missed = demonstrate(id, "whiff");
    expect(missed.battle.demonstration?.outcome).toBe("whiff");
    expect(contacts(missed.events)).toHaveLength(0);
    expect(contactAudio(missed.events)).toHaveLength(0);
    expect(bySound(missed.events, 21600)).toHaveLength(0);
  });

  it("switches missed heavy Arrow Kick to recovery 973 before any successful continuation", () => {
    const { events, battle } = demonstrate("row-73", "whiff");
    expect(battle.demonstration?.outcome).toBe("whiff");
    expect(bySound(events, 21239)).toHaveLength(1);
    expect(bySound(events, 21239)[0].scope).toContain("arrow-miss");
    expect(bySound(events, 21233)).toHaveLength(0);
    expect(bySound(events, 21234)).toHaveLength(0);
    expect(contactAudio(events)).toHaveLength(0);
  });

  it("starts dive landing audio at each actual landing, with different light/heavy flight lengths", () => {
    const offsets: number[] = [];
    for (const id of ["row-75", "row-77"]) {
      const battle = createDemonstration("jamie", id, DEFAULT_MATCH_CONFIG, "whiff");
      let start = -1, landing = -1;
      const events: BattleEvent[] = [];
      for (let i = 0; i < 1500 && battle.demonstration?.status !== "complete"; i++) {
        battle.step();
        const batch = battle.takeEvents();
        const action = getJamieState(battle.state.fighters[0])!.action;
        if (batch.some(event => event.type === "move" && event.variantId === id)) {
          start = action!.startTick;
          landing = getJamieState(battle.state.fighters[0])!.jumpUntilTick;
        }
        events.push(...batch);
      }
      const cues = bySound(events, 20).filter(event => event.scope?.includes("dive-land"));
      expect(cues).toHaveLength(1);
      expect(cues[0].tick).toBe(landing + 1); // Landing row's authored cue is at local frame 1.
      expect(cues[0].tick).toBeGreaterThan(start);
      offsets.push(cues[0].tick - start);
    }
    expect(offsets).toEqual([21, 33]);
  });

  it.each(["row-83", "row-84"])("plays %s capture frame zero immediately and stops its unconfirmed startup track", id => {
    const { events } = demonstrate(id);
    const capture = events.find(event => event.type === "cinematic" && event.phase === "combo")!;
    expect(capture).toBeDefined();
    const latch = bySound(events, 257).filter(event => event.scope?.includes("capture:"));
    expect(latch).toHaveLength(1);
    expect(latch[0].tick).toBe(capture.tick);
    expect(bySound(events, 420)).toHaveLength(0);
    const afterCapture = events.filter(isAudio).filter(event => event.tick >= capture.tick);
    expect(afterCapture.some(event => /action:(982|990)/.test(event.scope ?? ""))).toBe(false);
    expect(afterCapture.some(event => event.scope?.endsWith(":victim"))).toBe(true);
  });

  it("preserves SA1's intro cue while the game tick is frozen and sounds every actual one of its 13 contacts", () => {
    const battle = createDemonstration("jamie", "row-87", DEFAULT_MATCH_CONFIG);
    const events: BattleEvent[] = [];
    for (let i = 0; i < 4; i++) { battle.step(); events.push(...battle.takeEvents()); }
    expect(battle.state.tick).toBe(0);
    expect(bySound(events, 21300)).toHaveLength(1);
    for (let i = 0; i < 1400 && battle.demonstration?.status !== "complete"; i++) {
      battle.step(); events.push(...battle.takeEvents());
    }
    const actual = contacts(events).filter(event => event.variantId === "row-87" && event.outcome === "hit");
    const audible = contactAudio(events);
    expect(actual).toHaveLength(13);
    expect(new Set(actual.map(event => event.segment)).size).toBe(13);
    expect(audible.map(event => event.tick)).toEqual(actual.map(event => event.tick));
    expect(bySound(events, 21300)).toHaveLength(1);
    expect(bySound(events, 21302).map(event => event.tick)).toEqual([1]); // Raw55 crosses the intro boundary exactly once.
  });

  it("preserves repeated native intro cues regardless of when the renderer drains the frozen-tick queue", () => {
    function frozenIntro(drainEveryStep: boolean) {
      const battle = createDemonstration("jamie", "row-87", DEFAULT_MATCH_CONFIG);
      const events: BattleEvent[] = [];
      // The original SA1 intro schedules the same selected foot event at raw
      // frames15,32,54. These are three real cues although combat tick stays0.
      for (let i = 0; i < 55; i++) {
        battle.step();
        if (drainEveryStep) events.push(...battle.takeEvents());
      }
      if (!drainEveryStep) events.push(...battle.takeEvents());
      expect(battle.state.tick).toBe(0);
      expect(battle.state.superFreezeRemaining).toBe(0);
      return events.filter(isAudio).map(event => ({ clipId: event.clipId, fighterId: event.fighterId, tick: event.tick, scope: event.scope }));
    }
    const eachFrame = frozenIntro(true);
    const oneBatch = frozenIntro(false);
    const foot = sounds.actions[1200].cues.find(cue => cue.frame === 15 && cue.soundId === 1)!.clipId;
    expect(eachFrame.filter(cue => cue.clipId === foot)).toHaveLength(3);
    expect(oneBatch).toEqual(eachFrame);
  });

  it.each([["row-89", 21333, 21334, 21330], ["row-90", 21343, 21344, 21340]] as const)(
    "keeps %s's full confirmed source and victim audio tracks without replaying startup", (id, main, paired, startup) => {
      const { events } = demonstrate(id);
      expect(bySound(events, startup)).toHaveLength(1);
      expect(bySound(events, main)).toHaveLength(1);
      expect(bySound(events, paired)).toHaveLength(1);
      expect(bySound(events, main)[0].scope).toContain("capture:");
      const victim = events.filter(isAudio).filter(event => event.fighterId === "p2" && event.scope?.endsWith(":victim"));
      expect(victim.length).toBeGreaterThan(3);
      expect(victim.some(event => event.tick > bySound(events, main)[0].tick + 100)).toBe(true);
      const captureAt = bySound(events, main)[0].tick;
      expect(events.filter(isAudio).some(event => event.tick >= captureAt && /action:(1211|1215)/.test(event.scope ?? ""))).toBe(false);
    },
  );

  it("emits no future move cues after the opponent actually interrupts startup", () => {
    const battle = practice();
    expect(battle.requestMove("p1", "S04", "row-68")).toBe(true);
    expect(battle.requestMove("p2", "N01", "row-0")).toBe(true);
    const events = steps(battle, 100);
    expect(events.some(event => event.type === "interrupt" && event.fighterId === "p1" && event.moveId === "S04")).toBe(true);
    expect(bySound(events, 21220)).toHaveLength(1);
    expect(bySound(events, 21221)).toHaveLength(0);
  });

  it("keeps the first held gulp at host frame 47 even when released at frame 30", () => {
    const battle = practice();
    expect(battle.requestMove("p1", "S01", "row-38-hold-4")).toBe(true);
    const events = steps(battle, 30);
    expect(battle.setHold("p1", false)).toBe(true);
    steps(battle, 100, events);
    expect(bySound(events, 21293).map(event => event.tick)).toEqual([47]);
    expect(getJamieState(battle.state.fighters[0])!.drinkLevel).toBe(1);
  });

  it("repeats held-drink gulps on their action cycles and emits the actual level-four upgrade once", () => {
    const held = practice();
    held.requestMove("p1", "S01", "row-38-hold-4");
    const heldEvents = steps(held, 260);
    expect(bySound(heldEvents, 21293).map(event => event.tick)).toEqual([47, 95, 143, 191]);
    expect(bySound(heldEvents, 21299)).toHaveLength(1);
    expect(getJamieState(held.state.fighters[0])!.drinkLevel).toBe(4);
    const single = practice();
    getJamieState(single.state.fighters[0])!.drinkLevel = 3;
    single.requestMove("p1", "S01", "row-38");
    const events = steps(single, 180);
    const drink = events.find(event => event.type === "drink");
    expect(bySound(events, 21299)).toHaveLength(1);
    expect(bySound(events, 21299)[0].tick).toBe(drink?.tick);
  });

  it.each([0, 4])("branches held SA1 from drink level %s onto its drink action without later base cues", level => {
    const battle = practice();
    const source = battle.state.fighters[0];
    getJamieState(source)!.drinkLevel = level;
    getJamieState(source)!.super = 30000;
    expect(battle.requestMove("p1", "A01", "row-87-drink")).toBe(true);
    const events = steps(battle, 900);
    expect(bySound(events, 21311)).toHaveLength(1);
    expect(bySound(events, 21312)).toHaveLength(1);
    expect(bySound(events, 21315)).toHaveLength(1);
    expect(bySound(events, 21311)[0].scope).toContain("sa1-drink");
    expect(bySound(events, 21305)).toHaveLength(1); // Base raw75 only; raw129 belongs to the abandoned branch.
    expect(bySound(events, 21306)).toHaveLength(0);
    expect(bySound(events, 21309)).toHaveLength(0);
  });

  it("plays the complete automatic forward-throw drink track and actual level-four upgrade once", () => {
    const battle = practice();
    getJamieState(battle.state.fighters[0])!.drinkLevel = 3;
    expect(battle.requestMove("p1", "T01", "row-91")).toBe(true);
    const events = steps(battle, 300);
    for (const id of [21163, 21164]) {
      const cues = bySound(events, id).filter(event => event.scope?.endsWith(":throw-drink"));
      expect(cues).toHaveLength(1);
    }
    for (const voiceId of [21291, 21294]) {
      expect(events.filter(event => event.type === "voice" && event.voiceId === voiceId && event.scope?.endsWith(":throw-drink"))).toHaveLength(1);
    }
    const drinks = events.filter(event => event.type === "drink");
    expect(drinks).toHaveLength(1);
    expect(bySound(events, 21299).map(event => event.tick)).toEqual([drinks[0].tick]);
    expect(getJamieState(battle.state.fighters[0])!.drinkLevel).toBe(4);
    const missed = demonstrate("row-91", "whiff");
    expect(missed.events.some(event => event.type === "audio" && event.scope?.endsWith(":throw-drink"))).toBe(false);
  });

  it("does not double DI's authored impact with a speculative Type.AUTO contact fallback", () => {
    const { events } = demonstrate("row-95");
    const hits = contacts(events).filter(event => event.variantId === "row-95" && event.outcome === "hit");
    expect(hits).toHaveLength(1);
    expect(catalog.feedback["drive-impact"]).toHaveLength(1);
    for (const id of catalog.feedback["drive-impact"]) {
      expect(events.filter(isAudio).filter(event => event.clipId === id)).toHaveLength(1);
    }
    expect(contactAudio(events)).toHaveLength(0);
    const missed = demonstrate("row-95", "whiff");
    expect(contacts(missed.events)).toHaveLength(0);
    for (const id of catalog.feedback["drive-impact"]) {
      expect(missed.events.filter(isAudio).filter(event => event.clipId === id)).toHaveLength(1);
    }
  });

  it("adds DI guard feedback only on the resolved block", () => {
    const { events } = demonstrate("row-95", "block");
    const blocks = contacts(events).filter(event => event.variantId === "row-95" && event.outcome === "block");
    expect(blocks).toHaveLength(1);
    expect(catalog.feedback["drive-guard"]).toHaveLength(1);
    for (const id of catalog.feedback["drive-guard"]) {
      const cues = events.filter(isAudio).filter(event => event.clipId === id);
      expect(cues).toHaveLength(1);
      expect(cues[0].tick).toBe(blocks[0].tick);
    }
  });

  it("announces armor break on the third resolved strike, after exactly two absorbed DI contacts", () => {
    const battle = practice();
    expect(battle.requestMove("p1", "D01", "row-95")).toBe(true);
    steps(battle, 1);
    const source = battle.state.fighters[0];
    const events: BattleEvent[] = [];
    const strike = { sourceId: "p2" as const, targetId: "p1" as const, damage: 10, heal: 0, nativeAttackId: 15 };
    resolveHits(battle.state, [strike], events);
    resolveHits(battle.state, [strike], events);
    expect(getJamieState(source)!.action?.armorHits).toBe(2);
    const breaks = new Set(catalog.feedback["armor-break"]);
    expect(events.filter(isAudio).filter(event => breaks.has(event.clipId))).toHaveLength(0);
    resolveHits(battle.state, [strike], events);
    expect(getJamieState(source)!.action).toBeNull();
    expect(events.filter(isAudio).filter(event => breaks.has(event.clipId))).toHaveLength(1);
    expect(contacts(events).map(event => event.armor)).toEqual([true, true, false]);
    expect(contacts(events).at(-1)?.armorBreak).toBe(true);
  });
});
