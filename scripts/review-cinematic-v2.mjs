/** Re-encode a browser canvas+Web Audio recording; never launches the game. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [inputArg, ffmpegArg, versionArg = '2'] = process.argv.slice(2);
const version = Number(versionArg);
if (!inputArg || !ffmpegArg || ![2, 3].includes(version)) throw new Error('Usage: node scripts/review-cinematic-v2.mjs <canvas-audio.webm> <ffmpeg.exe> [2|3]');
const input = path.resolve(inputArg), ffmpeg = path.resolve(ffmpegArg);
if (!fs.existsSync(input) || !fs.existsSync(ffmpeg)) throw new Error('Recording and FFmpeg must already exist');
const output = path.join(repo, 'public/assets/jamie/cinematic');
const movieName = `review-v${version}.mp4`, previewName = `review-v${version}-preview.mp4`, posterName = `poster-v${version}.jpg`;
const run = args => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: 'pipe' });
run(['-i', input, '-vf', 'scale=960:-2,setsar=1', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-metadata:s:a:0', 'language=jpn', '-movflags', '+faststart', '-y', path.join(output, movieName)]);
// Keep complete spoken lines in both excerpts. The cut follows the first SA3
// phrase and precedes the CA's two final authored lines, rather than mid-word.
run(['-i', input, '-filter_complex', '[0:v]trim=start=0:end=3.3,setpts=PTS-STARTPTS[a];[0:v]trim=start=12.85:end=16.1167,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0,scale=640:-2,setsar=1[v];[0:a]atrim=start=0:end=3.3,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.01,afade=t=out:st=3.25:d=0.05[x];[0:a]atrim=start=12.85:end=16.1167,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.01,afade=t=out:st=3.2:d=0.06[y];[x][y]concat=n=2:v=0:a=1[audio]', '-map', '[v]', '-map', '[audio]', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-b:v', '260k', '-maxrate', '330k', '-bufsize', '390k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-metadata:s:a:0', 'language=jpn', '-movflags', '+faststart', '-y', path.join(output, previewName)]);
run(['-ss', version === 3 ? '1.2' : '14.2', '-i', path.join(output, movieName), '-frames:v', '1', '-q:v', '5', '-y', path.join(output, posterName)]);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const generated = {};
for (const name of [movieName, previewName, posterName]) {
  const bytes = fs.readFileSync(path.join(output, name)); generated[name] = { bytes: bytes.length, sha256: sha(bytes) };
}
const metadata = {
  version, description: version === 3 ? 'Recovered original facial driver, native-parameter secondary motion and actual four-drink appearance; original Japanese audio.' : 'Rendered from the local real-time 3D sample; reconstructed visual effects and approved original Japanese audio.',
  video: { framesPerSecond: 30, width: 960, height: 540 }, audio: { language: 'ja', codec: 'aac', sampleRate: 48000, sourceManifest: 'audio.json' },
  bodyFrames: { SA3: 438, CA: 499 }, tailFrames: 15, totalFrames: { SA3: 453, CA: 514 },
  excerpt: [{ start: 0, end: 3.3, mode: 'SA3' }, { start: 12.85, end: 16.1167, mode: 'CA' }],
  captureSha256: sha(fs.readFileSync(input)), encoderSha256: sha(fs.readFileSync(ffmpeg)), outputs: generated,
};
if (version === 3) metadata.appearance = { attackerDrinkLevel: 4, defenderDrinkLevel: 0, recoveryManifest: 'recovery.json' };
fs.writeFileSync(path.join(output, `review-v${version}.json`), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata));
