/** Verify shipped 2D review assets without the game, image generator or FFmpeg. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'public/assets/jamie/drawn-supers-v1');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.layout.columns * manifest.layout.rows, manifest.layout.celsPerClip);
assert.equal(manifest.layout.celsPerClip, 24);
for (const [name, record] of Object.entries(manifest.files)) {
  assert.equal(path.basename(name), name, 'Asset filenames must stay inside the atlas directory');
  const bytes = fs.readFileSync(path.join(directory, name));
  assert.equal(bytes.length, record.bytes, `${name}: size changed`);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), record.sha256, `${name}: hash changed`);
  if (name.endsWith('.png')) {
    assert.equal(bytes.readUInt32BE(16), record.width, `${name}: PNG width`);
    assert.equal(bytes.readUInt32BE(20), record.height, `${name}: PNG height`);
  }
  if (name.endsWith('.webp')) {
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  }
  if (name.endsWith('.mp4')) assert.equal(bytes.toString('ascii', 4, 8), 'ftyp');
}
for (const [mode, clip] of Object.entries(manifest.clips)) {
  assert.ok(manifest.files[clip.image], `${mode}: missing playback atlas`);
  assert.equal(clip.artFrames, manifest.layout.celsPerClip * manifest.layout.ticksPerCel);
  assert.ok(clip.reviewFrames > clip.artFrames, `${mode}: missing audio tail`);
  assert.ok(clip.nativeStartFrame >= 0);
}
const prompts = JSON.parse(fs.readFileSync(path.join(directory, 'PROMPTS.json'), 'utf8'));
assert.ok(prompts.prompts.SA3 && prompts.prompts.CA);
assert.equal(prompts.method, 'built-in image_gen');
console.log(`Verified ${Object.keys(manifest.files).length} assets and both independent 24-cel clips.`);
