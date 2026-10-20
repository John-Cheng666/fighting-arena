/**
 * Assemble a local SF6 review sample from the already extracted research.
 * Requires Node 24+ for native zstd decompression. Never starts the game.
 *
 * node scripts/prepare-sf6-cinematic.mjs --source-root <research repository>
 *   --rea-root <directory returned by REA extract_artifact>
 * node scripts/prepare-sf6-cinematic.mjs --verify
 *
 * The source installation is checked by index and selected payload ranges, not
 * by reading or hashing the complete 90 GB archive. Normal builds need neither
 * the installation nor the private extracted research.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { inflateRawSync, zstdDecompressSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`)
  return args[index + 1]
}
const sourceRoot = path.resolve(option('--source-root', process.env.SF6_CINEMATIC_SOURCE ?? repo))
const reaRootOption = option('--rea-root', process.env.SF6_CINEMATIC_REA_ROOT)
const reaRoot = reaRootOption ? path.resolve(reaRootOption) : null
const outputRoot = path.resolve(option('--output-root', path.join(repo, 'public/assets/jamie/cinematic')))
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const local = relative => path.join(sourceRoot, relative)
const normalizeMesh = name => name.toLowerCase().replace(/_sub_?(\d+)/g, '_sub$1')
const relativeSource = file => path.relative(sourceRoot, file).replaceAll('\\', '/')
const resolveResearchPath = file => {
  const marker = file.replaceAll('\\', '/').indexOf('/.local/')
  return marker >= 0 ? local(file.replaceAll('\\', '/').slice(marker + 1)) : path.resolve(sourceRoot, file)
}

function parseGlb(bytes) {
  check(bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2, 'Expected glTF 2.0 binary')
  check(bytes.readUInt32LE(8) === bytes.length, 'GLB length differs from header')
  check(bytes.readUInt32LE(16) === 0x4e4f534a, 'Missing JSON chunk')
  const jsonLength = bytes.readUInt32LE(12)
  const binHeader = 20 + jsonLength
  check(bytes.readUInt32LE(binHeader + 4) === 0x004e4942, 'Missing binary chunk')
  const binLength = bytes.readUInt32LE(binHeader)
  check(binHeader + 8 + binLength === bytes.length, 'Unexpected GLB chunks')
  return { json: JSON.parse(bytes.subarray(20, binHeader).toString('utf8')), binary: bytes.subarray(binHeader + 8) }
}

function encodeGlb(json, binary) {
  const sourceJson = Buffer.from(JSON.stringify(json))
  const jsonChunk = Buffer.alloc(Math.ceil(sourceJson.length / 4) * 4, 0x20)
  sourceJson.copy(jsonChunk)
  const binaryChunk = Buffer.alloc(Math.ceil(binary.length / 4) * 4)
  binary.copy(binaryChunk)
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + jsonChunk.length + binaryChunk.length, 8)
  header.writeUInt32LE(jsonChunk.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  const binaryHeader = Buffer.alloc(8)
  binaryHeader.writeUInt32LE(binaryChunk.length, 0)
  binaryHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jsonChunk, binaryHeader, binaryChunk])
}

function validateGlb({ json, binary }) {
  check(json.buffers.length === 1 && !json.buffers[0].uri, 'GLB must have one embedded buffer')
  check(json.buffers[0].byteLength <= binary.length, 'Truncated binary buffer')
  for (const view of json.bufferViews) {
    check((view.buffer ?? 0) === 0, 'Unexpected external buffer')
    check((view.byteOffset ?? 0) + view.byteLength <= json.buffers[0].byteLength, 'Buffer view out of range')
  }
  check(json.animations.length === 8, 'Expected the eight exported animation clips')
  check(json.skins.length === 1 && json.skins[0].joints.length === 878, 'Expected the native 878 joint skeleton')
  check(json.meshes.length === 43, 'Expected all 43 source mesh parts')
  for (const image of json.images ?? []) {
    check(image.bufferView !== undefined && !image.uri && image.mimeType === 'image/png', 'Image is not an embedded PNG')
    const view = json.bufferViews[image.bufferView]
    check(binary.subarray(view.byteOffset, view.byteOffset + 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Invalid embedded PNG')
  }
}

function verify() {
  const manifest = read(path.join(outputRoot, 'manifest.json'))
  for (const [file, identity] of Object.entries(manifest.outputs)) {
    const bytes = fs.readFileSync(path.join(outputRoot, file))
    check(bytes.length === identity.bytes && sha(bytes) === identity.sha256, `Changed output: ${file}`)
  }
  const glb = parseGlb(fs.readFileSync(path.join(outputRoot, 'jamie-native.glb')))
  validateGlb(glb)
  check(sha(glb.binary.subarray(0, manifest.nativeBinary.bytes)) === manifest.nativeBinary.sha256, 'Native animation/geometry binary changed')
  for (const key of ['animations', 'skins', 'accessors', 'nodes']) {
    check(sha(Buffer.from(JSON.stringify(glb.json[key]))) === manifest.nativeJsonSha256[key], `Native ${key} changed`)
  }
  check(glb.json.images.length === manifest.textures.embeddedImages, 'Texture count changed')
  const camera = read(path.join(outputRoot, 'camera.json'))
  for (const [mode, name] of Object.entries(manifest.cameraClips)) {
    check(camera.clips.find(clip => clip.name === name)?.frameCount === manifest.frames[mode], `Missing ${mode} camera`)
  }
  console.log(JSON.stringify({ verified: true, meshes: glb.json.meshes.length, bones: glb.json.skins[0].joints.length,
    clips: glb.json.animations.length, images: glb.json.images.length, outputs: Object.keys(manifest.outputs) }))
}

if (args.includes('--verify')) { verify(); process.exit(0) }

// All dependencies are private local research inputs; the emitted manifest keeps
// their identities and the exact boundary of each verification.
const reportFiles = ['extraction.json', 'texture-extraction.json', 'common-extraction.json']
const reports = reportFiles.map(name => ({ name, value: read(local(`research/sf6-cinematic/${name}`)) }))
const conversion = read(local('research/sf6-cinematic/conversion-provenance.json'))
const priorValidation = read(local('research/sf6-cinematic/native-glb-validation.json'))
const cameraAuditPath = local('research/sf6-cinematic/camera-audit.json')
const cameraAudit = read(cameraAuditPath)
const secondaryPath = resolveResearchPath(conversion.artifacts.secondaryApproximation)
const bakedPath = resolveResearchPath(conversion.artifacts.materialMap)
const normalPath = resolveResearchPath(conversion.artifacts.tangentNormalMap)
const baked = read(bakedPath)
const normalBakes = read(normalPath)
const materialProps = read(resolveResearchPath(conversion.artifacts.sourceStructureAndShaderFlags)).materials
const sourceGlbPath = resolveResearchPath(priorValidation.source)
const sourceGlbBytes = fs.readFileSync(sourceGlbPath)
const sourceGlb = parseGlb(sourceGlbBytes)
validateGlb(sourceGlb)
check(sha(sourceGlb.binary) === priorValidation.nativeBinaryPrefixSha256, 'Source GLB binary differs from audited conversion')

const archiveCache = new Map()
const verifiedSources = new Map()
let packedBytesRead = 0
let reaMembers = 0
function archiveFor(entry, report) {
  if (archiveCache.has(entry.archive)) return archiveCache.get(entry.archive)
  const expected = report.archives.find(archive => archive.path === entry.archive)
  check(expected, `No archive identity for ${entry.resource}`)
  check(fs.statSync(entry.archive).size === expected.size, `Installation archive size changed: ${entry.archive}`)
  const descriptor = fs.openSync(entry.archive, 'r')
  const header = Buffer.alloc(16)
  check(fs.readSync(descriptor, header, 0, 16, 0) === 16, 'Cannot read PAK header')
  check(header.toString('hex') === expected.headerHex, 'PAK header differs from extraction report')
  check(header.toString('ascii', 0, 4) === 'KPKA' && header.readUInt32LE(8) === expected.fileCount, 'Unsupported PAK layout')
  const index = Buffer.alloc(expected.fileCount * 48)
  check(fs.readSync(descriptor, index, 0, index.length, 16) === index.length, 'Truncated PAK index')
  check(sha(index) === expected.indexSha256, 'PAK index differs from extraction report')
  const archive = { descriptor, index, expected }
  archiveCache.set(entry.archive, archive)
  return archive
}
try {
  for (const { name, value: report } of reports) {
    for (const entry of report.entries) {
      if (verifiedSources.has(entry.resource)) {
        check(verifiedSources.get(entry.resource).sha256 === entry.sha256, `Conflicting resource identity: ${entry.resource}`)
        continue
      }
      check(entry.encryption === 0, `Encrypted member is unsupported: ${entry.resource}`)
      const archive = archiveFor(entry, report)
      check(entry.entryOffset === 16 + entry.index * 48, 'Invalid entry offset')
      const record = archive.index.subarray(entry.index * 48, (entry.index + 1) * 48)
      check(Number(record.readBigUInt64LE(8)) === entry.offset && Number(record.readBigUInt64LE(16)) === entry.packedBytes
        && Number(record.readBigUInt64LE(24)) === entry.bytes && record.readBigUInt64LE(32) === BigInt(entry.attributes), `PAK entry changed: ${entry.resource}`)
      const packed = Buffer.alloc(entry.packedBytes)
      check(fs.readSync(archive.descriptor, packed, 0, packed.length, entry.offset) === packed.length, 'Truncated PAK payload')
      packedBytesRead += packed.length
      check(sha(packed) === entry.packedSha256, `Packed payload differs: ${entry.resource}`)
      const decoded = entry.compression === 2 ? zstdDecompressSync(packed)
        : entry.compression === 1 ? inflateRawSync(packed) : entry.compression === 0 ? packed : null
      check(decoded && decoded.length === entry.bytes && sha(decoded) === entry.sha256, `Decoded payload differs: ${entry.resource}`)
      const extracted = fs.readFileSync(local(`.local/sf6-cinematic/extracted/${entry.resource}`))
      check(extracted.equals(decoded), `Extracted source differs from installation: ${entry.resource}`)
      const inReaPackage = name === 'extraction.json' && reaRoot
      if (inReaPackage) {
        check(fs.readFileSync(path.join(reaRoot, entry.resource)).equals(decoded), `REA extracted member differs: ${entry.resource}`)
        reaMembers++
      }
      verifiedSources.set(entry.resource, {
        resource: entry.resource, archive: path.basename(entry.archive), index: entry.index,
        offset: entry.offset, packedBytes: entry.packedBytes, bytes: entry.bytes,
        packedSha256: entry.packedSha256, sha256: entry.sha256,
        installationPayloadVerified: true, reaExtractedVerified: Boolean(inReaPackage),
      })
    }
  }
} finally {
  for (const archive of archiveCache.values()) fs.closeSync(archive.descriptor)
}
const cameraResource = reports[0].value.entries.find(entry => entry.resource.endsWith('.mcamlist.22'))
const bodyResource = reports[0].value.entries.find(entry => entry.resource.includes('/superarts/') && entry.resource.endsWith('.motlist.653'))
check(cameraResource.sha256 === cameraAudit.sourceSha256, 'Camera audit is for a different mcamlist')
const rawMotions = fs.readFileSync(local(`.local/sf6-cinematic/extracted/${bodyResource.resource}`))
for (const animation of sourceGlb.json.animations) {
  check(rawMotions.includes(Buffer.from(animation.name, 'utf16le')), `Clip name missing from native motlist: ${animation.name}`)
  check(animation.channels.length === priorValidation.nativeAnimationChannels[animation.name], `Animation channel count changed: ${animation.name}`)
}

const json = structuredClone(sourceGlb.json)
const nativeJsonSha256 = Object.fromEntries(['animations', 'skins', 'accessors', 'nodes'].map(key => [key, sha(Buffer.from(JSON.stringify(json[key])))]))
const baseByMesh = new Map(baked.map(item => [normalizeMesh(item.mesh), item]))
const normalByMesh = new Map(normalBakes.map(item => [normalizeMesh(item.mesh), item]))
const propsByMaterial = new Map(materialProps.map(item => [item.material.replace(/\.\d+$/, ''), item]))
const binaryParts = [sourceGlb.binary]
let binaryLength = sourceGlb.binary.length
const imageCache = new Map()
const textureInputs = []
json.materials = []
json.images = []
json.textures = []
json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]
// The original extensions only described exporter material/mesh metadata. Every
// material below is portable metallic/roughness glTF, with no external images.
delete json.extensionsUsed
delete json.extensionsRequired
function embedImage(file, kind, mesh) {
  const bytes = fs.readFileSync(file)
  check(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), `Not a PNG: ${file}`)
  const digest = sha(bytes)
  textureInputs.push({ mesh, kind, source: relativeSource(file), sha256: digest, bytes: bytes.length,
    width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) })
  if (imageCache.has(digest)) return imageCache.get(digest)
  const padding = (4 - binaryLength % 4) % 4
  if (padding) { binaryParts.push(Buffer.alloc(padding)); binaryLength += padding }
  const bufferView = json.bufferViews.length
  json.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: bytes.length })
  binaryParts.push(bytes)
  binaryLength += bytes.length
  const source = json.images.length
  json.images.push({ name: path.basename(file), mimeType: 'image/png', bufferView })
  const texture = json.textures.length
  json.textures.push({ sampler: 0, source })
  imageCache.set(digest, texture)
  return texture
}
const materialMapping = []
for (const mesh of json.meshes) {
  const bake = baseByMesh.get(normalizeMesh(mesh.name))
  check(bake, `No color/alpha bake for ${mesh.name}`)
  const normal = normalByMesh.get(normalizeMesh(mesh.name))
  const materialName = bake.sourceMaterial.replace(/\.\d+$/, '')
  const props = propsByMaterial.get(materialName)
  check(props, `Missing source material flags for ${materialName}`)
  const material = {
    name: `${mesh.name}__baked`,
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1],
      baseColorTexture: { index: embedImage(resolveResearchPath(bake.baseColor), 'baseColorAlpha', mesh.name), texCoord: 0 },
      metallicFactor: 0, roughnessFactor: props.roughness },
    doubleSided: Boolean(props.alphaLinked),
    alphaMode: props.renderMethod === 'BLENDED' ? 'BLEND' : props.alphaLinked ? 'MASK' : 'OPAQUE',
  }
  if (material.alphaMode === 'MASK') material.alphaCutoff = 0.4
  // EyeTear has an explicitly zero source alpha. Preserve that flag even if
  // the bake happens to have no linked alpha channel.
  if (!props.alphaLinked && props.alphaDefault !== 1) {
    material.pbrMetallicRoughness.baseColorFactor[3] = props.alphaDefault
  }
  if (normal) {
    check(normal.normalSpace === 'TANGENT' && normal.channelConvention === '+X,+Y,+Z' && normal.colorSpace === 'Non-Color', `Unsupported normal bake: ${mesh.name}`)
    material.normalTexture = { index: embedImage(resolveResearchPath(normal.normal), 'tangentNormal', mesh.name), texCoord: 0 }
  }
  const materialIndex = json.materials.length
  json.materials.push(material)
  for (const primitive of mesh.primitives) {
    primitive.material = materialIndex
    // FB_ngon_encoding is exporter metadata, not needed to draw triangles.
    delete primitive.extensions
  }
  materialMapping.push({ mesh: mesh.name, material: materialIndex, sourceMaterial: materialName,
    alphaMode: material.alphaMode, baseColor: material.pbrMetallicRoughness.baseColorTexture.index,
    normal: material.normalTexture?.index ?? null })
}
json.buffers[0].byteLength = binaryLength
const glbBytes = encodeGlb(json, Buffer.concat(binaryParts))
validateGlb(parseGlb(glbBytes))
const camera = {
  source: cameraResource.resource, sourceSha256: cameraResource.sha256,
  auditSha256: sha(fs.readFileSync(cameraAuditPath)), clips: cameraAudit.clips,
  layoutSource: cameraAudit.layoutSource,
  limitations: [
    'Curves are copied from the saved camera audit whose mcamlist SHA-256 matches the installed member; this assembly does not independently decode the camera format.',
    'Camera property vector X is interpreted as vertical field of view in radians; raw property vectors remain available.',
    'Native camera xyz and quaternion values are retained without axis reflection; renderer interpretation remains reviewable.',
  ],
}
const outputs = { 'jamie-native.glb': glbBytes, 'camera.json': jsonBytes(camera), 'secondary.json': fs.readFileSync(secondaryPath) }
const clips = json.animations.map(animation => {
  const durationSeconds = Math.max(...animation.samplers.map(sampler => json.accessors[sampler.input].max?.[0] ?? 0))
  return { name: animation.name, frames: Math.round(durationSeconds * 60), durationSeconds,
    channels: animation.channels.length, samplers: animation.samplers.length }
})
const manifest = {
  version: 1, character: 'Jamie', characterCode: 'esf021', purpose: 'Local SA3 / CA cinematic review sample',
  sourceFrameRate: 60, frames: { SA3: 438, CA: 499 }, clips,
  cameraClips: { SA3: 'CAM_SAA3_GETUGASAIHOU', CA: 'CAM_CAA_GETUGASAIHOU' },
  nativeGlb: { source: relativeSource(sourceGlbPath), sha256: sha(sourceGlbBytes), bytes: sourceGlbBytes.length },
  nativeBinary: { sha256: sha(sourceGlb.binary), bytes: sourceGlb.binary.length }, nativeJsonSha256,
  geometry: { meshes: json.meshes.length, bones: json.skins[0].joints.length, preservedMeshNames: json.meshes.map(mesh => mesh.name) },
  visconGroups: conversion.observations.visconGroups,
  textures: { baseColorAlphaBakes: baked.length, tangentNormalBakes: normalBakes.length, embeddedImages: json.images.length,
    embeddedTextureBytes: [...imageCache.keys()].reduce((sum, digest) => sum + textureInputs.find(input => input.sha256 === digest).bytes, 0),
    normalConvention: '+X,+Y,+Z tangent space; non-color data', inputs: textureInputs },
  materialMapping,
  provenance: {
    installationVerification: 'Complete PAK index and selected member offsets, packed hashes, decompression, and extracted hashes; no complete archive payload scan.',
    decoder: `Node ${process.version} node:zlib inflateRawSync / zstdDecompressSync`,
    packedBytesRead, uniqueMembersVerified: verifiedSources.size, reaExtractedMembersVerified: reaMembers,
    archives: [...archiveCache.values()].map(({ expected }) => ({ name: path.basename(expected.path), bytes: expected.size, fileCount: expected.fileCount, indexSha256: expected.indexSha256 })),
    reports: [...reportFiles, 'conversion-provenance.json', 'camera-audit.json', 'native-glb-validation.json'].map(name => ({ name, sha256: sha(fs.readFileSync(local(`research/sf6-cinematic/${name}`))) })),
    tools: { ...conversion.tools, contentExporter: priorValidation.tool }, sources: [...verifiedSources.values()],
  },
  limitations: [
    'CBFA facial expression curves are not mapped to anatomical mesh bones; the sample retains the converted rest facial pose.',
    'Original RE Engine chain physics, JCNS pose correctives, animated muscle, sweat, and cloth waves are not reconstructed; secondary.json contains a static review approximation.',
    'Base color and alpha were baked from the REME material graph; standard glTF PBR, alpha cutoff 0.4, and roughness approximate original engine shading.',
    'Original ClothWrinkle_MSK4 texture dependency remains unresolved in the source conversion.',
    'Original game VFX, original renderer lighting, and the original opponent model are not included in this asset bundle.',
    'The source exporter skipped 336 channels targeting missing skeleton bones, as recorded in jamie-native.skipped-animation-bones.md beside the source GLB. The eight exported clips are retained; this does not establish lossless preservation of every original animation channel.',
    'Automatic Viscon switching for clothing groups 20/21, hair groups 22/23, and gourd groups has not been recovered. Hair is selected manually in this sample; VisualSwitchKey.VisualFlag is not assumed to map directly to mesh group numbers.',
    'Exported body motion curves and skeleton are preserved from the audited conversion; exporter accuracy beyond these retained bytes is not independently established here.',
  ],
  outputs: Object.fromEntries(Object.entries(outputs).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha(bytes) }])),
}
for (const [mode, name] of Object.entries(manifest.cameraClips)) {
  check(camera.clips.find(clip => clip.name === name)?.frameCount === manifest.frames[mode], `Unexpected ${mode} source camera duration`)
}
fs.mkdirSync(outputRoot, { recursive: true })
for (const [name, bytes] of Object.entries(outputs)) fs.writeFileSync(path.join(outputRoot, name), bytes)
fs.writeFileSync(path.join(outputRoot, 'manifest.json'), jsonBytes(manifest))
verify()
