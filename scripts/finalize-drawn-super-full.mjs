/** Freeze or verify shipped full-review artwork, movies, clocks and provenance. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'public/assets/jamie/drawn-supers-v2');
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const clips=read('clips.json'),artwork=read('artwork.json'),audio=read('audio.json');
const prompts=read('PROMPTS.json'),corrections=read('CORRECTIONS.json');
assert.equal(clips.schemaVersion,2);assert.equal(clips.framesPerSecond,60);
assert.equal(artwork.columns,3);assert.equal(artwork.rows,2);assert.equal(artwork.ticksPerCel,5);
assert.equal(prompts.method,'built-in image_gen');assert.equal(prompts.batches.length,42);
assert.equal(corrections.corrections.length,2);
assert.equal(Object.values(artwork.phases).reduce((sum,p)=>sum+p.celCount,0),244);
for(const [mode,clip] of Object.entries(clips.clips)){
 assert.equal(clip.frameCount,audio.tracks[mode].frameCount);
 assert.equal(clip.width,1920);assert.equal(clip.height,1080);assert.equal(clip.framesPerSecond,60);
 assert.equal(clip.celCount,mode==='SA3'?121:140);
 let end=0;
 for(const phase of clip.phases){assert.equal(phase.from,end);assert.equal(phase.length,artwork.phases[phase.name].length);end+=phase.length;}
 assert.equal(clip.frameCount,end+15);
 for(const file of Object.values(clip.variants))assert.ok(fs.statSync(path.join(directory,file)).size>1000);
 assert.ok(fs.statSync(path.join(directory,clip.poster)).size>1000);
}
for(const [name,source] of Object.entries(artwork.sources)){
 const bytes=fs.readFileSync(path.join(directory,name));assert.equal(sha(bytes),source.sha256);
 assert.ok(source.width>=2000&&source.height>=750);
 assert.ok(Math.abs(source.width/source.height-8/3)<.04);
}
assert.ok(artwork.phases.intro.atlases.slice(0,2).every(file=>file.endsWith('-corrected.png')));
const fileRecords={};
for(const name of fs.readdirSync(directory).sort()){
 if(name==='manifest.json')continue;
 const bytes=fs.readFileSync(path.join(directory,name));fileRecords[name]={bytes:bytes.length,sha256:sha(bytes)};
}
const sourceFiles=['public/assets/jamie/cinematic/review-v3.mp4','public/assets/jamie/cinematic/jamie-native.glb','public/assets/jamie/cinematic/camera.json','public/assets/jamie/reference/603.mp4','public/assets/jamie/drawn-supers-v1/sa3-atlas.png','public/assets/jamie/official-jamie.png'];
const manifest={schemaVersion:2,method:'Built-in imagegen redraw; native-pose guides; cut-aware motion-compensated interpolation; approved original Japanese audio',
 uniqueDrawnCels:244,perClipDrawnCels:{SA3:121,CA:140},output:{width:1920,height:1080,fps:60},
 logicalSourceCelSize:{width:682,height:384},files:fileRecords,
 sources:Object.fromEntries(sourceFiles.map(file=>[file,sha(fs.readFileSync(path.join(root,file)))])),
 scope:'Complete independent hit-sequence review with startup, capture, recovery and audio tail; not battle integration.',
 limitations:clips.limitations};
const serialized=JSON.stringify(manifest,null,2)+'\n';
const destination=path.join(directory,'manifest.json');
if(process.argv.includes('--verify'))assert.equal(fs.readFileSync(destination,'utf8'),serialized,'Full review manifest is stale');
else fs.writeFileSync(destination,serialized);
const ffmpegFlag=process.argv.indexOf('--ffmpeg');
if(ffmpegFlag>=0){
 const ffmpeg=path.resolve(process.argv[ffmpegFlag+1]);
 const movies=Object.values(clips.clips).flatMap(clip=>Object.values(clip.variants).map(file=>({file,frames:clip.frameCount})));
 movies.push({file:'review-full.mp4',frames:clips.clips.SA3.frameCount+clips.clips.CA.frameCount});
 for(const movie of movies){
  const decoded=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-nostats','-i',path.join(directory,movie.file),'-map','0:v:0','-f','null','-','-progress','pipe:1'],{encoding:'utf8'});
  assert.equal(decoded.status,0,`${movie.file}: ${decoded.stderr}`);assert.equal(decoded.stderr.trim(),'');
  const count=Number([...decoded.stdout.matchAll(/^frame=\s*(\d+)/gm)].at(-1)?.[1]??0);
  assert.equal(count,movie.frames,`${movie.file}: decoded frame count`);
 }
}
console.log(JSON.stringify({verified:true,files:Object.keys(fileRecords).length,uniqueCels:244,frameCounts:{SA3:clips.clips.SA3.frameCount,CA:clips.clips.CA.frameCount}}));
