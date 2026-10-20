import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
interface Jiggle {
  range: Vec3; rangeOffset: Vec3; rangeAxis: Quat; rangeShape: number;
  springForce: number; gravityCoef: number; damping: number;
}
interface ChainNode {
  bone: string; angleLimitRad: number; angleMode: number; collisionRadius: number;
  angleLimitDirection: Quat;
  collisionFilterFlags: number; collisionShape: number; gravityCoef: number; jiggle: Jiggle | null;
}
interface Settings {
  id: number; gravity: Vec3; damping: number; springForce: number; velocityLimit: number;
}
interface Group {
  id: string; resolvedSettingId: number; nodes: ChainNode[];
}
interface Collider {
  bone: string | null; pairBone: string | null; offset: Vec3; pairOffset: Vec3;
  radius: number; endRadius: number; shape: number;
}
interface Link {
  groupA: string | null; groupB: string | null; distanceShrinkLimitCoef: number;
  distanceExpandLimitCoef: number; nodeCount: number; skipGroupA: number; skipGroupB: number;
}
export interface PhysicsData {
  version: number; fps: number;
  solver: { fixedStepSeconds: number; warmupFrames: number; iterations: number };
  bones: { name: string; position: Vec3; quaternion: Quat; scale: Vec3 }[];
  chains: { settings: Settings[]; groups: Group[]; collisions: Collider[]; links: Link[] }[];
}
interface BoundBone {
  object: Object3D; position: Vector3; quaternion: Quaternion; scale: Vector3;
}
interface Particle {
  bone: Object3D; source: ChainNode; current: Vector3; previous: Vector3; target: Vector3;
  targetQuaternion: Quaternion; targetParentQuaternion: Quaternion; simulatedQuaternion: Quaternion;
  parentParticle: Particle | null; coneY: Vector3; coneZ: Vector3; length: number;
}
interface BoundGroup {
  id: string; chain: number; particles: Particle[]; settings: Settings; gravity: Vector3;
  anchor: Vector3; inheritedRotation: Quaternion;
}
interface BoundCollider {
  source: Collider; chain: number; bone: Object3D; pairBone: Object3D; start: Vector3; end: Vector3;
}
interface BoundLink {
  a: BoundGroup; b: BoundGroup; source: Link; lengths: number[];
}
interface Cache {
  frames: number; values: Float32Array; buildMilliseconds: number;
  maximumLengthError: number; maximumBoneParticleError: number;
}

const EPSILON = 1e-10;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Projects a sphere particle outside a native sphere / tapered capsule. */
export function projectOutsideCapsule(
  point: Vector3, start: Vector3, end: Vector3, startRadius: number, endRadius: number, particleRadius = 0,
): boolean {
  const ax = end.x - start.x, ay = end.y - start.y, az = end.z - start.z;
  const lengthSq = ax * ax + ay * ay + az * az;
  const t = lengthSq > EPSILON ? clamp(((point.x - start.x) * ax + (point.y - start.y) * ay + (point.z - start.z) * az) / lengthSq, 0, 1) : 0;
  const cx = start.x + ax * t, cy = start.y + ay * t, cz = start.z + az * t;
  let dx = point.x - cx, dy = point.y - cy, dz = point.z - cz;
  const radius = startRadius + (endRadius - startRadius) * t + particleRadius;
  if (radius <= 0) return false;
  let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance >= radius) return false;
  if (distance < EPSILON) {
    // An exactly centred point needs a deterministic normal perpendicular to the
    // capsule axis; picking an arbitrary render-dependent previous normal drifts.
    if (Math.abs(ay) < Math.abs(ax) + Math.abs(az)) { dx = -az; dy = 0; dz = ax; }
    else { dx = 1; dy = 0; dz = 0; }
    distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < EPSILON) { dx = 1; dy = 0; dz = 0; distance = 1; }
  }
  point.set(cx + dx * radius / distance, cy + dy * radius / distance, cz + dz * radius / distance);
  return true;
}

/** Clamp a unit direction to a spherical rest cone without creating NaNs. */
export function constrainCone(direction: Vector3, reference: Vector3, limit: number): Vector3 {
  const dot = clamp(direction.dot(reference), -1, 1);
  const allowed = clamp(limit, 0, Math.PI);
  if (dot >= Math.cos(allowed) - 1e-12) return direction;
  const tangent = direction.clone().addScaledVector(reference, -dot);
  if (tangent.lengthSq() < EPSILON) {
    tangent.set(Math.abs(reference.y) < 0.9 ? 0 : 1, Math.abs(reference.y) < 0.9 ? 1 : 0, 0);
    tangent.addScaledVector(reference, -tangent.dot(reference));
  }
  tangent.normalize();
  return direction.copy(reference).multiplyScalar(Math.cos(allowed)).addScaledVector(tangent, Math.sin(allowed)).normalize();
}

/**
 * Portable LimitOval interpretation: the source viewer compresses the cone's
 * Z transverse axis by 0.5 for mode 4 (RE-Chain-Editor@54ed5d4). The engine's
 * exact oval formula remains unknown; this uses an angular ellipse, retaining
 * the exported rest direction and the calibrated original frame's roll.
 */
export function constrainOval(direction: Vector3, reference: Vector3, axisY: Vector3, axisZ: Vector3, limit: number): Vector3 {
  const angle = Math.acos(clamp(direction.dot(reference), -1, 1));
  if (angle < EPSILON) return direction;
  let y = direction.dot(axisY), z = direction.dot(axisZ);
  const transverse = Math.hypot(y, z);
  if (transverse < EPSILON) { y = 1; z = 0; }
  else { y /= transverse; z /= transverse; }
  const allowed = clamp(limit, 0, Math.PI) / Math.sqrt(y * y + 4 * z * z);
  if (angle <= allowed + 1e-12) return direction;
  return direction.copy(reference).multiplyScalar(Math.cos(allowed))
    .addScaledVector(axisY, y * Math.sin(allowed)).addScaledVector(axisZ, z * Math.sin(allowed)).normalize();
}

/**
 * One instance belongs to one actor. Build each mode once, at 60 Hz; apply only
 * interpolates immutable cached local poses, so pause/seek/render FPS cannot
 * advance simulation. The body callback must sample the original pose and must
 * not recursively invoke this class. Call body/facial first, then apply().
 */
export class SecondaryMotion {
  private readonly bones: BoundBone[];
  private readonly groups: BoundGroup[];
  private readonly colliders: BoundCollider[];
  private readonly links: BoundLink[];
  private readonly caches = new Map<string, Cache>();
  private readonly poseOrder: { particle: Particle; child: Particle }[];
  private building = false;
  private readonly velocity = new Vector3();
  private readonly difference = new Vector3();
  private readonly direction = new Vector3();
  private readonly reference = new Vector3();
  private readonly coneY = new Vector3();
  private readonly coneZ = new Vector3();
  private readonly transport = new Quaternion();
  private readonly rotation = new Quaternion();
  private readonly parentRotation = new Quaternion();
  private readonly scratchRotation = new Quaternion();
  private readonly inverseMatrix = new Matrix4();

  constructor(private readonly root: Object3D, private readonly data: PhysicsData) {
    if (data.version !== 1 || data.fps !== 60 || Math.abs(data.solver.fixedStepSeconds - 1 / 60) > 1e-12) {
      throw new Error('Secondary motion requires the audited 60 Hz physics data');
    }
    this.bones = data.bones.map(source => {
      const object = root.getObjectByName(source.name);
      if (!object) throw new Error(`Missing native physics bone ${source.name}`);
      const bound = { object, position: new Vector3().fromArray(source.position),
        quaternion: new Quaternion().fromArray(source.quaternion), scale: new Vector3().fromArray(source.scale) };
      return bound;
    });
    this.groups = data.chains.flatMap((chain, chainIndex) => chain.groups.map(group => {
      const settings = chain.settings.find(item => item.id === group.resolvedSettingId);
      if (!settings) throw new Error(`Missing parsed chain setting ${group.resolvedSettingId}`);
      return { id: group.id, chain: chainIndex, settings, gravity: new Vector3().fromArray(settings.gravity),
        anchor: new Vector3(), inheritedRotation: new Quaternion(), particles: group.nodes.map(node => ({
        source: node, bone: root.getObjectByName(node.bone)!, current: new Vector3(), previous: new Vector3(), target: new Vector3(),
        targetQuaternion: new Quaternion(), targetParentQuaternion: new Quaternion(), simulatedQuaternion: new Quaternion(),
        parentParticle: null, coneY: new Vector3(0, 1, 0), coneZ: new Vector3(0, 0, 1), length: 0,
      })) };
    }));
    this.groups.sort((a, b) => this.depth(a.particles[0].bone) - this.depth(b.particles[0].bone));
    const groupById = new Map(this.groups.map(group => [group.id, group]));
    this.colliders = data.chains.flatMap((chain, chainIndex) => chain.collisions.flatMap(source => {
      const bone = source.bone ? root.getObjectByName(source.bone) : null;
      const pairBone = source.pairBone ? root.getObjectByName(source.pairBone) : null;
      return bone && pairBone && [1, 2, 5].includes(source.shape)
        ? [{ source, chain: chainIndex, bone, pairBone, start: new Vector3(), end: new Vector3() }] : [];
    }));
    this.links = data.chains.flatMap(chain => chain.links.flatMap(source => {
      const a = source.groupA ? groupById.get(source.groupA) : null;
      const b = source.groupB ? groupById.get(source.groupB) : null;
      return a && b ? [{ a, b, source, lengths: [] }] : [];
    }));
    this.poseOrder = this.groups.flatMap(group => group.particles.slice(0, -1).map((particle, i) =>
      ({ particle, child: group.particles[i + 1] })));
    this.poseOrder.sort((a, b) => this.depth(a.particle.bone) - this.depth(b.particle.bone));
    const drivers = new Map(this.poseOrder.map(({ particle }) => [particle.bone, particle]));
    for (const group of this.groups) for (const particle of group.particles) {
      let ancestor = particle.bone.parent;
      while (ancestor && !drivers.has(ancestor)) ancestor = ancestor.parent;
      particle.parentParticle = ancestor ? drivers.get(ancestor)! : null;
    }
    for (const { particle, child } of this.poseOrder) {
      if (particle.source.angleMode !== 4) continue;
      const raw = new Quaternion().fromArray(particle.source.angleLimitDirection).normalize();
      const rawAxis = new Vector3(1, 0, 0).applyQuaternion(raw);
      const localRest = child.bone.position.clone().normalize();
      if (localRest.lengthSq() < 0.5) continue;
      // Some exported HairB bone axes differ from the raw cone frame. Calibrate
      // only its centre to the actual rest segment; keep the source transverse
      // axes rather than inventing a world-space left/right restriction.
      const calibration = new Quaternion().setFromUnitVectors(rawAxis, localRest);
      particle.coneY.set(0, 1, 0).applyQuaternion(raw).applyQuaternion(calibration).normalize();
      particle.coneZ.set(0, 0, 1).applyQuaternion(raw).applyQuaternion(calibration).normalize();
    }
  }

  private resetBasePose() {
    for (const bone of this.bones) {
      bone.object.position.copy(bone.position);
      bone.object.quaternion.copy(bone.quaternion);
      bone.object.scale.copy(bone.scale);
    }
  }

  /** Reset only native chain bones before an external kinematic body sample. */
  resetKinematics(): void { this.resetBasePose(); }

  private sampleTargets() {
    this.root.updateMatrixWorld(true);
    for (const group of this.groups) for (let i = 0; i < group.particles.length; i++) {
      const particle = group.particles[i];
      particle.bone.getWorldPosition(particle.target);
      particle.bone.getWorldQuaternion(particle.targetQuaternion);
      particle.simulatedQuaternion.copy(particle.targetQuaternion);
      particle.bone.parent?.getWorldQuaternion(particle.targetParentQuaternion);
      if (i) particle.length = particle.target.distanceTo(group.particles[i - 1].target);
    }
    for (const collider of this.colliders) {
      collider.start.fromArray(collider.source.offset).applyMatrix4(collider.bone.matrixWorld);
      if (collider.source.shape === 1) collider.end.copy(collider.start);
      else collider.end.fromArray(collider.source.pairOffset).applyMatrix4(collider.pairBone.matrixWorld);
    }
  }

  private initialiseParticles() {
    for (const group of this.groups) for (const particle of group.particles) {
      particle.current.copy(particle.target); particle.previous.copy(particle.target);
    }
    for (const link of this.links) {
      const count = Math.min(link.source.nodeCount || Math.min(link.a.particles.length, link.b.particles.length),
        link.a.particles.length - link.source.skipGroupA, link.b.particles.length - link.source.skipGroupB);
      link.lengths = Array.from({ length: Math.max(0, count) }, (_, i) =>
        link.a.particles[i + link.source.skipGroupA].target.distanceTo(link.b.particles[i + link.source.skipGroupB].target));
    }
  }

  private constrainJiggle(group: BoundGroup) {
    const particle = group.particles[0], jiggle = particle.source.jiggle;
    this.updateAnchor(group);
    if (!jiggle) { particle.current.copy(group.anchor); return; }
    const orientation = this.rotation.copy(group.inheritedRotation).multiply(particle.targetQuaternion)
      .multiply(this.scratchRotation.fromArray(jiggle.rangeAxis)).normalize();
    this.difference.copy(particle.current).sub(group.anchor).applyQuaternion(this.scratchRotation.copy(orientation).invert());
    this.difference.x -= jiggle.rangeOffset[0]; this.difference.y -= jiggle.rangeOffset[1]; this.difference.z -= jiggle.rangeOffset[2];
    if (jiggle.rangeShape === 1) {
      this.difference.x = clamp(this.difference.x, -jiggle.range[0], jiggle.range[0]);
      this.difference.y = clamp(this.difference.y, -jiggle.range[1], jiggle.range[1]);
      this.difference.z = clamp(this.difference.z, -jiggle.range[2], jiggle.range[2]);
    } else {
      let normalizedLength = 0;
      for (let axis = 0; axis < 3; axis++) {
        const radius = jiggle.range[axis];
        if (radius < EPSILON) this.difference.setComponent(axis, 0);
        else normalizedLength += (this.difference.getComponent(axis) / radius) ** 2;
      }
      if (normalizedLength > 1) this.difference.multiplyScalar(1 / Math.sqrt(normalizedLength));
    }
    this.difference.x += jiggle.rangeOffset[0]; this.difference.y += jiggle.rangeOffset[1]; this.difference.z += jiggle.rangeOffset[2];
    particle.current.copy(this.difference.applyQuaternion(orientation)).add(group.anchor);
  }

  private updateAnchor(group: BoundGroup) {
    const first = group.particles[0], parent = first.parentParticle;
    if (!parent) {
      group.anchor.copy(first.target); group.inheritedRotation.identity(); return;
    }
    // Native chains may branch from another simulated chain, rather than from
    // a purely animated head/hip. Transport the branch anchor with that actual
    // parent pose, so collider particles and the rendered bones share a frame.
    group.inheritedRotation.copy(parent.simulatedQuaternion).multiply(this.scratchRotation.copy(parent.targetQuaternion).invert()).normalize();
    group.anchor.copy(first.target).sub(parent.target).applyQuaternion(group.inheritedRotation).add(parent.current);
  }

  private integrate() {
    const dt = this.data.solver.fixedStepSeconds;
    for (const group of this.groups) {
      for (let i = 0; i < group.particles.length; i++) {
        const particle = group.particles[i];
        const jiggle = i === 0 ? particle.source.jiggle : null;
        if (i === 0 && !jiggle) { particle.previous.copy(particle.target); particle.current.copy(particle.target); continue; }
        const damping = clamp(jiggle?.damping ?? group.settings.damping, 0, 1);
        this.velocity.copy(particle.current).sub(particle.previous).multiplyScalar(1 - damping);
        if (group.settings.velocityLimit > 0) this.velocity.clampLength(0, group.settings.velocityLimit * dt);
        particle.previous.copy(particle.current);
        particle.current.add(this.velocity).addScaledVector(group.gravity, dt * dt * (jiggle?.gravityCoef ?? particle.source.gravityCoef));
        particle.current.lerp(particle.target, clamp(jiggle?.springForce ?? group.settings.springForce, 0, 1));
      }
      this.constrainJiggle(group);
    }
  }

  private constrainGroup(group: BoundGroup, collide: boolean) {
    this.constrainJiggle(group);
    for (let i = 1; i < group.particles.length; i++) {
      const particle = group.particles[i], previous = group.particles[i - 1];
      this.reference.copy(particle.target).sub(previous.target);
      if (particle.length < EPSILON) { particle.current.copy(previous.current); continue; }
      this.reference.normalize();
      const parent = previous.parentParticle;
      if (parent) this.transport.copy(parent.simulatedQuaternion).multiply(this.scratchRotation.copy(parent.targetQuaternion).invert()).normalize();
      else this.transport.identity();
      this.reference.applyQuaternion(this.transport);
      this.direction.copy(particle.current).sub(previous.current);
      if (this.direction.lengthSq() < EPSILON) this.direction.copy(this.reference);
      else this.direction.normalize();
      if (previous.source.angleMode === 4) {
        this.coneY.copy(previous.coneY).applyQuaternion(previous.targetQuaternion).applyQuaternion(this.transport);
        this.coneZ.copy(previous.coneZ).applyQuaternion(previous.targetQuaternion).applyQuaternion(this.transport);
        constrainOval(this.direction, this.reference, this.coneY, this.coneZ, previous.source.angleLimitRad);
      } else if (previous.source.angleMode !== 0) constrainCone(this.direction, this.reference, previous.source.angleLimitRad);
      particle.current.copy(previous.current).addScaledVector(this.direction, particle.length);
      if (collide && particle.source.collisionShape !== 0 && particle.source.collisionFilterFlags !== 0) {
        for (const collider of this.colliders) {
          if (collider.chain !== group.chain) continue;
          projectOutsideCapsule(particle.current, collider.start, collider.end, collider.source.radius,
            collider.source.shape === 5 ? collider.source.endRadius : collider.source.radius, particle.source.collisionRadius);
        }
      }
      this.direction.copy(particle.current).sub(previous.current).normalize();
      previous.simulatedQuaternion.setFromUnitVectors(this.reference, this.direction)
        .multiply(this.transport).multiply(previous.targetQuaternion).normalize();
    }
  }

  private constrainLinks() {
    for (const link of this.links) for (let i = 0; i < link.lengths.length; i++) {
      const ai = i + link.source.skipGroupA, bi = i + link.source.skipGroupB;
      if (!ai && !bi) continue;
      const a = link.a.particles[ai].current, b = link.b.particles[bi].current;
      this.difference.copy(b).sub(a);
      const distance = this.difference.length();
      if (distance < EPSILON) continue;
      const minimum = Math.max(0, link.source.distanceShrinkLimitCoef) * link.lengths[i];
      const maximum = Math.max(link.source.distanceShrinkLimitCoef, link.source.distanceExpandLimitCoef) * link.lengths[i];
      const delta = distance - clamp(distance, minimum, maximum);
      this.difference.multiplyScalar(delta / distance);
      if (ai && bi) { a.addScaledVector(this.difference, 0.5); b.addScaledVector(this.difference, -0.5); }
      else if (ai) a.add(this.difference);
      else b.sub(this.difference);
    }
  }

  private step() {
    this.integrate();
    for (let iteration = 0; iteration < this.data.solver.iterations; iteration++) {
      for (const group of this.groups) this.constrainGroup(group, true);
      this.constrainLinks();
    }
    // Finish with exact segment lengths. Collisions are solved iteratively;
    // conflicting hard constraints can retain a small collision residual.
    for (const group of this.groups) this.constrainGroup(group, false);
  }

  private writePose() {
    // Write from shallower bones to deeper bones so each local rotation uses
    // the already resolved parent rotation. All local translations remain the
    // original length, except the explicitly bounded jiggle roots.
    for (const { particle } of this.poseOrder) {
      const bone = particle.bone;
      if (particle.source.jiggle && bone.parent) {
        bone.parent.updateWorldMatrix(true, false);
        bone.position.copy(particle.current).applyMatrix4(this.inverseMatrix.copy(bone.parent.matrixWorld).invert());
      }
      if (bone.parent) {
        bone.parent.updateWorldMatrix(true, false);
        bone.parent.getWorldQuaternion(this.parentRotation);
        bone.quaternion.copy(this.parentRotation.invert()).multiply(particle.simulatedQuaternion).normalize();
      } else bone.quaternion.copy(particle.simulatedQuaternion);
      bone.updateMatrix();
    }
    this.root.updateMatrixWorld(true);
  }

  private depth(bone: Object3D): number {
    let result = 0, node = bone.parent;
    while (node) { result++; node = node.parent; }
    return result;
  }

  async build(mode: string, frames: number, sampleBody: (frame: number) => void): Promise<void> {
    if (this.building) throw new Error('Build one secondary motion mode per actor at a time');
    if (!Number.isInteger(frames) || frames < 0 || frames > 3600) throw new Error('Invalid secondary motion frame range');
    this.building = true;
    const start = performance.now();
    try {
      this.resetBasePose(); sampleBody(0); this.sampleTargets(); this.initialiseParticles();
      for (let i = 0; i < this.data.solver.warmupFrames; i++) this.step();
      const values = new Float32Array((frames + 1) * this.bones.length * 7);
      let maximumLengthError = 0, maximumBoneParticleError = 0;
      for (let frame = 0; frame <= frames; frame++) {
        this.resetBasePose(); sampleBody(frame); this.sampleTargets();
        if (frame > 0) this.step();
        else for (const group of this.groups) this.constrainGroup(group, false);
        this.writePose();
        for (let i = 0; i < this.bones.length; i++) {
          const bone = this.bones[i].object, at = (frame * this.bones.length + i) * 7;
          bone.position.toArray(values, at); bone.quaternion.toArray(values, at + 3);
        }
        for (const group of this.groups) for (let i = 1; i < group.particles.length; i++) {
          maximumLengthError = Math.max(maximumLengthError, Math.abs(group.particles[i].current.distanceTo(group.particles[i - 1].current) - group.particles[i].length));
        }
        for (const group of this.groups) for (const particle of group.particles) {
          particle.bone.getWorldPosition(this.difference);
          maximumBoneParticleError = Math.max(maximumBoneParticleError, this.difference.distanceTo(particle.current));
        }
        if (frame > 0 && frame % 32 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      this.caches.set(mode, { frames, values, maximumLengthError, maximumBoneParticleError, buildMilliseconds: performance.now() - start });
    } finally { this.building = false; }
  }

  /** Restore a cached pose after sampling the same frame's body/facial curves. */
  apply(mode: string, frame: number): void {
    const cache = this.caches.get(mode);
    if (!cache) throw new Error(`Secondary motion mode ${mode} is not built`);
    const clamped = clamp(Number.isFinite(frame) ? frame : 0, 0, cache.frames);
    const first = Math.floor(clamped), second = Math.min(first + 1, cache.frames), alpha = clamped - first;
    for (let i = 0; i < this.bones.length; i++) {
      const object = this.bones[i].object, a = (first * this.bones.length + i) * 7, b = (second * this.bones.length + i) * 7;
      object.position.fromArray(cache.values, a).lerp(this.difference.fromArray(cache.values, b), alpha);
      object.quaternion.fromArray(cache.values, a + 3).slerp(this.rotation.fromArray(cache.values, b + 3), alpha).normalize();
    }
    this.root.updateMatrixWorld(true);
  }

  getStats() {
    return { fixedFps: this.data.fps, groups: this.groups.length, bones: this.bones.length, colliders: this.colliders.length,
      modes: Object.fromEntries([...this.caches].map(([mode, cache]) => [mode, { frames: cache.frames,
        bytes: cache.values.byteLength, buildMilliseconds: cache.buildMilliseconds, maximumLengthError: cache.maximumLengthError,
        maximumBoneParticleError: cache.maximumBoneParticleError }])) };
  }

  dispose() { this.caches.clear(); }
}
