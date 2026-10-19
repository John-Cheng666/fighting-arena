import { getJamieState } from "../../state";
import Phaser from "phaser";
import type { Fighter } from "../../../../engine/types";
import type { JamieAction } from "../../types";
import { JAMIE_RIG_SCALE, p, sampleJamiePose, type Point, type Pose } from "./JamieAnimation";
import { JamieParts } from "./JamieParts";
import { getJamieSpriteFrames, JamieSprites } from "./JamieSprites";
const ink = 0x24212a;
const skin = 0xe6ad7c;
const shade = 0xb97654;
const yellow = 0xe6ae27;
const light = 0xffd95c;
const dark = 0x896321;
const hair = 0x292028;

/** Complete authored figure frames are the stage actor's primary visual.
 * The articulated renderer is retained only as a missing-asset fallback;
 * gameplay, hit timing and position stay in core. */
export class JamieRig {
  readonly root: Phaser.GameObjects.Container;
  private readonly drawing: Phaser.GameObjects.Graphics;
  private readonly trail: Phaser.GameObjects.Graphics;
  private readonly seatColor: number;
  private readonly parts?: JamieParts;
  readonly sprites?: JamieSprites;

  constructor(scene: Phaser.Scene, seatColor: number) {
    this.seatColor = seatColor;
    this.trail = scene.add.graphics();
    this.drawing = scene.add.graphics();
    this.root = scene.add.container(0, 0, [this.trail, this.drawing]);
    const frames = getJamieSpriteFrames(scene);
    if (frames?.has("idle")) {
      this.sprites = new JamieSprites(scene, frames);
      this.root.add(this.sprites.root);
    } else if (scene.textures.exists("jamie-part-head")) {
      this.parts = new JamieParts(scene);
      this.root.add(this.parts.root);
    }
  }

  update(fighter: Fighter, tick: number, time: number, running: boolean, winner: boolean, captureSource?: JamieAction, captureActor?: Fighter): void {
    const action = getJamieState(fighter)?.action ?? null;
    const g = this.drawing.clear();
    const hit = fighter.hitUntilTick > tick;
    this.root.setScale(fighter.facing < 0 ? -JAMIE_RIG_SCALE : JAMIE_RIG_SCALE, JAMIE_RIG_SCALE);
    this.root.setY(-fighter.height);
    this.root.setAlpha(fighter.hp <= 0 ? 0.72 : 1);
    this.drawMotion(action, fighter, time);

    if (this.sprites) {
      this.sprites.update(fighter, tick, winner, captureSource, captureActor);
      return;
    }

    const pose = sampleJamiePose(fighter, tick, time, running, winner, captureSource, captureActor);

    if (this.parts) {
      this.parts.update(pose, fighter, tick, time);
      if ((getJamieState(fighter)?.drinkLevel ?? 0) >= 4) this.braid(pose, fighter, time);
      return;
    }

    // The long plait sits behind the silhouette and reacts to movement.
    this.braid(pose, fighter, time);
    this.arm(pose.shoulder, pose.rearElbow, pose.rearHand, false, false);
    this.leg(pose.hip, pose.rearKnee, pose.rearFoot, false);
    this.body(pose, hit);
    this.leg(p(pose.hip.x + 5, pose.hip.y), pose.knee, pose.foot, true);
    this.head(pose.head, pose.shoulder, hit);
    this.arm(p(pose.shoulder.x + 6, pose.shoulder.y + 1), pose.elbow, pose.hand, true, pose.openHand);
    if (pose.gourd) {
      this.gourd(pose.hand.x + 2, pose.hand.y - 2, pose.gourdAngle, 0.95);
    } else {
      this.gourd(pose.hip.x - 12, pose.hip.y + 9, 0.15 + Math.sin(time * 9) * 0.12, 0.72);
    }
    // Wrist wraps and a small seat accent retain the same official costume.
    g.lineStyle(2, this.seatColor, 0.9).lineBetween(pose.elbow.x + 2, pose.elbow.y, pose.hand.x, pose.hand.y);
    if ((getJamieState(fighter)?.sa2UntilTick ?? 0) > tick) {
      g.lineStyle(1, 0xffe895, 0.7);
      g.strokeCircle(pose.head.x, pose.head.y, 16);
    }
  }

  private poly(points: Point[], color: number, alpha = 1): void {
    const g = this.drawing;
    g.fillStyle(color, alpha).fillPoints(points, true);
  }

  private segment(a: Point, b: Point, widthA: number, widthB: number, color: number): void {
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length, ny = dx / length;
    const outline = [p(a.x + nx * (widthA + 1), a.y + ny * (widthA + 1)), p(b.x + nx * (widthB + 1), b.y + ny * (widthB + 1)), p(b.x - nx * (widthB + 1), b.y - ny * (widthB + 1)), p(a.x - nx * (widthA + 1), a.y - ny * (widthA + 1))];
    this.poly(outline, ink);
    this.poly([p(a.x + nx * widthA, a.y + ny * widthA), p(b.x + nx * widthB, b.y + ny * widthB), p(b.x - nx * widthB, b.y - ny * widthB), p(a.x - nx * widthA, a.y - ny * widthA)], color);
    this.drawing.fillStyle(color).fillCircle(a.x, a.y, widthA).fillCircle(b.x, b.y, widthB);
  }

  private arm(shoulder: Point, elbow: Point, hand: Point, front: boolean, open: boolean): void {
    this.segment(shoulder, elbow, 9, 7.2, front ? yellow : dark);
    const cuff = p(elbow.x + (shoulder.x - elbow.x) * 0.12, elbow.y + (shoulder.y - elbow.y) * 0.12);
    this.segment(cuff, elbow, 7.7, 7.7, front ? 0xf2e7d5 : 0xbcb5a7);
    this.segment(elbow, hand, 5.2, 3.7, front ? skin : shade);
    const g = this.drawing;
    g.lineStyle(1.2, 0x9d684d, 0.6).lineBetween(elbow.x, elbow.y, hand.x - 1, hand.y + 2);
    g.fillStyle(0xe8ddca).fillCircle(hand.x - 2, hand.y, 4.3);
    if (open) {
      g.fillStyle(skin).fillEllipse(hand.x + 3, hand.y - 2, 9, 12);
      g.lineStyle(1, shade, 0.65).lineBetween(hand.x + 4, hand.y - 6, hand.x + 5, hand.y + 1);
      g.lineBetween(hand.x + 6, hand.y - 5, hand.x + 7, hand.y + 1);
    } else {
      g.fillStyle(ink).fillRoundedRect(hand.x - 2, hand.y - 5, 11, 10, 3);
      g.fillStyle(skin).fillRoundedRect(hand.x - 1, hand.y - 4, 9, 8, 2);
      g.lineStyle(1, shade).lineBetween(hand.x + 2, hand.y - 4, hand.x + 2, hand.y - 1);
    }
  }

  private leg(hip: Point, knee: Point, foot: Point, front: boolean): void {
    this.segment(hip, knee, 12, 10.5, front ? yellow : dark);
    this.segment(knee, p(foot.x - 3, foot.y - 6), 10.5, 6.4, front ? yellow : dark);
    const g = this.drawing;
    g.lineStyle(front ? 2.5 : 1.5, front ? light : 0xb8902e, 0.85)
      .lineBetween(hip.x + 3, hip.y + 4, knee.x + 3, knee.y)
      .lineBetween(knee.x + 3, knee.y + 1, foot.x, foot.y - 10);
    const angle = Math.atan2(foot.y - knee.y, foot.x - knee.x);
    const tip = p(foot.x + Math.sin(angle) * 10, foot.y - Math.cos(angle) * 6);
    this.segment(p(foot.x - 3, foot.y - 4), tip, 6, 5, 0x252a32);
    g.lineStyle(2.5, 0xeae0c7).lineBetween(foot.x - 5, foot.y + 1, tip.x + 3, tip.y + 3);
    g.lineStyle(1, 0x95948e).lineBetween(foot.x, foot.y - 5, foot.x + 4, foot.y - 4);
  }

  private body(pose: Pose, hit: boolean): void {
    const s = pose.shoulder, h = pose.hip;
    const g = this.drawing;
    this.segment(p(s.x, s.y + 5), p(h.x, h.y - 2), 12, 10, hit ? 0xffc1a0 : skin);
    // Open cropped training vest, dark piping, exposed chest and midriff.
    this.poly([p(s.x - 15, s.y - 2), p(s.x - 5, s.y - 4), p(s.x - 2, s.y + 16), p(h.x - 5, h.y - 10), p(h.x - 14, h.y - 13)], ink);
    this.poly([p(s.x - 14, s.y - 1), p(s.x - 6, s.y - 2), p(s.x - 4, s.y + 16), p(h.x - 6, h.y - 11), p(h.x - 12, h.y - 14)], yellow);
    this.poly([p(s.x + 6, s.y - 3), p(s.x + 15, s.y + 2), p(h.x + 14, h.y - 10), p(h.x + 4, h.y - 10), p(s.x + 4, s.y + 12)], ink);
    this.poly([p(s.x + 7, s.y - 1), p(s.x + 13, s.y + 3), p(h.x + 12, h.y - 12), p(h.x + 6, h.y - 12), p(s.x + 6, s.y + 11)], light);
    g.lineStyle(1, shade, 0.85).lineBetween(s.x - 1, s.y + 9, h.x + 2, h.y - 11);
    g.lineBetween(s.x - 5, s.y + 13, s.x + 4, s.y + 16);
    g.lineBetween(h.x - 5, h.y - 9, h.x + 5, h.y - 7);
    this.segment(p(h.x - 9, h.y - 2), p(h.x + 10, h.y - 2), 4, 4, 0x9b2f36);
    g.lineStyle(2, 0xe46b51).lineBetween(h.x - 9, h.y - 5, h.x + 8, h.y - 5);
    g.fillStyle(0xf0dfbd).fillCircle(h.x + 4, h.y - 2, 2);
    // Loose sash tails move with the hip rather than the entire actor.
    this.poly([p(h.x + 8, h.y + 1), p(h.x + 12, h.y + 1), p(h.x + 25, h.y + 27), p(h.x + 16, h.y + 22)], 0xb83a3a);
    g.lineStyle(1, 0xeb8160).lineBetween(h.x + 12, h.y + 6, h.x + 21, h.y + 22);
  }

  private head(head: Point, shoulder: Point, hit: boolean): void {
    const g = this.drawing;
    this.segment(p(shoulder.x, shoulder.y - 2), p(head.x - 1, head.y + 8), 5, 4, shade);
    g.fillStyle(ink).fillEllipse(head.x, head.y, 23, 29);
    g.fillStyle(hit ? 0xffc2a0 : skin).fillEllipse(head.x + 1, head.y + 1, 19.5, 25);
    this.poly([p(head.x + 8, head.y - 6), p(head.x + 13, head.y + 1), p(head.x + 9, head.y + 3), p(head.x + 8, head.y + 9), p(head.x + 1, head.y + 12), p(head.x - 4, head.y + 7)], skin);
    g.fillStyle(shade).fillEllipse(head.x - 9, head.y + 2, 5, 8);
    g.fillStyle(hair).fillEllipse(head.x - 3, head.y - 9, 20, 14);
    this.poly([p(head.x - 12, head.y - 9), p(head.x - 8, head.y - 17), p(head.x + 5, head.y - 16), p(head.x + 9, head.y - 10), p(head.x + 1, head.y - 7), p(head.x - 6, head.y - 9), p(head.x - 8, head.y + 2)], hair);
    g.fillStyle(0x4a3435).fillEllipse(head.x - 5, head.y - 17, 12, 9);
    g.lineStyle(1.4, 0x211e26).lineBetween(head.x + 3, head.y - 2, head.x + 9, head.y - 2);
    g.fillStyle(0x201d25).fillCircle(head.x + 7, head.y, 1.1);
    g.lineStyle(1, 0x965d47).lineBetween(head.x + 5, head.y + 7, head.x + 10, head.y + 6);
    g.lineStyle(1, 0x685044, 0.65).lineBetween(head.x - 9, head.y - 5, head.x - 6, head.y - 9);
    g.fillStyle(0xe8cb6c).fillCircle(head.x - 8, head.y + 5, 1.5);
  }

  private braid(pose: Pose, fighter: Fighter, time: number): void {
    const g = this.drawing;
    const loose = (getJamieState(fighter)?.drinkLevel ?? 0) >= 4;
    const start = p(pose.head.x - 8, pose.head.y - 16);
    const swing = Math.sin(time * 5 + fighter.x * 0.015) * 9;
    const end = p(pose.hip.x - 26 - swing, pose.hip.y + 18);
    const c1 = p(start.x - 37 - swing * 0.6, start.y - 43);
    const c2 = p(end.x - 38, end.y - 18);
    if (loose) {
      for (let strand = 0; strand < 5; strand++) {
        const strandEnd = p(end.x - 16 + strand * 7, end.y + 4 + Math.sin(time * 7 + strand) * 9);
        let previous = start;
        for (let i = 1; i <= 10; i++) {
          const t = i / 10, u = 1 - t;
          const point = p(u ** 3 * start.x + 3 * u * u * t * (start.x - 20) + 3 * u * t * t * (strandEnd.x - 16) + t ** 3 * strandEnd.x,
            u ** 3 * start.y + 3 * u * u * t * (start.y + 18) + 3 * u * t * t * (strandEnd.y - 30) + t ** 3 * strandEnd.y);
          this.segment(previous, point, 4 - t * 2.4, 4 - t * 2.7, strand % 2 ? 0x38262d : hair);
          previous = point;
        }
      }
      return;
    }
    const points: Point[] = [];
    for (let i = 0; i <= 13; i++) {
      const t = i / 13, u = 1 - t;
      points.push(p(u ** 3 * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * end.x + Math.sin(i * 2) * 0.8,
        u ** 3 * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * end.y));
    }
    for (let i = 1; i < points.length; i++) {
      const width = loose ? 5.8 - i * 0.17 : 3.8 - i * 0.08;
      this.segment(points[i - 1], points[i], width, width, hair);
      g.lineStyle(0.8, 0x684b42, 0.65).lineBetween(points[i].x - 2, points[i].y - 1, points[i].x + 2, points[i].y + 1);
    }
    g.fillStyle(yellow).fillCircle(end.x, end.y - 3, 2.5);
    this.poly([p(end.x - 2, end.y), p(end.x + 3, end.y), p(end.x + swing * 0.2, end.y + 10)], hair);
  }

  private gourd(x: number, y: number, angle: number, scale: number): void {
    const g = this.drawing;
    const point = (px: number, py: number) => p(x + (px * Math.cos(angle) - py * Math.sin(angle)) * scale, y + (px * Math.sin(angle) + py * Math.cos(angle)) * scale);
    const lower = point(0, 7), upper = point(0, -1), neck = point(0, -8);
    g.fillStyle(ink).fillCircle(lower.x, lower.y, 8 * scale).fillCircle(upper.x, upper.y, 5.8 * scale);
    g.fillStyle(0x23384c).fillCircle(lower.x, lower.y, 6.8 * scale).fillCircle(upper.x, upper.y, 4.8 * scale);
    const shine = point(-2.5, 5);
    g.fillStyle(0x7396ad, 0.8).fillEllipse(shine.x, shine.y, 3 * scale, 7 * scale);
    this.segment(point(0, -4), neck, 2.5 * scale, 2.4 * scale, 0x69402b);
    g.lineStyle(2 * scale, 0xf1d585).lineBetween(point(-4, 2).x, point(-4, 2).y, point(4, 2).x, point(4, 2).y);
  }

  private drawMotion(action: JamieAction | null, fighter: Fighter, time: number): void {
    const g = this.trail.clear();
    if (!action) return;
    const progress = action.frame / Math.max(action.duration, 1);
    const pulse = Math.sin(Math.PI * Math.min(1, progress));
    const od = /OD|Overdrive/.test(action.name);
    const color = action.pose === "parry" ? 0x8b8cff : action.pose === "rush" ? 0x79ecb4 : od ? 0xffdf70 : this.seatColor;
    if (["kick", "spin", "super"].includes(action.pose)) {
      const radius = action.pose === "spin" ? 67 : 58;
      const angle = progress * Math.PI * (action.pose === "spin" ? 4 : 1.4);
      for (let i = 0; i < 3; i++) g.lineStyle(5 - i * 1.5, color, pulse * (0.2 - i * 0.04))
        .beginPath().arc(0, -67, radius + i * 6, angle - 1.6, angle - 0.1, false).strokePath();
    }
    if (action.pose === "palm" || action.pose === "punch" || action.pose === "super") {
      for (let i = 0; i < 3; i++) g.lineStyle(2 - i * 0.4, color, pulse * 0.28)
        .lineBetween(12 + i * 8, -78 + i * 9, 46 + pulse * 25, -78 + i * 9);
    }
    if (action.pose === "parry") {
      g.lineStyle(4, color, 0.25 + pulse * 0.3).beginPath().arc(7, -75, 45, -1.3, 1.1, false).strokePath();
      g.lineStyle(1.5, 0xe9e4ff, 0.65).beginPath().arc(10, -75, 49, -1.2, 1, false).strokePath();
    }
    if (action.pose === "drink") {
      for (let i = 0; i < 3; i++) {
        const offset = (time * 14 + i * 9) % 28;
        g.fillStyle(0xffe5a0, 0.5 * (1 - offset / 28)).fillCircle(-8 + Math.sin(i * 2) * 7, -125 - offset, 1.3);
      }
    }
    if (action.pose === "rush" || od) {
      for (let i = 0; i < 5; i++) g.lineStyle(1.5, color, pulse * 0.4)
        .lineBetween(-44 - i * 5, -28 - i * 15, -14 - i * 3, -33 - i * 15);
    }
    if (action.pose === "super") {
      g.lineStyle(2, 0xffe4a0, pulse * 0.4).strokeCircle(0, -63, 69 + Math.sin(time * 25) * 3);
    }
    if (getJamieState(fighter)?.burnout) {
      g.lineStyle(1, 0xa7a2b4, 0.2).strokeEllipse(0, -50, 52, 97);
    }
  }
}
