import { describe, expect, it } from "vitest";
import { Bone, Group, Mesh, BoxGeometry, MeshBasicMaterial } from "three";
import { applyJamieAppearance, getJamieAppearance, jamieAppearanceManifest } from "./Appearance";

function actor() {
  const root = new Group();
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  for (const group of [...jamieAppearanceManifest.managedGroups, 0, 80, 81]) {
    const mesh = new Mesh(geometry, material);
    mesh.name = `Group_${group}_sub0__native`;
    root.add(mesh);
  }
  // A second native torso submesh must change together with the main jacket.
  const torso = new Mesh(geometry, material); torso.name = "Group_21_sub5__esf_Body00"; root.add(torso);
  const bone = new Bone(); bone.name = "C_Hip"; bone.position.set(0.2, 1.1, 0.4); root.add(bone);
  const visibleGroups = () => [...new Set(root.children.filter(object => object.visible && (object as Mesh).isMesh)
    .map(object => Number(/^Group_(\d+)_/.exec(object.name)![1])))].sort((a, b) => a - b);
  return { root, visibleGroups, bone, geometry, material };
}

describe("Jamie's original drink-level appearance", () => {
  it.each([0, 1, 2, 3])("actual level %s keeps the normal jacket and tied hair on the proper side", drinkLevel => {
    expect(getJamieAppearance({ drinkLevel, side: 1 }).groups).toEqual([20, 22, 24, 26]);
    expect(getJamieAppearance({ drinkLevel, side: 2 }).groups).toEqual([20, 22, 124, 126]);
  });

  it("selects the full original four-drink torso, jacket and hair, with independent mirrored waist parts", () => {
    const first = actor(), second = actor();
    const a = applyJamieAppearance(first.root, { drinkLevel: 4, side: 1 });
    const b = applyJamieAppearance(second.root, { drinkLevel: 0, side: 2 });
    expect(a.partsIds).toEqual([1, 3, 4, 7]);
    expect(a.groups).toEqual([21, 23, 24, 26]);
    expect(first.visibleGroups()).toEqual([0, 21, 23, 24, 26, 80, 81]);
    expect(first.root.getObjectByName("Group_21_sub5__esf_Body00")!.visible).toBe(true);
    expect(second.visibleGroups()).toEqual([0, 20, 22, 80, 81, 124, 126]);
    expect(a.missingGroups).toEqual([]); expect(b.missingGroups).toEqual([]);
    expect(first.visibleGroups().some(group => [25, 125, 30, 124, 126].includes(group))).toBe(false);
    expect(first.bone.position.toArray()).toEqual([0.2, 1.1, 0.4]);
    first.geometry.dispose(); first.material.dispose(); second.geometry.dispose(); second.material.dispose();
  });

  it("restores normal parts after leaving four drinks without resurrecting unrelated render layers", () => {
    const { root, visibleGroups, geometry, material } = actor();
    root.getObjectByName("Group_81_sub0__native")!.visible = false;
    applyJamieAppearance(root, { drinkLevel: 4, side: 2 });
    applyJamieAppearance(root, { drinkLevel: 1, side: 1 });
    expect(visibleGroups()).toEqual([0, 20, 22, 24, 26, 80]);
    expect(root.getObjectByName("Group_21_sub5__esf_Body00")!.visible).toBe(false);
    geometry.dispose(); material.dispose();
  });

  it("does not promote an SA2 effective level into actual four-drink appearance", () => {
    const state = { drinkLevel: 0, effectiveDrinkLevel: 4, sa2Active: true, side: 1 as const };
    expect(getJamieAppearance(state).groups).toEqual([20, 22, 24, 26]);
    // The source itself distinguishes native temporary styles from actual Style4.
    expect(jamieAppearanceManifest.nativeTemporaryStyles["5"]).toEqual([1, 2, 4, 7]);
    expect(jamieAppearanceManifest.drinkLevels["4"].partsIds).toEqual([1, 3, 4, 7]);
  });

  it("reports missing native parts and rejects invalid levels instead of inventing a silhouette", () => {
    const root = new Group();
    expect(applyJamieAppearance(root, { drinkLevel: 4, side: 1 }).missingGroups).toEqual([21, 23, 24, 26]);
    for (const drinkLevel of [-1, 1.5, 5, NaN]) expect(() => getJamieAppearance({ drinkLevel, side: 1 })).toThrow(RangeError);
    expect(() => getJamieAppearance({ drinkLevel: 4, side: 3 as 1 })).toThrow(RangeError);
  });
});
