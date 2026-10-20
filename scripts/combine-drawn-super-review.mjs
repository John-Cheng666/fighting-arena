/** Join the two reviewed movies while removing AAC padding at their boundary. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=process.argv.indexOf('--ffmpeg');
if(flag<0||!process.argv[flag+1])throw new Error('Usage: node scripts/combine-drawn-super-review.mjs --ffmpeg <ffmpeg.exe>');
const ffmpeg=path.resolve(process.argv[flag+1]);
const directory=path.join(root,'public/assets/jamie/drawn-supers-v2');
const metadata=JSON.parse(fs.readFileSync(path.join(directory,'clips.json'),'utf8'));
const a=metadata.clips.SA3,b=metadata.clips.CA,total=a.frameCount+b.frameCount;
const filters=`[0:v]setpts=N/(60*TB)[v0];[1:v]setpts=N/(60*TB)[v1];[0:a]atrim=end_sample=${a.frameCount*800},asetpts=N/SR/TB[a0];[1:a]atrim=end_sample=${b.frameCount*800},asetpts=N/SR/TB[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`;
execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-i',path.join(directory,a.variants.smooth),'-i',path.join(directory,b.variants.smooth),
 '-filter_complex',filters,'-map','[v]','-map','[a]','-frames:v',String(total),'-t',String(total/60),
 '-c:v','libx264','-preset','medium','-crf','22','-threads','4','-pix_fmt','yuv420p','-r','60','-fps_mode','cfr',
 '-color_range','tv','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',
 '-c:a','aac','-b:a','192k','-ar','48000','-metadata:s:a:0','language=jpn','-movflags','+faststart','-y',path.join(directory,'review-full.mp4')],{stdio:'pipe'});
console.log(JSON.stringify({combinedFrames:total,seconds:total/60}));
