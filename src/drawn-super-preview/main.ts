import { CinematicAudio } from "../cinematic-preview/CinematicAudio";
import { AtlasRenderer } from "./AtlasRenderer";
import { ART_FRAMES, ASSET_ROOT, CEL_COUNT, CLIPS, FPS, clampFrame, sampleClip, type DrawnSuper } from "./timeline";
import "./style.css";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>("scene"), timeline = el<HTMLInputElement>("timeline");
const playButton = el<HTMLButtonElement>("play"), sound = el<HTMLInputElement>("sound");
const images = {} as Record<DrawnSuper, HTMLImageElement>;
const audio = new CinematicAudio();
let renderer: AtlasRenderer | undefined;
let mode: DrawnSuper = "SA3", frame = 0, playing = false, ready = false, pending = false;
let disposed = false, playbackRequest = 0, previousTime = 0, animationId = 0, lastCel = -1;
const speed = () => Number(el<HTMLSelectElement>("speed").value);
const status = (text: string) => { el("status").textContent = text; };

function render() {
  if (!ready || !renderer) return;
  const clip = CLIPS[mode], sample = sampleClip(mode, frame);
  renderer.draw(images[mode], mode, frame);
  timeline.value = String(Math.floor(sample.frame));
  el<HTMLOutputElement>("time").value = `${(sample.frame / FPS).toFixed(2)} / ${(clip.duration / FPS).toFixed(2)} s`;
  el("phase-label").textContent = sample.tail ? "停格 · 收声" : sample.phase;
  el("cel-count").textContent = `${String(sample.cel + 1).padStart(2, "0")} / ${CEL_COUNT} CEL`;
  if (lastCel !== sample.cel) {
    canvas.setAttribute("aria-label", `杰米 ${mode} 二维重绘：${sample.phase}，第 ${sample.cel + 1} 张关键帧`);
    lastCel = sample.cel;
  }
}

function pause() {
  playbackRequest++; playing = false; pending = false; previousTime = 0;
  audio.pause(); playButton.textContent = "播放样片";
}
function seek(value: number) {
  pause(); frame = clampFrame(mode, value); render();
  status(frame >= CLIPS[mode].duration ? "本段播放完成" : "已暂停 · 可逐帧检查");
}
function selectMode(next: DrawnSuper) {
  pause(); mode = next; frame = 0; lastCel = -1;
  const clip = CLIPS[mode];
  el("sa3").setAttribute("aria-pressed", String(mode === "SA3"));
  el("ca").setAttribute("aria-pressed", String(mode === "CA"));
  el("move-label").textContent = mode;
  el("shot-title").textContent = clip.title;
  el("shot-description").textContent = clip.description;
  timeline.max = String(clip.duration);
  status(ready ? `${mode} 已就绪 · 点击播放` : "准备样片中");
  render();
}
async function play() {
  if (!ready || disposed) return;
  if (playing || pending) { pause(); status("已暂停 · 可逐帧检查"); return; }
  if (frame >= CLIPS[mode].duration) frame = 0;
  const request = ++playbackRequest;
  pending = true; playButton.textContent = "准备原声…";
  try {
    if (sound.checked) await audio.unlock();
    if (request !== playbackRequest || disposed) return;
    audio.setEnabled(sound.checked);
    if (!audio.start(mode, CLIPS[mode].nativeStart + frame, speed())) throw new Error("原声尚未准备就绪");
    pending = false; playing = true; previousTime = 0;
    playButton.textContent = "暂停";
    status(sound.checked ? "播放中 · 原版音效与日语原声节选" : "播放中 · 已静音");
  } catch (error) {
    if (request !== playbackRequest || disposed) return;
    pause(); status(`${error instanceof Error ? error.message : "原声载入失败"}；可关闭原声后播放`);
  }
}

function tick(now: number) {
  if (disposed) return;
  if (playing) {
    if (previousTime) frame += (now - previousTime) / 1000 * FPS * speed();
    previousTime = now;
    if (frame >= CLIPS[mode].duration) {
      const remainder = frame - CLIPS[mode].duration;
      if (el<HTMLInputElement>("loop").checked) {
        frame = remainder % CLIPS[mode].duration;
        audio.start(mode, CLIPS[mode].nativeStart + frame, speed());
      } else {
        frame = CLIPS[mode].duration; pause(); status("本段播放完成 · 可切换另一段");
      }
    }
    if (playing) audio.sync(mode, CLIPS[mode].nativeStart + frame, speed());
    render();
  }
  animationId = requestAnimationFrame(tick);
}

async function initialize() {
  try {
    renderer = new AtlasRenderer(canvas);
    await Promise.all((["SA3", "CA"] as const).map(async kind => {
      const image = new Image(); image.src = `${import.meta.env.BASE_URL}${ASSET_ROOT.slice(1)}${CLIPS[kind].image}`;
      await image.decode();
      if (image.naturalWidth < 1000 || image.naturalHeight < 1000) throw new Error(`${kind} 关键帧文件不完整`);
      images[kind] = image;
    }));
    if (disposed) return;
    ready = true;
    const params = new URLSearchParams(location.search);
    if (params.get("embed") === "1") document.body.classList.add("embed");
    selectMode(params.get("move")?.toUpperCase() === "CA" ? "CA" : "SA3");
    if (params.has("frame")) frame = clampFrame(mode, Number(params.get("frame")));
    if (params.get("silent") === "1") sound.checked = false;
    audio.setEnabled(sound.checked);
    el("loading").hidden = true;
    for (const id of ["play", "restart", "step-back", "step-next", "timeline"]) el<HTMLButtonElement>(id).disabled = false;
    render(); animationId = requestAnimationFrame(tick);
    Object.assign(window, { drawnSuperReview: {
      ready: true, seek, selectMode, play, pause,
      getState: () => ({ mode, frame, playing, pending, cel: sampleClip(mode, frame).cel,
        duration: CLIPS[mode].duration, artworkFrames: ART_FRAMES, audio: audio.getState() }),
      getAudioStream: () => audio.getRecordingStream(),
    } });
    if (params.get("autoplay") === "1" && !sound.checked) void play();
  } catch (error) {
    console.error(error); el("loading").classList.add("error");
    el("loading").querySelector("strong")!.textContent = "样片未能载入";
    el("load-message").textContent = error instanceof Error ? error.message : String(error);
    el("retry").hidden = false; status("请重新载入样片");
  }
}

playButton.addEventListener("click", () => void play());
el("restart").addEventListener("click", () => { seek(0); void play(); });
el("sa3").addEventListener("click", () => selectMode("SA3"));
el("ca").addEventListener("click", () => selectMode("CA"));
el("step-back").addEventListener("click", () => seek(Math.floor(frame) - 1));
el("step-next").addEventListener("click", () => seek(Math.floor(frame) + 1));
timeline.addEventListener("input", () => seek(Number(timeline.value)));
el("speed").addEventListener("change", () => {
  const resume = playing; pause();
  if (resume) void play(); else status("速度已调整 · 点击播放");
});
sound.addEventListener("change", () => {
  const resume = playing; pause(); audio.setEnabled(sound.checked);
  if (resume) void play(); else status(sound.checked ? "原声已开启 · 点击播放" : "已静音");
});
el("fullscreen").addEventListener("click", () => {
  const action = document.fullscreenElement ? document.exitFullscreen() : el("viewport").requestFullscreen?.();
  void action?.catch(() => status("当前浏览器不支持全屏观看"));
});
el("retry").addEventListener("click", () => location.reload());
window.addEventListener("keydown", event => {
  if (event.target instanceof Element && event.target.closest("input, select, button, a, textarea, [contenteditable]")) return;
  if (event.code === "Space") { event.preventDefault(); void play(); }
  else if (event.code === "ArrowLeft" || event.code === "ArrowRight") { event.preventDefault(); seek(Math.floor(frame) + (event.code === "ArrowRight" ? 1 : -1)); }
  else if (event.code === "KeyM") { sound.checked = !sound.checked; sound.dispatchEvent(new Event("change")); }
});
document.addEventListener("visibilitychange", () => { if (document.hidden && (playing || pending)) { pause(); status("已暂停 · 返回后可继续播放"); } });
window.addEventListener("pagehide", () => { disposed = true; pause(); cancelAnimationFrame(animationId); audio.dispose(); }, { once: true });
void initialize();
