import { afterEach, describe, expect, it, vi } from 'vitest';
import { BattleRuntime } from './BattleRuntime';
import { BattleAudio } from '../view/audio/BattleAudio';
import { DEFAULT_MATCH_CONFIG } from '../test/fixtures';
import { STEP, type BattleEvent } from '../engine/types';
const all:BattleRuntime[]=[];
function create(){const r=new BattleRuntime(DEFAULT_MATCH_CONFIG);all.push(r);r.setLoaded(true);r.battle.aiEnabled=false;return r;}
afterEach(()=>{all.splice(0).forEach(r=>r.dispose());vi.restoreAllMocks();});
describe('reviewed personal voice scenes',()=>{
  it('retains battle events while AudioContext resume is pending, without accumulating wall time',async()=>{
    vi.spyOn(BattleAudio.prototype,'setEnabled').mockImplementation(()=>{});
    vi.spyOn(BattleAudio.prototype,'warmup').mockResolvedValue();
    const status=vi.spyOn(BattleAudio.prototype,'getStatus').mockReturnValue({enabled:true,state:'blocked',loading:0,failedClips:0});
    const r=create();r.start();r.toggleSound();await Promise.resolve();await Promise.resolve();
    const step=vi.spyOn(r.battle,'step');r.advance(10);expect(step).not.toHaveBeenCalled();
    status.mockReturnValue({enabled:true,state:'ready',loading:0,failedClips:0});
    const events=r.advance(STEP);expect(step).toHaveBeenCalledOnce();expect(events.some(e=>e.type==='started')).toBe(true);
  });
  it('plays only P1/P2 opening dialogue without advancing battle or fighter positions',()=>{
    const r=create(),initial=structuredClone(r.getState().fighters);r.startWithOpening();const events:BattleEvent[]=[];
    for(let i=0;i<200&&r.getSummary().opening;i++){events.push(...r.advance(.1));expect(r.getState().tick).toBe(0);}
    expect(events.filter(e=>e.type==='voice').map(e=>[e.fighterId,e.scene])).toEqual([['p1','prefight-p1'],['p2','prefight-p2']]);
    expect(r.getState().phase).toBe('running');expect(r.getState().fighters).toEqual(initial);expect(r.getSummary().roundElapsed).toBe(0);
  });
  it('keeps opening voice timing independent from the combat speed and supports pause/skip',()=>{
    const slow=create(),fast=create();slow.setSpeed(.25);fast.setSpeed(4);slow.startWithOpening();fast.startWithOpening();
    slow.advance(.5);fast.advance(.5);expect(slow.getOpening()).toEqual(fast.getOpening());
    fast.togglePause();const frozen=fast.getOpening();fast.advance(20);expect(fast.getOpening()).toEqual(frozen);
    const stop=vi.spyOn(BattleAudio.prototype,'stopVoices');fast.skipOpening();expect(stop).toHaveBeenCalledOnce();
    expect(fast.getSummary().phase).toBe('running');expect(fast.advance(STEP).filter(e=>e.type==='voice'&&e.scene)).toEqual([]);
  });
  it('restarts opening cleanly and bypasses it for move demonstrations',()=>{
    const r=create();r.startWithOpening();r.advance(2);r.restart(undefined,true,true);
    expect(r.getOpening()?.scene).toBe('prefight-p1');expect(r.getOpening()?.progress).toBe(0);
    r.demonstrate('row-68');expect(r.getOpening()).toBeNull();expect(r.getSummary().mode).toBe('demonstration');
  });
  it.each([[10000,'victory-perfect'],[8000,'victory-dominant'],[2500,'victory-close'],[2499,'victory-narrow']])('emits one winner scene at HP %s',(hp,scene)=>{
    const consume=vi.spyOn(BattleAudio.prototype,'consume'),r=create();r.start();r.getState().fighters[0].maxHp=10000;r.getState().fighters[0].hp=Number(hp);r.getState().fighters[1].hp=0;
    r.advance(STEP);r.advance(STEP);
    const wins=consume.mock.calls.flatMap(c=>c[0]).filter(e=>e.type==='voice'&&e.scene?.startsWith('victory-'));
    expect(wins).toHaveLength(1);expect(wins[0]).toMatchObject({fighterId:'p1',scene});
  });
  it('does not play a winner line for a draw',()=>{
    const consume=vi.spyOn(BattleAudio.prototype,'consume'),r=create();r.start();r.getState().fighters.forEach(f=>f.hp=0);r.advance(STEP);
    expect(consume.mock.calls.flatMap(c=>c[0]).filter(e=>e.type==='voice'&&e.scene?.startsWith('victory-'))).toEqual([]);
  });
});
