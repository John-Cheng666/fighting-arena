import nativeData from "../characters/jamie/data/native-numerics.json";

export type DrawnSuper = "SA3" | "CA";
export const FPS = 60;
export const CEL_COUNT = 24;
export const CEL_FRAMES = 6;
export const ART_FRAMES = CEL_COUNT * CEL_FRAMES;
export const ASSET_ROOT = "/assets/jamie/drawn-supers-v1/";

export const CLIPS = {
  SA3: {
    image: "sa3-atlas.webp", row: 89, nativeStart: 279, duration: 174,
    title: "连续打击 → 双脚终结",
    description: "跟随双人的原版动作采样重绘，保留出手与受击的对应关系，以及终结踢的镜头切换。",
    phases: [[0, "连续打击"], [60, "蓄势转换"], [96, "双脚终结"], [120, "击飞收束"]] as const,
  },
  CA: {
    image: "ca-atlas.webp", row: 90, nativeStart: 318, duration: 196,
    title: "抓喉近景 → 终结连打",
    description: "单独重绘抓喉、拉近与释放后的终结连打。保留两张脸的近景关系，以及最后一击的机位变化。",
    phases: [[0, "抓喉近景"], [66, "拉近 · 释放"], [90, "终结连打"], [132, "最后一击"]] as const,
  },
} as const;

export interface DrawnContact { frame: number; damage: number; finisher: boolean }
export function contactsFor(mode: DrawnSuper): DrawnContact[] {
  const clip = CLIPS[mode];
  const hits = nativeData.rows.find(row => row.row === clip.row)!.captured!.hits;
  const damaging = hits.filter(hit => hit.damage > 0);
  const last = damaging.at(-1)!.from;
  return damaging.filter(hit => hit.from >= clip.nativeStart && hit.from < clip.nativeStart + ART_FRAMES)
    .map(hit => ({ frame: hit.from - clip.nativeStart, damage: hit.damage, finisher: hit.from === last }));
}

export function clampFrame(mode: DrawnSuper, value: number): number {
  return Math.max(0, Math.min(CLIPS[mode].duration, Number.isFinite(value) ? value : 0));
}

/** The 60 Hz review clock never invents intermediate poses or blends two bodies.
 * Each redrawn cel covers six ticks; the last cel holds for the original audio tail. */
export function sampleClip(mode: DrawnSuper, value: number) {
  const frame = clampFrame(mode, value), clip = CLIPS[mode];
  const cel = Math.min(CEL_COUNT - 1, Math.floor(frame / CEL_FRAMES));
  const phase = [...clip.phases].reverse().find(([start]) => frame >= start)![1];
  const contact = [...contactsFor(mode)].reverse().find(hit => hit.frame <= frame && frame - hit.frame < 10);
  return { frame, cel, nativeFrame: clip.nativeStart + frame, phase,
    tail: frame >= ART_FRAMES, contact, contactAge: contact ? frame - contact.frame : 0 };
}
