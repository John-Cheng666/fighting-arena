import Phaser from "phaser";

export type SuperEffectStyle = "spin" | "install" | "strike" | "critical";

export interface SuperEffectActor {
  key: string;
  name: string;
  style: SuperEffectStyle;
  x: number;
  y: number;
  height: number;
  facing: number;
  introFrame: number;
  introDuration: number;
  frame: number;
  duration: number;
  confirmed: boolean;
  finishing: boolean;
  contactFrame: number;
  hitCount: number;
  target?: { x: number; y: number; height: number };
}

export interface SuperEffectImpact {
  style: SuperEffectStyle;
  x: number;
  y: number;
  ageFrames: number;
  seed: number;
  finisher: boolean;
  blocked: boolean;
  direction?: number;
}

export const SUPER_EFFECT_PALETTES: Record<
  SuperEffectStyle,
  { primary: number; secondary: number; shade: number }
> = {
  spin: { primary: 0x62eeff, secondary: 0xe3fbff, shade: 0x2379df },
  install: { primary: 0x77ffd2, secondary: 0xffd883, shade: 0x259b82 },
  strike: { primary: 0xc291ff, secondary: 0xffda8a, shade: 0x734bd0 },
  critical: { primary: 0xff465c, secondary: 0xffd493, shade: 0x9f214c },
};

type Graphics = Phaser.GameObjects.Graphics;
const TAU = Math.PI * 2;
const WHITE = 0xfffcf4;
const MAX_ACTORS = 2;
const MAX_IMPACTS = 24;

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const noise = (value: number): number => {
  const sample = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return sample - Math.floor(sample);
};
const easeOut = (value: number): number => 1 - (1 - value) ** 3;

/**
 * All animation is sampled from battle frames: pausing, scrubbing a replay and
 * changing playback speed produce the same picture, without a second clock.
 * Graphics are reused and every particle loop has a fixed upper bound.
 */
export class SuperEffects {
  private readonly back: Graphics;
  private readonly front: Graphics;
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.back = scene.add.graphics().setDepth(85).setBlendMode(Phaser.BlendModes.ADD);
    this.front = scene.add.graphics().setDepth(850).setBlendMode(Phaser.BlendModes.ADD);
  }

  render(
    actors: readonly SuperEffectActor[],
    impacts: readonly SuperEffectImpact[],
    reducedMotion: boolean,
  ): void {
    if (this.destroyed) return;
    this.clear();
    for (let i = 0; i < Math.min(MAX_ACTORS, actors.length); i++) {
      const actor = actors[i];
      if (!Number.isFinite(actor.x + actor.y + actor.frame)) continue;
      const chest = actor.y - actor.height - 65;
      const intro = actor.introDuration > 0 && actor.introFrame >= 0
        && actor.introFrame < actor.introDuration;
      if (intro) this.drawIntro(actor, chest, reducedMotion);
      switch (actor.style) {
        case "spin": this.drawSpin(actor, chest, reducedMotion, intro); break;
        case "install": this.drawInstall(actor, chest, reducedMotion, intro); break;
        case "strike": this.drawStrike(actor, chest, reducedMotion, intro); break;
        case "critical": this.drawCritical(actor, chest, reducedMotion, intro); break;
      }
    }
    // Retain the newest contacts if many hit on the same simulation step.
    for (let i = Math.max(0, impacts.length - MAX_IMPACTS); i < impacts.length; i++) {
      this.drawImpact(impacts[i], reducedMotion);
    }
  }

  clear(): void {
    if (this.destroyed) return;
    this.back.clear();
    this.front.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.back.destroy();
    this.front.destroy();
    this.destroyed = true;
  }

  private drawIntro(actor: SuperEffectActor, chest: number, reduced: boolean): void {
    const palette = SUPER_EFFECT_PALETTES[actor.style];
    const progress = clamp(actor.introFrame / actor.introDuration);
    const gather = clamp(progress / 0.66);
    const release = clamp((progress - 0.66) / 0.34);
    const envelope = Math.sin(Math.PI * progress) ** 0.55;
    const radius = reduced ? 47 : 126 - 88 * easeOut(gather) + 96 * easeOut(release);
    const strength = reduced ? 0.28 : 0.75;
    const phase = reduced ? 0 : progress * 1.35;

    this.back.fillStyle(palette.shade, 0.055 * envelope);
    this.back.fillEllipse(actor.x, chest + 16, radius * 2.3, radius * 2.8);
    this.arc(this.back, actor.x, chest, radius, radius * 0.91,
      -0.6 + phase, Math.PI * 1.44, 3, palette.primary, envelope * strength);
    this.arc(this.back, actor.x, chest, radius + 12, (radius + 12) * 0.91,
      1.95 - phase, Math.PI * 0.8, 1, palette.secondary, envelope * 0.48);
    this.arc(this.front, actor.x, actor.y - 3, 36 + radius * 0.6, 10 + radius * 0.12,
      0.18, 2.65, 1.6, palette.primary, envelope * 0.62);

    const count = reduced ? 4 : 14;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + noise(i + 13) * 0.22;
      const reach = radius + 18 + noise(i + 4) * (reduced ? 12 : 53);
      const inner = radius + 7;
      const x = actor.x + Math.cos(angle) * reach;
      const y = chest + Math.sin(angle) * reach * 0.91;
      const endX = actor.x + Math.cos(angle) * inner;
      const endY = chest + Math.sin(angle) * inner * 0.91;
      this.ray(this.back, x, y, endX, endY, 1.2,
        i % 3 ? palette.primary : palette.secondary, envelope * strength);
    }
    // A compact light source at the forward shoulder leaves the face readable.
    const focusX = actor.x + actor.facing * 25;
    this.glint(this.front, focusX, chest + 10, reduced ? 8 : 12 + release * 12,
      palette.secondary, envelope * 0.8, -0.2);
    if (release > 0 && !reduced) {
      this.arc(this.back, actor.x, chest, 32 + release * 140, 32 + release * 140,
        -0.8, 4.5, 3 * (1 - release) + 0.5, palette.secondary,
        (1 - release) * 0.52);
    }
  }

  private drawSpin(actor: SuperEffectActor, chest: number, reduced: boolean, intro: boolean): void {
    const { primary, secondary, shade } = SUPER_EFFECT_PALETTES.spin;
    const envelope = this.bodyEnvelope(actor, intro);
    const elapsed = actor.introFrame + actor.frame;
    const phase = reduced ? 0 : elapsed * 0.145 * actor.facing;
    const swell = reduced ? 0 : Math.sin(elapsed * 0.13) * 8;
    const count = reduced ? 2 : 4;

    this.back.fillStyle(shade, 0.065 * envelope);
    this.back.fillEllipse(actor.x, chest + 22, 166 + swell, 162);
    for (let i = 0; i < count; i++) {
      const y = chest - 39 + i * (reduced ? 75 : 32);
      const radius = 56 + i * 10 + swell;
      const start = phase + i * 1.66;
      this.blade(this.back, actor.x, y, radius, 19 + i * 4,
        -0.22 * actor.facing, start, 4.15, reduced ? 2 : 5.8,
        i % 2 ? primary : secondary, envelope * (reduced ? 0.25 : 0.56));
      if (!reduced) {
        this.arc(this.front, actor.x, y, radius - 3, 16 + i * 4,
          start + 0.3, 0.95, 1.5, secondary, envelope * 0.68,
          -0.22 * actor.facing);
      }
    }
    this.arc(this.back, actor.x, actor.y - 4, 90 + swell, 18,
      0, TAU, 3, primary, 0.34 * envelope);
    this.arc(this.front, actor.x, actor.y - 3, 79 + swell, 15,
      0.12, 2.6, 1, secondary, 0.48 * envelope);

    for (let i = 0; i < (reduced ? 4 : 14); i++) {
      const travel = reduced ? noise(i + 10) : (elapsed * 0.026 + noise(i + 10)) % 1;
      const angle = i * 2.39996 + (reduced ? 0 : elapsed * 0.035);
      const radius = 48 + travel * 63;
      const x = actor.x + Math.cos(angle) * radius;
      const y = chest + 56 - travel * 122;
      const alpha = Math.sin(travel * Math.PI) * envelope * 0.7;
      this.ray(this.front, x, y, x + actor.facing * (5 + travel * 10),
        y - (reduced ? 3 : 9), 0.9, i % 3 ? primary : secondary, alpha);
      if (i % 4 === 0) this.glint(this.front, x, y, 3, secondary, alpha, 0);
    }
  }

  private drawInstall(actor: SuperEffectActor, chest: number, reduced: boolean, intro: boolean): void {
    const { primary, secondary, shade } = SUPER_EFFECT_PALETTES.install;
    const envelope = this.bodyEnvelope(actor, intro);
    const elapsed = actor.introFrame + actor.frame;
    const phase = reduced ? 0 : elapsed * 0.03;
    const cycle = reduced ? 0.35 : (elapsed % 44) / 44;

    this.back.fillStyle(shade, 0.085 * envelope);
    this.back.fillEllipse(actor.x, chest + 14, 136, 220);
    // Tapered columns and rising curved ribbons resemble flowing liquid light.
    for (let i = 0; i < (reduced ? 2 : 5); i++) {
      const offset = (i - (reduced ? 0.5 : 2)) * 21;
      const bend = reduced ? 0 : Math.sin(phase + i * 1.7) * 13;
      const x = actor.x + offset;
      const top = chest - 76 + Math.abs(offset) * 0.46;
      const alpha = envelope * (i % 2 ? 0.13 : 0.2);
      this.back.fillStyle(i % 2 ? primary : secondary, alpha);
      this.back.fillTriangle(x - 7, actor.y - 5, x + 7, actor.y - 5, x + bend, top);
      this.blade(this.back, x + bend, chest + 30, 22 + Math.abs(offset) * 0.2, 85,
        0.12, -1.4 + i * 0.7, 2.2, reduced ? 1.8 : 3.5,
        i % 2 ? primary : secondary, envelope * 0.34);
    }
    this.arc(this.back, actor.x, actor.y - 3, 62 + cycle * 48, 13 + cycle * 10,
      0.15, TAU - 0.65, 2.4, primary, (1 - cycle) * envelope * 0.55);
    for (let i = 0; i < 3; i++) {
      this.arc(this.front, actor.x, actor.y - 3, 47 + i * 14, 10 + i * 3,
        i * 2.1 + (reduced ? 0 : phase), 1.15, 1.3,
        i % 2 ? secondary : primary, envelope * 0.54);
    }
    for (let i = 0; i < (reduced ? 4 : 13); i++) {
      const travel = reduced ? noise(i + 6) : (elapsed * 0.014 + noise(i + 6)) % 1;
      const alpha = Math.sin(travel * Math.PI) * envelope * 0.78;
      const x = actor.x + (noise(i + 33) - 0.5) * 122
        + (reduced ? 0 : Math.sin(travel * 5 + i) * 10);
      const y = actor.y - 14 - travel * (actor.height + 166);
      this.ray(this.front, x, y + 8, x + 1, y - 5, 1.2, secondary, alpha * 0.6);
      if (i % 3 === 0) {
        // The paired lobes echo Jamie's gourd without adding sprite assets.
        this.front.fillStyle(primary, alpha * 0.72);
        this.front.fillCircle(x, y - 2.5, 1.8);
        this.front.fillCircle(x, y + 2, 2.7);
        this.glint(this.front, x + 1, y, 4, secondary, alpha * 0.8, 0.2);
      } else this.glint(this.front, x, y, 2.5, secondary, alpha, 0.2);
    }
  }

  private drawStrike(actor: SuperEffectActor, chest: number, reduced: boolean, intro: boolean): void {
    const { primary, secondary, shade } = SUPER_EFFECT_PALETTES.strike;
    const envelope = this.bodyEnvelope(actor, intro);
    const elapsed = actor.introFrame + actor.frame;
    const beat = reduced ? 0.4 : (elapsed % 22) / 22;
    const facing = actor.facing < 0 ? -1 : 1;
    const rotation = facing * -0.52;

    this.back.fillStyle(shade, envelope * 0.065);
    this.back.fillEllipse(actor.x, chest + 10, 173, 188);
    for (let i = 0; i < (reduced ? 2 : 4); i++) {
      const shift = i * 14;
      this.blade(this.back, actor.x + facing * shift, chest + 8 - i * 3,
        89 + shift, 38 + i * 3, rotation,
        facing > 0 ? -1.9 + beat * 0.32 : 1.1 - beat * 0.32,
        2.35, reduced ? 2 : 8 - i * 1.2,
        i % 2 ? secondary : primary, envelope * (0.47 - i * 0.08));
    }
    if (reduced) return;
    for (let i = 0; i < 8; i++) {
      const lane = i - 3.5;
      const startX = actor.x - facing * (37 + noise(i + 4) * 39);
      const startY = chest + lane * 15;
      this.ray(this.back, startX, startY,
        startX - facing * (26 + beat * 27), startY + 9, 1,
        i % 3 ? primary : secondary, envelope * (0.2 + noise(i) * 0.25));
    }
    const handX = actor.x + facing * (30 + beat * 12);
    this.glint(this.front, handX, chest + 16, 9, secondary, envelope * 0.74, -0.55);
    if (actor.confirmed && actor.contactFrame >= 0) {
      const age = actor.frame - actor.contactFrame;
      if (age >= 0 && age < 13) {
        const fade = (1 - age / 13) * envelope;
        this.ray(this.front, handX - facing * 19, chest + 49,
          handX + facing * 47, chest - 35, 2.4, secondary, fade * 0.68);
      }
    }
  }

  private drawCritical(actor: SuperEffectActor, chest: number, reduced: boolean, intro: boolean): void {
    const { primary, secondary, shade } = SUPER_EFFECT_PALETTES.critical;
    const envelope = this.bodyEnvelope(actor, intro);
    const elapsed = actor.introFrame + actor.frame;
    const phase = reduced ? 0 : elapsed * 0.042;
    const facing = actor.facing < 0 ? -1 : 1;

    this.back.fillStyle(shade, 0.085 * envelope);
    this.back.fillEllipse(actor.x, chest + 12, 205, 224);
    this.blade(this.back, actor.x, chest + 9, 109, 65, facing * -0.58,
      -1.4 + phase, 3.75, reduced ? 3 : 12, primary, envelope * 0.46);
    this.blade(this.back, actor.x + facing * 14, chest + 5, 121, 67, facing * -0.58,
      -1.25 + phase, 2.55, reduced ? 1 : 3.6, secondary, envelope * 0.62);

    const count = reduced ? 5 : 18;
    for (let i = 0; i < count; i++) {
      const angle = i * TAU / count + noise(i + 9) * 0.13;
      const cycle = reduced ? 0.35 : (elapsed * 0.028 + noise(i + 11)) % 1;
      const radius = 85 + cycle * 63;
      const length = reduced ? 8 : 13 + cycle * 48;
      const x = actor.x + Math.cos(angle) * radius;
      const y = chest + Math.sin(angle) * radius * 0.82;
      this.ray(this.back, x, y, x + Math.cos(angle) * length,
        y + Math.sin(angle) * length * 0.82, i % 4 ? 1 : 2,
        i % 4 ? primary : secondary, (1 - cycle) * envelope * 0.5);
    }
    this.arc(this.front, actor.x, actor.y - 2, 106, 20,
      0.08, 2.95, 2, primary, envelope * 0.38);
    this.glint(this.front, actor.x + facing * 33, chest + 7,
      reduced ? 6 : 13, secondary, envelope * 0.75, -0.63);

    if (actor.confirmed && actor.finishing && actor.target && !reduced) {
      const targetY = actor.target.y - actor.target.height - 65;
      this.ray(this.back, actor.x - facing * 40, chest + 46,
        actor.target.x + facing * 49, targetY - 38,
        2.3, primary, envelope * 0.45);
    }
  }

  private drawImpact(impact: SuperEffectImpact, reduced: boolean): void {
    const duration = impact.blocked ? 17 : impact.finisher ? 34 : 23;
    if (impact.ageFrames < 0 || impact.ageFrames >= duration) return;
    const palette = SUPER_EFFECT_PALETTES[impact.style];
    const progress = impact.ageFrames / duration;
    const expansion = easeOut(progress);
    const fade = (1 - progress) ** 1.5;
    const x = impact.x;
    const y = impact.y;
    const finisher = impact.finisher && !impact.blocked;
    const radius = reduced ? 16 + expansion * 26
      : 13 + expansion * (finisher ? 141 : impact.blocked ? 48 : 73);

    if (impact.blocked) {
      const direction = (impact.direction ?? 1) < 0 ? -1 : 1;
      const rotation = direction < 0 ? Math.PI : 0;
      this.arc(this.front, x, y, radius * 0.6, radius, -1.65, 3.3,
        reduced ? 2 : 3.8, palette.primary, fade * 0.78, rotation);
      this.arc(this.front, x + direction * 4, y, radius * 0.6 + 6, radius + 7,
        -1.5, 3, 1, palette.secondary, fade * 0.55, rotation);
      this.glint(this.front, x, y, reduced ? 7 : 12, palette.secondary, fade, direction * 0.3);
      return;
    }

    this.back.fillStyle(palette.shade, fade * (finisher ? 0.14 : 0.09));
    this.back.fillEllipse(x, y, radius * 2.2, radius * 1.9);
    this.arc(this.back, x, y, radius, radius * 0.78,
      -0.75, 4.8, finisher ? 5 : 2.6, palette.primary, fade * 0.66);
    this.arc(this.front, x, y, radius * 0.72, radius * 0.72,
      0.4, 3.7, 1.2, palette.secondary, fade * 0.73);
    this.glint(this.front, x, y, (finisher ? 27 : 17) * (1 - progress) + 3,
      palette.secondary, fade, -0.57);
    if (reduced) return;

    const angle = (noise(impact.seed + 2) - 0.5) * 1.1 - 0.65;
    const length = (finisher ? 139 : 80) * (0.58 + expansion * 0.42);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // A broad translucent brush stroke, a sharp core and an offset hairline.
    this.ray(this.front, x - cos * length, y - sin * length,
      x + cos * length, y + sin * length, finisher ? 7 : 4,
      palette.primary, fade * 0.74);
    this.ray(this.front, x - cos * length * 0.7, y - sin * length * 0.7,
      x + cos * length * 0.85, y + sin * length * 0.85,
      1.9, WHITE, fade * 0.8);
    this.ray(this.front, x - cos * length * 0.75 - sin * 8,
      y - sin * length * 0.75 + cos * 8,
      x + cos * length * 0.95 - sin * 8,
      y + sin * length * 0.95 + cos * 8, 1, palette.secondary, fade * 0.56);

    const count = finisher ? 20 : 11;
    for (let i = 0; i < count; i++) {
      const direction = i * TAU / count + noise(impact.seed + i * 3) * 0.34;
      const reach = radius * (0.55 + noise(i + impact.seed + 1) * 0.62);
      const shard = (finisher ? 22 : 12) * (1 - progress)
        + noise(impact.seed + i + 21) * 11;
      const px = x + Math.cos(direction) * reach;
      const py = y + Math.sin(direction) * reach * 0.82;
      const endX = px + Math.cos(direction) * shard;
      const endY = py + Math.sin(direction) * shard * 0.82;
      this.ray(this.front, px, py, endX, endY, i % 3 ? 1.1 : 2,
        i % 3 ? palette.primary : palette.secondary, fade * 0.8);
      if (i % 5 === 0) this.glint(this.front, endX, endY, 3, palette.secondary, fade, angle);
    }
    if (finisher) {
      this.blade(this.back, x, y, radius * 1.2, radius * 0.66,
        -0.45, 0.2, 2.5, 6 * fade, palette.secondary, fade * 0.65);
      this.blade(this.front, x, y, radius * 1.08, radius * 0.64,
        -0.45, 3.4, 1.95, 3.5 * fade, palette.primary, fade * 0.7);
    }
  }

  private bodyEnvelope(actor: SuperEffectActor, intro: boolean): number {
    // SA2's six recovery frames must not dim its entire 124-frame awakening.
    if (intro) return actor.style === "install" ? 0.9 : 0.48;
    const remaining = Math.max(0, actor.duration - actor.frame);
    return Math.min(1, remaining / Math.max(1, Math.min(12, actor.duration)));
  }

  private arc(
    graphics: Graphics, x: number, y: number, rx: number, ry: number,
    start: number, sweep: number, width: number, color: number, alpha: number, rotation = 0,
  ): void {
    if (alpha <= 0.002 || width <= 0) return;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const steps = 28;
    graphics.lineStyle(width, color, alpha);
    graphics.beginPath();
    for (let i = 0; i <= steps; i++) {
      const angle = start + sweep * i / steps;
      const px = Math.cos(angle) * rx;
      const py = Math.sin(angle) * ry;
      const targetX = x + px * cos - py * sin;
      const targetY = y + px * sin + py * cos;
      if (i === 0) graphics.moveTo(targetX, targetY);
      else graphics.lineTo(targetX, targetY);
    }
    graphics.strokePath();
  }

  /** An elliptical brush stroke with tapered ends, rather than a uniform ring. */
  private blade(
    graphics: Graphics, x: number, y: number, rx: number, ry: number,
    rotation: number, start: number, sweep: number, width: number, color: number, alpha: number,
  ): void {
    if (alpha <= 0.002 || width <= 0) return;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const steps = 25;
    graphics.fillStyle(color, alpha * 0.14);
    this.bladePath(graphics, x, y, rx, ry, cos, sin, start, sweep, width * 3, steps);
    graphics.fillStyle(color, alpha);
    this.bladePath(graphics, x, y, rx, ry, cos, sin, start, sweep, width, steps);
    this.arc(graphics, x, y, rx + width * 0.28, ry + width * 0.28,
      start + sweep * 0.15, sweep * 0.7, 0.9, WHITE, alpha * 0.6, rotation);
  }

  private bladePath(
    graphics: Graphics, x: number, y: number, rx: number, ry: number,
    cos: number, sin: number, start: number, sweep: number, width: number, steps: number,
  ): void {
    graphics.beginPath();
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i <= steps; i++) {
        const t = side === 0 ? i / steps : 1 - i / steps;
        const angle = start + sweep * t;
        const thickness = Math.sin(Math.PI * t) ** 0.8 * width * (side === 0 ? 1 : -1);
        const px = Math.cos(angle) * (rx + thickness);
        const py = Math.sin(angle) * (ry + thickness);
        const targetX = x + px * cos - py * sin;
        const targetY = y + px * sin + py * cos;
        if (side === 0 && i === 0) graphics.moveTo(targetX, targetY);
        else graphics.lineTo(targetX, targetY);
      }
    }
    graphics.closePath();
    graphics.fillPath();
  }

  private ray(
    graphics: Graphics, x: number, y: number, endX: number, endY: number,
    width: number, color: number, alpha: number,
  ): void {
    if (alpha <= 0.002) return;
    graphics.lineStyle(width * 5, color, alpha * 0.055);
    graphics.lineBetween(x, y, endX, endY);
    graphics.lineStyle(width * 2.2, color, alpha * 0.17);
    graphics.lineBetween(x, y, endX, endY);
    graphics.lineStyle(width, color, alpha);
    graphics.lineBetween(x, y, endX, endY);
  }

  private glint(
    graphics: Graphics, x: number, y: number, radius: number,
    color: number, alpha: number, rotation: number,
  ): void {
    if (alpha <= 0.002) return;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    graphics.fillStyle(color, alpha * 0.13);
    graphics.fillCircle(x, y, radius * 0.63);
    graphics.fillStyle(color, alpha);
    for (let i = 0; i < 4; i++) {
      const sign = i < 2 ? 1 : -1;
      const horizontal = i % 2 === 0;
      const dx = horizontal ? radius * sign : 0;
      const dy = horizontal ? 0 : radius * 0.72 * sign;
      const width = Math.min(2.3, radius * 0.15);
      const wx = horizontal ? -sin * width : cos * width;
      const wy = horizontal ? cos * width : sin * width;
      graphics.fillTriangle(x + wx, y + wy, x - wx, y - wy,
        x + dx * cos - dy * sin, y + dx * sin + dy * cos);
    }
    graphics.fillStyle(WHITE, alpha * 0.9);
    graphics.fillCircle(x, y, Math.min(2, radius * 0.14));
  }
}
