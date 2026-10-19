/**
 * Build checked-in runtime audio from the already extracted, approved SF6 review.
 * Never opens the game or an REA/IDA session. Normal app builds do not run this.
 * SF6_AUDIO_RESEARCH and SF6_COMBAT_RESEARCH may point to portable research copies.
 * node scripts/sync-sf6-audio.mjs --verify checks shipped hashes without research.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(process.env.SF6_AUDIO_RESEARCH ?? path.join(repo, 'research/sf6-audio'))
const publicRoot = path.join(repo, 'public/assets/audio')
const catalogFile = path.join(repo, 'src/content/audio/catalog.json')
const characterFile = path.join(repo, 'src/characters/jamie/data/audio.json')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const digest = file => sha(fs.readFileSync(file))
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}
function required(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing extracted research: ${file}. Restore the approved SF6 audio research bundle; see docs/character-audio.md. App build and --verify need no research or SF6 installation.`)
  return file
}

function verify() {
  const catalog = read(catalogFile), character = read(characterFile)
  const sources = read(path.join(publicRoot, 'sources.json'))
  if (!sources.voiceApproval || !catalog.voices?.jamie) throw new Error('Missing the current reviewed Jamie personal-voice dataset')
  let total = 0
  for (const [id, clip] of Object.entries(catalog.clips)) {
    const file = path.join(repo, 'public', clip.url)
    if (!fs.existsSync(file)) throw new Error(`Missing clip ${id}: ${file}`)
    if (digest(file) !== sources.clips[id].sha256) throw new Error(`Hash mismatch ${id}`)
    if (!(clip.seconds > 0) || Math.abs(clip.seconds * clip.sampleRate - clip.frames) > .001) throw new Error(`Invalid duration ${id}`)
    if (clip.loop && !(clip.loop.start >= 0 && clip.loop.end > clip.loop.start && clip.loop.end <= clip.seconds + 1 / clip.sampleRate)) throw new Error(`Invalid loop ${id}`)
    total += fs.statSync(file).size
  }
  const references = [
    ...Object.values(catalog.bgm).flatMap(t => Object.values(t).filter(v => typeof v === 'string' && v.startsWith('bgm-'))),
    ...Object.values(catalog.feedback).flat(),
    ...Object.values(character.actions).flatMap(a => a.cues.map(c => c.clipId)),
    ...Object.values(character.contacts).flatMap(c => [...c.normal, ...(c.counter ?? []), ...(c.punish ?? []), ...(c.guard ?? [])]),
    ...(character.voice?.light ?? []), ...(character.voice?.damage ?? []),
    ...Object.values(catalog.voices ?? {}).flatMap(v => [...Object.values(v.requests).flatMap(r => r.clips), ...Object.values(v.scenes).flat()]),
  ]
  for (const id of references) if (!catalog.clips[id]) throw new Error(`Unmapped clip ${id}`)
  if (sources.voiceApproval) {
    const rejected = new Set(sources.voiceApproval.rejectedSha256)
    for (const [id, clip] of Object.entries(sources.clips)) if (rejected.has(clip.sha256)) throw new Error(`Rejected voice remains shipped: ${id}`)
    for (const id of sources.voiceApproval.blockedRequestIds) if (catalog.voices?.jamie?.requests[id]) throw new Error(`Blocked voice request remains: ${id}`)
  }
  if (Object.keys(catalog.bgm).length !== 9) throw new Error('Expected 9 approved BGM tracks')
  for (const id of sources.coverage.specialActions) if (!character.actions[id]) throw new Error(`Missing audited special action ${id}`)
  console.log(JSON.stringify({ clips: Object.keys(catalog.clips).length, actions: Object.keys(character.actions).length, contacts: Object.keys(character.contacts).length, specialActions: sources.coverage.specialActions.length, bgmTracks: Object.keys(catalog.bgm).length, bytes: total, verified: true }))
}
if (process.argv.includes('--verify')) { verify(); process.exit(0) }

// The current project must not silently regenerate the superseded voice placeholders.
required(path.join(root, 'voice-review-v1/approval.json'))

const review = read(required(path.join(root, 'review-v4/manifest.json')))
const soundLinks = read(required(path.join(root, 'action-sound-links.json')))
const triggers = read(required(path.join(root, 'trigger-links.json')))
const media = read(required(path.join(root, 'media.json')))
for (const name of ['foot', 'costume', 'down']) media.push(...read(required(path.join(root, `review-v4/${name}/media.json`))))
const yoimaxSource = read(required(path.join(root, 'review-v4/yoimax/extraction.json'))).matches.find(m => /wt_skill_yoimax_cmn_m\.sbnk/.test(m.resource))
const combatCandidates = [process.env.SF6_COMBAT_RESEARCH, path.join(repo, 'research/sf6-ai/combat-values'), 'C:/Users/ASUS/Desktop/fighting-arena/research/sf6-ai/combat-values'].filter(Boolean)
const combatRoot = combatCandidates.find(dir => fs.existsSync(path.join(dir, 'combat-values.json')))
if (!combatRoot) throw new Error('Missing combat-values.json and jamie-action-numerics.json. Set SF6_COMBAT_RESEARCH to the extracted combat-values directory; see docs/character-audio.md.')
const combat = read(required(path.join(combatRoot, 'combat-values.json')))
const authored = read(required(path.join(combatRoot, 'jamie-action-numerics.json')))
const attacks = combat.attackData.find(x => x.source.includes('021.fchar')).attacks
const audits = ['freeflow', 'ground', 'kicks'].map(name => read(required(path.join(root, `review-v4-${name}-agent/findings.json`))))
const foot = read(required(path.join(root, 'review-v4/foot/links.json')))
const costume = read(required(path.join(root, 'review-v4/costume/links.json')))
const down = read(required(path.join(root, 'review-v4/down/links.json')))
const work = path.join(root, 'runtime-export')
fs.mkdirSync(work, { recursive: true })
fs.mkdirSync(publicRoot, { recursive: true })
const cli = required(path.join(root, 'tools/vgmstream/vgmstream-cli.exe'))
const ffmpeg = required(path.join(root, 'tools/ffmpeg.exe'))

// All review-v4 events already used -gwd. Regenerate supers likewise, since the
// first review's default TXTP omitted bank initial delays.
const superDir = path.join(work, 'super-events')
if (!fs.existsSync(path.join(superDir, '.complete'))) {
  fs.mkdirSync(superDir, { recursive: true })
  const python = process.env.SF6_AUDIO_PYTHON ?? 'C:/Program Files/IDA94/python311/python.exe'
  required(python)
  const banks = ['init', ...[131, 132, 133].flatMap(n => [`wt_skill_210${n}xx_es`, `wt_skill_210${n}xx_m`])]
  execFileSync(python, [required(path.join(root, 'tools/wwiser.pyz')), '-d', 'none', '-g', '-gbs', '-gwd', '-gd', '-go', superDir, '-gw', '../../wem', ...banks.map(b => required(path.join(root, 'banks', b + '.bnk')))], { cwd: root, maxBuffer: 5e6 })
  fs.writeFileSync(path.join(superDir, '.complete'), 'wwiser -gwd -gd -gbs\n')
}

// The first audition selected only a few common request IDs from these complete
// typed eventlists. Resolve the remaining movement/cloth/down IDs by exact
// TriggerID, then generate only those event IDs from the already extracted banks.
const supplementalTables = [{ name: 'foot', table: foot }, { name: 'costume', table: costume }, { name: 'down', table: down }]
const requestSoundIds = new Set(soundLinks.actions.flatMap(a => a.keys.filter(k => k.type === 'CharacterAsset.SEKey').map(k => k.values.SoundID)))
const supplementalMappings = []
for (const soundId of requestSoundIds) {
  const request = triggers.requests.find(r => r.kind === 'app.sound.SeRequestData' && r.fields.UniqueID === soundId && r.resource.includes('rdt_cmn'))
  if (!request) continue
  for (const { name, table } of supplementalTables) for (const trigger of table.triggers) {
    if (trigger.triggerId === request.fields.TriggerId && trigger.eventIds.default !== 0xffffffff) supplementalMappings.push({ soundId, triggerId: request.fields.TriggerId, eventId: trigger.eventIds.default, table: name, resource: trigger.resource, sourceSha256: trigger.sourceSha256 })
  }
}
const supplementalDirs = []
for (const { name } of supplementalTables) {
  const eventIds = [...new Set(supplementalMappings.filter(m => m.table === name).map(m => m.eventId))].sort((a, b) => a - b)
  const dir = path.join(root, `review-v4/${name}/runtime-events`), marker = path.join(dir, '.complete'), signature = eventIds.join(',')
  supplementalDirs.push(dir)
  fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8') !== signature) {
    const banks = fs.readdirSync(path.join(root, `review-v4/${name}/banks`)).filter(n => n.endsWith('.bnk')).map(n => path.join(root, `review-v4/${name}/banks`, n))
    const args = [required(path.join(root, 'tools/wwiser.pyz')), '-d', 'none', '-g', '-gbs', '-gwd', '-gd', '-go', dir, '-gw', '../wem', required(path.join(root, 'banks/init.bnk')), ...banks]
    if (name === 'foot') args.push('-gp', '[3125156716=3887221881][3253838321=1945290475]')
    args.push('-gf', ...eventIds.map(String))
    execFileSync(process.env.SF6_AUDIO_PYTHON ?? 'C:/Program Files/IDA94/python311/python.exe', args, { cwd: root, maxBuffer: 5e6 })
    fs.writeFileSync(marker, signature)
  }
}

const events = []
for (const dir of [path.join(root, 'review-v4/events'), superDir, path.join(root, 'review-v4/yoimax/events'), path.join(root, 'review-v4/foot/events'), path.join(root, 'review-v4/costume/events'), ...supplementalDirs]) {
  for (const name of fs.readdirSync(required(dir)).filter(name => name.endsWith('.txtp'))) {
    const file = path.join(dir, name), text = fs.readFileSync(file, 'utf8')
    const eventId = Number(text.match(/CAkEvent\[\d+\] (\d+)/)?.[1])
    events.push({ file, text, eventId })
  }
}
function locate(file) {
  if (fs.existsSync(file)) return file
  // Review artifacts used absolute paths. Relocate those references when a copy
  // of the extracted bundle is used on another machine.
  const parts = file.replaceAll('\\', '/').split('/research/sf6-audio/')
  return required(parts.length === 2 ? path.join(root, parts[1]) : file)
}
const eventById = (id, selector) => events.find(e => e.eventId === id && (!selector || e.file.includes(selector)))
const catalog = { schemaVersion: 1, clips: {}, bgm: {}, feedback: {} }
const character = { schemaVersion: 1, framesPerSecond: 60, actions: {}, contacts: {}, voice: { light: [], damage: [] } }
const evidence = { schemaVersion: 1, game: { steamBuild: 25071972, executableSha256: '26095ad815bca8c58205814348315f132e74a74650c63fe1b2801c752643627c', characterSourceSha256: soundLinks.sha256 }, approval: { reviewVersion: 4, manifestSha256: digest(path.join(root, 'review-v4/manifest.json')), reviewHtmlSha256: fs.existsSync(path.join(root, 'review-v4.html')) ? digest(path.join(root, 'review-v4.html')) : null, scope: 'User approved all v4 items and engineering implementation on 2026-10-19.', reviewCompositesUsedAsRuntimeTracks: false }, tools: { decoder: 'vgmstream r2117', bankGraph: 'wwiser v20260808 -gwd -gd -gbs', encoding: 'Opus; complete source event tails; no time stretch or fixed cap' }, clips: {}, inputHashes: {}, coverage: {}, unresolved: [], controls: [], contactTables: {}, limitations: ['Original-game runtime audio routing was not executed. This is a static source mapping integrated with this project\'s simulation.', 'Wwise runtime DSP, RTPC, material/random switch selection and bus ducking are representative. Footwear is Sneakers on stone and costume 0.', 'Unreviewed JP move voice groups are excluded; the two approved Japanese light attack/damage voices remain available.', 'Punish routing falls back to the supported counter event when no distinct native punish trigger has been established.', 'Contact Type.AUTO has no guessed punch/kick replacement; its original fields and overrides are retained.'] }
evidence.supplementalRequestMappings = supplementalMappings
for (const name of ['foot', 'costume', 'down']) evidence.inputHashes[`review-v4/${name}/links.json`] = digest(path.join(root, `review-v4/${name}/links.json`))
for (const file of ['action-sound-links.json', 'trigger-links.json', 'media.json', 'review-v4/manifest.json']) evidence.inputHashes[file] = digest(path.join(root, file))
evidence.inputHashes['combat-values.json'] = digest(path.join(combatRoot, 'combat-values.json'))
evidence.inputHashes['jamie-action-numerics.json'] = digest(path.join(combatRoot, 'jamie-action-numerics.json'))
const eventCache = new Map()
const previousCatalog = fs.existsSync(catalogFile) ? read(catalogFile) : { clips: {} }
const previousSources = fs.existsSync(path.join(publicRoot, 'sources.json')) ? read(path.join(publicRoot, 'sources.json')) : { clips: {} }

function wave(file) {
  const b = fs.readFileSync(file); let fmt, data
  for (let p = 12; p + 8 <= b.length;) {
    const name = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4)
    if (name === 'fmt ') fmt = b.subarray(p + 8, p + 8 + size)
    if (name === 'data') { data = b.subarray(p + 8, p + 8 + size); break }
    p += 8 + size + (size & 1)
  }
  if (!fmt || !data || (fmt.readUInt16LE(0) === 65534 ? fmt.readUInt16LE(24) : fmt.readUInt16LE(0)) !== 3 || fmt.readUInt16LE(14) !== 32) throw new Error(`Unexpected float WAV ${file}`)
  const channels = fmt.readUInt16LE(2), sampleRate = fmt.readUInt32LE(4), frames = data.length / channels / 4
  return { data, channels, sampleRate, frames }
}
function provenance(file, eventId) {
  const text = fs.readFileSync(file, 'utf8')
  const mediaIds = [...new Set([...text.matchAll(/[/\\](\d+)\.wem/g)].map(m => Number(m[1])))]
  return { eventId, nodeIds: [...new Set([...text.matchAll(/CAk\w+\[\d+\] (\d+)/g)].map(m => Number(m[1])))], txtp: path.relative(root, file).replaceAll('\\', '/'), txtpSha256: sha(Buffer.from(text)), media: mediaIds.map(id => {
    const m = media.find(m => m.id === id)
    if (m) return { id, sha256: m.sha256, sourceResource: m.resource, sourceSha256: m.sourceSha256 }
    const source = text.match(new RegExp(`(?:^|\\n)\\s*(\\S*[/\\\\]${id}\\.wem)`, 'm'))?.[1]
    const wem = source && path.resolve(path.dirname(file), source)
    if (wem && fs.existsSync(wem) && file.includes('yoimax')) return { id, sha256: digest(wem), sourceResource: yoimaxSource.resource, sourceSha256: yoimaxSource.sha256 }
    throw new Error(`Missing media provenance ${id} in ${file}`)
  }) }
}
function renderEvent(event) {
  if (!event) return null
  if (eventCache.has(event.file)) return eventCache.get(event.file)
  const variantKey = sha(Buffer.from(event.text.replaceAll('\\', '/'))).slice(0, 12)
  const id = `event-${event.eventId}-${variantKey}`, wavFile = path.join(work, id + '.wav'), output = path.join(publicRoot, id + '.ogg')
  const cached = previousSources.clips[id]
  if (cached && previousCatalog.clips[id] && cached.txtpSha256 === sha(Buffer.from(event.text)) && fs.existsSync(output) && digest(output) === cached.sha256 && cached.sourceFrames === cached.decodedFrames) {
    catalog.clips[id] = previousCatalog.clips[id]
    evidence.clips[id] = { ...cached, ...provenance(event.file, event.eventId) }
    eventCache.set(event.file, id)
    return id
  }
  const meta = JSON.parse(execFileSync(cli, ['-i', '-m', '-I', event.file], { encoding: 'utf8', maxBuffer: 1e6 }))
  execFileSync(cli, ['-i', '-W', '4', '-D', '2', '-o', wavFile, event.file], { maxBuffer: 1e6 })
  const audio = wave(wavFile)
  if (audio.frames !== meta.playSamples) throw new Error(`Event sample mismatch ${event.file}`)
  let peak = 0
  for (let i = 0; i < audio.data.length; i += 4) { const v = audio.data.readFloatLE(i); if (!Number.isFinite(v)) throw new Error('Nonfinite sample'); peak = Math.max(peak, Math.abs(v)) }
  if (peak === 0) { evidence.unresolved.push({ eventId: event.eventId, status: 'silent-selected-branch' }); eventCache.set(event.file, null); return null }
  const gain = Math.min(1, .92 / peak), pcm = Buffer.alloc(audio.frames * audio.channels * 2)
  for (let i = 0; i < audio.frames * audio.channels; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(audio.data.readFloatLE(i * 4) * gain * 32767))), i * 2)
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 's16le', '-ar', String(audio.sampleRate), '-ac', String(audio.channels), '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '96k', output], { input: pcm, maxBuffer: 1e6 })
  const decoded = execFileSync(ffmpeg, ['-v', 'error', '-i', output, '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1'], { maxBuffer: pcm.length + 1e6 })
  if (decoded.length !== pcm.length) throw new Error(`Opus changed decoded frames ${id}`)
  catalog.clips[id] = { url: `assets/audio/${id}.ogg`, seconds: audio.frames / audio.sampleRate, frames: audio.frames, sampleRate: audio.sampleRate, channels: audio.channels }
  evidence.clips[id] = { ...provenance(event.file, event.eventId), sha256: digest(output), sourceFrames: audio.frames, decodedFrames: decoded.length / audio.channels / 2, initialDelayPreserved: true, encodeGain: gain }
  eventCache.set(event.file, id)
  return id
}
function copyVariant(id, variant, { loop = variant.loop } = {}) {
  const source = locate(variant.ogg), output = path.join(publicRoot, id + '.ogg')
  if (variant.sha256 && digest(source) !== variant.sha256) throw new Error(`Approved bytes changed ${id}`)
  fs.copyFileSync(source, output)
  const frames = Math.round(variant.seconds * variant.sampleRate), channels = variant.channels
  const cached = previousSources.clips[id]
  if (!cached || cached.sha256 !== digest(output) || cached.decodedFrames !== frames) {
    const decoded = execFileSync(ffmpeg, ['-v', 'error', '-i', output, '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1'], { maxBuffer: frames * channels * 2 + 1e6 })
    if (decoded.length !== frames * channels * 2) throw new Error(`Approved duration mismatch ${id}`)
  }
  catalog.clips[id] = { url: `assets/audio/${id}.ogg`, seconds: variant.seconds, frames, sampleRate: variant.sampleRate, channels, ...(loop ? { loop: { start: loop.start, end: loop.end } } : {}) }
  const input = variant.input && locate(variant.input)
  evidence.clips[id] = { ...(input ? provenance(input, Number(fs.readFileSync(input, 'utf8').match(/CAkEvent\[\d+\] (\d+)/)?.[1])) : {}), sha256: digest(output), sourceFrames: frames, decodedFrames: frames, approvedVariant: variant.key, reusedApprovedBytes: true }
  return id
}

for (const entry of review.entries.filter(e => e.group === 'bgm')) {
  const states = { normal: 'on_fight', danger: 'on_dj', intro: 'on_intro', outro: 'on_outro', varied: 'on_fight_vary', extended: 'on_extended', break: 'on_break' }
  const track = { title: entry.title }
  for (const [mode, state] of Object.entries(states)) {
    const variant = entry.variants.find(v => v.state === state)
    if (!variant) throw new Error(`Missing BGM state ${entry.id} ${state}`)
    track[mode] = copyVariant(`${entry.id}-${mode}`, variant)
  }
  catalog.bgm[entry.id.slice(4)] = track
}

const extraLinks = [...foot.links, ...costume.links]
function requestFor(soundId, kind = 'se') {
  return triggers.requests.find(r => r.kind === (kind === 'se' ? 'app.sound.SeRequestData' : 'app.sound.VoiceRequestData') && r.fields.UniqueID === soundId && (soundId >= 21000 ? r.resource.includes('rdt_esf021') : r.resource.includes('rdt_cmn')))
}
function eventForSound(soundId) {
  if (soundId === 21299) return eventById(1786261899)
  const extra = extraLinks.find(l => l.soundId === soundId && (l.selectedFile || l.playableFiles?.length))
  if (extra) { const file = locate(extra.selectedFile ?? extra.playableFiles[0]); return events.find(e => e.file === file) }
  const request = requestFor(soundId)
  for (const trigger of request?.triggers ?? []) { const found = eventById(trigger.eventIds.default); if (found) return found }
  for (const mapping of supplementalMappings.filter(m => m.soundId === soundId)) { const found = eventById(mapping.eventId); if (found) return found }
  return null
}
const soundCache = new Map()
function clipForSound(id) {
  if (!soundCache.has(id)) soundCache.set(id, renderEvent(eventForSound(id)))
  return soundCache.get(id)
}

const nativeActions = soundLinks.actions.filter(a => a.styleId === 0)
for (const action of nativeActions) {
  const raw = authored.actions.find(a => a.styleId === 0 && a.actionId === action.actionId)
  const marginFrame = raw?.fields.ActionFrame?.values.MarginFrame
  const row = { cues: [], ...(marginFrame >= 0 ? { marginFrame } : {}) }
  for (const key of action.keys.filter(k => k.type === 'CharacterAsset.SEKey')) {
    const v = key.values, soundId = v.SoundID, clipId = clipForSound(soundId)
    if (soundId < 0) continue // Native disabled/sentinel entry, not a missing asset.
    if (clipId) row.cues.push({ frame: key.from, clipId, kind: 'se', soundId, stopMode: v.StopMode, afterBranch: v.AfterBranch, onlyOnce: v.OnlyOnce, targetData: v.TargetData, targetPos: v.TargetPos })
    else {
      const request = requestFor(soundId), eventIds = (request?.triggers ?? []).map(t => t.eventIds.default).filter(id => id !== 0xffffffff)
      if (eventIds.length) (row.controls ??= []).push({ frame: key.from, soundId, eventIds, kind: 'control' })
      else evidence.unresolved.push({ actionId: action.actionId, frame: key.from, soundId, status: 'no-playable-event-in-approved-extracted-scope' })
    }
  }
  row.cues.sort((a, b) => a.frame - b.frame)
  character.actions[action.actionId] = row
}
// Native entries 996 and 1018 contain no SEKey at all. Keep their explicit empty
// mappings rather than implying missing extraction or borrowing another move.
for (const action of audits.flatMap(a => a.actions)) {
  if (!character.actions[action.actionId]) character.actions[action.actionId] = { cues: [], ...(action.marginFrame >= 0 ? { marginFrame: action.marginFrame } : {}) }
}

// Conditions identify which original sound table applies. Never derive contact
// strength from damage or the project's light/medium/heavy move labels.
function murmurUtf16(name) {
  const b = Buffer.from(name, 'utf16le'), rol = (v, n) => v << n | v >>> (32 - n)
  let h = -1, p = 0
  for (; p + 4 <= b.length; p += 4) { let k = Math.imul(b.readUInt32LE(p), 0xcc9e2d51); k = Math.imul(rol(k, 15), 0x1b873593); h = rol(h ^ k, 13); h = Math.imul(h, 5) + 0xe6546b64 | 0 }
  if (p < b.length) { let k = 0; for (let i = p; i < b.length; i++) k |= b[i] << ((i - p) * 8); h ^= Math.imul(rol(Math.imul(k, 0xcc9e2d51), 15), 0x1b873593) }
  h ^= b.length; h = Math.imul(h ^ h >>> 16, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35)
  return (h ^ h >>> 16) >>> 0
}
const strengths = { 1: 1104702398, 2: 4059751673, 3: 522470418, 4: 1137669552, 5: 3619821232, 6: 991787193, 7: 4185605135 }
const typeNames = { 2: 'PUNCH', 3: 'KICK', 4: 'SLASH', 5: 'SHELL01', 6: 'THROW_ENGULF' }
function contactClip(values, outcome) {
  const name = typeNames[values.Type]
  if (!name || !strengths[values.Power]) return []
  const trigger = triggers.triggers.find(t => t.triggerId === murmurUtf16(`SND_DF_DMG_${outcome}_${name}`))
  const event = trigger && eventById(trigger.eventIds.default, `damagestrengthintensity=${strengths[values.Power]}`)
  const clip = renderEvent(event)
  return clip ? [clip] : []
}
for (const attack of attacks) {
  const tables = [...(attack.tables._CommonSounds ?? []), ...(attack.tables._Sounds ?? [])].map(t => t.values)
  const base = tables.find(v => v.IndexID === 0) ?? tables[0]
  if (!base) continue
  const extraIds = [base.ExtraSE, base.ExtraSE2, base.ThrowSE].filter(id => id >= 0)
  const extras = extraIds.map(clipForSound).filter(Boolean)
  const normal = [...contactClip(base, 'NORMAL'), ...extras]
  const counter = [...contactClip(base, 'COUNTER'), ...extras]
  const guard = contactClip(base, 'GUARD')
  character.contacts[attack.id] = { normal, counter: counter.length ? counter : normal, punish: counter.length ? counter : normal, guard, type: base.Type, power: base.Power, attr: base.Attr, ...(extraIds.length ? { extraSeIds: extraIds } : {}), ...(tables.length > 1 ? { overrides: tables.filter(t => t !== base).map(v => ({ indexId: v.IndexID, type: v.Type, power: v.Power, attr: v.Attr, extraSeIds: [v.ExtraSE, v.ExtraSE2, v.ThrowSE].filter(id => id >= 0) })) } : {}) }
  evidence.contactTables[attack.id] = tables
}

for (const id of ['parry', 'perfect-parry', 'perfect-shell', 'armor-break', 'guard-break', 'drive-rush-hit', 'stun', 'drive-impact', 'drive-charge', 'drive-reversal', 'drive-guard']) {
  const entry = review.entries.find(e => e.id === id), variant = entry.variants.find(v => v.key === entry.defaultVariant)
  const input = locate(variant.input), eventId = Number(fs.readFileSync(input, 'utf8').match(/CAkEvent\[\d+\] (\d+)/)?.[1])
  const current = eventById(eventId, id === 'drive-guard' ? 'damagestrengthintensity=1104702398' : null)
  const clipId = current ? renderEvent(current) : copyVariant(`feedback-${id}`, variant, { loop: null })
  catalog.feedback[id] = clipId ? [clipId] : []
}
evidence.coverage = { specialRows: 49, specialActions: [...new Set(audits.flatMap(a => a.actions.map(a => a.actionId)))].sort((a, b) => a - b), actionCount: Object.keys(character.actions).length, contactCount: Object.keys(character.contacts).length, cueCount: Object.values(character.actions).reduce((n, a) => n + a.cues.length, 0), knownControlCount: Object.values(character.actions).reduce((n, a) => n + (a.controls?.length ?? 0), 0) }
evidence.controls = Object.entries(character.actions).flatMap(([actionId, a]) => (a.controls ?? []).map(c => ({ actionId: Number(actionId), ...c })))
const stopEvidence = read(required(path.join(root, 'timing-v2/control-events.json'))).sound999
// TXTP paths omit some non-playable ActorMixer ancestors. Preserve the dump's
// DirectParentID edges so Stop_E_O can address only actual descendants.
const nodeParents = new Map()
for (const name of ['jamie-dump.txt', 'sfx-dump.txt']) {
  const file = required(path.join(root, name))
  evidence.inputHashes[name] = digest(file)
  let nodeId
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/obj  CAk\w+\[\d+\]/.test(line)) nodeId = undefined
    const id = line.match(/sid  ulID = (\d+)/)
    if (id) nodeId = Number(id[1])
    const parent = line.match(/tid  DirectParentID = (\d+)/)
    if (parent && nodeId != null) nodeParents.set(nodeId, Number(parent[1]))
  }
}
function withinTarget(id, targets) {
  const visited = new Set()
  while (id != null && !visited.has(id)) {
    if (targets.includes(id)) return true
    visited.add(id); id = nodeParents.get(id)
  }
  return false
}
for (const action of Object.values(character.actions)) for (const control of action.controls ?? []) {
  if (control.soundId === 999) {
    control.targets = stopEvidence.semantics.map(s => s.target)
    control.fadeMs = 50
    control.stopClipIds = Object.keys(catalog.clips).filter(id => evidence.clips[id].nodeIds?.some(node => withinTarget(node, control.targets)))
  }
}
evidence.controls = Object.entries(character.actions).flatMap(([actionId, a]) => (a.controls ?? []).map(c => ({ actionId: Number(actionId), ...c })))
write(catalogFile, catalog)
write(characterFile, character)
write(path.join(publicRoot, 'sources.json'), evidence)
const { syncVoices } = await import('./sync-sf6-voices.mjs')
syncVoices({ catalog: previousCatalog, sources: previousSources })
verify()
