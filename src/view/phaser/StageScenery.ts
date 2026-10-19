import Phaser from "phaser";
import { getStage, STAGES, type Stage, type StageId } from "../../content/stages";
import { ARENA } from "../../engine/types";

const FONT = 'Arial, "Microsoft YaHei", sans-serif';
// Trim unused sky so the back edge of each court sits above the simulation's
// minimum foot position. The shared square arena stays unchanged on every map.
const SKY_TRIM: Record<StageId, number> = {
  metro: 0.125, temple: 0.11, market: 0.08,
  foundry: 0.10, beach: 0.10, colosseum: 0.09,
};
let nextSceneryId = 0;

type Mote = {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
  alpha: number;
};

/** Stage artwork is shared across switches; only the scenery's own objects are rebuilt. */
export function preloadStages(scene: Phaser.Scene): void {
  for (const stage of STAGES) {
    const key = `stage-${stage.id}`;
    if (!scene.textures.exists(key)) scene.load.image(key, stage.image);
  }
}

export class StageScenery {
  private readonly scene: Phaser.Scene;
  private readonly shadeKey: string;
  private stage: Stage;
  private backdrop?: Phaser.GameObjects.Container;
  private ambience?: Phaser.GameObjects.Graphics;
  private motes: Mote[] = [];
  private elapsed = 0;
  private reducedMotion = false;
  private motionPreference?: MediaQueryList;
  private destroyed = false;

  constructor(scene: Phaser.Scene, initial: StageId) {
    this.scene = scene;
    this.stage = getStage(initial);
    this.shadeKey = `stage-edge-shade-${nextSceneryId++}`;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this.motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion = this.motionPreference.matches;
      this.motionPreference.addEventListener?.("change", this.onMotionPreference);
    }
    this.prepareShade();
    this.build();
  }

  get selectedId(): StageId {
    return this.stage.id;
  }

  setStage(id: StageId): void {
    if (this.destroyed) return;
    const next = getStage(id);
    if (next.id === this.stage.id && this.backdrop) return;
    this.clear();
    this.stage = next;
    this.elapsed = 0;
    this.build();
  }

  update(deltaSeconds: number): void {
    if (this.destroyed || this.reducedMotion || !this.ambience) return;
    const delta = Math.min(0.05, Math.max(0, deltaSeconds));
    this.elapsed += delta;
    this.moveMotes(delta);
    this.drawAmbience();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.motionPreference?.removeEventListener?.("change", this.onMotionPreference);
    this.clear();
    if (this.scene.textures.exists(this.shadeKey)) this.scene.textures.remove(this.shadeKey);
  }

  private readonly onMotionPreference = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
  };

  private clear(): void {
    this.backdrop?.destroy(true);
    this.ambience?.destroy();
    this.backdrop = undefined;
    this.ambience = undefined;
    this.motes = [];
  }

  private build(): void {
    const root = this.scene.add.container(0, 0).setDepth(-100);
    this.backdrop = root;
    const imageKey = `stage-${this.stage.id}`;
    if (this.scene.textures.exists(imageKey)) {
      const texture = this.scene.textures.get(imageKey);
      if (!texture.has("court")) {
        const source = texture.getSourceImage();
        const trim = Math.round(source.height * SKY_TRIM[this.stage.id]);
        texture.add("court", 0, 0, trim, source.width, source.height - trim);
      }
      root.add(this.scene.add.image(360, 360, imageKey, "court").setDisplaySize(720, 720));
    } else {
      this.drawFallback(root);
    }
    root.add(this.scene.add.image(360, 360, this.shadeKey));
    this.drawBoundary(root);
    this.drawLettering(root);
    this.seedMotes();
    this.ambience = this.scene.add.graphics().setDepth(-90);
    this.drawAmbience();
  }

  private prepareShade(): void {
    const texture = this.scene.textures.createCanvas(this.shadeKey, 720, 720);
    if (!texture) return;
    const context = texture.getContext();
    const top = context.createLinearGradient(0, 0, 0, 182);
    top.addColorStop(0, "rgba(8, 10, 18, 0.86)");
    top.addColorStop(0.55, "rgba(8, 10, 18, 0.38)");
    top.addColorStop(1, "rgba(8, 10, 18, 0)");
    context.fillStyle = top;
    context.fillRect(0, 0, 720, 182);
    const bottom = context.createLinearGradient(0, 595, 0, 720);
    bottom.addColorStop(0, "rgba(8, 10, 18, 0)");
    bottom.addColorStop(1, "rgba(8, 10, 18, 0.91)");
    context.fillStyle = bottom;
    context.fillRect(0, 595, 720, 125);
    const edges = context.createRadialGradient(360, 380, 210, 360, 380, 510);
    edges.addColorStop(0, "rgba(7, 9, 17, 0)");
    edges.addColorStop(1, "rgba(7, 9, 17, 0.35)");
    context.fillStyle = edges;
    context.fillRect(0, 0, 720, 720);
    texture.refresh();
  }

  private drawBoundary(root: Phaser.GameObjects.Container): void {
    const { left, right, top, bottom } = ARENA;
    const marks = this.scene.add.graphics();
    // Short painted marks preserve the floor's material instead of enclosing it in a panel.
    marks.lineStyle(1, 0xffffff, 0.12);
    for (const [x, direction] of [[left, 1], [right, -1]] as const) {
      for (const [y, vertical] of [[top, 1], [bottom, -1]] as const) {
        marks.beginPath()
          .moveTo(x, y + vertical * 22)
          .lineTo(x, y)
          .lineTo(x + direction * 22, y)
          .strokePath();
        marks.lineStyle(2, this.stage.color, 0.36)
          .lineBetween(x + direction * 5, y, x + direction * 14, y)
          .lineStyle(1, 0xffffff, 0.12);
      }
    }
    marks.lineStyle(1, this.stage.color, 0.13)
      .lineBetween(338, bottom, 348, bottom)
      .lineBetween(372, bottom, 382, bottom);
    root.add(marks);
  }

  private drawLettering(root: Phaser.GameObjects.Container): void {
    const addText = (
      x: number,
      y: number,
      text: string,
      size: number,
      color: string,
      spacing = 0,
    ): Phaser.GameObjects.Text => {
      const label = this.scene.add.text(x, y, text, {
        fontFamily: FONT,
        fontSize: `${size}px`,
        color,
        letterSpacing: spacing,
        shadow: { offsetY: 1, color: "#000000", blur: 5, fill: true },
      });
      root.add(label);
      return label;
    };
    const line = this.scene.add.graphics();
    line.fillStyle(this.stage.color, 0.95).fillRect(35, 28, 23, 2);
    line.fillStyle(0xffffff, 0.16).fillRect(66, 28, 99, 1);
    line.fillStyle(this.stage.color, 0.8).fillRect(35, 659, 3, 35);
    root.add(line);
    addText(35, 39, `STAGE ${this.stage.number}  /  ARENA LAB`, 9, "#d7d7df", 2);
    addText(33, 58, this.stage.englishName, 26, "#fff6e9", 1.6)
      .setFontStyle("bold");
    addText(35, 94, this.stage.location, 11, "#d2ced1", 1);
    addText(684, 39, "LOCAL TIME", 8, "#cfccd4", 1.8).setOrigin(1, 0);
    addText(686, 55, this.stage.time, 25, this.stage.accent, 1.5)
      .setOrigin(1, 0)
      .setFontStyle("bold");
    addText(48, 659, "THE LITTLE FIGHT CLUB", 9, "#f3e8de", 2.4);
    addText(48, 680, "ONE STAGE. ENDLESS POSSIBILITIES.", 8, "#bbb8c2", 1.4);
    addText(685, 658, this.stage.name, 18, "#f4eae1", 2).setOrigin(1, 0);
    addText(685, 685, `${this.stage.number}  /  06`, 9, this.stage.accent, 2).setOrigin(1, 0);
  }

  private drawFallback(root: Phaser.GameObjects.Container): void {
    const graphics = this.scene.add.graphics();
    const warm = ["temple", "market", "foundry", "colosseum"].includes(this.stage.id);
    const sky = this.stage.id === "beach" ? 0x5e797e : warm ? 0x352c30 : 0x151b36;
    const floor = this.stage.id === "beach" ? 0x71604b : warm ? 0x403a3b : 0x292d46;
    graphics.fillGradientStyle(sky, sky, floor, floor, 1).fillRect(0, 0, 720, 720);
    graphics.fillStyle(0x0e1522, 0.5);
    for (let i = 0; i < 9; i += 1) {
      const x = i * 90 - 35;
      const height = 90 + ((i * 47) % 100);
      graphics.fillRect(x, 202 - height, 67, height);
      graphics.lineStyle(2, this.stage.color, 0.2).lineBetween(x + 7, 199, x + 60, 199);
    }
    // A muted perspective court is kept legible even if artwork cannot be loaded.
    graphics.lineStyle(1, 0xf2d3bc, 0.09);
    for (let x = -600; x < 1300; x += 115) graphics.lineBetween(360 + (x - 360) * 0.25, 175, x, 720);
    for (let y = 200; y < 720; y += 48) graphics.lineBetween(0, y, 720, y);
    graphics.fillStyle(this.stage.color, 0.05).fillEllipse(360, 390, 660, 500);
    root.add(graphics);
  }

  private seedMotes(): void {
    const count = this.stage.ambience === "rain" ? 40 : this.stage.ambience === "lanterns" ? 12 : 26;
    // This local generator never consumes the battle's deterministic random stream.
    let seed = Number(this.stage.number) * 167;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let i = 0; i < count; i += 1) {
      this.motes.push({
        x: 24 + random() * 672,
        y: 115 + random() * 530,
        speed: 9 + random() * 19,
        size: 1 + random() * 2.5,
        phase: random() * Math.PI * 2,
        alpha: 0.12 + random() * 0.19,
      });
    }
  }

  private moveMotes(delta: number): void {
    const ambience = this.stage.ambience;
    for (const mote of this.motes) {
      if (ambience === "rain") {
        mote.x -= delta * 28;
        mote.y += delta * (195 + mote.speed * 3);
      } else if (ambience === "leaves") {
        mote.x += delta * (mote.speed * 0.7 + Math.sin(this.elapsed + mote.phase) * 9);
        mote.y += delta * (mote.speed * 0.55);
      } else if (ambience === "embers" || ambience === "lanterns") {
        mote.x += Math.sin(this.elapsed * 0.8 + mote.phase) * delta * 7;
        mote.y -= delta * mote.speed;
      } else {
        mote.x += delta * (ambience === "sea" ? mote.speed : mote.speed * 0.25);
        mote.y += Math.sin(this.elapsed * 0.5 + mote.phase) * delta * 3;
      }
      if (mote.x < 12) mote.x = 708;
      if (mote.x > 708) mote.x = 12;
      if (mote.y > 655) mote.y = 115;
      if (mote.y < 110) mote.y = 650;
    }
  }

  private drawAmbience(): void {
    const graphics = this.ambience;
    if (!graphics) return;
    graphics.clear();
    const ambience = this.stage.ambience;
    if (ambience === "lanterns") {
      for (const [index, x] of [82, 205, 526, 647].entries()) {
        const pulse = 0.8 + Math.sin(this.elapsed * 1.2 + index * 1.7) * 0.12;
        const y = index % 2 ? 102 : 136;
        graphics.fillStyle(0xffb95e, 0.018 * pulse).fillCircle(x, y, 45)
          .fillStyle(0xffb95e, 0.025 * pulse).fillCircle(x, y, 27);
      }
      this.drawSteam(graphics, 42, 570, 0.8);
      this.drawSteam(graphics, 675, 490, 1.4);
    } else if (ambience === "embers") {
      this.drawSteam(graphics, 42, 330, 1.2);
      this.drawSteam(graphics, 680, 540, 2.4);
    } else if (ambience === "sea") {
      for (let i = 0; i < 13; i += 1) {
        const x = 80 + i * 45;
        const y = 138 + Math.sin(i * 3.7) * 12;
        const alpha = 0.06 + Math.max(0, Math.sin(this.elapsed * 1.3 + i * 2.7)) * 0.14;
        graphics.lineStyle(1, 0xffe5ad, alpha)
          .lineBetween(x - 3, y, x + 5 + Math.sin(this.elapsed + i) * 2, y);
      }
    }
    for (const mote of this.motes) {
      const edge = mote.x < 125 || mote.x > 595;
      const alpha = mote.alpha * (edge ? 1 : 0.48);
      if (ambience === "rain") {
        graphics.lineStyle(0.8, 0xc4d7fa, alpha * 0.65)
          .lineBetween(mote.x, mote.y, mote.x - 2.5, mote.y + 11 + mote.size * 2);
      } else if (ambience === "leaves") {
        const sway = Math.sin(this.elapsed * 1.4 + mote.phase);
        graphics.fillStyle(mote.phase < 3 ? 0xe29459 : 0xc95140, alpha * 1.2)
          .fillTriangle(
            mote.x - mote.size, mote.y,
            mote.x + mote.size, mote.y + sway * 2,
            mote.x + sway * 2, mote.y + mote.size * 1.5,
          );
      } else if (ambience === "lanterns") {
        // Only peripheral motes accompany the lanterns; the center stays quiet.
        if (!edge) continue;
        graphics.fillStyle(0xffd58e, alpha * 0.6).fillCircle(mote.x, mote.y, mote.size * 0.45);
      } else if (ambience === "embers") {
        if (!edge && mote.y > 230) continue;
        graphics.fillStyle(0xffaa66, alpha).fillCircle(mote.x, mote.y, mote.size * 0.6)
          .lineStyle(0.8, 0xffbf7a, alpha * 0.5)
          .lineBetween(mote.x, mote.y + 4, mote.x, mote.y + 7);
      } else if (ambience === "sea") {
        if (!edge) continue;
        graphics.lineStyle(0.8, 0xffe8c7, alpha * 0.5)
          .lineBetween(mote.x, mote.y, mote.x + mote.size * 2, mote.y - 0.7);
      } else {
        const shimmer = 0.65 + Math.sin(this.elapsed + mote.phase) * 0.3;
        graphics.fillStyle(0xffe4a3, alpha * shimmer)
          .fillCircle(mote.x, mote.y, mote.size * 0.48);
      }
    }
  }

  private drawSteam(graphics: Phaser.GameObjects.Graphics, x: number, y: number, offset: number): void {
    for (let i = 0; i < 5; i += 1) {
      const progress = ((this.elapsed * 0.13 + i / 5 + offset) % 1);
      const drift = Math.sin(progress * 4 + offset) * 10;
      graphics.fillStyle(0xf6e2cc, Math.sin(progress * Math.PI) * 0.035)
        .fillEllipse(x + drift, y - progress * 85, 14 + progress * 31, 8 + progress * 18);
    }
  }
}
