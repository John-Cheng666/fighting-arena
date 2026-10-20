import { sampleClip, type DrawnSuper } from "./timeline";

export class AtlasRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly motionPreference = matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法创建二维画布");
    this.context = context;
  }

  draw(image: HTMLImageElement, mode: DrawnSuper, frame: number): void {
    const context = this.context, sample = sampleClip(mode, frame);
    const width = this.canvas.width, height = this.canvas.height;
    const cellWidth = image.naturalWidth / 4, cellHeight = image.naturalHeight / 6;
    // Round each shared grid edge independently: the generated atlases have
    // non-divisible dimensions. An inset prevents neighboring cels from bleeding.
    const column = sample.cel % 4, row = Math.floor(sample.cel / 4);
    const x = Math.round(column * cellWidth) + 2, y = Math.round(row * cellHeight) + 1;
    const sourceWidth = Math.round((column + 1) * cellWidth) - x - 2;
    const sourceHeight = Math.round((row + 1) * cellHeight) - y - 1;
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale, drawHeight = sourceHeight * scale;
    const impulse = sample.contact && !this.motionPreference.matches
      ? (sample.contact.finisher ? 2.1 : 1.1) * Math.exp(-sample.contactAge * 0.5) : 0;
    context.fillStyle = "#08090b";
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(Math.sin(sample.contactAge * 2.1) * impulse, Math.cos(sample.contactAge * 1.7) * impulse * 0.5);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, x, y, sourceWidth, sourceHeight,
      (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    context.restore();
    if (sample.contact && sample.contactAge < 3 && !this.motionPreference.matches) {
      // The cel already contains drawn hit light; this is a restrained, short
      // screen pulse at the verified contact, never at a zero-damage release.
      context.fillStyle = `rgba(255,234,193,${0.035 * (1 - sample.contactAge / 3)})`;
      context.fillRect(0, 0, width, height);
    }
    const vignette = context.createRadialGradient(width / 2, height / 2, height * 0.25,
      width / 2, height / 2, width * 0.65);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,.2)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);
  }
}
