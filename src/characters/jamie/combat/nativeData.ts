import data from "../data/native-numerics.json";

export interface NativeHit {
  hitId: number;
  attackId: number;
  collisionType: number;
  guardBit: number;
  kindFlag: number;
  condition: number;
  active: number[][];
  damage: number;
  recoverableDamage?: number;
  minimumDamage: number;
  superGain: number;
  driveGain: number;
  blockSuperGain: number;
  blockDriveGain?: number;
  targetSuperGain?: number;
  blockTargetSuperGain?: number;
  blockDriveLoss: number;
  punishDriveLoss: number;
  hitStopOwner: number;
  hitStopTarget: number;
  blockHitStopOwner: number;
  blockHitStopTarget: number;
  hitStun: number;
  blockStun: number;
}

export interface NativeMove {
  row: number;
  styleId: number;
  actionId: number;
  startup: number;
  active: number[][];
  duration: number | null;
  recovery: number | null;
  landingRecovery?: number;
  driveNeed: number;
  driveCost: number;
  superCost: number;
  freezeFrames: number;
  scaling: { starter: number; immediate: number; combo: number };
  hits: NativeHit[];
  composite?: boolean;
  captureAction?: number;
  rawDamageTotal?: number;
  captured?: NativeCapture;
  timerStops?: { from: number; to: number }[];
  punishCaptured?: NativeCapture;
  eventsByStyle?: Record<string, NativeEvent[]>;
}

export interface NativeCapture {
  actionId: number;
  duration: number;
  timerStops: { from: number; to: number }[];
  releaseFrame: number;
  worldStopFrames: number;
  releaseSuperGain: number;
  releaseDriveGain: number;
  releaseStun: number;
  hits: (NativeHit & { from: number; to: number })[];
}

export interface NativeEvent {
  from: number;
  ID: number;
  Param01: number;
  Param02: number;
  Param03: number;
  Param04: number;
  _ValidStyle: number[];
}

export function nativeMoveEvents(move: NativeMove, styleId: number): readonly NativeEvent[] {
  const parents = [-1, 0, 0, 0, 0, 0, 5, 5, 5];
  for (let current = styleId; current >= 0; current = parents[current]) {
    const events = move.eventsByStyle?.[String(current)];
    if (events) return events.filter(event => !event._ValidStyle.length || Boolean((event._ValidStyle[Math.floor(styleId / 32)] ?? 0) & 1 << (styleId % 32)));
  }
  return [];
}

export const JAMIE_NATIVE_SOURCE = data.source;
export const JAMIE_NATIVE_DEFAULTS = data.defaults;
export const JAMIE_NATIVE_MOVES: ReadonlyMap<number, NativeMove> = new Map(data.rows.map((row) => [row.row, row as NativeMove]));
export const JAMIE_NATIVE_VARIANTS = data.variants;

/** Repeated boxes sharing a HitID represent one contact, even when damage zones differ. */
export function nativeMoveDamage(hits: readonly NativeHit[]): number {
  const seen = new Set<number>();
  return hits.reduce((damage, hit) => {
    if (hit.hitId >= 0 && seen.has(hit.hitId)) return damage;
    if (hit.hitId >= 0) seen.add(hit.hitId);
    return damage + hit.damage;
  }, 0);
}
