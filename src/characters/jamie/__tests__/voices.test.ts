import { describe, expect, it } from 'vitest';
import { Battle } from '../../../game/Battle';
import { DEFAULT_MATCH_CONFIG } from '../../../test/fixtures';
import { getJamieState } from '../state';
import { resolveJamieThrowTech } from '../combat/execution';
import { advanceJamieAudio, stopJamieAudio } from '../audio';
import { JAMIE_VARIANTS } from '../moves';
import { createDemonstration } from '../../../game/training';
import type { BattleEvent } from '../../../engine/types';

function practice(){const b=new Battle(DEFAULT_MATCH_CONFIG);b.aiEnabled=false;b.start();b.takeEvents();return b;}
const voices=(events:BattleEvent[])=>events.filter((e):e is Extract<BattleEvent,{type:'voice'}>=>e.type==='voice');
describe('Jamie authored personal voice requests',()=>{
  it('emits the real light-attack key once, instead of the rejected fixed sample',()=>{
    const b=practice();expect(b.requestMove('p1','N01','row-0')).toBe(true);const events=b.takeEvents();
    for(let i=0;i<4;i++){b.step();events.push(...b.takeEvents());}
    expect(voices(events).filter(e=>e.fighterId==='p1'&&e.voiceId===500)).toHaveLength(1);
    expect(events.filter(e=>e.type==='audio'&&e.channel==='voice')).toEqual([]);
  });
  it('emits SA1 startup during its frozen intro, once, without advancing combat time',()=>{
    const b=practice(),f=b.state.fighters[0],j=getJamieState(f)!;j.super=30000;
    expect(b.requestMove('p1','A01','row-87')).toBe(true);const events=b.takeEvents();
    for(let i=0;i<8;i++){b.step();events.push(...b.takeEvents());}
    expect(b.state.tick).toBe(0);expect(voices(events).filter(e=>e.voiceId===21300)).toHaveLength(1);
  });
  it('retains SET_ACTION cancellation for the approved binding only',()=>{
    const variant=JAMIE_VARIANTS.find(v=>v.nativeActionId===684)!;
    const b=createDemonstration('jamie',variant.id,DEFAULT_MATCH_CONFIG,'whiff'),events:BattleEvent[]=[];
    for(let i=0;i<600&&!voices(events).some(e=>e.voiceId===21146);i++){b.step();events.push(...b.takeEvents());}
    const cue=voices(events).find(e=>e.voiceId===21146)!;
    expect(cue).toMatchObject({stopWithAction:true});advanceJamieAudio(b.state,b.state.fighters[0],events);
    stopJamieAudio(b.state,b.state.fighters[0],events);
    expect(events.some(e=>e.type==='voice-stop'&&e.fighterId===cue.fighterId&&e.actionOnly&&e.scope===cue.scope)).toBe(true);
  });
  it('requests the two-reviewed-version throw-tech pool for the defender only',()=>{
    const b=practice(),[source,target]=b.state.fighters,events:BattleEvent[]=[];
    resolveJamieThrowTech(b.state,source,target,events);
    expect(voices(events)).toEqual([{type:'voice',tick:0,fighterId:'p2',characterId:'jamie',voiceId:710}]);
  });
});
