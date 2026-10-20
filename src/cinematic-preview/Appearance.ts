import type { Object3D } from "three";
import appearanceData from "../../public/assets/jamie/cinematic/appearance.json";

export type JamieAppearanceSide = 1 | 2;
export interface JamieAppearanceOptions {
  /** Actual accumulated drinks, independently for each actor. Not SA2's effective style. */
  drinkLevel: number;
  /** Original native 1P/2P parts selection; paired motions need no extra rotation. */
  side: JamieAppearanceSide;
}
export interface JamieAppearanceSelection {
  drinkLevel: number;
  nativeStyle: number;
  side: JamieAppearanceSide;
  partsIds: readonly number[];
  groups: readonly number[];
}
interface NativeDrinkSelection {
  nativeStyle: number;
  partsIds: number[];
  groups1P: number[];
  groups2P: number[];
}

export const jamieAppearanceManifest = appearanceData;
const managedGroups = new Set<number>(appearanceData.managedGroups);
const nativeLevels: Record<string, NativeDrinkSelection> = appearanceData.drinkLevels;

/** Original fchar DefaultProps joined to PartsContainer.Info, including the torso and waist props. */
export function getJamieAppearance(options: JamieAppearanceOptions): JamieAppearanceSelection {
  const { drinkLevel, side } = options;
  if (!Number.isInteger(drinkLevel) || drinkLevel < 0 || drinkLevel > 4) {
    throw new RangeError("Jamie appearance requires an actual drink level from 0 to 4");
  }
  if (side !== 1 && side !== 2) throw new RangeError("Jamie appearance side must be 1P or 2P");
  const original = nativeLevels[drinkLevel];
  return { drinkLevel, nativeStyle: original.nativeStyle, side, partsIds: [...original.partsIds],
    groups: [...(side === 1 ? original.groups1P : original.groups2P)] };
}

/** Only original managed mesh visibility changes; pose, materials and other render layers are preserved. */
export function applyJamieAppearance(root: Object3D, options: JamieAppearanceOptions) {
  const selection = getJamieAppearance(options);
  const visible = new Set(selection.groups);
  const found = new Set<number>();
  let shownMeshes = 0, hiddenMeshes = 0;
  root.traverse(object => {
    if (!(object as Object3D & { isMesh?: boolean }).isMesh) return;
    const match = /^Group_(\d+)_/i.exec(object.name);
    if (!match) return;
    const group = Number(match[1]);
    if (!managedGroups.has(group)) return;
    found.add(group);
    object.visible = visible.has(group);
    if (object.visible) shownMeshes++;
    else hiddenMeshes++;
  });
  return { ...selection, shownMeshes, hiddenMeshes,
    missingGroups: selection.groups.filter(group => !found.has(group)) };
}
