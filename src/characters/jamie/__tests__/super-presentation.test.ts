import { describe, expect, it } from "vitest";
import type { Battle } from "../../../engine/Battle";
import type { BattleEvent, ContactEvent } from "../../../engine/types";
import { createDemonstration } from "../../../game/training";
import { BattleRuntime } from "../../../runtime/BattleRuntime";
import { DEFAULT_MATCH_CONFIG } from "../../../test/fixtures";
import { JAMIE_VARIANT_BY_ID } from "../moves";
import { describeJamie, describeJamieSuperContact } from "../presentation";
import { getJamieState } from "../state";

function sample(battle: Battle) {
  const source = battle.state.fighters[0];
  return {
    tick: battle.state.tick,
    phase: getJamieState(source)!.action?.cinematicPhase,
    cinematic: describeJamie(battle.state, source).cinematic,
  };
}

function demonstrate(variantId: string, scenario: "hit" | "block" | "whiff" = "hit") {
  const battle = createDemonstration("jamie", variantId, DEFAULT_MATCH_CONFIG, scenario);
  const samples: ReturnType<typeof sample>[] = [];
  const events: BattleEvent[] = [];
  for (let step = 0; step < 1500 && battle.demonstration?.status !== "complete"; step++) {
    battle.step();
    samples.push(sample(battle));
    events.push(...battle.takeEvents());
  }
  expect(battle.demonstration?.status).toBe("complete");
  const contacts = events.filter((event): event is ContactEvent => event.type === "contact" && event.variantId === variantId);
  return { battle, samples, contacts };
}

const supers = [["row-87", "spin"], ["row-88", "install"], ["row-89", "strike"], ["row-90", "critical"]] as const;
const attacks = ["row-87", "row-87-drink", "row-89", "row-90"] as const;

describe("Jamie super presentation from real execution", () => {
  it.each(supers)("describes %s as %s without altering combat state", (variantId, style) => {
    const battle = createDemonstration("jamie", variantId, DEFAULT_MATCH_CONFIG);
    battle.step();
    const source = battle.state.fighters[0];
    const action = getJamieState(source)!.action!;
    const before = structuredClone(battle.state);
    const status = describeJamie(battle.state, source);
    expect(status.cinematic?.superArt).toMatchObject({
      key: `${source.id}:${action.startTick}:${variantId}`, style,
      frame: 0, confirmed: false, finishing: false, contactFrame: -1, hitCount: 0,
    });
    expect(status.cinematic?.superArt?.duration).toBe(action.duration);
    expect(status.cinematic?.superArt?.introDuration).toBe(JAMIE_VARIANT_BY_ID[variantId].freezeFrames);
    expect(status.cinematic?.superArt?.introFrame).toBeGreaterThan(0);
    expect(battle.state).toEqual(before);
  });

  it.each(supers)("advances %s's presentation clock through the intro and into the action", (variantId) => {
    const battle = createDemonstration("jamie", variantId, DEFAULT_MATCH_CONFIG);
    battle.step();
    const first = sample(battle);
    for (let step = 0; step < 200 && getJamieState(battle.state.fighters[0])!.action!.frame < 1; step++) battle.step();
    const next = sample(battle);
    expect(first.tick).toBe(0);
    expect(first.cinematic?.frame).toBeGreaterThan(0);
    expect(next.tick).toBe(1);
    expect(next.cinematic?.frame).toBeGreaterThan(first.cinematic!.superArt!.introDuration);
    expect(next.cinematic?.superArt?.frame).toBe(1);
    expect(next.cinematic?.superArt?.introFrame).toBe(first.cinematic!.superArt!.introDuration);
  });

  it.each(attacks)("marks only %s's final actual damaging contact as its finisher", (variantId) => {
    const { samples, contacts } = demonstrate(variantId);
    const hits = contacts.filter(event => event.outcome === "hit" && event.amount > 0 && !event.armor && !event.deferred);
    expect(hits.length).toBeGreaterThan(1);
    const finishers = hits.filter(event => describeJamieSuperContact(event)?.finisher);
    expect(finishers).toEqual([hits.at(-1)]);
    const finalHit = finishers[0];
    expect(samples.filter(item => item.tick < finalHit.tick).every(item => !item.cinematic?.superArt?.finishing && !item.cinematic?.finalImpact)).toBe(true);
    const impact = samples.find(item => item.tick === finalHit.tick)!;
    expect(impact.cinematic?.superArt).toMatchObject({ confirmed: true, finishing: true, hitCount: hits.length });
    expect(impact.cinematic?.superArt?.contactFrame).toBe(hits[0].tick);
    expect(impact.cinematic?.finalImpact).toBe(true);
    if (variantId === "row-89" || variantId === "row-90") {
      // Native final damage precedes capture release and its phase="finish" event.
      expect(impact.phase).toBe("combo");
      expect(finalHit.finish).toBe(false);
    }
  });

  it.each(attacks)("never reports a %s finisher on block or whiff", (variantId) => {
    for (const scenario of ["block", "whiff"] as const) {
      const { battle, samples, contacts } = demonstrate(variantId, scenario);
      expect(battle.demonstration?.outcome).toBe(scenario);
      expect(samples.some(item => item.phase === "finish")).toBe(true);
      expect(samples.every(item => !item.cinematic?.superArt?.confirmed && !item.cinematic?.superArt?.finishing && !item.cinematic?.finalImpact)).toBe(true);
      expect(contacts.every(event => describeJamieSuperContact(event)?.finisher === false)).toBe(true);
      if (scenario === "block") {
        expect(contacts.length).toBeGreaterThan(0);
        expect(contacts.every(event => describeJamieSuperContact(event)?.style === (variantId === "row-90" ? "critical" : variantId === "row-89" ? "strike" : "spin"))).toBe(true);
      } else expect(contacts).toEqual([]);
    }
  });

  it("ignores deferred, armored, zero-damage and non-super contacts while retaining shields", () => {
    const { contacts } = demonstrate("row-89");
    const hit = contacts.at(-1)!;
    const before = structuredClone(hit);
    expect(describeJamieSuperContact({ ...hit, deferred: true })).toBeUndefined();
    expect(describeJamieSuperContact({ ...hit, armor: true })).toBeUndefined();
    expect(describeJamieSuperContact({ ...hit, amount: 0 })).toBeUndefined();
    expect(describeJamieSuperContact({ ...hit, variantId: "row-0" })).toBeUndefined();
    expect(describeJamieSuperContact({ ...hit, variantId: undefined })).toBeUndefined();
    expect(describeJamieSuperContact({ ...hit, outcome: "block", amount: 0 })).toEqual({ style: "strike", finisher: false });
    expect(hit).toEqual(before);
  });

  it("holds super clocks on pause, follows slow playback and resets on replay", () => {
    const runtime = new BattleRuntime(DEFAULT_MATCH_CONFIG);
    try {
      runtime.setLoaded(true);
      runtime.demonstrate("row-89");
      runtime.advance(10 / 60);
      runtime.pause();
      const paused = sample(runtime.battle);
      runtime.advance(1);
      expect(sample(runtime.battle)).toEqual(paused);
      runtime.setSpeed(0.25);
      runtime.togglePause();
      runtime.advance(4 / 60);
      expect(sample(runtime.battle).cinematic?.frame).toBe(paused.cinematic!.frame + 1);
      runtime.demonstrate("row-89");
      runtime.advance(4 / 60);
      expect(sample(runtime.battle).cinematic?.superArt).toMatchObject({
        introFrame: 1, frame: 0, confirmed: false, finishing: false, contactFrame: -1, hitCount: 0,
      });
    } finally { runtime.dispose(); }
  });
});
