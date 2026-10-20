/**
 * Recover the native SF6 CBFA -> FCE_ROM facial driver for the local review.
 * Does not run or modify SF6. Inputs are exact, hash-verified extracted members.
 *
 * node scripts/prepare-cinematic-face.mjs --source-root <previous research repo>
 *   --face-root <v3 extracted face directory> [--rea-root <REA extracted root>]
 * node scripts/prepare-cinematic-face.mjs --verify
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (key, fallback) => {
  const i = args.indexOf(key)
  if (i < 0) return fallback
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing ${key}`)
  return args[i + 1]
}
const sourceRoot = path.resolve(option('--source-root', process.env.SF6_CINEMATIC_SOURCE ?? repo))
const faceRoot = path.resolve(option('--face-root', path.join(repo, '.local/sf6-v3/face')))
const outputRoot = path.resolve(option('--output-root', path.join(repo, 'public/assets/jamie/cinematic')))
const reportRoot = path.resolve(option('--report-root', path.join(repo, 'research/sf6-cinematic-v3/face')))
const reaRoot = option('--rea-root', undefined)
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const check = (value, message) => { if (!value) throw new Error(message) }
const float = value => Number(value.toPrecision(8))
const vector = (bytes, offset, count) => Array.from({ length: count }, (_, i) => bytes.readFloatLE(offset + i * 4))
const uint64 = (bytes, offset) => Number(bytes.readBigUInt64LE(offset))

function wide(bytes, offset) {
  check(offset >= 0 && offset + 2 <= bytes.length, 'String pointer outside member')
  let end = offset
  while (end + 2 <= bytes.length && bytes.readUInt16LE(end)) end += 2
  check(end + 2 <= bytes.length, 'Unterminated native string')
  return bytes.subarray(offset, end).toString('utf16le')
}

function motions(bytes) {
  check(bytes.readUInt32LE(0) === 653 && bytes.toString('ascii', 4, 8) === 'mlst', 'Expected SF6 MOTLIST 653')
  const table = uint64(bytes, 16), idTable = uint64(bytes, 24), count = bytes.readUInt32LE(48)
  const result = []
  for (let slot = 0; slot < count; slot++) {
    const offset = uint64(bytes, table + slot * 8)
    if (!offset || bytes.toString('ascii', offset + 4, offset + 8) !== 'mot ') continue
    const b = bytes.subarray(offset)
    check(b.readUInt32LE(0) === 603, 'Expected SF6 MOT 603')
    result.push({ b, offset, slot, id: bytes.readUInt16LE(idTable + slot * 72 + 8), name: wide(b, uint64(b, 88)), frames: b.readFloatLE(96) })
  }
  return result
}

function bones(motion) {
  const { b } = motion, pointer = uint64(b, 16)
  check(pointer > 0, `Missing bone table in ${motion.name}`)
  const start = uint64(b, pointer), count = uint64(b, pointer + 8)
  check(count === b.readUInt16LE(112), 'Bone table/header counts differ')
  return Array.from({ length: count }, (_, i) => {
    const p = start + i * 80, parent = uint64(b, p + 8)
    return { name: wide(b, uint64(b, p)), hash: b.readUInt32LE(p + 68), parent: parent ? (parent - start) / 80 : -1,
      position: vector(b, p + 32, 3), quaternion: vector(b, p + 48, 4) }
  })
}

// SF6's sparse GPU-pose storage differs from the DMC5 GPU-motion format.
// The data header holds bone-pointer-array, bone count and pose-frame count.
// A bone row holds [pose-pointer-array, uint32 boneHash, padding]. Each pose is
// [uint32 TRS mask, float3 position, float4 quaternion, float3 scale, padding].
function gpuPoses(motion) {
  const { b } = motion, header = uint64(b, 56)
  check((b.readUInt32LE(124) & 2) !== 0 && header > 0, `${motion.name} is not a native GPU-pose motion`)
  const table = uint64(b, header), count = b.readUInt32LE(header + 8), frames = b.readUInt32LE(header + 12)
  check(frames === motion.frames + 1, 'GPU pose frame count differs from motion duration')
  const rows = []
  for (let i = 0; i < count; i++) {
    const row = uint64(b, table + i * 8), poses = uint64(b, row), hash = b.readUInt32LE(row + 8)
    const values = Array.from({ length: frames }, (_, frame) => {
      const p = uint64(b, poses + frame * 8), flags = b.readUInt32LE(p)
      check(flags === 1 || flags === 7, 'Unresolved native pose TRS mask')
      const value = { flags, position: vector(b, p + 4, 3), quaternion: flags & 2 ? vector(b, p + 16, 4) : [0, 0, 0, 1], scale: flags & 4 ? vector(b, p + 32, 3) : [1, 1, 1] }
      check([...value.position, ...value.quaternion, ...value.scale].every(Number.isFinite), 'Nonfinite native pose')
      check(Math.abs(Math.hypot(...value.quaternion) - 1) < 0.001, 'Native pose quaternion is not normalized')
      return value
    })
    rows.push({ hash, values })
  }
  return { frames, rows }
}

function cbfaCurves(motion, orderedHashes, scale, axis, controlByHash) {
  const { b } = motion, clipTable = uint64(b, 24), clipCount = b.readUInt16LE(114)
  const curves = new Map()
  for (let i = 0; i < clipCount; i++) {
    const clip = clipTable + i * 12, mask = b.readUInt16LE(clip + 2), hash = b.readUInt32LE(clip + 4), track = b.readUInt32LE(clip + 8)
    check((mask & 7) === 1, 'CBFA input has a nontranslation channel')
    const flags = b.readUInt32LE(track), count = b.readUInt32LE(track + 4), keyOffset = b.readUInt32LE(track + 8), dataOffset = b.readUInt32LE(track + 12)
    check((flags & 0xff000) === 0, 'Unresolved CBFA translation compression')
    const keyFormat = flags >>> 20
    check(keyFormat === 2 || keyFormat === 4 || keyFormat === 5, 'Unresolved CBFA key-time format')
    const stride = keyFormat === 2 ? 1 : keyFormat === 5 ? 4 : 2
    const keys = Array.from({ length: count }, (_, k) => keyOffset ? stride === 1 ? b.readUInt8(keyOffset + k) : stride === 2 ? b.readUInt16LE(keyOffset + k * 2) : b.readUInt32LE(keyOffset + k * 4) : 0)
    const values = Array.from({ length: count }, (_, k) => float(b.readFloatLE(dataOffset + k * 12 + axis * 4) * scale))
    check(keys.every((at, k) => k === 0 || at > keys[k - 1]), 'CBFA key times must increase')
    check(values.every(Number.isFinite), 'Nonfinite CBFA control')
    curves.set(hash, { name: controlByHash.get(hash)?.name, keys, values })
  }
  check(curves.size === orderedHashes.length && orderedHashes.every(hash => curves.has(hash)), 'CBFA control coverage differs from FastFacialBlend mapping')
  return orderedHashes.map(hash => curves.get(hash))
}

function nativeDriver(bytes) {
  const table = uint64(bytes, 16), count = bytes.readUInt32LE(48)
  for (let i = 0; i < count; i++) {
    const offset = uint64(bytes, table + i * 8)
    if (bytes.toString('ascii', offset + 4, offset + 8) !== 'mtre') continue
    const tree = bytes.subarray(offset)
    check(tree.readUInt32LE(0) === 19, 'Expected SF6 motion tree version 19')
    const nodeTable = uint64(tree, 32), nodes = tree.readUInt16LE(72)
    let typeOffset = nodeTable + nodes * 48
    const typeNames = []
    for (let n = 0; n < nodes; n++) {
      const end = tree.indexOf(0, typeOffset)
      typeNames.push(tree.toString('ascii', typeOffset, end)); typeOffset = end + 1
    }
    for (let n = 0; n < nodes; n++) {
      if (typeNames[n] !== 'FastFacialBlendNode') continue
      const node = nodeTable + n * 48, param = uint64(tree, node + 24)
      check(tree.readUInt32LE(param) === 13, 'Facial blend data is not ExtraData')
      const byteLength = tree.readUInt32LE(param + 4), bufferOffset = uint64(tree, param + 8), b = tree.subarray(bufferOffset, bufferOffset + byteLength)
      const controlCount = b.readUInt32LE(4), axis = b.readUInt32LE(8), scale = b.readFloatLE(12)
      check(byteLength === 40 + controlCount * 4 && controlCount === 210 && axis === 2 && scale === 100, 'Unexpected FastFacialBlend layout')
      return { name: 'FastFacialBlendNode', controlCount, input: 'translation', axis, scale,
        bankId: b.readUInt32LE(24), motionId: b.readUInt32LE(28), hashes: Array.from({ length: controlCount }, (_, k) => b.readUInt32LE(40 + k * 4)),
        treeOffset: offset, nodeOffset: offset + node, parameterOffset: offset + bufferOffset, parameterBytes: byteLength }
    }
  }
  throw new Error('Native FastFacialBlendNode not found')
}

function verify() {
  const manifest = readJson(path.join(reportRoot, 'manifest.json'))
  const bytes = fs.readFileSync(path.join(outputRoot, 'facial.json'))
  check(sha(bytes) === manifest.output.sha256 && bytes.length === manifest.output.bytes, 'Facial output identity changed')
  const data = JSON.parse(bytes)
  check(data.schemaVersion === 1 && data.driver.controlCount === 210 && data.bones.length === 148, 'Unexpected facial driver coverage')
  const glb = fs.readFileSync(path.join(outputRoot, 'jamie-native.glb'))
  const model = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)))
  check(data.bones.every(bone => model.nodes.some(node => node.name === bone.name)), 'Model no longer includes every native facial bone')
  for (const mode of ['SA3', 'CA']) {
    check(data.clips[mode].attacker.curves.length === 210, `${mode} controls missing`)
    const segments = data.clips[mode].defender.segments
    check(segments[0].from === 0 && segments.at(-1).to === data.clips[mode].bodyFrames, `${mode} victim timing incomplete`)
    check(segments.every((segment, i) => !i || segment.from === segments[i - 1].to), `${mode} victim timing has a gap`)
  }
  console.log(JSON.stringify({ verified: true, facialBones: data.bones.length, nativeControls: 210, sourcePoses: 210,
    SA3VictimSegments: data.clips.SA3.defender.segments.length, CAVictimSegments: data.clips.CA.defender.segments.length, outputSha256: sha(bytes) }))
}
if (args.includes('--verify')) { verify(); process.exit(0) }

const extractionPath = path.join(faceRoot, 'extraction.json')
const extraction = readJson(extractionPath)
const sourceIdentities = []
function extracted(resource) {
  const entry = extraction.entries.find(entry => entry.resource === resource)
  check(entry, `Missing named extraction: ${resource}`)
  const b = fs.readFileSync(path.join(faceRoot, resource))
  check(b.length === entry.bytes && sha(b) === entry.sha256, `Changed extracted member: ${resource}`)
  if (reaRoot) check(fs.readFileSync(path.join(reaRoot, resource)).equals(b), `REA member differs: ${resource}`)
  sourceIdentities.push({ resource, bytes: b.length, sha256: sha(b), archive: path.basename(entry.archive), entryIndex: entry.index,
    offset: entry.offset, packedSha256: entry.packedSha256, reaExtractedVerified: Boolean(reaRoot) })
  return b
}
const romResource = 'natives/stm/product/animation/esf/esf021/v00/motionlist/facial/esf021v00_rom.motlist.653'
const romBytes = extracted(romResource), rom = motions(romBytes).find(motion => motion.name === 'FCE_ROM')
check(rom, 'Native FCE_ROM missing')
const driver = nativeDriver(romBytes), romBones = bones(rom), boneByHash = new Map(romBones.map(bone => [bone.hash, bone]))
const poses = gpuPoses(rom)
check(poses.frames === driver.controlCount, 'ROM pose frames must match native CBFA control order')
const baseGlb = fs.readFileSync(path.join(outputRoot, 'jamie-native.glb'))
const model = JSON.parse(baseGlb.subarray(20, 20 + baseGlb.readUInt32LE(12)))
const nodes = new Map(model.nodes.map(node => [node.name, node]))
let nonIdentityPoses = 0
const missingBones = []
const facialBones = poses.rows.flatMap(row => {
  const bone = boneByHash.get(row.hash)
  check(bone, `Native facial pose bone hash is unnamed: ${row.hash}`)
  if (!nodes.has(bone.name)) { missingBones.push({ name: bone.name, hash: row.hash }); return [] }
  // FCE_ROM deliberately has a zero translation bind for the animated face:
  // its pose values are deltas, added to the actual head mesh bind positions.
  check(bone.position.every(value => Math.abs(value) < 1e-9), `ROM facial bone is not an additive offset: ${bone.name}`)
  check(bone.quaternion.every((value, i) => Math.abs(value - [0, 0, 0, 1][i]) < 1e-7), `ROM facial bone is not an additive rotation: ${bone.name}`)
  const deltas = []
  row.values.forEach((pose, index) => {
    const active = pose.position.some(value => Math.abs(value) > 1e-9) || pose.quaternion.slice(0, 3).some(value => Math.abs(value) > 1e-9)
      || pose.scale.some(value => Math.abs(value - 1) > 1e-9)
    if (!active) return
    deltas.push([index, ...pose.position.map(float), ...pose.quaternion.map(float), ...pose.scale.map(float)])
  })
  nonIdentityPoses += deltas.length
  return [{ name: bone.name, hash: bone.hash, deltas }]
})

const facialResource = 'natives/stm/product/animation/esf/esf021/v00/motionlist/facial/esf021v00_superarts_02.motlist.653'
const originalReport = readJson(path.join(sourceRoot, 'research/sf6-cinematic/extraction.json'))
const headResource = 'natives/stm/product/model/esf/esf021/000/00/esf021_000_00.mesh.230110883'
const headEntry = originalReport.entries.find(entry => entry.resource === headResource)
const headBytes = fs.readFileSync(path.join(sourceRoot, '.local/sf6-cinematic/extracted', headResource))
check(headEntry && sha(headBytes) === headEntry.sha256, 'Original head mesh member identity differs')
sourceIdentities.push({ resource: headResource, bytes: headBytes.length, sha256: sha(headBytes) })
const unboundSourceNames = missingBones.map(bone => ({ ...bone,
  asciiNameInSourceHead: headBytes.includes(Buffer.from(bone.name + '\0', 'utf8')),
  utf16NameInSourceHead: headBytes.includes(Buffer.from(bone.name + '\0', 'utf16le')) }))
const entry = originalReport.entries.find(entry => entry.resource === facialResource)
const facialBytes = fs.readFileSync(path.join(sourceRoot, '.local/sf6-cinematic/extracted', facialResource))
check(entry && sha(facialBytes) === entry.sha256, 'Original native cinematic facial member identity differs')
sourceIdentities.push({ resource: facialResource, bytes: facialBytes.length, sha256: sha(facialBytes) })
const facialMotions = motions(facialBytes), nativeControls = bones(facialMotions[0]), controlByHash = new Map(nativeControls.map(bone => [bone.hash, bone]))
driver.hashes.forEach((hash, index) => check(controlByHash.get(hash)?.name === `CBFA_${String(index).padStart(3, '0')}`, 'Native CBFA hash order differs'))
const damage = facialMotions.find(motion => motion.name === 'FCE_SCAD')
check(damage, 'Native victim facial poses missing')
const damagePoses = gpuPoses(damage), damageRows = new Map(damagePoses.rows.map(row => [row.hash, row.values]))
const actionPath = path.join(sourceRoot, '.local/sf6-cinematic/action-visual-keys.json'), actions = readJson(actionPath)
const clips = {}, usedDamagePoses = new Map()
for (const [mode, attackerId, defenderId, motionName, bodyFrames] of [
  ['SA3', 1212, 1213, 'FCE_SAA_GETUGASAIHOU', 438],
  ['CA', 1216, 1217, 'FCE_CAA_GETUGASAIHOU', 499],
]) {
  const attacker = actions.find(action => action.styleId === 0 && action.actionId === attackerId)
  const defender = actions.find(action => action.styleId === 0 && action.actionId === defenderId)
  check(attacker && defender, 'Original action audit missing')
  const motion = facialMotions.find(motion => motion.name === motionName)
  const cue = attacker.keys.find(key => key.type === 'CharacterAsset.FacialKey' && key.root?.fields.MotionType === 702)
  check(cue && cue.from === 0 && cue.root.fields.MotionStartFrame === 0, 'Unexpected original facial start time')
  check(cue.root.fields.MotionID === motion.id, 'Native action facial ID differs from MOTLIST ID')
  const segments = defender.keys.filter(key => key.type === 'CharacterAsset.FacialKey' && key.from < bodyFrames).map(key => {
    const fields = key.root.fields
    check(fields.MotionID === damage.id && fields.MotionStartFrame === fields.MotionEndFrame, 'Unresolved victim facial motion')
    const poseFrame = fields.MotionStartFrame
    check(poseFrame >= 0 && poseFrame < damagePoses.frames, 'Victim pose outside native data')
    if (!usedDamagePoses.has(poseFrame)) usedDamagePoses.set(poseFrame, driver.hashes.map(hash => {
      const pose = damageRows.get(hash)?.[poseFrame]
      check(pose, 'Native victim control missing')
      check(pose.position.every((value, i) => i === driver.axis || Math.abs(value) < 1e-9), 'Victim controls use an unresolved translation axis')
      return float(pose.position[driver.axis] * driver.scale)
    }))
    return { from: key.from, to: Math.min(key.to, bodyFrames), pose: poseFrame, sourceOffset: key.root.fieldFileOffsets?.MotionID }
  })
  clips[mode] = { bodyFrames, attacker: { actionId: attackerId, motionId: motion.id, sourceName: motion.name, sourceFrames: motion.frames,
      from: cue.from, to: cue.to, startFrame: cue.root.fields.MotionStartFrame, endFrame: cue.root.fields.MotionEndFrame,
      curves: cbfaCurves(motion, driver.hashes, driver.scale, driver.axis, controlByHash) },
    defender: { actionId: defenderId, sourceName: damage.name, motionId: damage.id, sourceFrames: damage.frames, segments } }
}
const data = { schemaVersion: 1, framesPerSecond: 60, driver: { name: driver.name, controlCount: driver.controlCount, input: driver.input, axis: driver.axis, scale: driver.scale },
  bones: facialBones, damagePoses: Object.fromEntries([...usedDamagePoses].sort((a, b) => a[0] - b[0])), clips,
  reconstruction: { poseSource: 'Original SF6 FCE_ROM sparse bone delta TRS', controlSource: 'Original SF6 CBFA MOT curves and FCE_SCAD poses',
    timingSource: 'Original CharacterAsset.FacialKey ranges and motion IDs',
    rotationBlend: 'Local additive quaternion composition in native control order',
    limitations: ['Native engine blend transitions and quaternion accumulation have not been compared against runtime; portable blending is deterministic.',
      ...unboundSourceNames.map(bone => `ROM bone ${bone.name} is absent from the preview skeleton and its name is absent from the source head mesh; this unbound ROM target is retained as an explicit coverage gap.`),
      'JCNS skin pose corrections and facial wrinkle shader are separate from the recovered bone animation.'] } }
fs.mkdirSync(outputRoot, { recursive: true }); fs.mkdirSync(reportRoot, { recursive: true })
const output = Buffer.from(JSON.stringify(data) + '\n')
fs.writeFileSync(path.join(outputRoot, 'facial.json'), output)
fs.writeFileSync(path.join(reportRoot, 'extraction.json'), JSON.stringify(extraction, null, 2) + '\n')
const manifest = { schemaVersion: 1, sources: sourceIdentities, actionAudit: { sha256: sha(fs.readFileSync(actionPath)), source: '.local/sf6-cinematic/action-visual-keys.json' },
  driver: { ...driver, controlHashOrderVerified: true }, coverage: { bindBones: romBones.length, sourceAnimatedBones: poses.rows.length, animatedBones: facialBones.length, missingBones: unboundSourceNames, controlCount: driver.controlCount, poseCount: poses.frames,
    nonIdentityBonePoses: nonIdentityPoses, victimNativePoses: damagePoses.frames, selectedVictimPoses: usedDamagePoses.size },
  parserReference: { url: 'https://github.com/kagenocookie/RE-Engine-Lib/blob/master/REE-Lib/RszFile/MotFile.cs', note: 'MOT header and bone layouts; SF6 sparse GPU-pose layout decoded from bounded native pointers and verified against the GLB bind skeleton.' },
  observations: ['ROM FastFacialBlendNode explicitly supplies 210 CBFA hashes, translation Z axis and 100 multiplier.',
    '148 of 149 animated native anatomical facial bones match the preview skeleton by name/hash; ROM zero translations and identity rotations establish additive TRS offsets.',
    'The 210 ROM pose frames align exactly with the ordered CBFA hashes.',
    'Victim facial state ranges and discrete SCAD frame selections are taken from the native action audit.'],
  limitations: data.reconstruction.limitations, output: { file: 'facial.json', bytes: output.length, sha256: sha(output) } }
fs.writeFileSync(path.join(reportRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ recovered: true, ...manifest.coverage, output: manifest.output }))
