import { describe, expect, it } from "vitest";
import shipped from "../../content/audio/catalog.json";
import type { AudioCatalog, VoiceRequest } from "../../content/audio/types";
import { VoiceDirector, type VoiceEvent } from "./VoiceDirector";

const request = (clips: string[], extra: Partial<VoiceRequest> = {}): VoiceRequest => ({ clips, priority: 50, prioritizeFirst: false, skipRate: 0, limit: 1, releaseMs: 50, avoidRepeat: 1, ...extra });
function fixture(): AudioCatalog {
  const clips = Object.fromEntries(['a','b','c'].map(id => [id,{url:id+'.ogg',seconds:1,frames:48000,sampleRate:48000,channels:1}]));
  const character = { language:'ja', requests:{1:request(['a','b']),2:request(['c'],{priority:100}),3:request(['a'],{skipRate:1}),4:request(['a'],{prioritizeFirst:true})}, scenes:{entrance:['c']},victory:[],ko:{normal:692,finish:693,launched:690,finishLaunched:691,down:694,finishDown:695} };
  return { schemaVersion:1, clips, bgm:{},feedback:{},voices:{first:character,second:character} };
}
const event = (voiceId:number, extra:Partial<VoiceEvent>={}): VoiceEvent => ({type:'voice',tick:0,fighterId:'p1',characterId:'first',voiceId,...extra});

describe('character-independent voice selection',()=>{
  it('shares avoid-repeat history across request aliases of one native random container',()=>{
    const data=fixture();data.voices!.first.requests[1].randomGroup=77;
    data.voices!.first.requests[5]=request(['a','b'],{randomGroup:77});
    const d=new VoiceDirector(data),sequence=Array.from({length:40},(_,i)=>d.choose(event(i%2?5:1),i*2)!.clipId);
    expect(sequence.every((id,i)=>i===0||id!==sequence[i-1])).toBe(true);
  });
  it('avoids immediate repeats and replays the same sequence after reseeding',()=>{
    const director=new VoiceDirector(fixture());
    const run=()=>Array.from({length:20},(_,i)=>director.choose(event(1),i*2)!.clipId);
    director.reset(431);const first=run();director.reset(431);expect(run()).toEqual(first);
    expect(first.every((id,i)=>i===0||id!==first[i-1])).toBe(true);
  });
  it('keeps high-priority speech against grunts, while separating both actors',()=>{
    const d=new VoiceDirector(fixture()),high=d.choose(event(2),0)!;
    expect(d.choose(event(1),.1)).toBeUndefined();expect(d.current(high.token)).toBe(true);
    expect(d.choose(event(1,{fighterId:'p2'}),.1)).toBeDefined();
    expect(d.choose(event(1),2)).toBeDefined();
  });
  it('preempts lower priority and honors prioritize-first on equal priority',()=>{
    const d=new VoiceDirector(fixture()),low=d.choose(event(1),0)!;
    expect(d.choose(event(4),.1)).toBeUndefined();
    expect(d.choose(event(2),.2)?.replaced).toBe(low.token);
    expect(d.current(low.token)).toBe(false);
  });
  it('applies skip only to that request and never substitutes a missing request',()=>{
    const d=new VoiceDirector(fixture());expect(d.choose(event(3),0)).toBeUndefined();
    expect(d.choose(event(999),0)).toBeUndefined();expect(d.choose(event(1),0)).toBeDefined();
  });
  it('cancels SET_ACTION by owner/scope without truncating DEFAULT tails',()=>{
    const d=new VoiceDirector(fixture()),a=d.choose(event(1,{scope:'one',stopWithAction:true}),0)!;
    const b=d.choose(event(1,{fighterId:'p2',scope:'one'}),0)!;
    expect(d.cancel({type:'voice-stop',tick:0,fighterId:'p1',scope:'other',actionOnly:true})).toEqual([]);
    expect(d.cancel({type:'voice-stop',tick:0,scope:'one',actionOnly:true})).toEqual([a.token]);expect(d.current(b.token)).toBe(true);
  });
  it.each([[1,'victory-perfect'],[.99999,'victory-dominant'],[.8,'victory-dominant'],[.79999,'victory-close'],[.25,'victory-close'],[.24999,'victory-narrow']])('uses the reviewed winner HP boundary %s',(ratio,scene)=>{
    expect(new VoiceDirector(shipped as AudioCatalog).victoryScene('jamie',Number(ratio)*10000,10000)).toBe(scene);
  });
  it('ships all170 reviewed clips and no request whose entire pool was rejected',()=>{
    const catalog=shipped as AudioCatalog,voice=catalog.voices!.jamie;
    const refs=new Set([...Object.values(voice.requests).flatMap(r=>r.clips),...Object.values(voice.scenes).flat()]);
    expect(refs.size).toBe(170);expect(catalog.clips['voice-light']).toBeUndefined();
    for(const id of [720,721,920,921,922,21930,21931,21933,21934,21935,21936,21937,21938,21939,21950,21951,21952]) expect(voice.requests[id]).toBeUndefined();
    expect(voice.requests[500].clips).toHaveLength(3);expect(voice.requests[710].clips).toHaveLength(2);
  });
});
