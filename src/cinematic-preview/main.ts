import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PresentationEffects, BODY_FRAMES, TAIL_FRAMES, impactDefinitions, type EffectTrack, type PresentationMode } from "./PresentationEffects";
import { CinematicAudio } from "./CinematicAudio";
import { FacialAnimation, type FacialData } from "./FacialAnimation";
import { SecondaryMotion, type PhysicsData } from "./SecondaryMotion";
import { applyJamieAppearance } from "./Appearance";
import "./style.css";
import "./embed.css";
import "./audio.css";

type Mode = "SA3" | "CA";
interface Curve { keys: number[]; values: number[][] }
interface CameraClip {
  name: string; frameCount: number;
  transform: { position: Curve; quaternion: Curve };
  properties: { position: Curve };
}
interface Actor { root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Record<Mode, THREE.AnimationAction>; facial: FacialAnimation; secondary: SecondaryMotion }
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>("scene");
const viewport = el<HTMLDivElement>("viewport");
const timeline = el<HTMLInputElement>("timeline");
const playButton = el<HTMLButtonElement>("play");
const cameraMode = el<HTMLSelectElement>("camera-mode");
const drinkLevels: [number, number] = [4, 0];
const assetRoot = "/assets/jamie/cinematic/";
if (new URLSearchParams(location.search).get("embed") === "1") document.body.classList.add("embed");
const totalFrames: Record<Mode, number> = { SA3: BODY_FRAMES.SA3 + TAIL_FRAMES, CA: BODY_FRAMES.CA + TAIL_FRAMES };
const clips = { SA3: ["esf021_SAA3_GETUGASAIHOU", "esf021_SAD3_GETUGASAIHOU"], CA: ["esf021_CAA_GETUGASAIHOU", "esf021_CAD_GETUGASAIHOU"] };
const cameraNames = { SA3: "CAM_SAA3_GETUGASAIHOU", CA: "CAM_CAA_GETUGASAIHOU" };
let mode: Mode = "SA3", frame = 0, playing = false, ready = false;
let lastTimestamp = 0, lastUiFrame = -1;
let cameras: CameraClip[] = [], actors: Actor[] = [];
let renderer: THREE.WebGLRenderer;
let disposed = false;
let effects: PresentationEffects | undefined;
const audio = new CinematicAudio();
let playbackRequest = 0;
const speed = () => Number(el<HTMLSelectElement>("speed").value);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x171b24);
scene.fog = new THREE.FogExp2(0x171b24, 0.018);
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 100);
const freeCamera = new THREE.PerspectiveCamera(38, 16 / 9, 0.02, 100);
freeCamera.position.set(-3.8, 2.1, 4.4);
const controls = new OrbitControls(freeCamera, canvas);
controls.target.set(0, 0.95, 0);
controls.minDistance = 0.8; controls.maxDistance = 15;
controls.enablePan = true; controls.enabled = false; controls.update();

function applyVisibility() {
  actors.forEach((actor, index) => applyJamieAppearance(actor.root, { drinkLevel: drinkLevels[index], side: index === 0 ? 1 : 2 }));
  el<HTMLSelectElement>("p1-drink").value = String(drinkLevels[0]);
  el<HTMLSelectElement>("p2-drink").value = String(drinkLevels[1]);
}

function curveInterval(curve: Curve, at: number): [number, number, number] {
  const keys = curve.keys;
  if (at <= keys[0]) return [0, 0, 0];
  const last = keys.length - 1;
  if (at >= keys[last]) return [last, last, 0];
  let low = 0, high = last;
  while (low + 1 < high) { const middle = (low + high) >> 1; if (keys[middle] <= at) low = middle; else high = middle; }
  return [low, high, (at - keys[low]) / (keys[high] - keys[low])];
}
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
const cameraAnchor = new THREE.Vector3(), cameraEndpoint = new THREE.Vector3();
function applyCamera() {
  const clip = cameras.find(item => item.name === cameraNames[mode]);
  if (!clip) return;
  const p = clip.transform.position, q = clip.transform.quaternion, fov = clip.properties.position;
  const [pa, pb, pt] = curveInterval(p, frame);
  camera.position.fromArray(p.values[pa]).lerp(cameraEndpoint.fromArray(p.values[pb]), pt);
  // The paired camera track is relative to the moving animation Root. The GLB
  // retains that motion in its skeleton; applying it here keeps later shots
  // aligned without changing the authored orientation or lens curves.
  const motionRoot = actors[0]?.root.getObjectByName("Root");
  if (motionRoot) camera.position.add(motionRoot.getWorldPosition(cameraAnchor));
  const [ra, rb, rt] = curveInterval(q, frame);
  camera.quaternion.copy(qa.fromArray(q.values[ra]).slerp(qb.fromArray(q.values[rb]), rt));
  const [fa, fb, ft] = curveInterval(fov, frame);
  camera.fov = THREE.MathUtils.radToDeg(THREE.MathUtils.lerp(fov.values[fa][0], fov.values[fb][0], ft));
  camera.updateProjectionMatrix();
}

function sampleBody(actor: Actor, kind: Mode, at: number) {
  actor.secondary.resetKinematics();
  actor.actions[kind].paused = false;
  actor.actions[kind].enabled = true;
  actor.mixer.setTime(Math.min(at / 60, actor.actions[kind].getClip().duration));
  if (el<HTMLInputElement>("facial").checked) actor.facial.sample(kind, at);
  else actor.facial.reset();
  actor.root.updateMatrixWorld(true);
}
function sampleActors(withPhysics = true) {
  for (const actor of actors) {
    sampleBody(actor, mode, frame);
    if (withPhysics && el<HTMLInputElement>("physics").checked) actor.secondary.apply(mode, frame);
  }
}
function updateUi() {
  const integerFrame = Math.round(frame);
  if (lastUiFrame === integerFrame) return;
  lastUiFrame = integerFrame;
  timeline.value = String(integerFrame);
  el<HTMLOutputElement>("time").value = `${String(integerFrame).padStart(3, "0")} / ${totalFrames[mode]} F`;
}
function render() {
  if (!ready || disposed) return;
  sampleActors(); applyCamera(); updateUi();
  if (playing) audio.sync(mode, frame, speed());
  const activeCamera = cameraMode.value === "native" ? camera : freeCamera;
  if (effects) effects.render(scene, activeCamera, mode, frame, cameraMode.value === "native");
  else renderer.render(scene, activeCamera);
}
function setPlaying(next: boolean) {
  if (!next) { playbackRequest++; audio.pause(); }
  playing = next && ready && audio.start(mode, frame, speed());
  playButton.textContent = playing ? "暂停" : "播放";
  playButton.setAttribute("aria-label", playing ? "暂停动画" : "播放动画");
  lastTimestamp = 0;
}
async function requestPlayback() {
  if (!ready) return;
  const request = ++playbackRequest;
  // Keep the control operable if an autoplay request is waiting for a gesture.
  playButton.disabled = false;
  playButton.textContent = "准备原声…";
  el("audio-status").textContent = "准备原版音效与日语语音…";
  try {
    if (el<HTMLInputElement>("sound").checked) await audio.unlock();
    if (request !== playbackRequest || disposed) return;
    if (frame >= totalFrames[mode]) seek(0);
    setPlaying(true);
    el("audio-status").textContent = el<HTMLInputElement>("sound").checked ? "原版音效 · 日语原声" : "已静音";
  } catch (error) {
    setPlaying(false);
    el("audio-status").textContent = error instanceof Error ? `原声未就绪：${error.message}` : "原声未就绪";
  } finally {
    playButton.disabled = false;
    playButton.textContent = playing ? "暂停" : "播放";
  }
}
function seek(value: number) {
  if (!Number.isFinite(value)) return;
  frame = THREE.MathUtils.clamp(value, 0, totalFrames[mode]);
  if (playing) audio.start(mode, frame, speed());
  lastUiFrame = -1; render();
}
function selectMode(next: Mode) {
  playbackRequest++;
  audio.pause();
  mode = next; frame = 0; lastUiFrame = -1;
  lastTimestamp = 0;
  document.documentElement.style.setProperty("--accent", next === "CA" ? "#f5b5a5" : "#d5bcfa");
  document.documentElement.style.setProperty("--accent-solid", next === "CA" ? "#df8e77" : "#ab7ded");
  viewport.classList.toggle("critical", next === "CA");
  el("sa3").setAttribute("aria-pressed", String(next === "SA3"));
  el("ca").setAttribute("aria-pressed", String(next === "CA"));
  timeline.max = String(totalFrames[next]);
  el("shot-label").textContent = `${next} · 命中演出`;
  el("duration").textContent = `${(totalFrames[next] / 60).toFixed(2)} 秒 / 含尾响`;
  for (const actor of actors) {
    actor.mixer.stopAllAction();
    actor.actions[next].reset().play();
  }
  if (playing) audio.start(mode, 0, speed());
  render();
}
function resize() {
  if (!renderer) return;
  const width = viewport.clientWidth, height = viewport.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  effects?.resize(width, height);
  camera.aspect = freeCamera.aspect = width / height;
  camera.updateProjectionMatrix(); freeCamera.updateProjectionMatrix(); render();
}

function buildEffectTracks(): Record<PresentationMode, EffectTrack> {
  const tracks = {} as Record<PresentationMode, EffectTrack>;
  const limbNames = ["L_Hand", "R_Hand", "L_Foot", "R_Foot"];
  const point = (actor: Actor, name: string) => (actor.root.getObjectByName(name) ?? actor.root).getWorldPosition(new THREE.Vector3());
  for (const kind of ["SA3", "CA"] as const) {
    selectMode(kind);
    const track: EffectTrack = { motion: [], impacts: [] };
    const frames = Array.from({ length: Math.ceil(BODY_FRAMES[kind] / 3) }, (_, index) => index * 3);
    frames.push(BODY_FRAMES[kind]);
    for (const at of frames) {
      frame = at; sampleActors(false);
      track.motion.push({ frame: at, limbs: limbNames.map(name => point(actors[0], name)) });
    }
    for (const cue of impactDefinitions(kind)) {
      frame = cue.frame; sampleActors(false);
      const target = actors[1], chest = point(target, "C_Chest"), head = point(target, "C_Head");
      let position = kind === "CA" && cue.attackId >= 242 ? point(target, "C_Neck") : chest.clone().lerp(head, cue.finisher ? .55 : .15);
      // Position the reconstruction at the closest actual animated limb/contact,
      // rather than a fixed screen-space explosion or the fighter's origin.
      if (cue.attackId < 242) {
        let nearest = .48;
        for (const targetPoint of [chest, head]) for (const name of limbNames) {
          const source = point(actors[0], name), distance = source.distanceTo(targetPoint);
          if (distance < nearest) { nearest = distance; position = targetPoint.clone().lerp(source, .4); }
        }
      }
      track.impacts.push({ ...cue, position });
    }
    tracks[kind] = track;
  }
  return tracks;
}

async function load() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = 0.45;
    room.dispose(); pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xdce5ff, 0x3b2d24, 1.7));
    const key = new THREE.DirectionalLight(0xffe5c8, 3.5);
    key.position.set(-3, 6, 5); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -4; key.shadow.camera.right = 4;
    key.shadow.camera.top = 4; key.shadow.camera.bottom = -4; key.shadow.normalBias = 0.025;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa5c5ff, 2.1); rim.position.set(3, 3, -4); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x222936, roughness: 0.93 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.012; floor.receiveShadow = true; scene.add(floor);
    const grid = new THREE.GridHelper(40, 80, 0x647084, 0x343e50); grid.position.y = -0.01; scene.add(grid);
    const [gltf, cameraData, facialData, physicsData] = await Promise.all([
      new GLTFLoader().loadAsync(`${assetRoot}jamie-native.glb`, event => {
        if (event.lengthComputable) el("load-progress").textContent = `载入模型与贴图 ${Math.round(event.loaded / event.total * 100)}%`;
      }),
      fetch(`${assetRoot}camera.json`).then(response => { if (!response.ok) throw new Error("原版镜头载入失败"); return response.json(); }),
      fetch(`${assetRoot}facial.json`).then(response => { if (!response.ok) throw new Error("原版面部数据载入失败"); return response.json() as Promise<FacialData>; }),
      fetch(`${assetRoot}physics.json`).then(response => { if (!response.ok) throw new Error("原版物理链数据载入失败"); return response.json() as Promise<PhysicsData>; }),
    ]);
    cameras = cameraData.clips;
    actors = [0, 1].map(index => {
      const root = clone(gltf.scene);
      root.name = index ? "受击方" : "攻击方";
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.frustumCulled = false;
        object.castShadow = !/Eye|Hair|Fur/i.test(object.name); object.receiveShadow = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => {
          if (!(material instanceof THREE.MeshStandardMaterial)) return;
          material.envMapIntensity = 0.6;
        });
      });
      scene.add(root);
      const mixer = new THREE.AnimationMixer(root);
      const actions = Object.fromEntries((Object.keys(clips) as Mode[]).map(kind => {
        const clip = gltf.animations.find(item => item.name === clips[kind][index]);
        if (!clip) throw new Error(`缺少原版动作 ${clips[kind][index]}`);
        const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
        return [kind, action];
      })) as Record<Mode, THREE.AnimationAction>;
      const facial = new FacialAnimation(facialData, root, index === 0 ? "attacker" : "defender");
      const secondary = new SecondaryMotion(root, physicsData);
      return { root, mixer, actions, facial, secondary };
    });
    applyVisibility();
    el("load-progress").textContent = "准备逐帧动作与命中特效…";
    effects = new PresentationEffects(renderer, scene, camera);
    effects.setTracks(buildEffectTracks());
    for (const kind of ["SA3", "CA"] as const) {
      selectMode(kind);
      for (const [index, actor] of actors.entries()) {
        el("load-progress").textContent = `准备 ${kind} ${index + 1}P 头发与布料动态…`;
        await actor.secondary.build(kind, totalFrames[kind], at => sampleBody(actor, kind, at));
      }
    }
    el("load-progress").textContent = "预载原版音效与日语语音…";
    await audio.warmup();
    ready = true;
    for (const id of ["play", "restart", "step-back", "step-next", "timeline"]) (el(id) as HTMLButtonElement | HTMLInputElement).disabled = false;
    el("loading").hidden = true; el("loading").style.display = "none";
    selectMode("SA3"); resize();
    const params = new URLSearchParams(location.search);
    for (let index = 0; index < 2; index++) {
      const value = params.get(`p${index + 1}Drink`);
      if (value !== null && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 4) drinkLevels[index] = Number(value);
    }
    applyVisibility();
    if (params.get("move")?.toUpperCase() === "CA") selectMode("CA");
    if (params.has("frame")) seek(Number(params.get("frame")));
    if (params.get("autoplay") === "1") void requestPlayback();
    Object.assign(window, { cinematicReview: {
      ready: true, seek, selectMode, play: requestPlayback, pause: () => setPlaying(false),
      unlockAudio: () => audio.unlock(), getAudioStream: () => audio.getRecordingStream(),
      setDrinkLevels: (p1: number, p2: number) => { if (![p1, p2].every(value => Number.isInteger(value) && value >= 0 && value <= 4)) throw new RangeError("Drink levels must be 0..4"); drinkLevels[0] = p1; drinkLevels[1] = p2; applyVisibility(); render(); },
      diagnose: () => ({ camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov }, actors: actors.map(actor => ["Root", "C_Hip", "C_Head"].map(name => { const bone = actor.root.getObjectByName(name); const position = bone?.getWorldPosition(new THREE.Vector3()); return { name, position: position?.toArray(), screen: position?.clone().project(camera).toArray() }; })) }),
      getState: () => ({ mode, frame, playing, drinkLevels: [...drinkLevels], camera: cameraMode.value, audio: audio.getState(), facialBones: actors.map(actor => actor.facial.boneCount), physics: actors.map(actor => actor.secondary.getStats()), clips: gltf.animations.map(clip => clip.name), cameraPosition: camera.position.toArray(), visibleMeshes: actors.map(actor => { let count = 0; actor.root.traverse(o => { if (o instanceof THREE.Mesh && o.visible) count++; }); return count; }), renderer: renderer.info.render }),
    } });
  } catch (error) {
    console.error(error);
    el("loading").classList.add("error");
    el("loading").querySelector("strong")!.textContent = "样片资源未能载入";
    el("load-progress").textContent = error instanceof Error ? error.message : String(error);
  }
}

playButton.addEventListener("click", () => { if (playing) setPlaying(false); else void requestPlayback(); });
el("restart").addEventListener("click", () => { setPlaying(false); seek(0); void requestPlayback(); });
el("sa3").addEventListener("click", () => selectMode("SA3"));
el("ca").addEventListener("click", () => selectMode("CA"));
timeline.addEventListener("input", () => { setPlaying(false); seek(Number(timeline.value)); });
el("step-back").addEventListener("click", () => { setPlaying(false); seek(Math.round(frame) - 1); });
el("step-next").addEventListener("click", () => { setPlaying(false); seek(Math.round(frame) + 1); });
for (let index = 0; index < 2; index++) el<HTMLSelectElement>(`p${index + 1}-drink`).addEventListener("change", event => { drinkLevels[index] = Number((event.target as HTMLSelectElement).value); applyVisibility(); render(); });
for (const id of ["facial", "physics"]) el(id).addEventListener("change", render);
el<HTMLInputElement>("effects").addEventListener("change", event => { effects?.setEnabled((event.target as HTMLInputElement).checked); render(); });
el<HTMLInputElement>("sound").addEventListener("change", event => {
  const enabled = (event.target as HTMLInputElement).checked;
  audio.setEnabled(enabled);
  el("audio-status").textContent = enabled ? "原版音效 · 日语原声" : "已静音";
  if (enabled && playing) void requestPlayback();
});
el("speed").addEventListener("change", () => { lastTimestamp = 0; if (playing) audio.start(mode, frame, speed()); });
cameraMode.addEventListener("change", () => {
  controls.enabled = cameraMode.value === "free";
  el("camera-label").textContent = controls.enabled ? "自由观察" : "原版镜头";
  el("view-hint").textContent = controls.enabled ? "拖动旋转 · 滚轮缩放 · 右键平移" : "空格 播放／暂停 · ← → 逐帧";
  controls.update(); render();
});
controls.addEventListener("change", render);
window.addEventListener("keydown", event => {
  if ((event.target as HTMLElement).closest("input,select,button,a")) return;
  if (event.code === "Space") { event.preventDefault(); if (playing) setPlaying(false); else void requestPlayback(); }
  if (["ArrowLeft", "ArrowRight"].includes(event.code)) { event.preventDefault(); setPlaying(false); seek(Math.round(frame) + (event.code === "ArrowRight" ? 1 : -1)); }
});
document.addEventListener("visibilitychange", () => { lastTimestamp = 0; if (document.hidden) setPlaying(false); });
const observer = new ResizeObserver(resize); observer.observe(viewport);
window.addEventListener("pagehide", () => { disposed = true; setPlaying(false); observer.disconnect(); controls.dispose(); effects?.dispose(); audio.dispose(); renderer?.dispose(); }, { once: true });
function animate(timestamp: number) {
  if (disposed) return;
  requestAnimationFrame(animate);
  if (!ready || !playing || document.hidden) { lastTimestamp = 0; return; }
  if (!lastTimestamp) { lastTimestamp = timestamp; return; }
  const elapsed = (timestamp - lastTimestamp) / 1000; lastTimestamp = timestamp;
  frame += elapsed * 60 * Number(el<HTMLSelectElement>("speed").value);
  if (frame >= totalFrames[mode]) {
    if (el<HTMLInputElement>("loop").checked) frame %= totalFrames[mode];
    else { frame = totalFrames[mode]; setPlaying(false); }
  }
  render();
}
void load(); requestAnimationFrame(animate);
