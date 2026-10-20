/** Build the independent review track from the approved, shipped SF6 audio only. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = name => JSON.parse(fs.readFileSync(path.join(repo, name), 'utf8'))
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const characterFile = 'src/characters/jamie/data/audio.json'
const numericsFile = 'src/characters/jamie/data/native-numerics.json'
const catalogFile = 'src/content/audio/catalog.json'
const sourcesFile = 'public/assets/audio/sources.json'
const character = read(characterFile), numerics = read(numericsFile)
const catalog = read(catalogFile), sources = read(sourcesFile)
if (!sources.voiceApproval || catalog.voices?.jamie?.language !== 'ja') {
  throw new Error('The approved original Japanese Jamie voice catalog is required')
}

const clips = {}, voiceRequests = {}, tracks = {}
for (const [mode, rowId, bodyFrames] of [['SA3', 89, 438], ['CA', 90, 499]]) {
  const native = numerics.rows.find(row => row.row === rowId)?.captured
  if (!native) throw new Error(`Missing original capture row ${rowId}`)
  const attackerAction = native.actionId, defenderAction = attackerAction + 1
  const cues = [], excludedAfterBody = []
  for (const [actor, actionId] of [['attacker', attackerAction], ['defender', defenderAction]]) {
    const action = character.actions[actionId]
    if (!action) throw new Error(`Missing authored audio action ${actionId}`)
    for (const [index, cue] of action.cues.entries()) {
      const value = { id: `${actionId}:se:${index}`, frame: cue.frame, actor, channel: 'sfx', clipId: cue.clipId,
        source: { kind: 'SEKey', actionId, soundId: cue.soundId } }
      ;(cue.frame <= bodyFrames ? cues : excludedAfterBody).push(value)
    }
    for (const [index, cue] of (action.voiceCues?.[0] ?? []).entries()) {
      const value = { id: `${actionId}:voice:${index}`, frame: cue.frame, actor, channel: 'voice', voiceId: cue.voiceId,
        source: { kind: 'VoiceKey', actionId, voiceId: cue.voiceId } }
      ;(cue.frame <= bodyFrames ? cues : excludedAfterBody).push(value)
    }
  }
  const contacts = native.hits.map(hit => ({ frame: hit.from, attackId: hit.attackId, damage: hit.damage }))
  for (const [index, hit] of contacts.entries()) {
    if (hit.frame > bodyFrames || hit.damage <= 0) continue
    const profile = character.contacts[hit.attackId]
    // These capture attacks have Type.AUTO with empty contact-SE tables. Their
    // frame-1 SEKeys already start complete multi-source Wwise compositions.
    // Preserve any explicitly mapped contact sound; never invent another hit layer.
    for (const [sound, clipId] of (profile?.normal ?? []).entries()) cues.push({
      id: `${attackerAction}:contact-se:${index}:${sound}`, frame: hit.frame, actor: 'attacker', channel: 'sfx', clipId,
      source: { kind: 'contact', actionId: attackerAction, attackId: hit.attackId },
    })
    // Match the existing combat audio's original request routing: AUTO damage
    // without a dedicated VoiceID requests Jamie's approved 600 damage group.
    const voiceId = profile?.voiceId ?? 600
    cues.push({ id: `${defenderAction}:damage:${index}`, frame: hit.frame, actor: 'defender', channel: 'voice', voiceId,
      source: { kind: 'contact-voice', actionId: defenderAction, attackId: hit.attackId, voiceId } })
  }
  cues.sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id))
  const unique = cues.filter((cue, index) => !cues.slice(0, index).some(prior => prior.frame === cue.frame
    && prior.actor === cue.actor && prior.channel === cue.channel && prior.clipId === cue.clipId && prior.voiceId === cue.voiceId))
  for (const cue of unique) {
    if (cue.channel === 'voice') {
      const request = catalog.voices.jamie.requests[cue.voiceId]
      if (!request?.clips.length) throw new Error(`Unmapped approved Japanese voice ${cue.voiceId}`)
      if (request.skipRate !== 0 || request.limit !== 1) throw new Error(`Unexpected cinematic request policy ${cue.voiceId}`)
      voiceRequests[cue.voiceId] = request
    }
    for (const clipId of cue.clipId ? [cue.clipId] : voiceRequests[cue.voiceId].clips) {
      const clip = catalog.clips[clipId], source = sources.clips[clipId]
      if (!clip || !source) throw new Error(`Missing approved audio ${clipId}`)
      const local = path.join(repo, 'public', clip.url)
      if (hash(fs.readFileSync(local)) !== source.sha256) throw new Error(`Audio hash mismatch: ${clipId}`)
      clips[clipId] = { ...clip, url: `/${clip.url}`, sha256: source.sha256 }
    }
  }
  const compositions = unique.filter(cue => cue.channel === 'sfx' && cue.actor === 'attacker' && cue.frame === 1)
    .map(cue => {
      const source = sources.clips[cue.clipId]
      if (!source.initialDelayPreserved || source.media.length < 2 || source.nodeIds.length < 2) {
        throw new Error(`Expected the complete original multi-source event: ${cue.clipId}`)
      }
      return { clipId: cue.clipId, soundId: cue.source.soundId, eventId: source.eventId,
        seconds: clips[cue.clipId].seconds, mediaCount: source.media.length, nodeCount: source.nodeIds.length,
        initialDelayPreserved: true, txtpSha256: source.txtpSha256 }
    })
  tracks[mode] = { attackerAction, defenderAction, bodyFrames, tailFrames: 15, frameCount: bodyFrames + 15,
    cues: unique, contacts, compositions, excludedAfterBody }
}

const ordered = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
const manifest = { schemaVersion: 1, framesPerSecond: 60, language: 'ja', clips: ordered(clips), voiceRequests, tracks,
  source: { inputs: Object.fromEntries([characterFile, numericsFile, catalogFile, sourcesFile].map(file =>
    [file, hash(fs.readFileSync(path.join(repo, file)))])), audioApproval: sources.approval, voiceApproval: sources.voiceApproval,
    contactVoiceRouting: 'Original contact VoiceID, or request 600 as in src/characters/jamie/audio.ts; deterministic variants and per-actor native priority arbitration.',
    compositions: 'The two frame-1 SEKeys start complete Wwise event renders with original initial delays; no guessed extra impact layer.' },
  limitations: [
    'This deterministic review uses shipped, approved original audio; Wwise runtime DSP, RTPC and bus ducking are not reproduced.',
    'Captured contacts drive original Jamie damage requests. Random damage variants use a repeatable review sequence, not the game runtime RNG.',
    'Japanese voices always play at their original sample rate and pitch. Non-1x review changes request spacing and can interrupt a line according to the original priority policy.',
    'SE compositions follow review speed. Exact authored sound and motion timing is evaluated at 1x.',
    'The 15-frame frozen-picture tail completes the final in-body voice. Cues beginning after the original body range are excluded, including recovery lines 21339 and 21349.',
  ] }
const output = path.join(repo, 'public/assets/jamie/cinematic/audio.json')
const serialized = JSON.stringify(manifest, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== serialized) throw new Error('Cinematic audio manifest is stale')
} else {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, serialized)
}
console.log(JSON.stringify({ clips: Object.keys(clips).length,
  tracks: Object.fromEntries(Object.entries(tracks).map(([mode, track]) => [mode, {
    bodyFrames: track.bodyFrames, tailFrames: track.tailFrames, cues: track.cues.length, contacts: track.contacts.length,
  }])), verified: true }))
