/** Full review audio: approved startup, captured action and authored recovery cues. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const character = read('src/characters/jamie/data/audio.json');
const numerics = read('src/characters/jamie/data/native-numerics.json');
const catalog = read('src/content/audio/catalog.json');
const source = read('public/assets/audio/sources.json');
if (!source.voiceApproval || catalog.voices?.jamie?.language !== 'ja') throw new Error('Approved Japanese audio is required');
const introFrames = 84, clips = {}, voiceRequests = {}, tracks = {};
for (const [mode, row, startAction, body, recovery] of [['SA3',89,1211,438,80],['CA',90,1215,499,114]]) {
  const captured = numerics.rows.find(value => value.row === row).captured;
  const cues = [];
  const collect = (id, actor, offset, limit) => {
    const action = character.actions[id];
    for (const [index,cue] of (action?.cues ?? []).entries()) if (cue.frame < limit) cues.push({
      id:`${id}:se:${index}`, frame:offset+cue.frame, actor, channel:'sfx', clipId:cue.clipId,
      source:{kind:'SEKey',actionId:id,soundId:cue.soundId},
    });
    for (const [index,cue] of (action?.voiceCues?.[0] ?? []).entries()) if (cue.frame < limit) cues.push({
      id:`${id}:voice:${index}`,frame:offset+cue.frame,actor,channel:'voice',voiceId:cue.voiceId,
      source:{kind:'VoiceKey',actionId:id,voiceId:cue.voiceId},
    });
  };
  collect(startAction,'attacker',0,introFrames);
  collect(captured.actionId,'attacker',introFrames,body+recovery);
  collect(captured.actionId+1,'defender',introFrames,body+recovery);
  const contacts = captured.hits.map(hit => ({frame:introFrames+hit.from,attackId:hit.attackId,damage:hit.damage}));
  for (const [index,hit] of contacts.entries()) {
    if (hit.damage <= 0) continue;
    const profile = character.contacts[hit.attackId];
    const voiceId = profile?.voiceId ?? 600;
    cues.push({id:`${captured.actionId+1}:damage:${index}`,frame:hit.frame,actor:'defender',channel:'voice',voiceId,
      source:{kind:'contact-voice',actionId:captured.actionId+1,attackId:hit.attackId,voiceId}});
    for (const [sound,clipId] of (profile?.normal ?? []).entries()) cues.push({
      id:`${captured.actionId}:contact-se:${index}:${sound}`,frame:hit.frame,actor:'attacker',channel:'sfx',clipId,
      source:{kind:'contact',actionId:captured.actionId,attackId:hit.attackId},
    });
  }
  cues.sort((a,b)=>a.frame-b.frame||a.id.localeCompare(b.id));
  for (const cue of cues) {
    if (cue.channel === 'voice') {
      const request = catalog.voices.jamie.requests[cue.voiceId];
      if (!request?.clips.length) throw new Error(`Missing voice ${cue.voiceId}`);
      voiceRequests[cue.voiceId] = request;
    }
    for (const clipId of cue.clipId ? [cue.clipId] : voiceRequests[cue.voiceId].clips) {
      const original = catalog.clips[clipId], evidence = source.clips[clipId];
      if (!original || !evidence) throw new Error(`Missing approved clip ${clipId}`);
      const bytes=fs.readFileSync(path.join(root,'public',original.url));
      const sha=crypto.createHash('sha256').update(bytes).digest('hex');
      if (sha !== evidence.sha256) throw new Error(`Changed source clip ${clipId}`);
      clips[clipId]={...original,url:`/${original.url}`,sha256:sha};
    }
  }
  tracks[mode]={bodyFrames:introFrames+body+recovery,tailFrames:15,frameCount:introFrames+body+recovery+15,
    introFrames,captureFrames:body,recoveryFrames:recovery,cues,contacts};
}
const output={schemaVersion:1,framesPerSecond:60,language:'ja',clips,voiceRequests,tracks,
  source:{kind:'Approved original startup/capture/recovery event and Japanese voice cues',
    recoveryVoices:[21339,21349],introFrames,audioApproval:source.approval,voiceApproval:source.voiceApproval},
  limitations:['Offline review retains the native event clips and deterministic per-actor voice priority; original engine DSP and RTPC are not reproduced.','The appended wide recovery camera is an authored 2D review transition, not a verified native camera.']};
const serialized=JSON.stringify(output,null,2)+'\n';
const file=path.join(root,'public/assets/jamie/drawn-supers-v2/audio.json');
if(process.argv.includes('--check')) {
  if(fs.readFileSync(file,'utf8')!==serialized)throw new Error('Full review audio metadata is stale');
}else fs.writeFileSync(file,serialized);
console.log(JSON.stringify({clips:Object.keys(clips).length,tracks:Object.fromEntries(Object.entries(tracks).map(([m,t])=>[m,{frames:t.frameCount,cues:t.cues.length}]))}));
