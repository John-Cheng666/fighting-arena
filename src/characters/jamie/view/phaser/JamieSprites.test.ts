import { getJamieState } from "../../state";
import { describe, expect, it } from "vitest";
import { Battle } from "../../../../game/Battle";
import { DEFAULT_MATCH_CONFIG } from "../../../../test/fixtures";
import { JAMIE_VARIANTS, JAMIE_VARIANT_BY_ID } from "../../moves";
import type { JamieAction } from "../../types";
import { extractJamieSpriteRegions } from "./JamieSpriteAtlas";
import { JAMIE_SPRITE_GROUPS, sampleJamieSpriteMotion, selectJamieSpritePose } from "./JamieSpriteAnimation";
import { placeJamieSprite, type JamieSpriteFrame } from "./JamieSprites";
import spriteManifest from "../../../../../public/assets/jamie/sprites-v3/manifest.json";
import type { JamieSpriteManifest, JamieSpritePoseSpec } from "./JamieSprites";

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

function manifestFrames(): Map<string, JamieSpriteFrame> {
  const specs = (spriteManifest as JamieSpriteManifest).sheets.flatMap((sheet) => sheet.poses.map((pose): JamieSpritePoseSpec => typeof pose === "string" ? { id: pose } : pose));
  return new Map(specs.map((pose) => [pose.id, {
    id: pose.id, texture: pose.id, scale: 124 / 287 * (pose.scale ?? 1), width: 418, height: 313.5,
    anchor: { x: 209, y: 300 }, hand: pose.hand ? { x: pose.hand[0], y: pose.hand[1] } : undefined,
    neck: pose.neck ? { x: pose.neck[0], y: pose.neck[1] } : undefined,
    source: { sheet: "manifest", slot: 0, x: 0, y: 0, width: 418, height: 313.5 },
  }]));
}

describe("Jamie complete figure sprites", () => {
  it("shows a different authored contact pose for each of HP's three active hits", () => {
    for (const level of [0, 4]) {
      const poses = [5, 7, 12].map((frame) => {
        const fighter = actor("row-4", frame); getJamieState(fighter)!.drinkLevel = level;
        return selectJamieSpritePose(fighter, frame);
      });
      expect(new Set(poses).size).toBe(3);
    }
  });

  it("distinguishes the back throw's kick-roll-kick sequence from the front throw", () => {
    const front = [5, 10, 15, 24].map((frame) => selectJamieSpritePose(actor("row-91", frame), frame));
    const back = [5, 10, 15, 24].map((frame) => selectJamieSpritePose(actor("row-92", frame), frame));
    expect(back).toEqual(["throw-knee", "backflip", "reversal-sweep", "flying-side-kick"]);
    expect(back).not.toEqual(front);
  });

  it("switches from Arrow Kick's rising strike to its follow-up flying kick", () => {
    for (const row of [71, 72, 73, 74]) {
      const variant = JAMIE_VARIANT_BY_ID[`row-${row}`];
      const poses = variant.active.map(([frame]) => selectJamieSpritePose(actor(variant.id, frame), frame));
      expect(poses[0]).toBe("arrow-rise");
      expect(new Set(poses).size).toBeGreaterThan(1);
    }
  });

  it("uses continuous strength-specific motion while keeping paired cinematic landmarks stationary", () => {
    const light = sampleJamieSpriteMotion(actor("row-75", 11), 11);
    const heavy = sampleJamieSpriteMotion(actor("row-77", 11), 11);
    expect(light.rotation).not.toBe(heavy.rotation);
    const a = sampleJamieSpriteMotion(actor("row-0", 3), 3);
    const b = sampleJamieSpriteMotion(actor("row-0", 4), 4);
    expect(a.x).not.toBe(b.x);
    expect(sampleJamieSpriteMotion(actor("row-90", 185, { captureTargetId: "p2" }), 185)).toEqual({x:0,y:0,rotation:0});
  });

  it("preserves distinct standing, crouching and airborne normals at both real drink levels", () => {
    for (const level of [0, 4]) {
      const selected = JAMIE_VARIANTS.slice(0, 18).map((variant) => {
        const fighter = actor(variant.id, variant.active[0][0]); getJamieState(fighter)!.drinkLevel = level;
        return selectJamieSpritePose(fighter, 0);
      });
      expect(new Set(selected).size).toBe(18);
      expect(selected.every((id) => id.startsWith("loose-") === (level === 4))).toBe(true);
    }
  });

  it("addresses a complete authored pose for every variant and both hair states", () => {
    const supplied = new Set<string>(Object.values(JAMIE_SPRITE_GROUPS).flat());
    expect(supplied.size).toBe(144);
    for (const variant of JAMIE_VARIANTS) for (const level of [0, 4]) for (const frame of [0, variant.startup, variant.duration]) {
      const fighter = actor(variant.id, frame); getJamieState(fighter)!.drinkLevel = level;
      const pose = selectJamieSpritePose(fighter, 0);
      expect(supplied.has(pose), `${variant.id}, drink ${level}, frame ${frame}: ${pose}`).toBe(true);
    }
  });

  it("keeps the SA2 temporary install on the tied-hair figure", () => {
    const fighter = actor("row-88", 0, { introFrame: 45, introDuration: 100 });
    getJamieState(fighter)!.sa2UntilTick = 900; getJamieState(fighter)!.drinkLevel = 0;
    expect(selectJamieSpritePose(fighter, 0)).toBe("drink-pour");
  });

  it("extracts whole figures even when an upturned foot crosses its grid row", () => {
    const width = 60, height = 80, pixels = new Uint8ClampedArray(width * height * 4);
    const fill = (x1: number, y1: number, x2: number, y2: number) => {
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) pixels[(y * width + x) * 4 + 3] = 255;
    };
    for (let row = 0; row < 4; row++) for (let column = 0; column < 3; column++) {
      if (row === 2 && column === 0) continue;
      fill(column * 20 + 6, row * 20 + 6, column * 20 + 14, row * 20 + 15);
    }
    fill(2, 35, 3, 48); fill(4, 48, 14, 57);
    fill(34, 34, 43, 35);
    const extracted = extractJamieSpriteRegions(pixels, width, height);
    expect(extracted.regions).toHaveLength(12);
    expect(extracted.regions[6].minY).toBe(35);
    expect(extracted.regions[6].maxY).toBe(57);
    expect(extracted.regions[4].maxX).toBe(43);
  });

  it("aligns CA using the selected figure's visible landmarks in either facing", () => {
    const makeFrame = (id: string, extra: Partial<JamieSpriteFrame> = {}): JamieSpriteFrame => ({
      id, texture: id, scale: 0.43, width: 300, height: 310, anchor: { x: 150, y: 300 },
      source: { sheet: "test", slot: 0, x: 0, y: 0, width: 300, height: 310 }, ...extra,
    });
    const frames = new Map([
      ["idle", makeFrame("idle")],
      ["ca-neck-pull", makeFrame("ca-neck-pull", { hand: { x: 255, y: 92 } })],
      ["victim-neck-arched", makeFrame("victim-neck-arched", { neck: { x: 125, y: 75 } })],
    ]);
    for (const facing of [-1, 1]) for (const offset of [40, 55]) {
      const source = actor("row-90", 445, { confirmedAtFrame: 5, cinematicTimeScale: 2, captureTargetId: "p2" });
      source.x = 340; source.y = 450; source.facing = facing;
      const target = new Battle(DEFAULT_MATCH_CONFIG).state.fighters[1];
      target.x = source.x + facing * offset; target.y = source.y; target.facing = -facing;
      target.capture = { sourceId: "p1", moveId: "A03", untilTick: 600, phase: "combo" };
      const attack = placeJamieSprite(frames, source, 445)!;
      const victim = placeJamieSprite(frames, target, 445, false, getJamieState(source)!.action!, source)!;
      expect(victim.contactError).toBeLessThan(0.001);
      expect(Math.hypot(attack.hand!.x - victim.neck!.x, attack.hand!.y - victim.neck!.y)).toBeLessThan(0.001);
      expect(victim.frame.scale).toBe(0.43);
    }
  });

  it("separates faint alpha bridges without erasing the original figure edges", () => {
    const width = 60, height = 80, pixels = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < 4; row++) for (let column = 0; column < 3; column++) {
      for (let y = row * 20 + 5; y <= row * 20 + 15; y++) for (let x = column * 20 + 5; x <= column * 20 + 14; x++) pixels[(y * width + x) * 4 + 3] = 255;
    }
    for (let y = 16; y <= 24; y++) pixels[(y * width + 10) * 4 + 3] = 80;
    const extracted = extractJamieSpriteRegions(pixels, width, height);
    expect(extracted.regions).toHaveLength(12);
    expect(extracted.seedThreshold).toBe(96);
    const upper = extracted.regions[0].components[0], lower = extracted.regions[3].components[0];
    expect(upper).not.toBe(lower);
    for (let y = 16; y <= 24; y++) expect([upper, lower]).toContain(extracted.labels[y * width + 10]);
  });

  it("rejects a missing person even when tiny alpha fragments could fill the twelfth slot", () => {
    const width = 60, height = 80, pixels = new Uint8ClampedArray(width * height * 4);
    for (let slot = 0; slot < 11; slot++) for (let y = Math.floor(slot / 3) * 20 + 5; y <= Math.floor(slot / 3) * 20 + 15; y++) for (let x = slot % 3 * 20 + 5; x <= slot % 3 * 20 + 14; x++) pixels[(y * width + x) * 4 + 3] = 255;
    pixels[(79 * width + 59) * 4 + 3] = 255;
    expect(() => extractJamieSpriteRegions(pixels, width, height)).toThrow(/Tiny alpha fragments/);
  });

  it("supplies visible CA contact landmarks in the shipped tied and loose hair frames", () => {
    const frames = manifestFrames();
    expect(frames.size).toBe(144);
    for (const level of [0, 4]) for (const facing of [-1, 1]) for (const t of [185, 220, 235]) {
      const frame = 5 + t * 2;
      const source = actor("row-90", frame, { confirmedAtFrame: 5, cinematicTimeScale: 2, captureTargetId: "p2" });
      source.facing = facing; getJamieState(source)!.drinkLevel = level;
      const victim = new Battle(DEFAULT_MATCH_CONFIG).state.fighters[1];
      victim.facing = -facing; victim.x = source.x + facing * 40; getJamieState(victim)!.drinkLevel = level;
      victim.capture = { sourceId: "p1", moveId: "A03", untilTick: 800, phase: "combo" };
      const attacker = placeJamieSprite(frames, source, frame)!;
      const captured = placeJamieSprite(frames, victim, frame, false, getJamieState(source)!.action!, source)!;
      expect(attacker.hand, `${attacker.poseId} needs a visible hand annotation`).toBeDefined();
      expect(captured.neck, `${captured.poseId} needs a visible neck annotation`).toBeDefined();
      expect(captured.contactError).toBeLessThan(0.001);
      expect(attacker.poseId.startsWith("loose-")).toBe(level === 4);
    }
  });

  it("releases the victim's neck when the shipped CA figure lowers its hand at 239", () => {
    const frames = manifestFrames(), frame = 5 + 239 * 2;
    const source = actor("row-90", frame, { confirmedAtFrame: 5, cinematicTimeScale: 2, captureTargetId: "p2" });
    const victim = new Battle(DEFAULT_MATCH_CONFIG).state.fighters[1];
    source.facing = 1; victim.facing = -1; victim.x = source.x + 40;
    victim.capture = { sourceId: "p1", moveId: "A03", untilTick: 800, phase: "combo" };
    expect(placeJamieSprite(frames, source, frame)!.poseId).toBe("ca-neck-release");
    const released = placeJamieSprite(frames, victim, frame, false, getJamieState(source)!.action!, source)!;
    expect(released.x).toBe(0);
    expect(released.y).toBe(0);
  });
});
