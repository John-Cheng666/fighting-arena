/** Copy reviewed voices, never render or re-encode them. Ordinary builds only use public assets. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(process.env.SF6_AUDIO_RESEARCH ?? path.join(repo, 'research/sf6-audio'))
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
const publicRoot = path.join(repo, 'public/assets/audio')
const catalogFile = path.join(repo, 'src/content/audio/catalog.json')
const characterFile = path.join(repo, 'src/characters/jamie/data/audio.json')
const sourcesFile = path.join(publicRoot, 'sources.json')

export function syncVoices(previous = {}) {
  const selectedFile = path.join(root, 'voice-review-v1/selected-manifest.json')
  const routingFile = path.join(root, 'voice-review-v1/routing-spec.json')
  const approvalFile = path.join(root, 'voice-review-v1/approval.json')
  const selection = read(selectedFile), routing = read(routingFile), approval = read(approvalFile)
  if (selection.sourceReviewSha256 !== approval.inputSha256 || routing.sourceReviewSha256 !== approval.inputSha256 || approval.counts.pending || approval.counts.adjust)
    throw new Error('Voice review ancestry or decisions are incomplete')
  const catalog = read(catalogFile), character = read(characterFile), sources = read(sourcesFile)
  const rejected = new Set(approval.rejected.map(e => e.sha256)), accepted = new Map(approval.accepted.map(e => [e.id, e.sha256]))
  const selectedAudio = entry => {
    const portable = path.join(root, 'voice-review-v1/reviewed', approval.inputSha256, 'audio', entry.id + '.ogg')
    return fs.existsSync(portable) ? portable : entry.ogg
  }
  for (const entry of selection.entries) {
    if (!/^voice-ja-[0-9a-f]{18}$/.test(entry.id)) throw new Error('Unexpected reviewed voice asset ID ' + entry.id)
    if (accepted.get(entry.id) !== entry.sha256 || rejected.has(entry.sha256) || hash(selectedAudio(entry)) !== entry.sha256)
      throw new Error('Unapproved or changed voice ' + entry.id)
  }
  const protectedClips = new Set([
    ...Object.values(catalog.bgm).flatMap(t => Object.values(t)), ...Object.values(catalog.feedback).flat(),
    ...Object.values(character.actions).flatMap(a => a.cues.filter(c => c.kind === 'se').map(c => c.clipId)),
    ...Object.values(character.contacts).flatMap(c => [...c.normal, ...(c.guard ?? []), ...(c.counter ?? []), ...(c.punish ?? [])]),
  ])
  const legacy = new Set([...(character.voice?.light ?? []), ...(character.voice?.damage ?? [])])
  for (const [id, provenance] of Object.entries({ ...(previous.sources?.clips ?? {}), ...sources.clips })) {
    if (!(legacy.has(id) || rejected.has(provenance.sha256) || provenance.voiceReview?.character === 'jamie')) continue
    if (protectedClips.has(id)) throw new Error('Voice retirement conflicts with an effect/music reference ' + id)
    const clip = catalog.clips[id] ?? previous.catalog?.clips[id]
    if (clip) {
      const file = path.resolve(repo, 'public', clip.url)
      if (!file.startsWith(publicRoot + path.sep)) throw new Error('Voice path escapes generated audio folder')
      if (fs.existsSync(file) && hash(file) !== provenance.sha256) throw new Error('Refusing to retire modified generated audio ' + id)
      // One exact, hash-verified generator-owned file; never a recursive cleanup.
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
    delete catalog.clips[id]; delete sources.clips[id]
  }
  const clipIds = new Map()
  for (const entry of selection.entries) {
    const id = 'jamie-' + entry.id, filename = id + '.ogg', destination = path.join(publicRoot, filename)
    fs.copyFileSync(selectedAudio(entry), destination)
    catalog.clips[id] = { url: 'assets/audio/' + filename, seconds: entry.seconds, frames: entry.frames, sampleRate: entry.sampleRate, channels: entry.channels }
    sources.clips[id] = { sha256: entry.sha256, sourcePcmSha256: entry.sourcePcmSha256, sourceFrames: entry.frames, sampleRate: entry.sampleRate, channels: entry.channels,
      voiceReview: { character: 'jamie', assetId: entry.id, decision: 'keep', reviewSha256: approval.inputSha256 }, eventIds: entry.eventIds, voiceIds: entry.voiceIds }
    clipIds.set(entry.id, id)
  }
  const combat = read(path.join(root, 'voice-review-v1-combat-agent/findings.json'))
  const voice = { language: selection.language, requests: {}, scenes: {}, victory: [], ko: { normal: 692, finish: 693, launched: 690, finishLaunched: 691, down: 694, finishDown: 695 } }
  for (const entry of selection.entries) for (const use of entry.uses) {
    if (use.voiceId == null) continue
    const p = use.triggerParameters ?? {}, value = (a, b, fallback) => p[a] ?? p[b] ?? fallback
    const graph = combat.byEvent.find(e => e.eventIdJa === use.eventId)?.bankGraph
    const request = voice.requests[use.voiceId] ??= { clips: [], randomGroup: graph?.randomContainers?.[0]?.nodeId ?? use.eventId, priority: value('_Priority', 'priority', 50), prioritizeFirst: value('_PrioritizeFirst', 'prioritizeFirst', false),
      skipRate: value('_SkipRate', 'skipRate', 0), limit: value('_Limit', 'limit', 1), releaseMs: value('_ReleaseTime', 'releaseTime', 50),
      avoidRepeat: Math.max(0, ...(graph?.randomContainers ?? []).map(c => c.avoidRepeatCount ?? 0)) }
    const clip = clipIds.get(entry.id); if (!request.clips.includes(clip)) request.clips.push(clip)
  }
  for (const rule of routing.rules) {
    const clip = clipIds.get(rule.assetId)
    if (!clip) throw new Error('Scene references excluded voice ' + rule.id)
    voice.scenes[rule.id] = [clip]
    if (rule.winnerHpRatio) voice.victory.push({ scene: rule.id, min: rule.winnerHpRatio.min, max: rule.winnerHpRatio.max, maxInclusive: rule.winnerHpRatio.maxInclusive })
  }
  for (const blocked of routing.blockedVoiceIds) if (voice.requests[blocked]) throw new Error('Rejected voice request survived ' + blocked)
  catalog.voices ??= {}; catalog.voices.jamie = voice
  character.voice = { light: [], damage: [] }
  for (const action of Object.values(character.actions)) delete action.voiceCues
  const links = read(path.join(root, 'action-sound-links.json'))
  let cues = 0
  for (const action of links.actions) {
    const keys = action.keys.filter(k => k.type === 'CharacterAsset.VoiceKey' && voice.requests[k.values.SoundID])
    if (!keys.length) continue
    const target = character.actions[action.actionId] ??= { cues: [] }
    target.voiceCues ??= {}
    target.voiceCues[action.styleId] = keys.map(k => ({ frame: k.from, voiceId: k.values.SoundID, stopMode: k.values.StopMode, stopWithAction: k.values.StopMode === 3,
      afterBranch: k.values.AfterBranch, onlyOnce: k.values.OnlyOnce, inBattle: k.values.InBattle })).sort((a, b) => a.frame - b.frame)
    cues += keys.length
  }
  for (const [id, contact] of Object.entries(character.contacts)) {
    const table = sources.contactTables[id]?.find(v => v.IndexID === 0) ?? sources.contactTables[id]?.[0]
    if (table && voice.requests[table.Voice]) contact.voiceId = table.Voice
    else delete contact.voiceId
  }
  sources.voiceApproval = { reviewSha256: approval.inputSha256, selectedManifestSha256: hash(selectedFile), routingSha256: hash(routingFile), approvedClips: selection.entries.length,
    rejectedClips: approval.rejected.length, blockedRequestIds: routing.blockedVoiceIds, rejectedSha256: [...rejected], supersedesOlderApprovals: routing.supersedesOlderApprovals,
    engineeringAuthorization: 'User requested project implementation and reusable character documentation in this conversation.', nativeRuntimeVoiceVerified: false }
  sources.limitations = sources.limitations.filter(s => !s.includes('Unreviewed JP move voice'))
  const limitation = 'Voice skip probability, actor-level arbitration and scene timing are project adaptations of static source metadata, not verified original-game runtime behavior.'
  if (!sources.limitations.includes(limitation)) sources.limitations.push(limitation)
  sources.coverage.voiceClips = selection.entries.length; sources.coverage.voiceRequests = Object.keys(voice.requests).length; sources.coverage.voiceCues = cues
  write(catalogFile, catalog); write(characterFile, character); write(sourcesFile, sources)
  console.log(JSON.stringify({ approvedVoiceClips: selection.entries.length, requests: Object.keys(voice.requests).length, authoredVoiceCues: cues, rejected: approval.rejected.length }))
}
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) syncVoices()
