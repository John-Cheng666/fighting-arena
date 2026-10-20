/** Append evaluated original shader normals for the four-drink mesh variants. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reportPath=path.resolve(process.argv[2]??path.join(repo,'.local/sf6-v3/normals/normal-bakes-v3.json'));
const output=path.join(repo,'public/assets/jamie/cinematic');
const file=path.join(output,'jamie-native.glb'), manifestPath=path.join(output,'manifest.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const normalize=n=>n.toLowerCase().replace(/_sub_?(\d+)/g,'_sub$1');
const input=fs.readFileSync(file), jsonLength=input.readUInt32LE(12), binaryHeader=20+jsonLength;
if(input.readUInt32LE(0)!==0x46546c67||input.readUInt32LE(4)!==2)throw Error('Expected GLB 2.0');
const json=JSON.parse(input.subarray(20,binaryHeader));
let binary=input.subarray(binaryHeader+8,binaryHeader+8+json.buffers[0].byteLength);
const immutable=Object.fromEntries(['animations','skins','accessors','nodes'].map(key=>[key,sha(JSON.stringify(json[key]))]));
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const mappings=[];
json.extras??={};json.extras.cinematicV3Normals??={};
for(const item of report){
  const png=fs.readFileSync(item.normal);
  if(sha(png)!==item.sha256)throw Error('Changed evaluated normal bake: '+item.mesh);
  const mesh=json.meshes.find(m=>normalize(m.name)===normalize(item.mesh));
  if(!mesh)throw Error('Missing four-drink mesh '+item.mesh);
  let texture=json.extras.cinematicV3Normals[item.mesh]?.texture;
  if(texture===undefined||json.extras.cinematicV3Normals[item.mesh].sha256!==item.sha256){
    const padding=Buffer.alloc((4-binary.length%4)%4);binary=Buffer.concat([binary,padding]);
    const view=json.bufferViews.push({buffer:0,byteOffset:binary.length,byteLength:png.length})-1;
    binary=Buffer.concat([binary,png]);
    const image=json.images.push({name:`v3-${item.mesh}`,bufferView:view,mimeType:'image/png'})-1;
    texture=json.textures.push({sampler:0,source:image})-1;
    json.extras.cinematicV3Normals[item.mesh]={texture,sha256:item.sha256};
  }
  for(const primitive of mesh.primitives)json.materials[primitive.material].normalTexture={index:texture,scale:1};
  mappings.push({mesh:mesh.name,texture,sha256:item.sha256,sourceMaterial:item.sourceMaterial,normalSpace:item.normalSpace,channelConvention:item.channelConvention,source:item.source});
}
json.buffers[0].byteLength=binary.length;
for(const[key,expected]of Object.entries(immutable))if(sha(JSON.stringify(json[key]))!==expected)throw Error('Original skeletal data changed: '+key);
const raw=Buffer.from(JSON.stringify(json)),text=Buffer.alloc(Math.ceil(raw.length/4)*4,0x20);raw.copy(text);
const bin=Buffer.alloc(Math.ceil(binary.length/4)*4);binary.copy(bin);
const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+text.length+bin.length,8);header.writeUInt32LE(text.length,12);header.writeUInt32LE(0x4e4f534a,16);
const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
const result=Buffer.concat([header,text,bh,bin]);
fs.writeFileSync(file,result);
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
manifest.outputs['jamie-native.glb']={bytes:result.length,sha256:sha(result)};
manifest.fourDrinkNormals={source:'Evaluated original REME shader graphs for existing native open-jacket and loose-hair meshes',reportSha256:sha(fs.readFileSync(reportPath)),mappings};
manifest.textures.embeddedImages=json.images.length;
manifest.textures.tangentNormalBakes=json.images.length-manifest.textures.baseColorAlphaBakes;
manifest.textures.embeddedTextureBytes=json.images.reduce((sum,image)=>sum+json.bufferViews[image.bufferView].byteLength,0);
manifest.textures.inputs=manifest.textures.inputs.filter(item=>!item.cinematicV3);
for(const item of report)manifest.textures.inputs.push({mesh:item.mesh,kind:'tangentNormal',cinematicV3:true,source:path.relative(repo,item.normal).replaceAll('\\','/'),sha256:item.sha256,bytes:fs.statSync(item.normal).size,width:1024,height:1024});
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({meshes:mappings.length,images:json.images.length,bytes:result.length,sha256:sha(result)}));
