/** Render the approved full timeline at 1x without launching the game. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=process.argv.indexOf('--ffmpeg');
if(flag<0||!process.argv[flag+1])throw new Error('Usage: node scripts/render-drawn-super-audio.mjs --ffmpeg <ffmpeg.exe>');
const ffmpeg=path.resolve(process.argv[flag+1]);
const work=path.join(root,'.local/drawn-full');fs.mkdirSync(work,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/assets/jamie/drawn-supers-v2/audio.json'),'utf8'));
const vite=await createServer({root,configFile:false,server:{middlewareMode:true},appType:'custom'});
try{
 const {compileAudioTimeline}=await vite.ssrLoadModule('/src/cinematic-preview/audio-timeline.ts');
 for(const mode of ['SA3','CA']){
  const cues=compileAudioTimeline(mode,1,manifest),args=['-hide_banner','-loglevel','error'];
  const filters=[];
  cues.forEach((cue,index)=>{
   const clip=manifest.clips[cue.clipId];args.push('-i',path.join(root,'public',clip.url.replace(/^\//,'')));
   const duration=cue.until-cue.at,fade=Math.min(.008,duration/2),gain=(clip.gain??1)*.8*(cue.channel==='sfx'?.65:1);
   filters.push(`[${index}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${gain},afade=t=in:st=0:d=0.003,afade=t=out:st=${Math.max(0,duration-fade)}:d=${fade},adelay=${Math.round(cue.at*1000)}:all=1[a${index}]`);
  });
  const duration=manifest.tracks[mode].frameCount/60;
  filters.push(cues.map((_,i)=>`[a${i}]`).join('')+`amix=inputs=${cues.length}:normalize=0:dropout_transition=0,acompressor=threshold=0.7079:ratio=12:knee=2:attack=3:release=120,apad,atrim=duration=${duration}[mix]`);
  args.push('-filter_complex',filters.join(';'),'-map','[mix]','-ar','48000','-ac','2','-c:a','pcm_s16le','-y',path.join(work,`${mode.toLowerCase()}-audio.wav`));
  execFileSync(ffmpeg,args,{stdio:'pipe'});
  fs.writeFileSync(path.join(work,`${mode.toLowerCase()}-audio-plan.json`),JSON.stringify(cues,null,2));
  console.log(JSON.stringify({mode,cues:cues.length,duration}));
 }
}finally{await vite.close()}
