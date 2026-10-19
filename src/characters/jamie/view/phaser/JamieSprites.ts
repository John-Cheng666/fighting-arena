import { getJamieState } from "../../state";
import type Phaser from "phaser";
import type { Fighter } from "../../../../engine/types";
import type { JamieAction } from "../../types";
import { JAMIE_RIG_SCALE, type Point } from "./JamieAnimation";
import { extractJamieSpriteRegions } from "./JamieSpriteAtlas";
import { jamieCinematicFrame, sampleJamieSpriteMotion, selectJamieSpritePose } from "./JamieSpriteAnimation";

export interface JamieSpritePoseSpec {
  id: string;
  /** Pixel coordinates relative to the original logical cell, before extraction. */
  anchor?: [number, number];
  hand?: [number, number];
  neck?: [number, number];
  scale?: number;
}
export interface JamieSpriteManifest {
  version: number;
  worldHeight?: number;
  sheets: {
    id: string; image: string; columns?: number; rows?: number;
    referenceHeight?: number;
    poses: (string | JamieSpritePoseSpec)[];
  }[];
}
export interface JamieSpriteFrame {
  id: string; texture: string; scale: number;
  width: number; height: number; anchor: Point;
  hand?: Point; neck?: Point;
  source: { sheet: string; slot: number; x: number; y: number; width: number; height: number };
}
export interface JamieSpritePlacement {
  poseId: string; requestedPoseId: string; frame: JamieSpriteFrame; x: number; y: number; rotation: number;
  /** World points derived from the selected full figure's visible landmarks. */
  hand?: Point; neck?: Point;
  contactError?: number;
}

const MANIFEST_KEY = "jamie-fullbody-manifest";
const framesByScene = new WeakMap<Phaser.Scene, Map<string, JamieSpriteFrame>>();
const sheetKey = (id: string) => `jamie-fullbody-sheet-${id}`;

export function preloadJamieSprites(scene: Phaser.Scene): void {
  scene.load.once(`filecomplete-json-${MANIFEST_KEY}`, (_key: string, _type: string, data: JamieSpriteManifest) => {
    for (const sheet of data.sheets ?? []) scene.load.image(sheetKey(sheet.id), sheet.image);
  });
  scene.load.json(MANIFEST_KEY, "/assets/jamie/sprites-v3/manifest.json");
}

/** Complete-figure extraction only; no limb is stretched, repainted or rebuilt. */
export function prepareJamieSprites(scene: Phaser.Scene): void {
  const manifest = scene.cache.json.get(MANIFEST_KEY) as JamieSpriteManifest | undefined;
  if (!manifest?.sheets?.length) return;
  const frames = new Map<string, JamieSpriteFrame>();
  let referenceHeight = 0, referenceCellHeight = 0;
  for (const sheet of manifest.sheets) {
    if (!scene.textures.exists(sheetKey(sheet.id))) continue;
    const source = scene.textures.get(sheetKey(sheet.id)).getSourceImage() as HTMLImageElement;
    const canvas = document.createElement("canvas"); canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const columns = sheet.columns ?? 3, rows = sheet.rows ?? 4;
    const extraction = extractJamieSpriteRegions(pixels, canvas.width, canvas.height, columns, rows);
    const cellWidth = canvas.width / columns, cellHeight = canvas.height / rows;
    for (let slot = 0; slot < sheet.poses.length; slot++) {
      const value = sheet.poses[slot];
      const spec = typeof value === "string" ? { id: value } : value;
      const id = /^(e|l)(-|$)/i.test(sheet.id) && /^(loose-)?landing$/.test(spec.id) ? `${spec.id}-e` : spec.id;
      const region = extraction.regions[slot];
      if (!region) continue;
      const minX = Math.max(0, region.minX - 2), minY = Math.max(0, region.minY - 2);
      const maxX = Math.min(canvas.width - 1, region.maxX + 2), maxY = Math.min(canvas.height - 1, region.maxY + 2);
      const cropped = document.createElement("canvas"); cropped.width = maxX - minX + 1; cropped.height = maxY - minY + 1;
      const croppedContext = cropped.getContext("2d")!;
      const output = croppedContext.createImageData(cropped.width, cropped.height);
      const selected = new Set(region.components);
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        let include = selected.has(extraction.labels[y * canvas.width + x]);
        if (!include && pixels[(y * canvas.width + x) * 4 + 3] > 0) {
          for (let dy = -1; dy <= 1 && !include; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (x + dx >= 0 && x + dx < canvas.width && y + dy >= 0 && y + dy < canvas.height && selected.has(extraction.labels[(y + dy) * canvas.width + x + dx])) { include = true; break; }
          }
        }
        if (!include) continue;
        const from = (y * canvas.width + x) * 4, to = ((y - minY) * cropped.width + x - minX) * 4;
        for (let channel = 0; channel < 4; channel++) output.data[to + channel] = pixels[from + channel];
      }
      croppedContext.putImageData(output, 0, 0);
      const texture = `jamie-fullbody-pose-${id}`;
      if (scene.textures.exists(texture)) scene.textures.remove(texture);
      scene.textures.addCanvas(texture, cropped);
      const cellX = (slot % columns) * cellWidth, cellY = Math.floor(slot / columns) * cellHeight;
      const landmark = (point: [number, number]): Point => ({ x: cellX + point[0] - minX, y: cellY + point[1] - minY });
      const anchor = spec.anchor ? landmark(spec.anchor) : { x: cellX + cellWidth / 2 - minX, y: region.maxY - minY };
      if (id === "idle") { referenceHeight = sheet.referenceHeight ?? region.maxY - region.minY + 1; referenceCellHeight = cellHeight; }
      const physicalReference = sheet.referenceHeight ?? (referenceHeight ? referenceHeight * cellHeight / referenceCellHeight : cellHeight * 0.9);
      frames.set(id, {
        id, texture, width: cropped.width, height: cropped.height, anchor,
        scale: (manifest.worldHeight ?? 124) / physicalReference * (spec.scale ?? 1),
        hand: spec.hand ? landmark(spec.hand) : undefined, neck: spec.neck ? landmark(spec.neck) : undefined,
        source: { sheet: sheet.id, slot, x: minX, y: minY, width: cropped.width, height: cropped.height },
      });
    }
    // GPU copies of the large sheets are unnecessary after extraction.
    scene.textures.remove(sheetKey(sheet.id));
  }
  framesByScene.set(scene, frames);
  scene.registry.set("jamie-fullbody-frame-count", frames.size);
}

export function getJamieSpriteFrames(scene: Phaser.Scene): ReadonlyMap<string, JamieSpriteFrame> | undefined {
  return framesByScene.get(scene);
}

function worldPoint(fighter: Fighter, placement: JamieSpritePlacement, landmark: Point): Point {
  const x = (landmark.x - placement.frame.anchor.x) * placement.frame.scale;
  const y = (landmark.y - placement.frame.anchor.y) * placement.frame.scale;
  const cosine = Math.cos(placement.rotation), sine = Math.sin(placement.rotation);
  return {
    x: fighter.x + fighter.facing * JAMIE_RIG_SCALE * (placement.x + x * cosine - y * sine),
    y: fighter.y - fighter.height + JAMIE_RIG_SCALE * (placement.y + x * sine + y * cosine),
  };
}

/** Visible artwork landmarks, rather than legacy skeleton points, constrain CA. */
export function placeJamieSprite(frames: ReadonlyMap<string, JamieSpriteFrame>, fighter: Fighter, tick: number, winner = false, captureSource?: JamieAction, captureActor?: Fighter): JamieSpritePlacement | undefined {
  const poseId = selectJamieSpritePose(fighter, tick, winner, captureSource);
  const frame = frames.get(poseId) ?? frames.get((getJamieState(fighter)?.drinkLevel ?? 0) >= 4 ? "loose-idle" : "idle");
  if (!frame) return undefined;
  const placement: JamieSpritePlacement = { poseId: frame.id, requestedPoseId: poseId, frame, ...sampleJamieSpriteMotion(fighter, tick) };
  if (captureActor && captureSource?.variantId === "row-90" && fighter.capture) {
    const t = jamieCinematicFrame(captureSource);
    const source = placeJamieSprite(frames, captureActor, tick);
    if (t >= 170 && t <= 245 && source?.frame.hand && frame.neck) {
      const desired = worldPoint(captureActor, source, source.frame.hand);
      const actual = worldPoint(fighter, placement, frame.neck);
      // The release artwork lowers its hand at 239. Let the victim recoil
      // before that frame rather than dragging their neck toward the waist.
      const weight = Math.min(1, Math.max(0, (t - 170) / 15), Math.max(0, (239 - t) / 4));
      placement.x += (desired.x - actual.x) / (fighter.facing * JAMIE_RIG_SCALE) * weight;
      placement.y += (desired.y - actual.y) / JAMIE_RIG_SCALE * weight;
      const solved = worldPoint(fighter, placement, frame.neck);
      placement.contactError = Math.hypot(solved.x - desired.x, solved.y - desired.y);
    }
  }
  if (frame.hand) placement.hand = worldPoint(fighter, placement, frame.hand);
  if (frame.neck) placement.neck = worldPoint(fighter, placement, frame.neck);
  return placement;
}

/** Two complete figure images provide a very short transition; all scaling is
 * uniform. No body-part atlas participates in the main character rendering. */
export class JamieSprites {
  readonly root: Phaser.GameObjects.Container;
  placement?: JamieSpritePlacement;
  private readonly current: Phaser.GameObjects.Image;
  private readonly previous: Phaser.GameObjects.Image;
  private readonly frames: ReadonlyMap<string, JamieSpriteFrame>;
  private previousId = "";
  private transitionFrame = -1;
  private previousPlacement?: JamieSpritePlacement;
  private visualFrame = 0;
  private lastTick = -1;
  private lastIntro = 0;
  private lastAction = "";

  constructor(scene: Phaser.Scene, frames: ReadonlyMap<string, JamieSpriteFrame>) {
    this.frames = frames;
    const neutral = frames.get("idle")!;
    this.previous = scene.add.image(0, 0, neutral.texture).setVisible(false);
    this.current = scene.add.image(0, 0, neutral.texture);
    this.root = scene.add.container(0, 0, [this.previous, this.current]);
  }

  private apply(image: Phaser.GameObjects.Image, placement: JamieSpritePlacement): void {
    const frame = placement.frame;
    image.setTexture(frame.texture).setOrigin(frame.anchor.x / frame.width, frame.anchor.y / frame.height)
      .setPosition(placement.x, placement.y).setScale(frame.scale).setRotation(placement.rotation);
  }

  update(fighter: Fighter, tick: number, winner = false, captureSource?: JamieAction, captureActor?: Fighter): void {
    const placement = placeJamieSprite(this.frames, fighter, tick, winner, captureSource, captureActor);
    if (!placement) return;
    const action = getJamieState(fighter)?.action;
    const actionKey = action ? `${action.startTick}:${action.variantId}` : "";
    const intro = action?.introFrame ?? 0;
    this.visualFrame += Math.max(0, tick - (this.lastTick < 0 ? tick : this.lastTick)) + (actionKey === this.lastAction ? Math.max(0, intro - this.lastIntro) : 0);
    this.lastTick = tick; this.lastIntro = intro; this.lastAction = actionKey;
    const phaseFrame = this.visualFrame;
    if (placement.poseId !== this.previousId) {
      this.previousPlacement = this.placement;
      this.transitionFrame = phaseFrame;
      this.previousId = placement.poseId;
    }
    this.placement = placement;
    this.apply(this.current, placement);
    const blend = Math.min(1, Math.max(0, phaseFrame - this.transitionFrame) / 2);
    // Paired contact frames switch cleanly; blending two different silhouettes
    // at the neck would make their visible hand landmarks ambiguous.
    const paired = placement.contactError !== undefined || getJamieState(fighter)?.action?.variantId === "row-90";
    if (!paired && this.previousPlacement && blend < 1) {
      this.apply(this.previous, this.previousPlacement);
      this.previous.setAlpha((1 - blend) * 0.4).setVisible(true);
      this.current.setAlpha(0.6 + blend * 0.4);
    } else { this.previous.setVisible(false); this.current.setAlpha(1); }
    this.current.clearTint();
    if (fighter.hitUntilTick > tick) this.current.setTint(0xffdbcd);
    else if ((getJamieState(fighter)?.sa2UntilTick ?? 0) > tick) this.current.setTint(0xffeddd);
  }
}
