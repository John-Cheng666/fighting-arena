import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { FacialAnimation, type FacialData } from "./FacialAnimation";

const data: FacialData = JSON.parse(readFileSync(new URL("../../public/assets/jamie/cinematic/facial.json", import.meta.url), "utf8"));
const glb = readFileSync(new URL("../../public/assets/jamie/cinematic/jamie-native.glb", import.meta.url));
const nativeModel: { nodes: { name: string; translation?: number[]; rotation?: number[]; scale?: number[] }[] } =
  JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));

function fixture(role: "attacker" | "defender") {
  const root = new THREE.Group();
  for (const source of data.bones) {
    const node = nativeModel.nodes.find(node => node.name === source.name);
    if (!node) throw new Error(`Missing native model bone ${source.name}`);
    const bone = new THREE.Bone(); bone.name = source.name;
    bone.position.fromArray(node.translation ?? [0, 0, 0]);
    bone.quaternion.fromArray(node.rotation ?? [0, 0, 0, 1]);
    bone.scale.fromArray(node.scale ?? [1, 1, 1]); root.add(bone);
  }
  return { root, facial: new FacialAnimation(data, root, role) };
}
const snapshot = (root: THREE.Object3D) => root.children.map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()]);

describe("recovered native cinematic facial animation", () => {
  it("binds the original anatomical face controls without placeholder bones", () => {
    const { root, facial } = fixture("attacker");
    expect(facial.boneCount).toBe(148);
    expect(root.getObjectByName("C_jaw")).toBeDefined();
    expect(root.getObjectByName("L_eyebrow_Up_00")).toBeDefined();
    expect(root.getObjectByName("R_eye_lid_up")).toBeDefined();
    expect(data.clips.SA3.attacker.curves).toHaveLength(210);
    expect(data.clips.CA.attacker.curves).toHaveLength(210);
  });

  it("changes the original jaw, brow and eyelid poses over both authored timelines", () => {
    const { root, facial } = fixture("attacker");
    for (const mode of ["SA3", "CA"] as const) {
      const samples = new Map(["C_jaw", "L_eyebrow_Up_00", "R_eye_lid_up"].map(name => [name, new Set<string>()]));
      for (let frame = 0; frame < data.clips[mode].bodyFrames; frame += 6) {
        facial.sample(mode, frame);
        for (const [name, values] of samples) {
          const bone = root.getObjectByName(name)!;
          values.add([...bone.position.toArray(), ...bone.quaternion.toArray()].map(value => value.toFixed(5)).join(","));
        }
      }
      for (const values of samples.values()) expect(values.size).toBeGreaterThan(3);
    }
  });

  it("reproduces an absolute frame after reverse scrubbing, replay and switching SA3/CA", () => {
    const { root, facial } = fixture("attacker");
    facial.sample("SA3", 187.5); const reference = snapshot(root);
    facial.sample("CA", 499); facial.sample("SA3", 438); facial.sample("SA3", 187.5);
    expect(snapshot(root)).toEqual(reference);
    facial.sample("SA3", 187.5); expect(snapshot(root)).toEqual(reference);
  });

  it("preserves the body animation's head and neck orientation", () => {
    const { root, facial } = fixture("attacker");
    const head = new THREE.Bone(), neck = new THREE.Bone();
    head.name = "C_Head"; neck.name = "C_Neck";
    head.quaternion.setFromEuler(new THREE.Euler(0.15, -0.8, 0.3));
    neck.quaternion.setFromEuler(new THREE.Euler(-0.2, 0.3, 0.15));
    root.add(head, neck);
    const headRotation = head.quaternion.toArray(), neckRotation = neck.quaternion.toArray();
    facial.sample("CA", 270); facial.sample("SA3", 380);
    expect(head.quaternion.toArray()).toEqual(headRotation);
    expect(neck.quaternion.toArray()).toEqual(neckRotation);
  });

  it("continues the original mouth animation through the voice tail and holds at the native FacialKey end", () => {
    const { root, facial } = fixture("attacker");
    for (const mode of ["SA3", "CA"] as const) {
      const clip = data.clips[mode];
      expect(clip.attacker.to).toBeGreaterThan(clip.bodyFrames + 15);
      expect(Math.max(...clip.attacker.curves.flatMap(curve => curve.keys))).toBeGreaterThan(clip.bodyFrames + 15);
      facial.sample(mode, clip.bodyFrames);
      const jaw = root.getObjectByName("C_jaw")!;
      const bodyEndMouth = [...jaw.position.toArray(), ...jaw.quaternion.toArray()];
      facial.sample(mode, clip.bodyFrames + 15);
      expect([...jaw.position.toArray(), ...jaw.quaternion.toArray()]).not.toEqual(bodyEndMouth);
      const tail = snapshot(root);
      facial.sample(mode, 0); facial.sample(mode, clip.bodyFrames + 15);
      expect(snapshot(root)).toEqual(tail);
      facial.sample(mode, clip.attacker.to); const nativeEnd = snapshot(root);
      facial.sample(mode, clip.attacker.to + 200);
      expect(snapshot(root)).toEqual(nativeEnd);
    }
  });

  it("holds the native victim SCAD pose within its action range and switches at the native boundary", () => {
    const { root, facial } = fixture("defender");
    facial.sample("SA3", 1); const first = snapshot(root);
    facial.sample("SA3", 5.9); expect(snapshot(root)).toEqual(first);
    facial.sample("SA3", 6); expect(snapshot(root)).not.toEqual(first);
    facial.sample("SA3", 1); expect(snapshot(root)).toEqual(first);
    facial.sample("CA", 499); const last = snapshot(root);
    facial.sample("CA", 559); expect(snapshot(root)).toEqual(last);
  });

  it("keeps all source bone transforms finite and normalized throughout both clips", () => {
    for (const role of ["attacker", "defender"] as const) {
      const { root, facial } = fixture(role);
      for (const mode of ["SA3", "CA"] as const) for (let frame = 0; frame <= data.clips[mode].bodyFrames; frame += 3) {
        facial.sample(mode, frame);
        for (const bone of root.children) {
          expect([...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()].every(Number.isFinite)).toBe(true);
          expect(bone.quaternion.length()).toBeCloseTo(1, 6);
          expect(Math.min(...bone.scale.toArray())).toBeGreaterThan(0);
        }
      }
    }
  });
});
