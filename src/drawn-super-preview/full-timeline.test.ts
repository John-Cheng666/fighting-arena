import { describe,expect,it } from "vitest";
import { fullFrame,validateFullMetadata,type FullMetadata,type FullMode } from "./full-timeline";
const metadata:FullMetadata={schemaVersion:2,framesPerSecond:60,ticksPerDrawnCel:5,clips:{
 SA3:{frameCount:617,celCount:121,width:1920,height:1080,framesPerSecond:60,variants:{smooth:"sa3-smooth.mp4",drawn:"sa3-drawn.mp4"},poster:"sa3-poster.jpg",phases:[{name:"intro",from:0,length:84},{name:"sa3-body",from:84,length:438},{name:"sa3-end",from:522,length:80}]},
 CA:{frameCount:712,celCount:140,width:1920,height:1080,framesPerSecond:60,variants:{smooth:"ca-smooth.mp4",drawn:"ca-drawn.mp4"},poster:"ca-poster.jpg",phases:[{name:"intro",from:0,length:84},{name:"ca-body",from:84,length:499},{name:"ca-end",from:583,length:114}]},
}};
describe("full 2D review clock",()=>{
 it.each(["SA3","CA"] as FullMode[])("retains %s phase boundaries when lengths are not divisible by the cel interval",mode=>{
  validateFullMetadata(metadata);const clip=metadata.clips[mode];
  expect(fullFrame(mode,83,metadata)).toMatchObject({phase:"intro",cel:16});
  expect(fullFrame(mode,84,metadata)).toMatchObject({cel:17});
  const recovery=clip.phases[2];
  expect(fullFrame(mode,recovery.from-1,metadata).phase).toBe(clip.phases[1].name);
  expect(fullFrame(mode,recovery.from,metadata).phase).toBe(recovery.name);
  expect(fullFrame(mode,clip.frameCount-15,metadata)).toMatchObject({tail:true,cel:clip.celCount-1});
  expect(fullFrame(mode,Infinity,metadata).frame).toBe(0);
  expect(fullFrame(mode,clip.frameCount+1,metadata).frame).toBe(clip.frameCount);
 });
 it("does not conflate the normal SA3 finisher with CA's throat sequence",()=>{
  expect(fullFrame("SA3",460,metadata).label).toBe("双脚终结");
  expect(fullFrame("CA",388,metadata).label).toBe("抓喉近景");
  expect(fullFrame("CA",538,metadata).label).toBe("终结一击");
 });
 it("rejects a missing phase or a movie with a different frame count",()=>{
  const bad=structuredClone(metadata);bad.clips.CA.phases[2].from++;
  expect(()=>validateFullMetadata(bad)).toThrow("分镜时序不连续");
  const short=structuredClone(metadata);short.clips.SA3.frameCount--;
  expect(()=>validateFullMetadata(short)).toThrow("收尾长度不匹配");
 });
});
