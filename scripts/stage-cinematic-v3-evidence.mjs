/** Re-read selected original PAK members and stage a raw REA audit package. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inflateRawSync, zstdDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const at=process.argv.indexOf('--source-root');
const original=path.resolve(at<0?process.env.SF6_CINEMATIC_SOURCE??repo:process.argv[at+1]);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const check=(yes,message)=>{if(!yes)throw Error(message);};
const baseline=read(path.join(original,'research/sf6-cinematic/extraction.json'));
const reports=[
  {file:path.join(original,'research/sf6-cinematic/rig-extraction.json')},
  {file:path.join(original,'research/sf6-cinematic/secondary-extraction.json')},
  {file:path.join(original,'research/sf6-cinematic/extraction.json'),select:e=>e.resource.includes('/motionlist/facial/')&&!e.resource.includes('_en.')},
  {file:path.join(repo,'.local/sf6-v3/face/extraction.json')},
  {file:path.join(original,'.local/sf6-v3/appearance/extraction.json')},
];
const staging=path.join(repo,'.local/sf6-v3/rea-staging');fs.mkdirSync(staging,{recursive:true});
const archives=new Map(),members=new Map();let packedBytesRead=0;
try{
  for(const reportInfo of reports){
    const report=read(reportInfo.file);
    for(const entry of report.entries){
      if(reportInfo.select&&!reportInfo.select(entry))continue;
      check(/^natives\/[a-z0-9_./-]+$/i.test(entry.resource)&&!entry.resource.split('/').includes('..'),'Unsafe original resource path');
      if(members.has(entry.resource)){check(members.get(entry.resource).sha256===entry.sha256,'Conflicting original identity');continue;}
      let archive=archives.get(entry.archive);
      if(!archive){
        const expected=baseline.archives.find(item=>item.path===entry.archive);
        check(expected,'Archive is not in the selected installation');
        check(fs.statSync(entry.archive).size===expected.size,'PAK installation size changed');
        const descriptor=fs.openSync(entry.archive,'r'),header=Buffer.alloc(16);
        fs.readSync(descriptor,header,0,16,0);
        check(header.toString('hex')===expected.headerHex,'PAK header changed');
        const index=Buffer.alloc(header.readUInt32LE(8)*48);fs.readSync(descriptor,index,0,index.length,16);
        check(sha(index)===expected.indexSha256,'PAK index identity changed');
        archive={descriptor,index,expected};archives.set(entry.archive,archive);
      }
      const record=archive.index.subarray(entry.index*48,(entry.index+1)*48);
      check(Number(record.readBigUInt64LE(8))===entry.offset&&Number(record.readBigUInt64LE(16))===entry.packedBytes&&Number(record.readBigUInt64LE(24))===entry.bytes,'Selected PAK entry changed');
      const packed=Buffer.alloc(entry.packedBytes);check(fs.readSync(archive.descriptor,packed,0,packed.length,entry.offset)===packed.length,'Truncated PAK range');packedBytesRead+=packed.length;
      check(sha(packed)===entry.packedSha256,'Packed member changed');
      const bytes=entry.compression===2?zstdDecompressSync(packed):entry.compression===1?inflateRawSync(packed):entry.compression===0?packed:null;
      check(bytes&&bytes.length===entry.bytes&&sha(bytes)===entry.sha256,'Original decoded member changed');
      const source=entry.output??path.join(original,'.local/sf6-cinematic/extracted',entry.resource);
      check(fs.readFileSync(source).equals(bytes),'Research source differs from original PAK');
      const target=path.join(staging,entry.resource);check(!path.relative(staging,target).startsWith('..'),'Staging path escaped');
      fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
      members.set(entry.resource,{resource:entry.resource,archive:path.basename(entry.archive),index:entry.index,offset:entry.offset,packedBytes:entry.packedBytes,bytes:entry.bytes,packedSha256:entry.packedSha256,sha256:entry.sha256});
    }
  }
}finally{for(const archive of archives.values())fs.closeSync(archive.descriptor);}
const manifest={version:3,purpose:'Original facial pose/control, chain and actual drink-level appearance recovery',scope:'Named original PAK entries only; no game execution',archiveIndices:[...archives.values()].map(a=>({archive:path.basename(a.expected.path),indexSha256:a.expected.indexSha256})),members:[...members.values()],packedBytesRead};
const bytes=JSON.stringify(manifest,null,2)+'\n';fs.writeFileSync(path.join(staging,'extraction.json'),bytes);
fs.mkdirSync(path.join(repo,'research/sf6-cinematic-v3'),{recursive:true});
fs.writeFileSync(path.join(repo,'research/sf6-cinematic-v3/staged-members.json'),bytes);
console.log(JSON.stringify({staging,members:members.size,packedBytesRead,manifestSha256:sha(bytes)}));
