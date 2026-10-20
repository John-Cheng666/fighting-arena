import * as THREE from "three";

type Mode = "SA3" | "CA";
type Role = "attacker" | "defender";
interface ControlCurve { name: string; keys: number[]; values: number[] }
interface FacialSegment { from: number; to: number; pose: number }
interface FacialClip {
  bodyFrames: number;
  attacker: { from: number; to: number; startFrame: number; endFrame: number; curves: ControlCurve[] };
  defender: { segments: FacialSegment[] };
}
export interface FacialData {
  schemaVersion: number;
  framesPerSecond: number;
  driver: { name: string; controlCount: number; input: string; axis: number; scale: number };
  // [CBFA control index, delta position XYZ, delta quaternion XYZW, delta scale XYZ]
  bones: { name: string; hash: number; deltas: number[][] }[];
  damagePoses: Record<string, number[]>;
  clips: Record<Mode, FacialClip>;
}
interface Delta {
  control: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}
interface Target {
  bone: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  deltas: Delta[];
}

function sampleCurve(curve: ControlCurve, frame: number): number {
  const { keys, values } = curve;
  if (frame <= keys[0]) return values[0];
  const last = keys.length - 1;
  if (frame >= keys[last]) return values[last];
  let low = 0, high = last;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle] <= frame) low = middle;
    else high = middle;
  }
  return THREE.MathUtils.lerp(values[low], values[high], (frame - keys[low]) / (keys[high] - keys[low]));
}

/**
 * Replays the original CBFA curves through the recovered original FCE_ROM bone
 * poses. Call after the body mixer at the same absolute 60 Hz frame. Native
 * controls and timing are retained; RE Engine quaternion accumulation and
 * state transitions use the documented portable additive approximation.
 */
export class FacialAnimation {
  private readonly targets: Target[] = [];
  private readonly controls: Float32Array;
  private readonly weightedRotation = new THREE.Quaternion();

  constructor(private readonly data: FacialData, root: THREE.Object3D, private readonly role: Role) {
    if (data.schemaVersion !== 1 || data.framesPerSecond !== 60 || data.driver.controlCount !== 210) {
      throw new Error("Unsupported native facial animation data");
    }
    this.controls = new Float32Array(data.driver.controlCount);
    for (const source of data.bones) {
      const bone = root.getObjectByName(source.name);
      if (!bone) throw new Error(`Native facial bone is missing: ${source.name}`);
      this.targets.push({
        bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
        deltas: source.deltas.map(value => ({ control: value[0], position: new THREE.Vector3().fromArray(value, 1),
          quaternion: new THREE.Quaternion().fromArray(value, 4).normalize(), scale: new THREE.Vector3().fromArray(value, 8) })),
      });
    }
  }

  get boneCount(): number { return this.targets.length; }

  sample(mode: Mode, absoluteFrame: number): void {
    const clip = this.data.clips[mode];
    // The authored face track continues through the short voice tail after the
    // cinematic body pose stops. Keep using those native curves within their
    // own FacialKey range; the victim's discrete action poses stop with body.
    const endFrame = this.role === "attacker" ? clip.attacker.to : clip.bodyFrames;
    const frame = THREE.MathUtils.clamp(absoluteFrame, 0, endFrame);
    if (this.role === "attacker") {
      const at = Math.min(clip.attacker.endFrame, clip.attacker.startFrame + Math.max(0, frame - clip.attacker.from));
      clip.attacker.curves.forEach((curve, index) => { this.controls[index] = sampleCurve(curve, at); });
    } else {
      const segment = clip.defender.segments.find(item => frame >= item.from && frame < item.to)
        ?? clip.defender.segments.at(-1);
      if (!segment) throw new Error(`Original ${mode} victim facial timing is missing`);
      const weights = this.data.damagePoses[String(segment.pose)];
      if (!weights || weights.length !== this.controls.length) throw new Error("Original victim facial pose is missing");
      this.controls.set(weights);
    }
    for (const target of this.targets) {
      const { bone } = target;
      // Reset to the head mesh bind pose for every absolute sample. This keeps
      // backwards scrubbing and mode switches independent of playback history.
      bone.position.copy(target.position);
      bone.quaternion.copy(target.quaternion);
      bone.scale.copy(target.scale);
      for (const delta of target.deltas) {
        const weight = this.controls[delta.control];
        if (Math.abs(weight) < 1e-8) continue;
        bone.position.addScaledVector(delta.position, weight);
        this.weightedRotation.identity().slerp(delta.quaternion, weight);
        bone.quaternion.multiply(this.weightedRotation);
        bone.scale.x += target.scale.x * (delta.scale.x - 1) * weight;
        bone.scale.y += target.scale.y * (delta.scale.y - 1) * weight;
        bone.scale.z += target.scale.z * (delta.scale.z - 1) * weight;
      }
      bone.quaternion.normalize();
    }
  }

  reset(): void {
    for (const { bone, position, quaternion, scale } of this.targets) {
      bone.position.copy(position); bone.quaternion.copy(quaternion); bone.scale.copy(scale);
    }
  }
}
