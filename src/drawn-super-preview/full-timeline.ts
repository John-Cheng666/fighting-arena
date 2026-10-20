export type FullMode = "SA3" | "CA";
export type ReviewVariant = "smooth" | "drawn";
export interface FullPhase { name: string; from: number; length: number }
export interface FullClip {
  frameCount: number; celCount: number; width: number; height: number; framesPerSecond: number;
  variants: Record<ReviewVariant,string>; poster: string; phases: FullPhase[];
}
export interface FullMetadata { schemaVersion: number; framesPerSecond: number; ticksPerDrawnCel: number; clips: Record<FullMode,FullClip> }
export const FULL_FPS = 60;
export const FULL_ASSET_ROOT = "assets/jamie/drawn-supers-v2/";
const labels = {
  SA3: [[0,"超必杀启动"],[84,"初击 · 扫堂"],[150,"邀战近景"],[282,"拆招 · 连击"],[383,"连续打击"],[460,"双脚终结"],[522,"释放 · 恢复"]] as const,
  CA: [[0,"超必杀启动"],[84,"初击 · 扫堂"],[170,"邀战 · 拆招"],[316,"连续打击"],[388,"抓喉近景"],[465,"拉近 · 释放"],[538,"终结一击"],[583,"倒地 · 恢复"]] as const,
};
export function fullFrame(mode: FullMode, value: number, metadata: FullMetadata) {
  const clip=metadata.clips[mode],frame=Math.max(0,Math.min(clip.frameCount,Number.isFinite(value)?value:0));
  const phase=[...clip.phases].reverse().find(phase=>frame>=phase.from)??clip.phases[0];
  const preceding=clip.phases.filter(item=>item.from<phase.from).reduce((sum,item)=>sum+Math.ceil(item.length/metadata.ticksPerDrawnCel),0);
  const cel=Math.min(clip.celCount-1,preceding+Math.min(Math.ceil(phase.length/metadata.ticksPerDrawnCel)-1,Math.floor((frame-phase.from)/metadata.ticksPerDrawnCel)));
  const label=[...labels[mode]].reverse().find(([from])=>frame>=from)![1];
  const tail=frame>=phase.from+phase.length;
  return {frame,cel,phase:phase.name,label:tail?"停格 · 收声":label,tail};
}
export function validateFullMetadata(value: FullMetadata): void {
  if(value.schemaVersion!==2||value.framesPerSecond!==60||value.ticksPerDrawnCel!==5)throw new Error("演出时间轴版本不匹配");
  for(const mode of ["SA3","CA"] as const) {
    const clip=value.clips?.[mode];
    if(!clip||clip.width!==1920||clip.height!==1080||clip.framesPerSecond!==60)throw new Error(`${mode} 影片规格不匹配`);
    if(!clip.phases?.length||clip.phases[0].from!==0)throw new Error(`${mode} 缺少启动段`);
    let end=0,cels=0;
    for(const phase of clip.phases){if(phase.from!==end||!(phase.length>0))throw new Error(`${mode} 分镜时序不连续`);end+=phase.length;cels+=Math.ceil(phase.length/5);}
    if(clip.frameCount!==end+15||cels!==clip.celCount)throw new Error(`${mode} 收尾长度不匹配`);
    if(!clip.variants.smooth||!clip.variants.drawn)throw new Error(`${mode} 缺少审阅版本`);
  }
}
