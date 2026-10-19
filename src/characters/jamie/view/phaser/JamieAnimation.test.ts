import { getJamieState } from "../../state";
import { describe, expect, it } from "vitest";
import { Battle } from "../../../../game/Battle";
import { DEFAULT_MATCH_CONFIG } from "../../../../test/fixtures";
import { JAMIE_VARIANTS, JAMIE_VARIANT_BY_ID } from "../../moves";
import type { JamieAction } from "../../types";
import { JAMIE_RIG_SCALE, sampleJamiePose } from "./JamieAnimation";

function actor(variantId: string, frame: number, extra: Partial<JamieAction> = {}) {
  const fighter = new Battle(DEFAULT_MATCH_CONFIG).state.fighters[0];
  const variant = JAMIE_VARIANT_BY_ID[variantId];
  getJamieState(fighter)!.action = {
    moveId: variant.moveId, name: variant.name, pose: variant.pose, variantId,
    frame, visualFrame: frame, duration: variant.duration, startTick: 0,
    directionX: 1, directionY: 0, hitSegments: [], connected: false,
    blocked: false, drinkApplied: false, armorHits: 0, ...extra,
  };
  return fighter;
}

describe("Jamie authored animation", () => {
  it("gives all eighteen normals different contact silhouettes", () => {
    const contacts = new Set(JAMIE_VARIANTS.slice(0, 18).map((variant) => {
      const fighter = actor(variant.id, variant.active[0][0]);
      return JSON.stringify(sampleJamiePose(fighter, 0, 0, true, false));
    }));
    expect(contacts.size).toBe(18);
  });

  it("keeps every variant's startup, contact and recovery joints finite", () => {
    for (const variant of JAMIE_VARIANTS) for (const frame of [0, variant.startup, variant.duration]) {
      const fighter = actor(variant.id, frame);
      const pose = sampleJamiePose(fighter, 0, 0, true, false);
      for (const value of Object.values(pose)) if (typeof value === "object") {
        expect(Number.isFinite(value.x), `${variant.id} frame ${frame} x`).toBe(true);
        expect(Number.isFinite(value.y), `${variant.id} frame ${frame} y`).toBe(true);
      }
    }
  });

  it("shares SA1's prefix and switches to the local drinking branch after frame65", () => {
    for (const frame of [8, 25, 60]) {
      const normal = sampleJamiePose(actor("row-87", frame), 0, 0, true, false);
      const drink = sampleJamiePose(actor("row-87-drink", frame), 0, 0, true, false);
      expect(drink).toEqual(normal);
    }
    expect(sampleJamiePose(actor("row-87-drink", 100), 0, 0, true, false)).not.toEqual(sampleJamiePose(actor("row-87", 100), 0, 0, true, false));
  });

  it("animates the SA2 intro while combat frame remains frozen", () => {
    const pouring = sampleJamiePose(actor("row-88", 0, { introFrame: 40, introDuration: 100 }), 0, 0, true, false);
    const wiping = sampleJamiePose(actor("row-88", 0, { introFrame: 75, introDuration: 100 }), 0, 0, true, false);
    expect(pouring.gourd).toBe(true);
    expect(pouring.hand.y).toBeLessThan(-115);
    expect(wiping.gourd).toBe(false);
    expect(wiping.hand).not.toEqual(pouring.hand);
  });

  it("finishes the standard SA3 with both feet raised rather than a standing palm", () => {
    const pose = sampleJamiePose(actor("row-89", 220, { confirmedAtFrame: 5, captureTargetId: "p2" }), 0, 0, true, false);
    expect(pose.foot.y).toBeLessThan(-100);
    expect(pose.rearFoot.y).toBeLessThan(-100);
    expect(pose.head.y).toBeGreaterThan(-60);
  });

  it("gives CA a grounded grip and arm retraction instead of the standard double kick", () => {
    const grip = sampleJamiePose(actor("row-90", 190, { confirmedAtFrame: 5, captureTargetId: "p2" }), 0, 0, true, false);
    const finish = sampleJamiePose(actor("row-90", 250, { confirmedAtFrame: 5, captureTargetId: "p2" }), 0, 0, true, false);
    expect(grip.hand.x).toBeGreaterThan(60);
    expect(finish.hand.x).toBeLessThan(10);
    expect(finish.foot.y).toBe(0);
    expect(finish.rearFoot.y).toBe(0);
  });

  it("expands the confirmed cinematic while retaining the ordinary recovery duration", () => {
    const original = sampleJamiePose(actor("row-89", 220, { confirmedAtFrame: 5 }), 0, 0, true, false);
    const expanded = sampleJamiePose(actor("row-89", 435, { confirmedAtFrame: 5, cinematicTimeScale: 2 }), 0, 0, true, false);
    expect(expanded).toEqual(original);
    const originalRecovery = sampleJamiePose(actor("row-89", 262, { confirmedAtFrame: 5 }), 0, 0, true, false);
    const expandedRecovery = sampleJamiePose(actor("row-89", 477, { confirmedAtFrame: 5, cinematicTimeScale: 2 }), 0, 0, true, false);
    expect(expandedRecovery).toEqual(originalRecovery);
  });

  it("synchronizes the captured target's sweep reaction without its own action", () => {
    const source = getJamieState(actor("row-89", 45, { confirmedAtFrame: 5, captureTargetId: "p2" }))!.action!;
    const target = new Battle(DEFAULT_MATCH_CONFIG).state.fighters[1];
    target.capture = { sourceId: "p1", moveId: "A03", untilTick: 300, phase: "combo" };
    const pose = sampleJamiePose(target, 45, 0, true, false, source);
    expect(pose.hip.y).toBeGreaterThan(-25);
    expect(pose.head.y).toBeGreaterThan(-75);
  });

  it("keeps the CA hand on the mirrored victim's neck throughout the held pull", () => {
    for (const facing of [-1, 1]) for (const spacing of [40, 55]) for (const beat of [185, 200, 212, 220, 233, 235]) {
      const frame = 5 + beat * 2;
      const source = actor("row-90", frame, { confirmedAtFrame: 5, cinematicTimeScale: 2, captureTargetId: "p2" });
      source.x = 340; source.y = 450; source.facing = facing;
      const target = new Battle(DEFAULT_MATCH_CONFIG).state.fighters[1];
      target.x = source.x + facing * spacing; target.y = source.y; target.facing = -facing;
      target.capture = { sourceId: "p1", moveId: "A03", untilTick: 600, phase: "combo" };
      const attack = sampleJamiePose(source, frame, 0, true, false);
      const victim = sampleJamiePose(target, frame, 0, true, false, getJamieState(source)!.action!, source);
      const handX = source.x + source.facing * attack.hand.x * JAMIE_RIG_SCALE;
      const handY = source.y - source.height + attack.hand.y * JAMIE_RIG_SCALE;
      const neckX = target.x + target.facing * (victim.head.x - 2) * JAMIE_RIG_SCALE;
      const neckY = target.y - target.height + (victim.head.y + 10) * JAMIE_RIG_SCALE;
      expect(Math.hypot(handX - neckX, handY - neckY), `facing ${facing}, spacing ${spacing}, beat ${beat}`).toBeLessThan(6);
      expect(Math.hypot(victim.head.x - victim.shoulder.x, victim.head.y - victim.shoulder.y)).toBeLessThan(35);
    }
  });
});
