/**
 * Decode the already extracted SF6 chain.52 and secondary MOT.603 assets.
 * node scripts/prepare-cinematic-physics.mjs --source-root <research repository>
 * Original game files are read only. This script never starts the game.
 * Layout references are pinned in the emitted provenance, not fetched at build time.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { inflateRawSync, zstdDecompressSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const option = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at < 0 ? fallback : process.argv[at + 1]
}
const sourceRoot = path.resolve(option('--source-root', 'C:/Users/ASUS/Desktop/fighting-arena'))
const out = path.join(repo, 'public/assets/jamie/cinematic/physics.json')
const research = path.join(repo, 'research/sf6-cinematic-v3/physics')
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n') }
const check = (ok, message) => { if (!ok) throw new Error(message) }
if (process.argv.includes('--verify')) {
  const data = read(out), manifest = read(path.join(repo, 'public/assets/jamie/cinematic/manifest.json'))
  const expected = manifest.outputs['physics.json']
  check(expected && expected.sha256 === sha(fs.readFileSync(out)), 'Physics output differs from finalized recovery manifest')
  check(data.version === 1 && data.fps === 60 && data.bones.length === 363, 'Unexpected native physics structure')
  check(data.chains.reduce((n, c) => n + c.groups.length, 0) === 93, 'Unexpected native chain count')
  console.log(JSON.stringify({ verified: true, groups: 93, bones: data.bones.length, fixedFps: 60 }))
  process.exit(0)
}
const u64 = (b, o) => Number(b.readBigUInt64LE(o))
const v3 = (b, o) => [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)]
const q4 = (b, o) => [...v3(b, o), b.readFloatLE(o + 12)]
const wstring = (b, o) => {
  check(o > 0 && o < b.length, `Invalid string offset ${o}`)
  let end = o
  while (end + 2 <= b.length && b.readUInt16LE(end) !== 0) end += 2
  return b.subarray(o, end).toString('utf16le')
}
function hashWide(name) {
  const b = Buffer.from(name, 'utf16le')
  let h = 0xffffffff
  const mix = k => {
    k = Math.imul(k, 0xcc9e2d51); k = k << 15 | k >>> 17
    return Math.imul(k, 0x1b873593)
  }
  let i = 0
  for (; i + 4 <= b.length; i += 4) {
    h ^= mix(b.readUInt32LE(i)); h = h << 13 | h >>> 19
    h = Math.imul(h, 5) + 0xe6546b64 | 0
  }
  let tail = 0
  for (let j = 0; i + j < b.length; j++) tail |= b[i + j] << (8 * j)
  if (i < b.length) h ^= mix(tail)
  h ^= b.length; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16
  return h >>> 0
}
const glb = fs.readFileSync(path.join(repo, 'public/assets/jamie/cinematic/jamie-native.glb'))
const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'))
const names = new Map(gltf.nodes.map((n, i) => [n.name, i]))
const hashes = new Map(gltf.nodes.map(n => [hashWide(n.name), n.name]))
check(hashWide('Root') === 0xf8dfd3bb, 'Unexpected native Murmur3 name-hash convention')
const parents = new Map()
gltf.nodes.forEach((n, i) => n.children?.forEach(c => parents.set(c, i)))
const rawSources = []
const getSource = entry => {
  const b = fs.readFileSync(path.join(sourceRoot, '.local/sf6-cinematic/extracted', entry.resource))
  check(b.length === entry.bytes && sha(b) === entry.sha256, `Changed extracted source: ${entry.resource}`)
  const fd = fs.openSync(entry.archive, 'r')
  try {
    const record = Buffer.alloc(48), packed = Buffer.alloc(entry.packedBytes)
    check(fs.readSync(fd, record, 0, 48, entry.entryOffset) === 48 && u64(record, 8) === entry.offset
      && u64(record, 16) === entry.packedBytes && u64(record, 24) === entry.bytes, 'Changed selected PAK index entry')
    check(fs.readSync(fd, packed, 0, packed.length, entry.offset) === packed.length && sha(packed) === entry.packedSha256, 'Changed selected PAK payload')
    const decoded = entry.compression === 2 ? zstdDecompressSync(packed) : entry.compression === 1 ? inflateRawSync(packed) : packed
    check(decoded.equals(b), 'Installed payload differs from extracted physics source')
  } finally { fs.closeSync(fd) }
  rawSources.push({ resource: entry.resource, bytes: b.length, sha256: sha(b), archive: path.basename(entry.archive),
    index: entry.index, offset: entry.offset, installedMemberVerified: true })
  return b
}
const fieldNames = ['damping', 'secondDamping', 'secondDampingSpeed', 'minDamping', 'secondMinDamping', 'dampingPow', 'secondDampingPow', 'collideMaxVelocity', 'springForce', 'springLimitRate', 'springMaxVelocity']
const extraNames = ['reduceSelfDistanceRate', 'secondReduceDistanceRate', 'secondReduceDistanceSpeed', 'friction', 'shockAbsorptionRate', 'coefOfElasticity', 'coefOfExternalForces', 'stretchInteractionRatio', 'angleLimitInteractionRatio', 'shootingElasticLimitRate']
function parseSettings(b, o) {
  return { id: b.readUInt32LE(o + 24), chainType: b[o + 28], settingsAttrFlags: b[o + 29],
    colliderFilterInfoPath: u64(b, o) ? wstring(b, u64(b, o)) : '', gravity: v3(b, o + 32), muzzleVelocity: v3(b, o + 44),
    ...Object.fromEntries(fieldNames.map((name, i) => [name, b.readFloatLE(o + 56 + i * 4)])),
    springCalcType: b[o + 100], motionForce: b.readFloatLE(o + 104),
    ...Object.fromEntries(extraNames.map((name, i) => [name, b.readFloatLE(o + 112 + i * 4)])),
    groupDefaultAttr: b.readUInt32LE(o + 152), windEffectCoef: b.readFloatLE(o + 156),
    velocityLimit: b.readFloatLE(o + 160), hardness: b.readFloatLE(o + 164),
    windDelaySpeed: b.readFloatLE(o + 168), envWindEffectCoef: b.readFloatLE(o + 172) }
}
function parseJiggle(b, o) {
  return { range: v3(b, o), rangeOffset: v3(b, o + 16), rangeAxis: q4(b, o + 32),
    rangeShape: b.readUInt32LE(o + 48), springForce: b.readFloatLE(o + 52), gravityCoef: b.readFloatLE(o + 56),
    damping: b.readFloatLE(o + 60), attrFlags: b.readUInt32LE(o + 64) }
}
function parseNode(b, o, bone) {
  const jiggleOffset = u64(b, o + 64)
  return { bone, angleLimitDirection: q4(b, o), angleLimitRad: b.readFloatLE(o + 16),
    angleLimitDistance: b.readFloatLE(o + 20), angleLimitRestitution: b.readFloatLE(o + 24),
    angleLimitRestituteStopSpeed: b.readFloatLE(o + 28), collisionRadius: b.readFloatLE(o + 32),
    collisionFilterFlags: b.readInt32LE(o + 36), capsuleStretchRate: [b.readFloatLE(o + 40), b.readFloatLE(o + 44)],
    attrFlags: b.readUInt32LE(o + 48), constraintJointHash: b.readUInt32LE(o + 52), windCoef: b.readFloatLE(o + 56),
    angleMode: b[o + 60], collisionShape: b[o + 61], attachType: b[o + 62], rotationType: b[o + 63],
    gravityCoef: b.readFloatLE(o + 72), jiggle: jiggleOffset ? parseJiggle(b, jiggleOffset) : null }
}
function parseChain(entry) {
  const b = getSource(entry)
  check(b.readUInt32LE(0) === 52 && b.toString('ascii', 4, 8) === 'chan', 'Expected native chain version 52')
  const header = { version: 52, settingsOffset: u64(b, 56), collisionOffset: u64(b, 24), groupOffset: u64(b, 40),
    linkOffset: u64(b, 48), windOffset: u64(b, 64), groupCount: b[72], settingCount: b[73],
    collisionCount: b[74], windCount: b[75], linkCount: b[76], defaultSettingIdx: b[78],
    calculateMode: b[79], calculateStepTime: b.readFloatLE(88) }
  const settings = Array.from({ length: header.settingCount }, (_, i) => parseSettings(b, header.settingsOffset + i * 176))
  const groups = Array.from({ length: header.groupCount }, (_, i) => {
    const o = header.groupOffset + i * 120
    const tail = wstring(b, u64(b, o)), nodeOffset = u64(b, o + 8), count = b[o + 20]
    const bones = []
    let bone = names.get(tail)
    for (let n = 0; n < count; n++) {
      check(bone !== undefined, `Cannot map native chain ancestry: ${tail}`)
      bones.unshift(gltf.nodes[bone].name); bone = parents.get(bone)
    }
    const settingId = b.readInt32LE(o + 16)
    const resolved = settings.find(s => s.id === settingId) ?? settings[header.defaultSettingIdx]
    check(resolved, `No native setting or default for ${tail}`)
    return { id: `${path.basename(entry.resource)}:${i}`, tail, settingId, resolvedSettingId: resolved.id,
      settingFallback: !settings.some(s => s.id === settingId), terminateNodeNameHash: b.readUInt32LE(o + 24),
      attrFlags: b.readInt32LE(o + 28), collisionFilterFlags: b.readInt32LE(o + 32),
      extraNodeLocalPos: v3(b, o + 36), angleLimitDirectionMode: b[o + 93],
      nodes: bones.map((name, n) => parseNode(b, nodeOffset + n * 80, name)) }
  })
  const collisions = Array.from({ length: header.collisionCount }, (_, i) => {
    const o = header.collisionOffset + i * 80, jointHash = b.readUInt32LE(o + 52), pairJointHash = b.readUInt32LE(o + 56)
    return { jointHash, pairJointHash, bone: hashes.get(jointHash) ?? null,
      pairBone: pairJointHash ? hashes.get(pairJointHash) ?? null : hashes.get(jointHash) ?? null,
      offset: v3(b, o + 8), pairOffset: v3(b, o + 20), rotation: q4(b, o + 32),
      rotationOrder: b.readUInt32LE(o + 48), radius: b.readFloatLE(o + 60), endRadius: b.readFloatLE(o + 64),
      lerp: b.readFloatLE(o + 68), shape: b[o + 72], collisionFilterFlags: b.readInt32LE(o + 76) }
  })
  const links = Array.from({ length: header.linkCount }, (_, i) => {
    const o = header.linkOffset + i * 32, a = b.readUInt32LE(o + 8), c = b.readUInt32LE(o + 12)
    return { groupA: groups.find(g => g.terminateNodeNameHash === a)?.id ?? null,
      groupB: groups.find(g => g.terminateNodeNameHash === c)?.id ?? null,
      distanceShrinkLimitCoef: b.readFloatLE(o + 16), distanceExpandLimitCoef: b.readFloatLE(o + 20),
      linkMode: b[o + 24], connectFlags: b[o + 25], linkAttrFlags: b.readUInt16LE(o + 26),
      nodeCount: b[o + 28], skipGroupA: b[o + 29], skipGroupB: b[o + 30] }
  })
  // Wind has no recovered scene activation/timing. Preserve the original record
  // identity without inventing a sine-wave force or random environmental gusts.
  const wind = { bytes: header.windCount * 184, sha256: sha(b.subarray(header.windOffset, header.windOffset + header.windCount * 184)), active: false }
  return { source: entry.resource, sha256: entry.sha256, header, settings, groups, collisions, links, wind }
}
function parseTrack(b, o, kind) {
  const flags = b.readUInt32LE(o), count = b.readUInt32LE(o + 4)
  const indexOffset = b.readUInt32LE(o + 8), dataOffset = b.readUInt32LE(o + 12), unpackOffset = b.readUInt32LE(o + 16)
  const keyType = flags >>> 20 & 0xf, compression = flags & 0xff000
  const width = ({ 2: 1, 4: 2, 5: 4 })[keyType]
  check(width || !indexOffset, `Unsupported native MOT key type ${keyType}`)
  const keys = Array.from({ length: count }, (_, n) => indexOffset ? b.readUIntLE(indexOffset + n * width, width) : 0)
  const unpack = unpackOffset ? Array.from({ length: 8 }, (_, n) => b.readFloatLE(unpackOffset + n * 4)) : []
  let cursor = dataOffset
  const unpackBits = bits => {
    const bytes = Math.ceil(bits * 3 / 8)
    let packed = 0n
    for (let n = 0; n < bytes; n++) packed |= BigInt(b[cursor++]) << BigInt(n * 8)
    const mask = (1n << BigInt(bits)) - 1n
    return [0, 1, 2].map(n => Number(packed >> BigInt(n * bits) & mask) / Number(mask))
  }
  const values = Array.from({ length: count }, () => {
    let xyz
    if (compression === 0 || (kind === 'quaternion' && compression === 0xc0000)) {
      xyz = v3(b, cursor); cursor += 12
    } else if (kind === 'quaternion' && [0x20000, 0x30000, 0x40000, 0x50000, 0x60000, 0x70000].includes(compression)) {
      const bits = ({ 0x20000: 5, 0x30000: 8, 0x40000: 10, 0x50000: 13, 0x60000: 16, 0x70000: 18 })[compression]
      const packed = unpackBits(bits)
      xyz = packed.map((v, axis) => v * unpack[axis] + unpack[axis + 4])
    } else if (kind === 'position' && compression === 0x40000) {
      xyz = unpackBits(10).map((v, axis) => v * unpack[axis] + unpack[axis + 3])
    } else throw new Error(`Unsupported MOT ${kind} compression 0x${compression.toString(16)}`)
    if (kind !== 'quaternion') return xyz
    if (compression === 0) { const w = b.readFloatLE(cursor); cursor += 4; return [...xyz, w] }
    return [...xyz, Math.sqrt(Math.max(0, 1 - xyz.reduce((s, v) => s + v * v, 0)))]
  })
  return { kind, flags: `0x${flags.toString(16)}`, offset: o, keys, values }
}
function parseSecondary(entry) {
  const b = getSource(entry)
  check(b.readUInt32LE(0) === 603 && b.toString('ascii', 4, 8) === 'mot ', 'Expected native secondary MOT 603')
  const base = u64(b, 16), boneOffset = u64(b, base), boneCount = u64(b, base + 8)
  const bones = Array.from({ length: boneCount }, (_, i) => {
    const o = boneOffset + i * 80
    return { name: wstring(b, u64(b, o)), hash: b.readUInt32LE(o + 68),
      parentIndex: u64(b, o + 8) ? (u64(b, o + 8) - boneOffset) / 80 : null,
      position: v3(b, o + 32), quaternion: q4(b, o + 48) }
  })
  const tracks = Array.from({ length: b.readUInt16LE(114) }, (_, i) => {
    const o = u64(b, 24) + i * 12, hash = b.readUInt32LE(o + 4), flags = b[o + 2]
    const name = bones.find(n => n.hash === hash)?.name
    check(name, 'Unknown secondary MOT bone hash')
    let cursor = b.readUInt32LE(o + 8)
    const properties = []
    for (const [mask, kind] of [[1, 'position'], [2, 'quaternion'], [4, 'scale']]) if (flags & mask) {
      properties.push(parseTrack(b, cursor, kind)); cursor += 20
    }
    return { bone: name, bindsCurrentSkeleton: names.has(name), properties }
  })
  return { resource: entry.resource, sha256: entry.sha256, name: wstring(b, u64(b, 88)),
    frameCount: b.readFloatLE(96), fps: b.readUInt16LE(120), bones, tracks }
}

const chainManifest = read(path.join(sourceRoot, 'research/sf6-cinematic/rig-extraction.json'))
const secondaryManifest = read(path.join(sourceRoot, 'research/sf6-cinematic/secondary-extraction.json'))
const chains = chainManifest.entries.filter(e => e.resource.endsWith('.chain.52')).map(parseChain)
const secondary = secondaryManifest.entries.map(parseSecondary)
const boneNames = [...new Set(chains.flatMap(c => c.groups.flatMap(g => g.nodes.map(n => n.bone))))]
const data = {
  version: 1, fps: 60, units: { position: 'native model units, treated as metres by the review solver', gravity: 'native chain XYZ, treated as metres per second squared', angles: 'radians', damping: 'native coefficient, interpreted per 1/60 second step' },
  solver: { type: 'Verlet particles with length, rest-cone, tapered-capsule, jiggle-range and chain-link constraints',
    fixedStepSeconds: 1 / 60, warmupFrames: 180, iterations: 6, windEnabled: false },
  bones: boneNames.map(name => {
    const n = gltf.nodes[names.get(name)]
    return { name, position: n.translation ?? [0, 0, 0], quaternion: n.rotation ?? [0, 0, 0, 1], scale: n.scale ?? [1, 1, 1] }
  }), chains,
  secondaryMotions: secondary.map(s => ({ resource: s.resource, sha256: s.sha256, fps: s.fps, frames: s.frameCount,
    animatedBones: s.tracks.map(t => t.bone), bindableTracks: s.tracks.filter(t => t.bindsCurrentSkeleton).length,
    hairTracks: s.tracks.filter(t => /hair/i.test(t.bone)).length, active: false,
    reason: 'No animated bone binds the current costume skeleton; source segment-to-cinematic timing is also not recovered. The curves are retained in the research audit.' })),
  provenance: { sourceGlbSha256: sha(glb), nativeSources: rawSources,
    layoutReferences: [
      { url: 'https://github.com/NSACloud/RE-Chain-Editor/blob/54ed5d41a6360511b4b314c80e9b459032b32688/modules/file_re_chain.py', commit: '54ed5d41a6360511b4b314c80e9b459032b32688' },
      { url: 'https://github.com/kagenocookie/RE-Engine-Lib/blob/867daf1b0361a67e24bc82ef1391e01cc33d524a/REE-Lib/RszFile/MotFile.cs', commit: '867daf1b0361a67e24bc82ef1391e01cc33d524a' },
    ] },
  limitations: [
    'Original chain parameters, node membership, and collider bindings are parsed; this browser solver is an approximation, not the recovered RE Engine solver.',
    'Native angleLimitRad is enforced around the exported rest geometry. Raw angleLimitDirection is retained, but its engine cone-frame and anisotropic angle modes are not reproduced exactly.',
    'Jiggle range and link coefficients are interpreted by the review solver; engine attach/rotation modes, second damping, damping powers, and full filter semantics remain unresolved.',
    'Wind records have no recovered activation timeline and are disabled. No sine-wave or random force is substituted.',
    'Missing collider bone hashes are retained and excluded from collision, rather than attached to an invented body bone.',
    'The separate hand gourd chain references setting ID 1 although only ID 0 exists in its file; the header default setting index 0 is the explicit review fallback.',
    'The six fourth-named secondary MOT clips have real cloth keys but no corresponding animated bones in the current skeleton, and no Hair tracks. They are not retargeted or stretched; the filename alone does not establish their costume or activation.',
  ],
}
check(data.secondaryMotions.every(s => s.bindableTracks === 0 && s.hairTracks === 0), 'Revisit secondary MOT binding before shipping this audit')
write(out, data)
write(path.join(research, 'secondary-motion-audit.json'), { sourceFiles: rawSources.filter(s => s.resource.endsWith('.mot.603')), motions: secondary })
write(path.join(research, 'physics-audit.json'), { sourceGlbSha256: sha(glb), outputSha256: sha(fs.readFileSync(out)),
  groups: chains.map(c => ({ source: c.source, groups: c.groups.length, nodes: c.groups.reduce((sum, g) => sum + g.nodes.length, 0),
    colliders: c.collisions.length, boundColliders: c.collisions.filter(c => c.bone && c.pairBone).length,
    unmappedColliders: c.collisions.filter(c => !c.bone || !c.pairBone), settingsFallbacks: c.groups.filter(g => g.settingFallback).map(g => g.tail) })),
  mappedBones: boneNames.length, rawSources, limitations: data.limitations })
console.log(JSON.stringify({ output: path.relative(repo, out), bytes: fs.statSync(out).size,
  groups: chains.reduce((s, c) => s + c.groups.length, 0), nodes: chains.reduce((s, c) => s + c.groups.reduce((a, g) => a + g.nodes.length, 0), 0),
  mappedBones: boneNames.length, boundColliders: chains.reduce((s, c) => s + c.collisions.filter(c => c.bone && c.pairBone).length, 0), secondaryMotions: secondary.length }))
