/** Join REA-verified native recovery evidence and shipped browser artifacts. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(repo,'public/assets/jamie/cinematic');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const check=(yes,message)=>{if(!yes)throw Error(message);};
const files=['jamie-native.glb','facial.json','physics.json','appearance.json'];
if(process.argv.includes('--verify')){
  const evidence=read(path.join(output,'recovery.json'));
  for(const[file,expected]of Object.entries(evidence.outputs)){
    const bytes=fs.readFileSync(path.join(output,file));
    check(bytes.length===expected.bytes&&sha(bytes)===expected.sha256,'Changed recovered artifact: '+file);
  }
  check(evidence.originalMembers.every(m=>m.reaExtractedVerified),'Missing REA materialization verification');
  console.log(JSON.stringify({verified:true,originalMembers:evidence.originalMembers.length,outputs:Object.keys(evidence.outputs)}));process.exit(0);
}
const at=process.argv.indexOf('--rea-root');check(at>=0&&process.argv[at+1],'Provide the directory returned by REA extract_artifact');
const reaRoot=path.resolve(process.argv[at+1]);
const stagedFile=path.join(repo,'research/sf6-cinematic-v3/staged-members.json');
const stagedBytes=fs.readFileSync(stagedFile),staged=JSON.parse(stagedBytes);
check(fs.readFileSync(path.join(reaRoot,'extraction.json')).equals(stagedBytes),'REA package manifest differs from source staging');
const originalMembers=staged.members.map(member=>{
  check(sha(fs.readFileSync(path.join(reaRoot,member.resource)))===member.sha256,'REA extracted bytes differ: '+member.resource);
  return {...member,reaExtractedVerified:true};
});
const rea=read(path.join(repo,'research/sf6-cinematic-v3/rea-recovery-forward-evidence.json'));
const extract=rea.records.find(record=>record.operation==='extract_artifact');
check(extract,'Missing successful REA extraction Evidence');
const outputs=Object.fromEntries(files.map(name=>{const bytes=fs.readFileSync(path.join(output,name));return[name,{bytes:bytes.length,sha256:sha(bytes)}];}));
const face=read(path.join(output,'facial.json')),physics=read(path.join(output,'physics.json')),appearance=read(path.join(output,'appearance.json'));
check(face.bones.length===148&&face.driver.controlCount===210,'Unexpected native facial mapping');
check(physics.bones.length===363&&physics.fps===60,'Unexpected native physics binding');
check(appearance.drinkLevels['4'].groups1P.includes(21)&&appearance.drinkLevels['4'].groups1P.includes(23),'Incomplete original four-drink appearance');
const recovery={version:3,purpose:'SA3/CA facial, chain dynamics and actual four-drink appearance review',
  evidence:{packageSha256:rea.artifacts[0].digest.sha256,extractionEvidenceId:extract.evidence_id,originalPackedBytesRead:staged.packedBytesRead,archiveIndices:staged.archiveIndices},
  originalMembers,outputs,
  restored:{facial:{controls:face.driver.controlCount,anatomicalBones:face.bones.length,method:'Original CBFA curves and FCE_ROM relative bone poses; original victim FCE_SCAD timing'},
    physics:{groups:physics.chains.reduce((n,c)=>n+c.groups.length,0),nodes:physics.bones.length,fixedFps:60,method:'Native chain52 settings, membership and collision geometry with a portable fixed-step constrained solver'},
    appearance:{source:'Native fchar Style.DefaultProps joined to PartsContainer.Info',actualFour:appearance.drinkLevels['4'],actualZero:appearance.drinkLevels['0']}},
  limitations:['Original quaternion-blend order and facial transitions have not been compared frame-by-frame in the running original engine.',
    'Physics uses recovered parameters and constraints; it is not the original RE Engine integrator. Native wind activation and all anisotropic/filter/attachment modes are not fully recovered.',
    'Wrinkle shading, JCNS pose-corrective drivers and every conditional timeline part event remain incomplete.'],
};
const recoveryBytes=JSON.stringify(recovery,null,2)+'\n';fs.writeFileSync(path.join(output,'recovery.json'),recoveryBytes);
const file=path.join(output,'manifest.json'),manifest=read(file);
for(const[name,identity]of Object.entries(outputs))manifest.outputs[name]=identity;
manifest.outputs['recovery.json']={bytes:Buffer.byteLength(recoveryBytes),sha256:sha(recoveryBytes)};
manifest.v3Recovery={manifest:'recovery.json',facialBones:148,facialControls:210,chainGroups:recovery.restored.physics.groups,chainNodes:363,fixedFps:60,actualDrinkLevelAppearance:true,reaMaterializedMembers:originalMembers.length};
manifest.legacySecondary='secondary.json is retained as the first review artifact; v3 uses physics.json and no static hair-sag override.';
manifest.limitations=manifest.limitations.filter(line=>!line.startsWith('CBFA facial expression curves')&&!line.startsWith('Original RE Engine chain physics')&&!line.startsWith('Automatic Viscon switching'));
manifest.limitations=[...new Set([...manifest.limitations,...recovery.limitations])];
fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({originalMembers:originalMembers.length,reaEvidence:extract.evidence_id,facialBones:148,chainNodes:363,outputs:Object.keys(outputs)}));
