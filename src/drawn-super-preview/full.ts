import { FULL_ASSET_ROOT, FULL_FPS, fullFrame, validateFullMetadata, type FullMetadata, type FullMode, type ReviewVariant } from "./full-timeline";
import "./style.css";
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const video=el<HTMLVideoElement>("scene"),timeline=el<HTMLInputElement>("timeline"),playButton=el<HTMLButtonElement>("play");
const sound=el<HTMLInputElement>("sound"),renderChoice=el<HTMLSelectElement>("render-mode");
const asset=(name:string)=>`${import.meta.env.BASE_URL}${FULL_ASSET_ROOT}${name}`;
const params=new URLSearchParams(location.search);
let metadata:FullMetadata,mode:FullMode=params.get("move")?.toUpperCase()==="CA"?"CA":"SA3";
let variant:ReviewVariant=params.get("render")==="drawn"?"drawn":"smooth";
let ready=false,pending=false,disposed=false,playRevision=0,sourceRevision=0,animationId=0,lastLabel="";
if(params.get("embed")==="1")document.body.classList.add("embed");
if(params.get("silent")==="1")sound.checked=false;
video.muted=!sound.checked;video.preservesPitch=true;video.volume=1;
const status=(message:string)=>{el("status").textContent=message;};
const frame=()=>metadata?Math.max(0,Math.min(metadata.clips[mode].frameCount,video.currentTime*FULL_FPS)):0;
const playing=()=>!video.paused&&!video.ended;
function controls(enabled:boolean){for(const id of ["play","restart","step-back","step-next","timeline","chapter-intro","chapter-action","chapter-recovery"])el<HTMLButtonElement>(id).disabled=!enabled;}
function pause(){playRevision++;pending=false;video.pause();playButton.textContent="播放演出";}
function render(){
 if(!ready||!metadata)return;
 const clip=metadata.clips[mode],sample=fullFrame(mode,frame(),metadata);
 timeline.value=String(Math.round(sample.frame));timeline.setAttribute("aria-valuetext",`${(sample.frame/FULL_FPS).toFixed(2)}秒，${sample.label}`);
 el<HTMLOutputElement>("time").value=`${(sample.frame/FULL_FPS).toFixed(2)} / ${(clip.frameCount/FULL_FPS).toFixed(2)} s`;
 el("phase-label").textContent=sample.label;
 el("cel-count").textContent=`${String(sample.cel+1).padStart(3,"0")} / ${clip.celCount} CEL`;
 if(lastLabel!==sample.label){video.setAttribute("aria-label",`杰米 ${mode} 二维演出：${sample.label}`);lastLabel=sample.label;}
 playButton.textContent=pending?"正在准备…":playing()?"暂停":"播放演出";
}
function seek(value:number){
 if(!ready)return;pause();video.currentTime=fullFrame(mode,value,metadata).frame/FULL_FPS;
 status("已暂停 · 可逐帧审阅");render();
}
async function play(){
 if(!ready||disposed)return;
 if(playing()||pending){pause();status("已暂停 · 可逐帧审阅");return;}
 if(video.ended||frame()>=metadata.clips[mode].frameCount-.5)video.currentTime=0;
 const request=++playRevision;pending=true;playButton.textContent="正在准备…";
 try{
  video.muted=!sound.checked;
  await video.play();
  if(request!==playRevision||disposed)return;
  pending=false;status(sound.checked?"播放中 · 原版音效与日语原声":"播放中 · 已静音");render();
 }catch(error){if(request!==playRevision||disposed)return;pause();status(error instanceof Error?`暂时无法播放：${error.message}`:"暂时无法播放影片");}
}
async function load(nextMode:FullMode,nextVariant:ReviewVariant,at=0,resume=false){
 pause();ready=false;controls(false);mode=nextMode;variant=nextVariant;
 const revision=++sourceRevision,clip=metadata.clips[mode];lastLabel="";
 el("sa3").setAttribute("aria-pressed",String(mode==="SA3"));el("ca").setAttribute("aria-pressed",String(mode==="CA"));
 renderChoice.value=variant;el("move-label").textContent=mode;timeline.max=String(clip.frameCount);
 el("clip-meta").textContent=variant==="smooth"?"1080p · 60 FPS 补帧":"1080p · 重绘原帧";
 el("shot-title").textContent=mode==="SA3"?"启动 → 连击 → 双脚终结":"启动 → 抓喉 → 终结连打";
 el("shot-description").textContent=mode==="SA3"?"保留启动、扫堂、邀战、拆招与双脚终结，接回宽景恢复动作。":"独立制作 CA 的抓喉近景、释放和终结连打，并补齐倒地与恢复。";
 el("frame-description").textContent=`SA3 ${metadata.clips.SA3.celCount} 张、CA ${metadata.clips.CA.celCount} 张重绘关键帧。输出 1080p，提供补帧版与重绘原帧对照。`;
 video.poster=asset(clip.poster);el("loading").hidden=false;el("retry").hidden=true;
 el("load-message").textContent=`载入 ${mode} 完整影片…`;
 try{
  await new Promise<void>((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timeout);video.removeEventListener("loadedmetadata",success);video.removeEventListener("error",failure);};
   const success=()=>{cleanup();resolve();};
   const failure=()=>{cleanup();reject(new Error(video.error?.message||"影片载入失败"));};
   const timeout=setTimeout(()=>{cleanup();reject(new Error("影片载入超时，请重试"));},20000);
   video.addEventListener("loadedmetadata",success);video.addEventListener("error",failure);
   video.src=asset(clip.variants[variant]);video.load();
  });
  if(revision!==sourceRevision||disposed)return;
  if(!Number.isFinite(video.duration)||Math.abs(video.duration-clip.frameCount/FULL_FPS)>.1)throw new Error("影片时长与审阅时间轴不一致");
  ready=true;controls(true);el("loading").hidden=true;
  video.playbackRate=Number(el<HTMLSelectElement>("speed").value);video.muted=!sound.checked;
  video.currentTime=fullFrame(mode,at,metadata).frame/FULL_FPS;render();
  status(`${mode} 完整演出已就绪 · ${variant==="smooth"?"60 FPS 补帧版":"重绘原帧"}`);
  el<HTMLAnchorElement>("download").href=asset("review-full.mp4");
  if(resume)void play();
 }catch(error){
  if(revision!==sourceRevision||disposed)return;ready=false;pause();
  el("loading").classList.add("error");el("loading").querySelector("strong")!.textContent="影片未能载入";
  el("load-message").textContent=error instanceof Error?error.message:String(error);el("retry").hidden=false;
  status("请重新载入影片");
 }
}
el("sa3").addEventListener("click",()=>{if(metadata)void load("SA3",variant);});
el("ca").addEventListener("click",()=>{if(metadata)void load("CA",variant);});
playButton.addEventListener("click",()=>void play());
el("restart").addEventListener("click",()=>{seek(0);void play();});
el("step-back").addEventListener("click",()=>seek(Math.round(frame())-1));
el("step-next").addEventListener("click",()=>seek(Math.round(frame())+1));
timeline.addEventListener("input",()=>seek(Number(timeline.value)));
el("speed").addEventListener("change",()=>{video.playbackRate=Number(el<HTMLSelectElement>("speed").value);});
sound.addEventListener("change",()=>{video.muted=!sound.checked;status(sound.checked?"原声已开启":"已静音");});
el("loop").addEventListener("change",()=>{video.loop=el<HTMLInputElement>("loop").checked;});
renderChoice.addEventListener("change",()=>{const at=frame(),resume=playing();void load(mode,renderChoice.value as ReviewVariant,at,resume);});
for(const [id,index] of [["chapter-intro",0],["chapter-action",1],["chapter-recovery",2]] as const)el(id).addEventListener("click",()=>seek(metadata.clips[mode].phases[index].from));
el("fullscreen").addEventListener("click",()=>{const action=document.fullscreenElement?document.exitFullscreen():el("viewport").requestFullscreen?.();void action?.catch(()=>status("当前浏览器不支持全屏观看"));});
el("retry").addEventListener("click",()=>{el("loading").classList.remove("error");if(metadata)void load(mode,variant);else void initialize();});
video.addEventListener("ended",()=>{playButton.textContent="播放演出";status("本段播放完成 · 可切换另一段");render();});
video.addEventListener("seeked",render);
document.addEventListener("visibilitychange",()=>{if(document.hidden&&(playing()||pending)){pause();status("已暂停 · 返回后可继续");}});
window.addEventListener("keydown",event=>{
 if(event.target instanceof Element&&event.target.closest("input,select,button,a,textarea,[contenteditable]"))return;
 if(event.code==="Space"){event.preventDefault();void play();}
 else if(event.code==="ArrowLeft"||event.code==="ArrowRight"){event.preventDefault();seek(Math.round(frame())+(event.code==="ArrowRight"?1:-1));}
 else if(event.code==="KeyM"){sound.checked=!sound.checked;sound.dispatchEvent(new Event("change"));}
});
function tick(){if(disposed)return;render();animationId=requestAnimationFrame(tick);}
async function initialize(){
 try{
  const response=await fetch(asset("clips.json"));if(!response.ok)throw new Error("完整演出时间轴载入失败");
  metadata=await response.json() as FullMetadata;validateFullMetadata(metadata);
  if(disposed)return;
  Object.assign(window,{drawnSuperReview:{get ready(){return ready;},seek,selectMode:(next:FullMode)=>load(next,variant),play,pause,
   selectVariant:(next:ReviewVariant)=>load(mode,next,frame(),playing()),
   getState:()=>({mode,variant,ready,frame:frame(),playing:playing(),pending,cel:ready?fullFrame(mode,frame(),metadata).cel:0,
    duration:metadata.clips[mode].frameCount,artworkCels:metadata.clips[mode].celCount,muted:video.muted,speed:video.playbackRate})}});
  await load(mode,variant,Number(params.get("frame")??0));animationId=requestAnimationFrame(tick);
  if(params.get("autoplay")==="1"&&!sound.checked)void play();
 }catch(error){el("load-message").textContent=error instanceof Error?error.message:String(error);el("retry").hidden=false;status("完整演出未能载入");}
}
window.addEventListener("pagehide",()=>{disposed=true;pause();sourceRevision++;cancelAnimationFrame(animationId);video.removeAttribute("src");video.load();},{once:true});
void initialize();
