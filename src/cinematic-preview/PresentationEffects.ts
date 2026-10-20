import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import nativeData from "../characters/jamie/data/native-numerics.json";

export type PresentationMode = "SA3" | "CA";
export interface ImpactCue { frame: number; attackId: number; strength: number; finisher: boolean; position: THREE.Vector3 }
export interface MotionSample { frame: number; limbs: THREE.Vector3[] }
export interface EffectTrack { impacts: ImpactCue[]; motion: MotionSample[] }
export const BODY_FRAMES: Record<PresentationMode, number> = { SA3: 438, CA: 499 };
export const TAIL_FRAMES = 15;
export function impactDefinitions(mode: PresentationMode) {
  const captured = nativeData.rows.find(row => row.row === (mode === "CA" ? 90 : 89))!.captured!;
  const hits = captured.hits.filter(hit => hit.damage > 0);
  return hits.map((hit, index) => ({ frame: hit.from, attackId: hit.attackId,
    strength: hit.damage >= 1000 ? 1.7 : hit.damage >= 500 ? 1.05 : 0.65,
    finisher: index === hits.length - 1 }));
}

const hash = (seed: number) => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
const smooth = (from: number, to: number, value: number) => THREE.MathUtils.smoothstep(value, from, to);
const filmShader = {
  uniforms: { tDiffuse: { value: null }, frame: { value: 0 }, film: { value: 0 }, hit: { value: 0 },
    hitUv: { value: new THREE.Vector2(0.5, 0.5) }, aspect: { value: 16 / 9 }, reduced: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float frame,film,hit,aspect,reduced; uniform vec2 hitUv; varying vec2 vUv;
    float noise(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec2 d=vUv-hitUv; d.x*=aspect;
      float radius=length(d); float pulse=hit*(1.0-reduced*.8);
      vec2 uv=vUv+normalize(vUv-hitUv+vec2(.0001))*sin(radius*65.0)*pulse*.0009;
      vec3 c=texture2D(tDiffuse,uv).rgb;
      float luma=dot(c,vec3(.2126,.7152,.0722));
      c=mix(c,vec3(luma)*vec3(1.06,1.025,.945),film*.86);
      vec2 edge=(vUv-.5)*vec2(1.0,.82);
      c*=1.0-film*.38*smoothstep(.18,.66,length(edge));
      c+=vec3(1.0,.85,.56)*pulse*.23*exp(-radius*4.5);
      c=mix(c,vec3(2.5,2.2,1.75),pulse*.10);
      float grain=(noise(gl_FragCoord.xy+floor(frame*.5)*vec2(7.0,19.0))-.5)*.006*film*(1.0-reduced);
      c=max(vec3(0.0),c+grain);
      float bar=film*.047;
      if(vUv.y<bar||vUv.y>1.0-bar)c=vec3(.0015);
      gl_FragColor=vec4(c,1.0);
    }`,
};

function texture(kind: "glow" | "smoke") {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  if (kind === "glow") {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 63);
    g.addColorStop(0, "rgba(255,255,250,1)"); g.addColorStop(0.1, "rgba(255,251,220,.95)");
    g.addColorStop(0.33, "rgba(255,210,135,.32)"); g.addColorStop(1, "rgba(255,170,70,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  } else for (let i = 0; i < 16; i++) {
    const x = 25 + hash(i + 3) * 78, y = 25 + hash(i + 22) * 78, r = 20 + hash(i + 9) * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(240,235,215,.16)"); g.addColorStop(1, "rgba(235,230,210,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  const result = new THREE.CanvasTexture(canvas); result.colorSpace = THREE.SRGBColorSpace;
  return result;
}

/** Procedural study of the reference's white-gold impacts and kung-fu film grade.
 * Every particle and trail is sampled from authored frames, including on rewind.
 * These effects are reconstructed; they are not an imported RE Engine VFX graph.
 */
export class PresentationEffects {
  private composer: EffectComposer;
  private pass: ShaderPass;
  private renderPass: RenderPass;
  private group = new THREE.Group();
  private tracks!: Record<PresentationMode, EffectTrack>;
  private glows: THREE.Sprite[] = [];
  private rings: THREE.Mesh[] = [];
  private smoke: THREE.Sprite[] = [];
  private glowTexture = texture("glow");
  private smokeTexture = texture("smoke");
  private sparkGeometry = new THREE.BufferGeometry();
  private rayGeometry = new THREE.BufferGeometry();
  private trailGeometry = new THREE.BufferGeometry();
  private sparkPositions = new Float32Array(512 * 3);
  private sparkColors = new Float32Array(512 * 3);
  private rayPositions = new Float32Array(512 * 6);
  private rayColors = new Float32Array(512 * 6);
  private trailPositions = new Float32Array(4 * 8 * 18);
  private trailColors = new Float32Array(4 * 8 * 24);
  private sparks: THREE.Points;
  private rays: THREE.LineSegments;
  private trails: THREE.Mesh;
  private light = new THREE.PointLight(0xffdfa2, 0, 3.2, 2);
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private projected = new THREE.Vector3();
  private enabled = true;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera); this.composer.addPass(this.renderPass);
    this.pass = new ShaderPass(filmShader); this.composer.addPass(this.pass); this.composer.addPass(new OutputPass());
    this.group.name = "reconstructed-super-presentation"; scene.add(this.group);
    this.group.add(this.light);
    for (let i = 0; i < 4; i++) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      glow.renderOrder = 10; this.glows.push(glow); this.group.add(glow);
      const ring = new THREE.Mesh(new THREE.RingGeometry(.94, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffe9bc, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      this.rings.push(ring); this.group.add(ring);
      for (let s = 0; s < 3; s++) {
        const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTexture, color: 0xe9e0cd, transparent: true, depthWrite: false, opacity: .25 }));
        this.smoke.push(smoke); this.group.add(smoke);
      }
    }
    this.sparkGeometry.setAttribute("position", new THREE.BufferAttribute(this.sparkPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkGeometry.setAttribute("color", new THREE.BufferAttribute(this.sparkColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparks = new THREE.Points(this.sparkGeometry, new THREE.PointsMaterial({ map: this.glowTexture, size: .038, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.rayGeometry.setAttribute("position", new THREE.BufferAttribute(this.rayPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.rayGeometry.setAttribute("color", new THREE.BufferAttribute(this.rayColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.rays = new THREE.LineSegments(this.rayGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.trailGeometry.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeometry.setAttribute("color", new THREE.BufferAttribute(this.trailColors, 4).setUsage(THREE.DynamicDrawUsage));
    this.trails = new THREE.Mesh(this.trailGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    for (const object of [this.sparks, this.rays, this.trails]) { object.frustumCulled = false; this.group.add(object); }
  }
  setTracks(tracks: Record<PresentationMode, EffectTrack>) { this.tracks = tracks; }
  setEnabled(value: boolean) { this.enabled = value; this.group.visible = value; }
  resize(width: number, height: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(width, height);
    this.pass.uniforms.aspect.value = width / height;
  }
  private sampleMotion(track: EffectTrack, frame: number, limb: number, out: THREE.Vector3) {
    const index = Math.min(track.motion.length - 1, Math.max(0, Math.floor(frame / 3)));
    const a = track.motion[index], b = track.motion[Math.min(index + 1, track.motion.length - 1)];
    return out.copy(a.limbs[limb]).lerp(b.limbs[limb], a === b ? 0 : THREE.MathUtils.clamp((frame - a.frame) / (b.frame - a.frame), 0, 1));
  }
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, mode: PresentationMode, frame: number, shake: boolean) {
    if (!this.enabled || !this.tracks) { this.renderer.render(scene, camera); return; }
    // Projection must use this sample's view matrix even after a seek. Waiting
    // for WebGLRenderer to update it would project flashes using the last frame.
    camera.updateMatrixWorld(true);
    const track = this.tracks[mode], active = track.impacts.filter(cue => frame >= cue.frame && frame - cue.frame < 36).slice(-4);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion); this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    let pointCount = 0, rayCount = 0, strongest = 0;
    this.light.intensity = 0;
    for (let b = 0; b < 4; b++) {
      const cue = active[b];
      this.glows[b].visible = this.rings[b].visible = Boolean(cue);
      for (let j = 0; j < 3; j++) this.smoke[b * 3 + j].visible = Boolean(cue);
      if (!cue) continue;
      const age = frame - cue.frame, strength = cue.strength, t = age / 60;
      const flare = Math.exp(-age * .31) * strength;
      this.glows[b].position.copy(cue.position); this.glows[b].scale.setScalar((.25 + age * .017) * strength);
      (this.glows[b].material as THREE.SpriteMaterial).opacity = Math.min(.94, flare);
      this.rings[b].position.copy(cue.position); this.rings[b].quaternion.copy(camera.quaternion);
      this.rings[b].scale.setScalar((.03 + .3 * (1 - Math.exp(-age * .2))) * strength);
      (this.rings[b].material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - age / 11) * .38;
      for (let j = 0; j < 3; j++) {
        const smoke = this.smoke[b * 3 + j], seed = cue.frame + j * 91;
        smoke.position.copy(cue.position).addScaledVector(this.right, (hash(seed) - .5) * (.12 + t * .3));
        smoke.position.y += .03 + t * .2 + (hash(seed + 9) - .5) * .12;
        smoke.scale.setScalar((.25 + t * .7) * strength);
        const mat = smoke.material as THREE.SpriteMaterial; mat.rotation = hash(seed + 4) * 6.28 + t * .2;
        mat.opacity = Math.sin(Math.min(1, age / 36) * Math.PI) * (cue.finisher ? .5 : .3);
      }
      const count = this.reduced ? 8 : cue.finisher ? 46 : 28;
      for (let i = 0; i < count && age < 27 && pointCount < 512; i++) {
        const seed = cue.frame * 31 + i * 7, angle = hash(seed) * Math.PI * 2;
        const speed = (.6 + hash(seed + 1) * 2.5) * strength;
        const travel = speed * t * (1 - t * .9);
        this.direction.copy(this.right).multiplyScalar(Math.cos(angle)).addScaledVector(this.up, Math.sin(angle));
        const pos = cue.position.clone().addScaledVector(this.direction, travel); pos.y -= t * t * .75;
        const fade = Math.pow(1 - age / 27, 1.5) * (.5 + hash(seed + 2) * .5);
        this.sparkPositions.set(pos.toArray(), pointCount * 3);
        this.sparkColors.set([fade, fade * (.72 + hash(seed + 3) * .24), fade * .35], pointCount++ * 3);
        const tail = pos.clone().addScaledVector(this.direction, -.02 * speed);
        this.rayPositions.set([...tail.toArray(), ...pos.toArray()], rayCount * 6);
        this.rayColors.set([0, 0, 0, fade * 1.3, fade, fade * .55], rayCount++ * 6);
      }
      if (flare > strongest) {
        strongest = flare; this.projected.copy(cue.position).project(camera);
        this.pass.uniforms.hitUv.value.set(this.projected.x * .5 + .5, this.projected.y * .5 + .5);
        this.light.position.copy(cue.position); this.light.intensity = flare * .7;
      }
    }
    this.sparkGeometry.setDrawRange(0, pointCount); this.rayGeometry.setDrawRange(0, rayCount * 2);
    for (const geometry of [this.sparkGeometry, this.rayGeometry]) { geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true; }
    let vertex = 0;
    const p = new THREE.Vector3(), q = new THREE.Vector3(), width = new THREE.Vector3(), view = new THREE.Vector3();
    for (let limb = 0; limb < 4; limb++) for (let step = 0; step < 7; step++) {
      const at = Math.max(0, frame - step * 2), before = Math.max(0, at - 2);
      this.sampleMotion(track, at, limb, p); this.sampleMotion(track, before, limb, q);
      const distance = p.distanceTo(q);
      if (distance < .055 || distance > .7 || this.reduced || frame > BODY_FRAMES[mode]) continue;
      view.copy(camera.position).sub(p).normalize(); width.copy(p).sub(q).cross(view).normalize().multiplyScalar(.014 + Math.min(.03, distance * .12));
      const corners = [p.clone().add(width), q.clone().add(width), p.clone().sub(width), p.clone().sub(width), q.clone().add(width), q.clone().sub(width)];
      const opacity = Math.min(.34, distance * 2) * (1 - step / 7) ** 1.5;
      for (let j = 0; j < 6; j++) {
        this.trailPositions.set(corners[j].toArray(), vertex * 3);
        this.trailColors.set([1, .9, .7, opacity * (j === 1 || j >= 4 ? .25 : 1)], vertex++ * 4);
      }
    }
    this.trailGeometry.setDrawRange(0, vertex); this.trailGeometry.attributes.position.needsUpdate = true; this.trailGeometry.attributes.color.needsUpdate = true;
    if (shake && !this.reduced && strongest > .04) {
      const amount = Math.min(1, strongest) * .006;
      camera.position.addScaledVector(this.right, Math.sin(frame * 2.3) * amount).addScaledVector(this.up, Math.cos(frame * 2.9) * amount * .6);
    }
    const film = smooth(mode === "CA" ? 65 : 90, mode === "CA" ? 112 : 144, frame);
    this.pass.uniforms.frame.value = frame; this.pass.uniforms.film.value = film;
    this.pass.uniforms.hit.value = Math.min(1, strongest); this.pass.uniforms.reduced.value = this.reduced ? 1 : 0;
    this.renderPass.camera = camera; this.composer.render(0);
  }
  dispose() {
    this.group.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite || object instanceof THREE.LineSegments) { if ("geometry" in object) object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => material.dispose()); } });
    this.glowTexture.dispose(); this.smokeTexture.dispose(); this.group.removeFromParent();
    this.composer.passes.forEach(pass => pass.dispose()); this.composer.dispose();
  }
}
