import { getJamieState } from "../../state";
import type { Fighter } from "../../../../engine/types";
import type { JamieAction } from "../../types";
import { JAMIE_VARIANT_BY_ID, type JamieVariant } from "../../moves";

export type Point = { x: number; y: number };
export type Pose = {
  hip: Point; shoulder: Point; head: Point;
  rearElbow: Point; rearHand: Point; elbow: Point; hand: Point;
  rearKnee: Point; rearFoot: Point; knee: Point; foot: Point;
  gourd: boolean; gourdAngle: number; openHand: boolean;
  faceTurn?: number;
};
type PoseEdit = Partial<Record<Exclude<keyof Pose, "gourd" | "gourdAngle" | "openHand" | "faceTurn">, [number, number]>> & Pick<Partial<Pose>, "gourd" | "gourdAngle" | "openHand" | "faceTurn">;
export const p = (x: number, y: number): Point => ({ x, y });
export const JAMIE_RIG_SCALE = 1.08;
const joints = ["hip", "shoulder", "head", "rearElbow", "rearHand", "elbow", "hand", "rearKnee", "rearFoot", "knee", "foot"] as const;

export function neutralPose(time = 0, moving = false): Pose {
  const bounce = Math.sin(time * (moving ? 10 : 3)) * (moving ? 1.4 : 0.35);
  const stride = moving ? Math.sin(time * 10) * 10 : 0;
  return {
    hip: p(-4, -53 + bounce), shoulder: p(-2, -88 + bounce), head: p(1, -110 + bounce),
    rearElbow: p(-21, -76 + bounce), rearHand: p(-8, -64 + bounce),
    elbow: p(20, -84 + bounce), hand: p(33, -98 + bounce),
    rearKnee: p(-23, -29), rearFoot: p(-34 + stride, 0), knee: p(20, -27), foot: p(33 - stride, 0),
    gourd: false, gourdAngle: 0, openHand: true,
  };
}

function edit(base: Pose, values: PoseEdit): Pose {
  const result = { ...base };
  for (const joint of joints) {
    const value = values[joint];
    result[joint] = value ? p(value[0], value[1]) : p(base[joint].x, base[joint].y);
  }
  result.gourd = values.gourd ?? base.gourd;
  result.gourdAngle = values.gourdAngle ?? base.gourdAngle;
  result.openHand = values.openHand ?? base.openHand;
  result.faceTurn = values.faceTurn ?? base.faceTurn;
  return result;
}

function mix(a: Pose, b: Pose, t: number): Pose {
  const u = Math.max(0, Math.min(1, t));
  const value = u * u * (3 - 2 * u);
  const result = { ...b };
  for (const joint of joints) result[joint] = p(a[joint].x + (b[joint].x - a[joint].x) * value, a[joint].y + (b[joint].y - a[joint].y) * value);
  result.gourdAngle = a.gourdAngle + (b.gourdAngle - a.gourdAngle) * value;
  return result;
}

function crouch(base: Pose): Pose {
  return edit(base, { hip: [-7, -29], shoulder: [-4, -63], head: [0, -84], rearElbow: [-22, -48], rearHand: [-7, -42], elbow: [20, -58], hand: [33, -75], knee: [23, -15], foot: [40, 0], rearKnee: [-25, -13], rearFoot: [-34, 0] });
}

function drink(base: Pose, lift = 1, wipe = false): Pose {
  return edit(base, wipe
    ? { shoulder: [-7, -87], head: [-8, -110], elbow: [23, -103], hand: [-14, -105], rearElbow: [-25, -76], rearHand: [-19, -58], gourd: false }
    : { hip: [-5, -52], shoulder: [-10, -88], head: [-15, -112], elbow: [16, -92 - lift * 18], hand: [10 - lift * 15, -75 - lift * 55], rearElbow: [-28, -70], rearHand: [-8, -59], gourd: true, gourdAngle: -0.2 - lift * 1.8 });
}

function handstand(base: Pose, angle: number, length = 66, oneHand = false): Pose {
  const hip = p(-5, -66);
  const foot = p(hip.x + Math.cos(angle) * length, hip.y - 13 + Math.sin(angle) * length * 0.77);
  const rearFoot = p(hip.x - Math.cos(angle + 0.4) * length, hip.y - 19 - Math.sin(angle + 0.4) * length * 0.7);
  return edit(base, {
    hip: [hip.x, hip.y], shoulder: [1, -35], head: [6, -17], elbow: [20, -18], hand: [29, -1],
    rearElbow: oneHand ? [-24, -40] : [-19, -19], rearHand: oneHand ? [-41, -58] : [-26, -1],
    knee: [(hip.x + foot.x) / 2 + 3, (hip.y + foot.y) / 2 - 6], foot: [foot.x, foot.y],
    rearKnee: [(hip.x + rearFoot.x) / 2 - 4, (hip.y + rearFoot.y) / 2 - 4], rearFoot: [rearFoot.x, rearFoot.y],
  });
}

// One keyed contact silhouette for every normal. These use official row IDs,
// rather than guessing punch/kick from an N number or the coarse action pose.
const normalContacts: PoseEdit[] = [
  { shoulder: [4, -88], elbow: [34, -88], hand: [61, -93], openHand: false },
  { hip: [-12, -53], shoulder: [-12, -89], head: [-10, -112], knee: [27, -24], foot: [66, -18], rearFoot: [-28, 0] },
  { shoulder: [8, -85], head: [10, -108], rearElbow: [30, -81], rearHand: [69, -83], elbow: [15, -68], hand: [8, -87], openHand: false },
  { hip: [-12, -56], shoulder: [-20, -90], head: [-21, -112], knee: [32, -55], foot: [82, -57], rearFoot: [-25, 0] },
  { shoulder: [11, -87], head: [12, -110], elbow: [36, -85], hand: [69, -89], rearElbow: [-11, -74], rearHand: [8, -73], openHand: false },
  { hip: [-10, -53], shoulder: [-24, -89], head: [-30, -110], knee: [29, -83], foot: [88, -104], rearFoot: [-21, 0], rearElbow: [-43, -86], rearHand: [-55, -103], elbow: [-3, -78], hand: [8, -95] },
  { shoulder: [2, -61], head: [4, -82], elbow: [28, -58], hand: [55, -58], openHand: false },
  { hip: [-11, -28], knee: [31, -12], foot: [72, -2], rearKnee: [-27, -12], rearFoot: [-42, 0] },
  { shoulder: [5, -63], head: [8, -84], rearElbow: [27, -62], rearHand: [63, -66], elbow: [20, -52], hand: [7, -64], openHand: false },
  { hip: [-15, -25], shoulder: [-10, -59], head: [-8, -80], knee: [32, -12], foot: [88, -4], rearKnee: [-26, -8], rearFoot: [-48, 0] },
  { hip: [-6, -34], shoulder: [-1, -69], head: [-4, -91], elbow: [21, -89], hand: [32, -124], rearElbow: [-23, -49], rearHand: [-10, -42], openHand: false },
  { hip: [-12, -23], shoulder: [-29, -47], head: [-39, -64], elbow: [-14, -25], hand: [-8, -1], rearElbow: [-48, -42], rearHand: [-58, -55], knee: [35, -9], foot: [90, -2], rearKnee: [-23, -12], rearFoot: [-45, -2] },
  { knee: [14, -37], foot: [-4, -20], rearKnee: [-24, -45], rearFoot: [-36, -24], elbow: [25, -99], hand: [49, -109], openHand: false },
  { knee: [25, -45], foot: [48, -37], rearKnee: [-26, -43], rearFoot: [-40, -18], elbow: [23, -98], hand: [23, -118] },
  { shoulder: [9, -85], head: [12, -106], rearElbow: [29, -83], rearHand: [58, -67], elbow: [14, -94], hand: [8, -108], knee: [23, -38], foot: [6, -22], rearKnee: [-26, -40], rearFoot: [-39, -19], openHand: false },
  { shoulder: [-16, -88], head: [-20, -111], hip: [-9, -52], knee: [34, -49], foot: [86, -46], rearKnee: [-29, -38], rearFoot: [-53, -31], elbow: [8, -94], hand: [16, -116] },
  { shoulder: [13, -82], head: [13, -104], elbow: [34, -72], hand: [58, -60], rearElbow: [25, -85], rearHand: [51, -66], knee: [20, -38], foot: [0, -20], rearKnee: [-22, -44], rearFoot: [-37, -25], openHand: false },
  { shoulder: [-19, -85], head: [-25, -108], hip: [-8, -53], knee: [36, -57], foot: [89, -64], rearKnee: [-29, -43], rearFoot: [-58, -44], elbow: [7, -93], hand: [19, -112], rearElbow: [-36, -91], rearHand: [-43, -113] },
];

function contactPose(base: Pose, variant: JamieVariant, phase: number): Pose {
  const row = variant.row;
  if (row < 18) {
    if (row === 4) {
      const segment = Math.floor(phase * 3) % 3;
      return edit(base, segment === 1 ? { shoulder: [10, -85], rearElbow: [38, -81], rearHand: [65, -78], elbow: [13, -72], hand: [5, -88], openHand: false } : segment === 2 ? { shoulder: [14, -87], elbow: [41, -87], hand: [76, -89], rearElbow: [-10, -73], rearHand: [2, -68] } : normalContacts[row]);
    }
    return edit(base, normalContacts[row]);
  }
  if (row === 18) return edit(handstand(base, -1.18, 75, true), { hip: [-6, -60], shoulder: [-21, -37], head: [-34, -28], elbow: [-7, -18], hand: [4, -1], rearElbow: [-42, -50], rearHand: [-54, -68], knee: [15, -92], foot: [60, -128], rearKnee: [-30, -27], rearFoot: [-48, 0] });
  if (row === 19) return edit(base, { hip: [-18, -19], shoulder: [-27, -40], head: [-42, -45], elbow: [-16, -20], hand: [0, -1], rearElbow: [-45, -23], rearHand: [-55, -5], knee: [25, -29], foot: [74, -58], rearKnee: [-14, -13], rearFoot: [-39, -1] });
  if ([20, 29, 37].includes(row)) return drink(base);
  if (row === 21 || row === 27) return handstand(base, -0.6 + phase * 0.6, 75, true);
  if (row === 22 || row === 30) return edit(base, { hip: [-2, -49], shoulder: [16, -84], head: [9, -108], rearElbow: [51, -87], rearHand: [28, -104], elbow: [28, -70], hand: [12, -79], rearFoot: [-41, 0], foot: [35, 0], faceTurn: -0.25 });
  if (row === 23 || row === 33) return edit(base, { hip: [-11, -52], shoulder: [-25, -82], head: [-32, -104], knee: [29, -33], foot: [85, -23], rearKnee: [-20, -22], rearFoot: [-29, 0], rearElbow: [-46, -79], rearHand: [-61, -65] });
  if (row >= 24 && row <= 26) return edit(base, normalContacts[[0, 1, 2][row - 24]]);
  if (row === 28) return handstand(base, phase * Math.PI * 1.5, 73, true);
  if (row === 31) return edit(base, { shoulder: [13, -81], head: [7, -105], elbow: [41, -94], hand: [68, -84], rearElbow: [-8, -67], rearHand: [0, -56], hip: [1, -47], openHand: false });
  if (row === 32) return edit(base, { hip: [-1, -65], shoulder: [-32, -81], head: [-53, -91], knee: [39, -66], foot: [88, -65], rearKnee: [-18, -38], rearFoot: [-39, -27], elbow: [-20, -64], hand: [-4, -58], rearElbow: [-53, -76], rearHand: [-66, -61] });
  if (row === 34) return edit(base, { shoulder: [-29, -83], head: [-48, -104], hip: [-8, -46], elbow: [-6, -68], hand: [12, -81], rearElbow: [-50, -69], rearHand: [-56, -49], knee: [22, -35], foot: [20, -8], rearFoot: [-38, 0] });
  if (row === 35) return edit(base, { shoulder: [15, -81], head: [15, -104], elbow: [39, -81], hand: [75, -83], hip: [1, -47], foot: [46, 0], rearFoot: [-42, 0] });
  if (row === 36) return edit(crouch(base), { shoulder: [12, -62], head: [11, -84], elbow: [39, -65], hand: [80, -73], hip: [4, -27], foot: [49, 0], rearFoot: [-46, 0] });
  if (row >= 39 && row < 47) return edit(base, { hip: [4, -49], shoulder: [15, -82], head: [16, -105], elbow: [41, -79], hand: [72, -82], rearElbow: [-10, -78], rearHand: [-26, -66], foot: [48, 0], rearFoot: [-35, -1], openHand: false });
  if (row >= 47 && row < 53) return edit(base, { hip: [1, -53], shoulder: [7, -86], head: [2, -110], rearElbow: [34, -94], rearHand: [51, -121], elbow: [19, -73], hand: [10, -86], knee: [28, -50], foot: [43, -30], rearFoot: [-31, 0], openHand: false });
  if (row >= 53 && row < 59) return edit(base, { hip: [8, -43], shoulder: [24, -76], head: [27, -98], elbow: [50, -72], hand: [85, -68], rearElbow: [1, -64], rearHand: [-14, -59], knee: [39, -22], foot: [56, 0], rearFoot: [-42, 0] });
  if (row >= 59 && row < 63) return edit(base, { hip: [-5, -56], shoulder: [-20, -86], head: [-30, -107], rearKnee: [35, -58], rearFoot: [88, -71], knee: [-9, -27], foot: [-24, 0], elbow: [4, -88], hand: [14, -108], rearElbow: [-40, -76], rearHand: [-54, -64] });
  if (row >= 63 && row < 67) return handstand(base, -0.9 + phase * 2.5, 75, true);
  if (row >= 67 && row < 71) return edit(base, { hip: [3, -39], shoulder: [22, -73], head: [25, -96], elbow: [49, -71], hand: [82, -76], rearElbow: [-7, -75], rearHand: [-31, -69], knee: [38, -19], foot: [55, 0], rearKnee: [-22, -20], rearFoot: [-48, -1] });
  if (row >= 71 && row < 75) return handstand(base, -0.65 - phase * 1.3, 81, true);
  if (row >= 75 && row < 79) return edit(base, { hip: [-1, -55], shoulder: [-22, -83], head: [-37, -102], knee: [26, -32], foot: [68, 0], rearKnee: [-22, -45], rearFoot: [-40, -31], elbow: [4, -77], hand: [23, -89], rearElbow: [-41, -72], rearHand: [-56, -89] });
  if (row >= 79 && row < 83) return handstand(base, phase * Math.PI * 6 - 1.2, 75, Math.floor(phase * 8) % 2 === 0);
  if (row === 83 || row === 84) return edit(base, { shoulder: [7, -88], head: [8, -110], elbow: [36, -96], hand: [76, -105], rearElbow: [-23, -70], rearHand: [-6, -62], knee: [27, -27], foot: [45, 0], rearFoot: [-38, 0] });
  if (row === 85 || row === 86) return edit(base, { hip: [7, -32], shoulder: [23, -67], head: [27, -88], elbow: [51, -62], hand: [90, -68], rearElbow: [-7, -68], rearHand: [-27, -57], knee: [40, -16], foot: [58, 0], rearFoot: [-52, -2] });
  if (row === 91) return edit(base, phase < 0.5 ? { shoulder: [14, -82], head: [19, -105], elbow: [38, -80], hand: [66, -86], rearElbow: [23, -70], rearHand: [56, -68], knee: [30, -56], foot: [44, -41] } : { shoulder: [-13, -71], head: [-30, -84], hip: [7, -50], elbow: [0, -50], hand: [19, -22], rearElbow: [21, -75], rearHand: [39, -98], rearKnee: [-30, -23], rearFoot: [-51, 0], knee: [32, -29], foot: [46, 0] });
  if (row === 92) return edit(base, phase < 0.5 ? { hip: [3, -51], shoulder: [12, -82], head: [11, -107], elbow: [39, -80], hand: [61, -92], rearElbow: [22, -69], rearHand: [53, -70], knee: [34, -55], foot: [48, -34] } : { hip: [-4, -52], shoulder: [-23, -76], head: [-39, -91], rearElbow: [-48, -72], rearHand: [-70, -79], elbow: [0, -60], hand: [15, -68], rearKnee: [-19, -27], rearFoot: [-38, 0], knee: [35, -55], foot: [77, -75], faceTurn: -1 });
  if (row === 95) return edit(crouch(base), { shoulder: [14, -65], head: [16, -87], elbow: [42, -65], hand: [80, -69], rearElbow: [-13, -58], rearHand: [-31, -49], knee: [39, -16], foot: [58, 0], rearFoot: [-47, 0] });
  if (row === 96 || row === 97) return edit(crouch(base), { hip: [-5, -22], shoulder: [-24, -46], head: [-36, -64], elbow: [-9, -24], hand: [4, -1], knee: [32, -9], foot: [93, -5], rearKnee: [-24, -12], rearFoot: [-45, 0], rearElbow: [-44, -39], rearHand: [-56, -54] });
  return base;
}

function cinematic(base: Pose, action: JamieAction, variant: JamieVariant): Pose {
  const frame = action.visualFrame ?? action.frame;
  const intro = (action.introFrame ?? 0) / Math.max(1, action.introDuration ?? 1);
  const introducing = (action.introFrame ?? 0) < (action.introDuration ?? 0) && frame === 0;
  if (variant.row === 87) {
    if (introducing) return mix(base, edit(base, { hip: [1, -54], shoulder: [10, -87], head: [13, -108], elbow: [35, -83], hand: [68, -85], rearElbow: [-16, -74], rearHand: [-27, -61] }), intro);
    const plant = edit(crouch(base), { hand: [17, -1], rearHand: [-23, -2], shoulder: [-2, -45], head: [-4, -64] });
    const windows = variant.active;
    const last = windows.length ? windows[windows.length - 1][1] : 133;
    if (frame < 4) return mix(base, plant, frame / 4);
    if (frame < 8) return mix(plant, handstand(base, 0, 76), (frame - 4) / 4);
    if (frame <= last) {
      const centers = windows.map(([start, end]) => (start + end) / 2);
      let angle = 0;
      for (let index = 0; index < centers.length; index++) {
        const next = centers[index + 1] ?? centers[index] + 12;
        if (frame >= centers[index]) angle = index * Math.PI + Math.min(1, (frame - centers[index]) / Math.max(1, next - centers[index])) * Math.PI;
      }
      return handstand(base, angle, 76, Math.floor(angle / Math.PI) % 2 === 0);
    }
    const landing = edit(base, { hip: [-8, -68], shoulder: [-34, -79], head: [-56, -85], knee: [26, -58], foot: [42, -34], rearKnee: [-20, -42], rearFoot: [-39, -28] });
    if (frame < last + 15) return mix(handstand(base, 0.3, 70), landing, (frame - last) / 15);
    if (action.variantId.includes("drink") && frame > last + 25) return drink(base, Math.min(1, (frame - last - 25) / 16));
    return mix(landing, base, (frame - last - 15) / 30);
  }
  if (variant.row === 88) {
    const progress = introducing ? intro : 1;
    if (progress < 0.2) return mix(base, drink(base, 0), progress / 0.2);
    if (progress < 0.58) return drink(base, Math.min(1, (progress - 0.2) / 0.14));
    if (progress < 0.8) return mix(drink(base), drink(base, 0, true), (progress - 0.58) / 0.22);
    return mix(drink(base, 0, true), base, (progress - 0.8) / 0.2);
  }
  if (variant.row === 89 || variant.row === 90) {
    if (action.confirmedAtFrame === undefined) {
      const focus = edit(base, { shoulder: [-12, -86], head: [-10, -109], elbow: [13, -100], hand: [4, -115], rearElbow: [-32, -78], rearHand: [-15, -86], rearFoot: [-41, 0] });
      return introducing ? mix(base, focus, intro) : mix(focus, edit(crouch(base), { shoulder: [15, -66], head: [20, -89], elbow: [43, -67], hand: [77, -66] }), frame / Math.max(1, variant.startup));
    }
    const finish = variant.row === 90 ? 245 : 215;
    const scale = action.cinematicTimeScale ?? 1;
    const elapsed = frame - action.confirmedAtFrame;
    // Only the confirmed performance is time-expanded. Its official recovery
    // remains 42 simulation frames rather than becoming a second slow motion.
    const t = elapsed <= finish * scale ? elapsed / scale : finish + elapsed - finish * scale;
    if (variant.row === 90 && t >= 165) {
      // The separately captured CA match footage shows a throat grip, a pull
      // and a sharp arm retraction. It does not use the standard double kick.
      const caBeats: [number, Pose][] = [
        [165, edit(base, { shoulder: [3, -82], head: [12, -104], rearElbow: [29, -87], rearHand: [59, -96], elbow: [15, -68], hand: [29, -77] })],
        [185, edit(base, { hip: [3, -50], shoulder: [9, -86], head: [11, -110], elbow: [35, -100], hand: [65, -112], rearElbow: [-15, -77], rearHand: [-3, -69], knee: [27, -25], foot: [44, 0], rearFoot: [-41, 0] })],
        [212, edit(base, { hip: [-3, -51], shoulder: [-2, -88], head: [-1, -111], elbow: [26, -100], hand: [54, -112], rearElbow: [-25, -77], rearHand: [-11, -68], knee: [22, -27], foot: [40, 0], rearFoot: [-43, 0] })],
        [235, edit(base, { hip: [-9, -52], shoulder: [-17, -91], head: [-24, -114], elbow: [11, -100], hand: [35, -112], rearElbow: [-40, -83], rearHand: [-53, -71], foot: [38, 0], rearFoot: [-45, 0] })],
        [245, edit(base, { hip: [-8, -51], shoulder: [-18, -88], head: [-13, -111], elbow: [8, -91], hand: [4, -105], rearElbow: [-44, -90], rearHand: [-67, -99], knee: [21, -27], foot: [43, 0], rearFoot: [-46, 0], faceTurn: -0.3 })],
        [287, base],
      ];
      for (let i = 1; i < caBeats.length; i++) if (t <= caBeats[i][0]) return mix(caBeats[i - 1][1], caBeats[i][1], (t - caBeats[i - 1][0]) / Math.max(1, caBeats[i][0] - caBeats[i - 1][0]));
      return base;
    }
    const beats: [number, Pose][] = [
      [0, edit(crouch(base), { hip: [6, -31], shoulder: [18, -64], head: [20, -88], elbow: [45, -64], hand: [78, -65], rearElbow: [-10, -63], rearHand: [-23, -52], foot: [53, 0], rearFoot: [-43, 0] })],
      [28, edit(crouch(base), { shoulder: [-24, -49], head: [-38, -66], hand: [-4, -1], elbow: [-17, -24], knee: [38, -11], foot: [88, -3], rearHand: [-52, -51] })],
      [58, edit(base, { shoulder: [0, -88], head: [2, -111], elbow: [27, -85], hand: [60, -88], rearElbow: [-23, -69], rearHand: [-9, -61] })],
      [95, edit(base, { shoulder: [-4, -87], head: [-2, -111], elbow: [23, -85], hand: [55, -88], rearElbow: [-23, -70], rearHand: [-9, -62] })],
      [120, edit(base, { shoulder: [-7, -86], head: [-6, -110], elbow: [29, -89], hand: [66, -96], rearElbow: [14, -77], rearHand: [49, -92] })],
      [143, edit(base, { shoulder: [-22, -88], head: [-31, -111], elbow: [8, -91], hand: [45, -99], rearElbow: [-33, -73], rearHand: [-8, -70] })],
      [165, edit(base, { shoulder: [3, -82], head: [12, -104], rearElbow: [29, -87], rearHand: [59, -96], elbow: [15, -68], hand: [29, -77] })],
      // Official 603.mp4 8.0–9.5: both soles face the target, followed by
      // a backwards drop and a simultaneous rising double-foot kick.
      [finish - 24, edit(crouch(base), { hip: [-7, -25], shoulder: [-23, -56], head: [-35, -75], elbow: [-2, -48], hand: [23, -57], rearElbow: [-41, -42], rearHand: [-46, -20], knee: [18, -28], foot: [34, -15], rearKnee: [-12, -26], rearFoot: [5, -12] })],
      [finish - 18, edit(base, { hip: [2, -38], shoulder: [-31, -44], head: [-54, -47], elbow: [-37, -21], hand: [-48, -3], rearElbow: [-56, -26], rearHand: [-67, -5], knee: [26, -69], foot: [34, -93], rearKnee: [13, -59], rearFoot: [23, -83] })],
      [200, edit(base, { hip: [-3, -39], shoulder: [-34, -32], head: [-57, -25], elbow: [-34, -15], hand: [-45, -1], rearElbow: [-52, -18], rearHand: [-65, -3], knee: [29, -73], foot: [57, -110], rearKnee: [17, -54], rearFoot: [24, -73] })],
      [finish, edit(base, { hip: [-3, -39], shoulder: [-34, -32], head: [-57, -25], elbow: [-34, -15], hand: [-45, -1], rearElbow: [-52, -18], rearHand: [-65, -3], knee: [31, -79], foot: [60, -118], rearKnee: [20, -71], rearFoot: [50, -108] })],
      [finish + 18, edit(crouch(base), { shoulder: [-13, -56], head: [-17, -78], hip: [-7, -27], hand: [12, -3], elbow: [-3, -26], rearHand: [-35, -2], rearElbow: [-31, -25] })],
      [finish + 42, base],
    ];
    for (let i = 1; i < beats.length; i++) if (t <= beats[i][0]) return mix(beats[i - 1][1], beats[i][1], (t - beats[i - 1][0]) / Math.max(1, beats[i][0] - beats[i - 1][0]));
    return base;
  }
  return base;
}

function capturedPose(base: Pose, source: JamieAction, fighter?: Fighter, sourceActor?: Fighter, tick = 0, time = 0): Pose {
  const t = ((source.visualFrame ?? source.frame) - (source.confirmedAtFrame ?? 0)) / (source.cinematicTimeScale ?? 1);
  if (source.moveId === "A03") {
    if (t < 28) return edit(base, { hip: [-6, -49], shoulder: [-26, -78], head: [-40, -95], elbow: [-5, -64], hand: [12, -59], rearElbow: [-41, -63], rearHand: [-42, -42] });
    if (t < 70) return edit(crouch(base), { hip: [-17, -16], shoulder: [-14, -47], head: [-12, -68], elbow: [9, -31], hand: [19, -5], rearElbow: [-37, -31], rearHand: [-46, -4], knee: [12, -8], foot: [35, 0], rearKnee: [-29, -5], rearFoot: [-48, 0] });
    if (t < 120) return mix(crouch(base), edit(base, { shoulder: [9, -82], head: [14, -103], elbow: [34, -83], hand: [65, -88] }), (t - 70) / 50);
    if (t < 170) return edit(base, { shoulder: [6, -86], head: [11, -108], elbow: [32, -89], hand: [69, -96], rearElbow: [14, -73], rearHand: [40, -82] });
    if (source.variantId === "row-90") {
      let head = p(-25, -122);
      if (fighter && sourceActor) {
        const sourcePose = sampleJamiePose(sourceActor, tick, time, true, false);
        // Both roots have their own facing, stage position and airborne offset.
        // Put the victim's neck (head.x - 2, head.y + 10) at the actual grasp,
        // rather than assuming that a mirrored local head coordinate lines up.
        const handX = sourceActor.x + sourceActor.facing * sourcePose.hand.x * JAMIE_RIG_SCALE;
        const handY = sourceActor.y - sourceActor.height + sourcePose.hand.y * JAMIE_RIG_SCALE;
        head = p((handX - fighter.x) / (fighter.facing * JAMIE_RIG_SCALE) + 2,
          (handY - fighter.y + fighter.height) / JAMIE_RIG_SCALE - 10);
      }
      const gripped = edit(base, {
        hip: [-2, -57], head: [head.x, head.y], shoulder: [head.x * 0.55, head.y + 26],
        elbow: [head.x * 0.4 + 20, head.y + 44], hand: [head.x * 0.2 + 35, head.y + 65],
        rearElbow: [head.x * 0.55 - 16, head.y + 42], rearHand: [head.x * 0.55 - 23, head.y + 62],
        knee: [22, -27], foot: [38, 0], rearFoot: [-35, 0],
      });
      const recoil = edit(base, { hip: [-10, -48], shoulder: [-19, -82], head: [-37, -105], elbow: [2, -66], hand: [17, -48], rearElbow: [-40, -71], rearHand: [-55, -48], knee: [15, -24], foot: [36, 0], rearFoot: [-43, 0] });
      if (t < 185) return mix(edit(base, { shoulder: [6, -86], head: [11, -108] }), gripped, (t - 170) / 15);
      return t <= 235 ? gripped : mix(gripped, recoil, (t - 235) / 10);
    }
    return edit(base, { hip: [-4, -52], shoulder: [3, -86], head: [5, -109], elbow: [24, -81], hand: [40, -92], rearElbow: [-17, -76], rearHand: [-7, -67], knee: [20, -27], foot: [35, 0], rearFoot: [-36, 0] });
  }
  if (source.moveId === "T01" || source.moveId === "T02") return edit(base, { shoulder: [-28, -69], head: [-47, -80], hip: [2, -45], elbow: [-20, -43], hand: [-9, -23], rearElbow: [-48, -56], rearHand: [-56, -30], knee: [26, -27], foot: [45, -1], rearFoot: [-26, -4] });
  const recoil = Math.sin(t * 0.65) * 5;
  return edit(base, { hip: [-8, -50], shoulder: [-22 - recoil, -83], head: [-32 - recoil, -106], elbow: [1, -70], hand: [11, -53], rearElbow: [-42, -73], rearHand: [-49, -91], knee: [17, -27], foot: [37, -1] });
}

export function sampleJamiePose(fighter: Fighter, tick: number, time: number, running: boolean, winner: boolean, captureSource?: JamieAction, captureActor?: Fighter): Pose {
  let base = neutralPose(time, running && Math.hypot(fighter.vx, fighter.vy) > 15);
  const action = getJamieState(fighter)?.action;
  if (fighter.capture && captureSource) return capturedPose(base, captureSource, fighter, captureActor, tick, time);
  if (fighter.height > 15 && (fighter.juggleUntilTick ?? 0) > tick) return edit(base, { hip: [-7, -55], shoulder: [-28, -82], head: [-44, -102], elbow: [-4, -70], hand: [13, -53], rearElbow: [-47, -82], rearHand: [-61, -98], knee: [20, -35], foot: [39, -15], rearKnee: [-25, -34], rearFoot: [-48, -18] });
  if (fighter.hp <= 0 || fighter.knockdownUntilTick > tick) return edit(base, { hip: [-8, -13], shoulder: [-35, -20], head: [-59, -19], elbow: [-23, -7], hand: [-3, -2], rearElbow: [-42, -8], rearHand: [-56, -3], knee: [15, -8], foot: [43, -1], rearKnee: [10, -20], rearFoot: [31, -3] });
  if (fighter.hitUntilTick > tick && fighter.stunUntilTick > tick) return capturedPose(base, { moveId: "hit", frame: tick, hitCount: 1 } as JamieAction);
  if (!action) {
    if (winner) return drink(base);
    if (fighter.crouching || getJamieState(fighter)?.guardLow) base = crouch(base);
    return (getJamieState(fighter)?.guardUntilTick ?? 0) > tick ? edit(base, { elbow: [24, base.shoulder.y - 6], hand: [20, base.head.y - 2], rearElbow: [5, base.shoulder.y + 6], rearHand: [25, base.head.y + 6] }) : base;
  }
  const variant = JAMIE_VARIANT_BY_ID[action.variantId];
  if (!variant) return base;
  const frame = action.visualFrame ?? action.frame;
  if (variant.row >= 87 && variant.row <= 90) return cinematic(base, action, variant);
  if (variant.posture === "crouch") base = crouch(base);
  if (variant.behavior === "drink" || [20, 29, 37].includes(variant.row)) return drink(base, Math.min(1, frame / 18));
  if (variant.drinkOnCompletion && frame > action.duration - 43 || variant.drinkFrame > 0 && frame > variant.drinkFrame - 20) return drink(base, Math.min(1, (frame - (variant.drinkFrame || action.duration) + 43) / 20));
  if (variant.behavior === "parry") return edit(base, { shoulder: [-8, -88], head: [-6, -110], elbow: [21, -96], hand: [16, -114], rearElbow: [-3, -88], rearHand: [23, -101], foot: [33, 0], rearFoot: [-37, 0] });
  if (variant.moveId === "jump") return edit(base, { hip: [-2, -58], knee: [24, -39], foot: [6, -24], rearKnee: [-25, -46], rearFoot: [-38, -25], elbow: [18, -101], hand: [23, -122], rearElbow: [-27, -97], rearHand: [-28, -116] });
  if (variant.moveId === "crouch") return crouch(base);
  if (variant.moveId.startsWith("walk")) return neutralPose(time, true);
  if (variant.behavior === "rush" || variant.moveId === "dash" || variant.moveId === "backstep") return edit(base, variant.moveId === "backstep" ? { hip: [-16, -46], shoulder: [-30, -79], head: [-38, -102], elbow: [-6, -87], hand: [16, -101], rearElbow: [-46, -73], rearHand: [-59, -64], knee: [9, -29], foot: [21, -4], rearKnee: [-39, -23], rearFoot: [-56, 0] } : { hip: [-3, -43], shoulder: [19, -75], head: [31, -95], elbow: [-1, -59], hand: [-16, -70], rearElbow: [-27, -79], rearHand: [-43, -70], knee: [24, -27], foot: [46, 0], rearKnee: [-31, -27], rearFoot: [-56, -8] });
  const active = variant.active.length ? variant.active : [[Math.max(1, variant.startup), Math.max(2, variant.startup + 2)]];
  const first = active[0][0];
  const last = active[active.length - 1][1];
  const phase = Math.max(0, Math.min(1, (frame - first) / Math.max(1, last - first)));
  const contact = contactPose(base, variant, phase);
  const windup = edit(base, { shoulder: [base.shoulder.x - 7, base.shoulder.y + 2], head: [base.head.x - 8, base.head.y + 1], elbow: [base.elbow.x - 9, base.elbow.y + 5], hand: [base.hand.x - 16, base.hand.y + 7] });
  if (frame < first * 0.45) return mix(base, windup, frame / Math.max(1, first * 0.45));
  if (frame < first) return mix(windup, contact, (frame - first * 0.45) / Math.max(1, first * 0.55));
  if (frame <= last) return contact;
  return mix(contact, base, (frame - last) / Math.max(1, action.duration - last));
}
