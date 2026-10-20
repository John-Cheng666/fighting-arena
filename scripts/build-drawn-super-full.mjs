/** Assemble high-resolution 2D cels into cut-aware 60 Hz review movies. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ffmpegArg = process.argv.indexOf('--ffmpeg');
if (ffmpegArg < 0 || !process.argv[ffmpegArg+1]) throw new Error('Usage: node scripts/build-drawn-super-full.mjs --ffmpeg <ffmpeg.exe>');
const ffmpeg = path.resolve(process.argv[ffmpegArg+1]);
if (!fs.existsSync(ffmpeg)) throw new Error('FFmpeg executable not found');
const directory = path.join(root,'public/assets/jamie/drawn-supers-v2');
const work = path.join(root,'.local/drawn-full-build');
fs.mkdirSync(work,{recursive:true});
const inputAudio = JSON.parse(fs.readFileSync(path.join(directory,'audio.json'),'utf8'));
const fps = 60, step = 5, columns = 3, rows = 2;
const definitions = {
  intro:{length:84,cuts:[0,80]},
  'sa3-body':{length:438,cuts:[0,15,30,66,112,198,244,264,299,327,343,365,397]},
  'ca-body':{length:499,cuts:[0,15,30,65,86,138,183,203,232,260,276,304,381,407,422,435]},
  'sa3-end':{length:80,cuts:[0]},
  'ca-end':{length:114,cuts:[0]},
};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const run = args => execFileSync(ffmpeg,['-hide_banner','-loglevel','error',...args],{cwd:root,stdio:'pipe'});
const assertFrames=(file,expected)=>{
  const progress=run(['-nostats','-i',file,'-map','0:v:0','-f','null','-','-progress','pipe:1']).toString();
  const matches=[...progress.matchAll(/^frame=\s*(\d+)/gm)];
  const actual=Number(matches.at(-1)?.[1]??0);
  if(actual!==expected)throw new Error(`${path.basename(file)} decoded ${actual} frames; expected ${expected}`);
};
const qt = file => file.replaceAll('\\','/').replaceAll("'","'\\''");
const artwork = {schemaVersion:2,columns,rows,ticksPerCel:step,framesPerSecond:fps,phases:{},sources:{}};

for (const [phase,definition] of Object.entries(definitions)) {
  const count = Math.ceil(definition.length/step), atlasCount = Math.ceil(count/(columns*rows));
  const phaseDirectory = path.join(work,phase); fs.mkdirSync(phaseDirectory,{recursive:true});
  const atlases=[];
  for(let atlas=0;atlas<atlasCount;atlas++) {
    const original=`${phase}-${String(atlas+1).padStart(2,'0')}.png`;
    const corrected=original.replace('.png','-corrected.png');
    const name=fs.existsSync(path.join(directory,corrected))?corrected:original;
    const file=path.join(directory,name);
    const bytes=fs.readFileSync(file), width=bytes.readUInt32BE(16), height=bytes.readUInt32BE(20);
    if(Math.abs(width/height-8/3)>.04)throw new Error(`Unexpected 3x2 atlas dimensions: ${name} ${width}x${height}`);
    artwork.sources[name]={bytes:bytes.length,sha256:sha(bytes),width,height};
    atlases.push(name);
    const valid=Math.min(6,count-atlas*6);
    const filters=[],maps=[];
    for(let slot=0;slot<valid;slot++) {
      const col=slot%columns,row=Math.floor(slot/columns);
      const x=Math.round(col*width/columns)+2,y=Math.round(row*height/rows)+1;
      const w=Math.round((col+1)*width/columns)-x-2,h=Math.round((row+1)*height/rows)-y-1;
      filters.push(`[0:v]crop=${w}:${h}:${x}:${y},scale=768:432:force_original_aspect_ratio=decrease:flags=lanczos,pad=768:432:(ow-iw)/2:(oh-ih)/2:color=black[f${slot}]`);
      maps.push('-map',`[f${slot}]`,'-frames:v','1','-compression_level','3',path.join(phaseDirectory,`key-${String(atlas*6+slot).padStart(3,'0')}.png`));
    }
    run(['-filter_complex_threads','2','-i',file,'-filter_complex',filters.join(';'),'-y',...maps]);
  }
  artwork.phases[phase]={length:definition.length,celCount:count,atlases};
  console.log(JSON.stringify({prepared:phase,cels:count}));
}
fs.writeFileSync(path.join(directory,'artwork.json'),JSON.stringify(artwork,null,2)+'\n');

const rendered={};
for (const mode of ['SA3','CA']) {
  const names=['intro',`${mode.toLowerCase()}-body`,`${mode.toLowerCase()}-end`];
  const variants={};
  for(const variant of ['drawn','smooth']) {
    const parts=[];
    for (const [phaseIndex,phase] of names.entries()) {
      const definition=definitions[phase],count=artwork.phases[phase].celCount;
      const cuts=[...new Set(definition.cuts.map(f=>Math.ceil(f/step)))].filter(i=>i<count).sort((a,b)=>a-b);
      cuts.push(count);
      for(let shot=0;shot<cuts.length-1;shot++) {
        const from=cuts[shot],to=cuts[shot+1],number=to-from;
        const start=from*step,end=Math.min(to*step,definition.length);
        const tail=phaseIndex===2&&shot===cuts.length-2?15:0;
        const ticks=end-start+tail;
        const target=path.join(work,`${mode.toLowerCase()}-${variant}-${phaseIndex}-${shot}.mp4`);
        // setpts clears the link's rate in the pinned FFmpeg build. Restore it
        // before padding; otherwise short shots silently lose their endpoints.
        const filter=variant==='smooth'
          ? `trim=end_frame=${number},setpts=PTS-STARTPTS,fps=12:eof_action=pass,tpad=start_mode=clone:start=2:stop_mode=clone:stop=12,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:mb_size=16:search_param=16:vsbmc=1:scd=fdiff:scd_threshold=8,trim=start_frame=10:end_frame=${10+ticks},setpts=N/(60*TB),fps=60`
          : `trim=end_frame=${number},setpts=PTS-STARTPTS,fps=12:eof_action=pass,tpad=stop_mode=clone:stop=12,fps=60,trim=end_frame=${ticks},setpts=N/(60*TB),fps=60`;
        run(['-filter_threads','2','-framerate','12','-start_number',String(from),'-i',path.join(work,phase,'key-%03d.png'),
          '-vf',`${filter},scale=1920:1080:flags=lanczos:out_range=tv:out_color_matrix=bt709,setsar=1`,'-frames:v',String(ticks),'-r','60','-fps_mode','cfr',
          '-an','-c:v','libx264','-preset','fast','-crf','18','-threads','4','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709','-video_track_timescale','15360','-y',target]);
        assertFrames(target,ticks);
        parts.push(target);
      }
    }
    const list=path.join(work,`${mode.toLowerCase()}-${variant}.ffconcat`);
    fs.writeFileSync(list,'ffconcat version 1.0\n'+parts.map(file=>`file '${qt(file)}'`).join('\n')+'\n');
    const movie=path.join(directory,`${mode.toLowerCase()}-${variant}.mp4`);
    const audio=path.join(root,'.local/drawn-full',`${mode.toLowerCase()}-audio.wav`);
    if(!fs.existsSync(audio))throw new Error('Render the approved full audio timeline before assembling movies');
    run(['-f','concat','-safe','0','-i',list,'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000',
      '-t',String(inputAudio.tracks[mode].frameCount/fps),'-metadata:s:a:0','language=jpn','-movflags','+faststart','-y',movie]);
    variants[variant]=path.basename(movie);
    assertFrames(movie,inputAudio.tracks[mode].frameCount);
    console.log(JSON.stringify({rendered:mode,variant,frames:inputAudio.tracks[mode].frameCount}));
  }
  const poster=`${mode.toLowerCase()}-poster.jpg`;
  run(['-ss',String(mode==='CA'?7:7.7),'-i',path.join(directory,variants.smooth),'-vf','scale=in_range=tv:out_range=pc,format=yuvj420p','-color_range','pc','-frames:v','1','-q:v','2','-y',path.join(directory,poster)]);
  const phases=names.map((phase,index)=>({name:phase,from:names.slice(0,index).reduce((sum,p)=>sum+definitions[p].length,0),length:definitions[phase].length}));
  rendered[mode]={frameCount:inputAudio.tracks[mode].frameCount,celCount:names.reduce((sum,p)=>sum+artwork.phases[p].celCount,0),
    width:1920,height:1080,framesPerSecond:fps,variants,poster,phases};
}
const clips={schemaVersion:2,framesPerSecond:fps,ticksPerDrawnCel:step,sourceCelSize:{width:682,height:384},
  appearance:{attackerDrinkLevel:4,defenderDrinkLevel:0},clips:rendered,
  interpolation:'Motion-compensated interpolation within camera shots; no interpolation across source camera cuts. Original cels available as a separate review mode.',
  limitations:['Generated face, hands, hair and fabric can retain small temporal differences.','Output is 1080p; original redrawn cels are approximately 680x380, upscaled with Lanczos.','Independent complete hit-sequence review, without battle-engine integration or block/whiff/KO branches.']};
fs.writeFileSync(path.join(directory,'clips.json'),JSON.stringify(clips,null,2)+'\n');
execFileSync(process.execPath,[path.join(root,'scripts/combine-drawn-super-review.mjs'),'--ffmpeg',ffmpeg],{stdio:'inherit'});
console.log(JSON.stringify({complete:true,clips:rendered}));
