import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AnimationClip, AnimationMixer, LoopOnce, Object3D, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { constrainCone, constrainOval, projectOutsideCapsule, SecondaryMotion, type PhysicsData } from './SecondaryMotion';

const assetRoot = resolve('public/assets/jamie/cinematic');
const physics = JSON.parse(readFileSync(resolve(assetRoot, 'physics.json'), 'utf8')) as PhysicsData;
const glb = readFileSync(resolve(assetRoot, 'jamie-native.glb'));
const jsonLength = glb.readUInt32LE(12);
interface Gltf {
  nodes: { name: string; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[] }[];
  accessors: { count: number; componentType: number; type: string; bufferView: number; byteOffset?: number }[];
  bufferViews: { byteOffset: number; byteStride?: number }[];
  animations: { name: string; samplers: { input: number; output: number }[];
    channels: { sampler: number; target: { node: number; path: string } }[] }[];
}
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
const bin = glb.subarray(28 + jsonLength);
function accessor(index: number) {
  const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView];
  const width = ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
  if (a.componentType !== 5126 || !width) throw new Error('Unexpected native animation accessor');
  const result = new Float32Array(a.count * width);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < width; c++) {
    result[i * width + c] = bin.readFloatLE(v.byteOffset + (a.byteOffset ?? 0) + i * (v.byteStride ?? width * 4) + c * 4);
  }
  return result;
}
function nativeActor(clipName: string) {
  const nodes = gltf.nodes.map(source => {
    const bone = new Object3D(); bone.name = source.name;
    if (source.translation) bone.position.fromArray(source.translation);
    if (source.rotation) bone.quaternion.fromArray(source.rotation);
    if (source.scale) bone.scale.fromArray(source.scale);
    return bone;
  });
  gltf.nodes.forEach((source, i) => source.children?.forEach(child => nodes[i].add(nodes[child])));
  const root = nodes[0], source = gltf.animations.find(a => a.name === clipName)!;
  const tracks = source.channels.map(channel => {
    const sampler = source.samplers[channel.sampler];
    const suffix = ({ translation: 'position', rotation: 'quaternion', scale: 'scale' } as Record<string, string>)[channel.target.path];
    const name = `${gltf.nodes[channel.target.node].name}.${suffix}`;
    return suffix === 'quaternion' ? new QuaternionKeyframeTrack(name, accessor(sampler.input), accessor(sampler.output))
      : new VectorKeyframeTrack(name, accessor(sampler.input), accessor(sampler.output));
  });
  const mixer = new AnimationMixer(root);
  const clip = new AnimationClip(source.name, -1, tracks);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1).play();
  action.clampWhenFinished = true;
  return { root, sample: (frame: number) => {
    action.paused = false; action.enabled = true;
    mixer.setTime(Math.min(frame / 60, clip.duration)); root.updateMatrixWorld(true);
  } };
}
const snapshot = (root: Object3D) => physics.bones.flatMap(source => {
  const bone = root.getObjectByName(source.name)!;
  return [...bone.position.toArray(), ...bone.quaternion.toArray()];
});

describe('native chain constraints', () => {
  it('projects sphere and tapered capsule contacts, including an exactly centred particle', () => {
    const start = new Vector3(0, 0, 0), end = new Vector3(0, 2, 0);
    const particle = new Vector3(0, 1, 0);
    expect(projectOutsideCapsule(particle, start, end, 0.2, 0.4, 0.05)).toBe(true);
    expect(particle.distanceTo(new Vector3(0, 1, 0))).toBeCloseTo(0.35, 10);
    expect(projectOutsideCapsule(particle, start, end, 0.2, 0.4, 0.05)).toBe(false);
    const centre = new Vector3();
    projectOutsideCapsule(centre, start, start, 0.1, 0.1);
    expect(centre.length()).toBeCloseTo(0.1, 10);
    expect(centre.toArray().every(Number.isFinite)).toBe(true);
  });

  it('limits an opposite direction to the original angle without NaNs', () => {
    const reference = new Vector3(0, 0, -1), direction = new Vector3(0, 0, 1);
    constrainCone(direction, reference, Math.PI / 6);
    expect(direction.length()).toBeCloseTo(1, 10);
    expect(direction.dot(reference)).toBeCloseTo(Math.cos(Math.PI / 6), 10);
  });

  it('preserves the full oval Y limit and the source viewer’s half-width Z limit', () => {
    const reference = new Vector3(1, 0, 0), y = new Vector3(0, 1, 0), z = new Vector3(0, 0, 1);
    const alongY = new Vector3(0.5, Math.sqrt(3) / 2, 0);
    const alongZ = new Vector3(0.5, 0, Math.sqrt(3) / 2);
    constrainOval(alongY, reference, y, z, Math.PI / 2);
    constrainOval(alongZ, reference, y, z, Math.PI / 2);
    expect(alongY.angleTo(reference)).toBeCloseTo(Math.PI / 3, 10);
    expect(alongZ.angleTo(reference)).toBeCloseTo(Math.PI / 4, 10);
    expect(alongZ.length()).toBeCloseTo(1, 10);
  });
});

describe('60 Hz native secondary motion cache', () => {
  it('keeps native bone lengths, restores the same frame after arbitrary scrubbing, and rebuilds from rest', async () => {
    const actor = nativeActor('esf021_SAA3_GETUGASAIHOU');
    const motion = new SecondaryMotion(actor.root, physics);
    const face = actor.root.getObjectByName('C_Jaw') ?? actor.root.getObjectByName('C_Head')!;
    await motion.build('SA3', 120, actor.sample);
    actor.sample(60); motion.apply('SA3', 60);
    const expected = snapshot(actor.root);
    expect(expected.every(Number.isFinite)).toBe(true);
    actor.sample(0); motion.apply('SA3', 0);
    actor.sample(119.5); motion.apply('SA3', 119.5);
    actor.sample(60); motion.apply('SA3', 60);
    expect(snapshot(actor.root)).toEqual(expected);
    for (const chain of physics.chains) for (const group of chain.groups) for (let i = 1; i < group.nodes.length; i++) {
      const child = actor.root.getObjectByName(group.nodes[i].bone)!;
      const original = physics.bones.find(b => b.name === child.name)!;
      expect(child.position.length()).toBeCloseTo(new Vector3().fromArray(original.position).length(), 5);
    }
    actor.sample(90);
    const beforeFace = face.quaternion.toArray();
    motion.apply('SA3', 90);
    expect(face.quaternion.toArray()).toEqual(beforeFace);
    // The native rear hair used to fan above its root at this otherwise quiet
    // shot because mode 4 was treated as an unrestricted round cone.
    const rearRoot = actor.root.getObjectByName('C_HairB_BackA_00')!.getWorldPosition(new Vector3());
    const rearEnd = actor.root.getObjectByName('C_HairB_BackA_end')!.getWorldPosition(new Vector3());
    expect(rearEnd.y).toBeLessThan(rearRoot.y);
    await motion.build('SA3', 120, actor.sample);
    actor.sample(60); motion.apply('SA3', 60);
    expect(snapshot(actor.root)).toEqual(expected);
    const stats = motion.getStats();
    expect(stats.groups).toBe(93); expect(stats.bones).toBe(363); expect(stats.colliders).toBe(23);
    expect(stats.modes.SA3.maximumLengthError).toBeLessThan(1e-8);
    expect(stats.modes.SA3.maximumBoneParticleError).toBeLessThan(1e-5);
    expect(stats.modes.SA3.bytes).toBe(121 * 363 * 7 * 4);
    console.info('Native SA3 physics cache', stats.modes.SA3);
  }, 20000);

  it('owns independent actor and mode caches, with physical hair motion after warmup', async () => {
    const a = nativeActor('esf021_SAA3_GETUGASAIHOU'), b = nativeActor('esf021_SAD3_GETUGASAIHOU');
    b.root.position.x = 4;
    const first = new SecondaryMotion(a.root, physics), second = new SecondaryMotion(b.root, physics);
    await first.build('SA3', 90, a.sample);
    a.sample(60); first.apply('SA3', 60);
    const expected = snapshot(a.root);
    await second.build('SA3', 90, b.sample);
    b.sample(60); second.apply('SA3', 60);
    expect(snapshot(a.root)).toEqual(expected);
    expect(snapshot(b.root)).not.toEqual(expected);
    const hair = a.root.getObjectByName('C_HairRong_04')!;
    const at60 = hair.quaternion.clone();
    a.sample(0); first.apply('SA3', 0);
    expect(hair.quaternion.angleTo(at60)).toBeGreaterThan(0.01);
    first.resetKinematics();
    const rest = physics.bones.find(item => item.name === hair.name)!;
    expect(hair.quaternion.toArray()).toEqual(rest.quaternion);
    expect(second.getStats().modes.SA3.frames).toBe(90);
    first.dispose(); expect(first.getStats().modes).toEqual({});
  }, 20000);

  it('builds both full SA3 / CA actor tracks and their 15-frame held tails without non-finite poses', async () => {
    const results: Record<string, ReturnType<SecondaryMotion['getStats']>> = {};
    for (const [name, clip, frames] of [
      ['SA3-attacker', 'esf021_SAA3_GETUGASAIHOU', 453], ['SA3-defender', 'esf021_SAD3_GETUGASAIHOU', 453],
      ['CA-attacker', 'esf021_CAA_GETUGASAIHOU', 514], ['CA-defender', 'esf021_CAD_GETUGASAIHOU', 514],
    ] as const) {
      const actor = nativeActor(clip), motion = new SecondaryMotion(actor.root, physics);
      await motion.build(name, frames, actor.sample);
      for (const at of [0, 1, 100, frames - 15, frames]) {
        actor.sample(at); motion.apply(name, at);
        expect(snapshot(actor.root).every(Number.isFinite)).toBe(true);
      }
      expect(motion.getStats().modes[name].maximumLengthError).toBeLessThan(1e-8);
      expect(motion.getStats().modes[name].maximumBoneParticleError).toBeLessThan(1e-5);
      results[name] = motion.getStats();
    }
    console.info('Full native secondary cache validation', JSON.stringify(results));
  }, 20000);
});
