import { getJamieState } from "../../state";
import Phaser from "phaser";
import type { Fighter } from "../../../../engine/types";
import type { Point, Pose } from "./JamieAnimation";

const names = ["head", "torso", "pelvis", "braid", "rear-upper", "upper", "rear-forearm", "forearm", "rear-thigh", "thigh", "rear-shin", "shin", "rear-hand", "hand", "gourd", "shoe"];
const PREFIX = "jamie-part-";

/** Split the generated material atlas into genuinely transparent pieces. The
 * disconnected guide-line remnants are excluded without keying costume colors. */
export function prepareJamieParts(scene: Phaser.Scene): void {
  if (scene.textures.exists(`${PREFIX}head`) || !scene.textures.exists("jamie-parts")) return;
  const source = scene.textures.get("jamie-parts").getSourceImage() as HTMLImageElement;
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = source.width; sourceCanvas.height = source.height;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true })!;
  sourceContext.drawImage(source, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  for (let index = 0; index < names.length; index++) {
    const cellX = Math.round((index % 4) * source.width / 4), cellY = Math.round(Math.floor(index / 4) * source.height / 4);
    const size = Math.floor(source.width / 4);
    let top = 9, bottom = size - 10;
    if (index === 4 || index === 5) bottom = Math.floor(size * 0.58);
    if (index === 6 || index === 7) top = Math.floor(size * 0.5);
    const width = size - 20, height = bottom - top;
    const seen = new Uint8Array(width * height);
    let largest: number[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const local = y * width + x;
      if (seen[local]) continue;
      seen[local] = 1;
      const alpha = pixels[((cellY + top + y) * source.width + cellX + 10 + x) * 4 + 3];
      if (alpha < 100) continue;
      const queue = [local];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const position = queue[cursor], px = position % width, py = Math.floor(position / width);
        for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next]) continue;
          seen[next] = 1;
          if (pixels[((cellY + top + ny) * source.width + cellX + 10 + nx) * 4 + 3] >= 100) queue.push(next);
        }
      }
      if (queue.length > largest.length) largest = queue;
    }
    if (!largest.length) continue;
    let minX = width, maxX = 0, minY = height, maxY = 0;
    for (const at of largest) {
      minX = Math.min(minX, at % width); maxX = Math.max(maxX, at % width);
      minY = Math.min(minY, Math.floor(at / width)); maxY = Math.max(maxY, Math.floor(at / width));
    }
    const canvas = document.createElement("canvas");
    canvas.width = maxX - minX + 3; canvas.height = maxY - minY + 3;
    const context = canvas.getContext("2d")!;
    const output = context.createImageData(canvas.width, canvas.height);
    for (const at of largest) {
      const x = at % width, y = Math.floor(at / width);
      const target = ((y - minY + 1) * canvas.width + x - minX + 1) * 4;
      const from = ((cellY + top + y) * source.width + cellX + 10 + x) * 4;
      for (let channel = 0; channel < 4; channel++) output.data[target + channel] = pixels[from + channel];
    }
    context.putImageData(output, 0, 0);
    scene.textures.addCanvas(`${PREFIX}${names[index]}`, canvas);
  }
}

/** The artwork supplies materials and anatomy; this class supplies no animation
 * timing. Each image follows the authored joints from JamieAnimation. */
export class JamieParts {
  readonly root: Phaser.GameObjects.Container;
  private readonly images = new Map<string, Phaser.GameObjects.Image>();
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.root = scene.add.container(0, 0);
    for (const [key, part] of [
      ["braid", "braid"], ["rear-upper", "rear-upper"], ["rear-forearm", "rear-forearm"], ["rear-hand", "rear-hand"],
      ["rear-thigh", "rear-thigh"], ["rear-shin", "rear-shin"], ["rear-shoe", "shoe"],
      ["torso", "torso"], ["pelvis", "pelvis"], ["thigh", "thigh"], ["shin", "shin"], ["shoe", "shoe"],
      ["head", "head"], ["upper", "upper"], ["forearm", "forearm"], ["hand", "hand"], ["gourd", "gourd"],
    ]) {
      const image = scene.add.image(0, 0, `${PREFIX}${part}`);
      this.images.set(key, image); this.root.add(image);
    }
  }

  private bone(key: string, a: Point, b: Point, width: number): void {
    const image = this.images.get(key)!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    image.setOrigin(0.5, 0.08).setPosition(a.x, a.y).setDisplaySize(width, length / 0.84)
      .setRotation(Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2).setFlipX(false).setVisible(true);
  }

  update(pose: Pose, fighter: Fighter, tick: number, time: number): void {
    const g = this.images;
    for (const image of g.values()) image.clearTint();
    this.bone("rear-upper", pose.shoulder, pose.rearElbow, 17);
    this.bone("rear-forearm", pose.rearElbow, pose.rearHand, 10);
    this.bone("rear-thigh", pose.hip, pose.rearKnee, 27);
    this.bone("rear-shin", pose.rearKnee, pose.rearFoot, 19);
    this.bone("thigh", { x: pose.hip.x + 4, y: pose.hip.y }, pose.knee, 27);
    this.bone("shin", pose.knee, pose.foot, 19);
    const upper = { x: pose.shoulder.x, y: pose.shoulder.y - 8 };
    const lower = { x: pose.hip.x, y: pose.hip.y + 1 };
    this.bone("torso", upper, lower, 38);
    g.get("pelvis")!.setOrigin(0.5, 0.25).setPosition(pose.hip.x, pose.hip.y - 5).setDisplaySize(31, 22)
      .setRotation(Math.atan2(lower.y - upper.y, lower.x - upper.x) - Math.PI / 2);
    this.bone("upper", { x: pose.shoulder.x + 6, y: pose.shoulder.y + 1 }, pose.elbow, 18);
    this.bone("forearm", pose.elbow, pose.hand, 11);
    for (const [key, joint, previous] of [["hand", pose.hand, pose.elbow], ["rear-hand", pose.rearHand, pose.rearElbow]] as const) {
      g.get(key)!.setPosition(joint.x, joint.y).setDisplaySize(pose.openHand ? 12 : 11, pose.openHand ? 16 : 12)
        .setOrigin(0.5, 0.12).setRotation(Math.atan2(joint.y - previous.y, joint.x - previous.x) - Math.PI / 2);
    }
    for (const [key, joint, knee] of [["shoe", pose.foot, pose.knee], ["rear-shoe", pose.rearFoot, pose.rearKnee]] as const)
      g.get(key)!.setOrigin(0.4, 0.7).setPosition(joint.x, joint.y - 2).setDisplaySize(23, 16)
        .setRotation(joint.y > -4 ? 0 : Math.atan2(joint.y - knee.y, joint.x - knee.x) - Math.PI / 2);
    const headAngle = Math.atan2(pose.head.x - pose.shoulder.x, pose.shoulder.y - pose.head.y);
    g.get("head")!.setOrigin(0.5, 0.55).setPosition(pose.head.x + 1, pose.head.y).setDisplaySize(24, 33)
      .setRotation(headAngle).setFlipX((pose.faceTurn ?? 0) < -0.5);
    const realLevel4 = (getJamieState(fighter)?.drinkLevel ?? 0) >= 4;
    g.get("braid")!.setOrigin(0.9, 0.85).setPosition(pose.head.x - 5 * Math.cos(headAngle) + 12 * Math.sin(headAngle), pose.head.y - 5 * Math.sin(headAngle) - 12 * Math.cos(headAngle)).setDisplaySize(60, 88)
      .setFlipX(true).setRotation(headAngle - 1.02 + Math.sin(time * 5) * 0.08).setVisible(!realLevel4);
    g.get("gourd")!.setOrigin(0.5, 0.42).setPosition(pose.gourd ? pose.hand.x + 2 : pose.hip.x - 13, pose.gourd ? pose.hand.y - 1 : pose.hip.y + 13)
      .setDisplaySize(pose.gourd ? 14 : 10, pose.gourd ? 21 : 16).setRotation(pose.gourd ? pose.gourdAngle : 0.15);
    if (fighter.hitUntilTick > tick) for (const image of g.values()) image.setTint(0xffc4b2);
    if ((getJamieState(fighter)?.sa2UntilTick ?? 0) > tick) g.get("head")!.setTint(0xffbc9d);
    // Avoid texture warning work in update; keep a reference for clean ownership.
    this.root.setVisible(this.scene.textures.exists(`${PREFIX}head`));
  }
}
