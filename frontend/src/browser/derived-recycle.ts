import {current,directory,librarySession,localFile,writeFile,assertCurrentRevision,allPhotoSources,uid,now} from './storage';
import type {Directory} from './storage';
import {sourceHash} from '../core/editor-adapter';
import {maintainLibrary} from './maintenance';
import {recentTasks} from './task-service';
import type {Job} from '../types';
import {collageOutputPath} from '../core/collage-output';

export type RecycleItem={path:string;sha256:string;size:number};
type Record={version:1;id:string;created_at:string;state:'moving'|'stored'|'restoring'|'restored';items:RecycleItem[]};
const token='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',idPattern=new RegExp('^'+token+'$');
const workPath=new RegExp('^works/'+token+'/(?:scene\\.png|poster-[1-9][0-9]*\\.png|preview-[1-9][0-9]*\\.webp)$'),draftPath=new RegExp('^drafts/'+token+'/preview-[a-zA-Z0-9_-]+\\.webp$');
const editedPath=new RegExp('^photos/'+token+'-edited\\.(?:png|jpg|webp)$'),collagePath=new RegExp('^drafts/collage-outputs/'+token+'/[a-f0-9]{64}\\.(?:png|jpg|webp)$'),splitPath=new RegExp('^drafts/splits/'+token+'/(?:master\\.png|panel-[0-9]{2}\\.(?:png|jpg))$');
const aiPath=new RegExp('^ai-studio/'+token+'/(?:image\\.png|generated\\.png|preview\\.webp)$');
const patterns=[workPath,draftPath,editedPath,collagePath,splitPath,aiPath];
const bad=()=>new Error('Invalid derived recycle record.');
function safe(path:unknown):asserts path is string{if(typeof path!=='string'||!patterns.some(pattern=>pattern.test(path)))throw bad();}
function validItems(value:unknown):asserts value is RecycleItem[]{
  if(!Array.isArray(value)||value.length<1||value.length>100)throw bad();const seen=new Set<string>();
  for(const item of value){if(!item||typeof item!=='object'||Object.keys(item).length!==3||Object.keys(item).some(k=>!['path','sha256','size'].includes(k))||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isSafeInteger(item.size)||item.size<1)throw bad();safe(item.path);if(seen.has(item.path))throw bad();seen.add(item.path);}
}
function refs(){
  const s=current(),paths=new Set<string>();
  for(const p of allPhotoSources(s)){paths.add(p.managed_path||p.relative_path);for(const sidecar of p.metadata_sidecars||[])if(sidecar.managed_path)paths.add(sidecar.managed_path);}
  for(const r of s.ai_results||[])if(r.kind!=='annotation')for(const name of ['image.png','generated.png','preview.webp'])paths.add(`ai-studio/${r.id}/${name}`);
  for(const e of s.edits||[])if(e.source_path)paths.add(e.source_path);
  for(const output of s.collage_outputs||[])paths.add(collageOutputPath(output));
  for(const group of s.splits||[])for(const asset of [group.master,...group.panels])paths.add(asset.path);
  for(const w of s.works)for(const name of ['scene.png',`poster-${w.revision}.png`,`preview-${w.revision}.webp`])paths.add(`works/${w.id}/${name}`);
  for(const d of s.drafts){if(d.preview_file)paths.add(d.preview_file);if(d.artwork_id)paths.add(`works/${d.artwork_id}/poster-${d.source_revision}.png`);if(d.source.file_path)paths.add(d.source.file_path);}
  return paths;
}
function scope(){const base=directory(),id=current().id,generation=librarySession();return {base,id,check:()=>{if(librarySession()!==generation||directory()!==base||current().id!==id)throw new Error('Library changed. Reopen the current library.');}};}
async function optionalFolder(base:FileSystemDirectoryHandle,name:string){try{return await base.getDirectoryHandle(name) as Directory;}catch(e){if(e instanceof DOMException&&e.name==='NotFoundError')return null;throw e;}}
async function* inventory(base:Directory){
  const photos=await optionalFolder(base,'photos');
  if(photos)for await(const file of photos.values())if(file.kind==='file'&&editedPath.test('photos/'+file.name))yield 'photos/'+file.name;
  for(const area of ['works','drafts','drafts/collage-outputs','drafts/splits','ai-studio']){
    let root:Directory|null=base;for(const segment of area.split('/')){root=root&&await optionalFolder(root,segment);if(!root)break;}if(!root)continue;
    for await(const folder of root.values()){if(folder.kind!=='directory'||!idPattern.test(folder.name))continue;const handle=await root.getDirectoryHandle(folder.name) as Directory;for await(const file of handle.values()){const path=`${area}/${folder.name}/${file.name}`;if(file.kind==='file'&&patterns.some(pattern=>pattern.test(path)))yield path;}}
  }
}
export async function recyclable(page=1){
  if(!Number.isSafeInteger(page)||page<1)throw bad();const s=scope();await assertCurrentRevision();s.check();const protectedPaths=refs(),items:RecycleItem[]=[];let total=0;
  for await(const path of inventory(s.base)){s.check();if(protectedPaths.has(path))continue;total++;if(total-1>=(page-1)*40&&total-1<page*40){const file=await localFile(path,s.base);s.check();items.push({path,sha256:await sourceHash(file),size:file.size});s.check();}}
  return {items,total,page,page_size:40};
}
async function readRecord(id:string,base:Directory){
  if(!idPattern.test(id))throw bad();const file=await localFile(`recycle/${id}/record.json`,base);if(file.size>128*1024)throw bad();const record=JSON.parse(await file.text()) as Record;
  if(!record||typeof record!=='object'||Object.keys(record).length!==5||Object.keys(record).some(k=>!['version','id','created_at','state','items'].includes(k))||record.version!==1||record.id!==id||typeof record.created_at!=='string'||!['moving','stored','restoring','restored'].includes(record.state))throw bad();validItems(record.items);return record;
}
export async function recycleHistory(page=1){
  if(!Number.isSafeInteger(page)||page<1)throw bad();const s=scope(),root=await optionalFolder(s.base,'recycle'),rows:{id:string;created_at:string;state:string;count:number;bytes:number}[]=[];s.check();
  if(root)for await(const folder of root.values()){s.check();if(folder.kind!=='directory'||!idPattern.test(folder.name))continue;try{const r=await readRecord(folder.name,s.base);s.check();rows.push({id:r.id,created_at:r.created_at,state:r.state,count:r.items.length,bytes:r.items.reduce((a,b)=>a+b.size,0)});}catch(error){s.check();/* Keep malformed journals and bytes for manual recovery. */}}
  rows.sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));return {items:rows.slice((page-1)*20,page*20),total:rows.length,page,page_size:20};
}
async function exists(path:string,base:Directory){try{await localFile(path,base);return true;}catch(e){if(e instanceof DOMException&&e.name==='NotFoundError')return false;throw e;}}
async function removeKnown(path:string,sha256:string,base:Directory,check:()=>void){
  const parts=path.split('/');let folder:FileSystemDirectoryHandle=base;for(const part of parts.slice(0,-1))folder=await folder.getDirectoryHandle(part);check();
  const handle=await folder.getFileHandle(parts.at(-1)!);if(await sourceHash(await handle.getFile())!==sha256)throw new Error('Recycling was interrupted. Restore the recorded batch before retrying.');check();await folder.removeEntry(parts.at(-1)!);
}
async function exclusive<T>(run:(s:ReturnType<typeof scope>)=>Promise<T>){
  const s=scope();return maintainLibrary(async()=>{
    if((recentTasks() as Job[]).some(j=>['queued','running'].includes(j.status)))throw new Error('Wait for background tasks before recycling files.');
    return navigator.locks.request('photocollection:'+s.id,async()=>{s.check();await assertCurrentRevision();s.check();return run(s);});
  });
}
export async function recycleDerived(items:unknown){
  validItems(items);const requested=structuredClone(items);
  return exclusive(async s=>{
    const protectedPaths=refs();for(const item of requested){s.check();const file=await localFile(item.path,s.base);if(protectedPaths.has(item.path)||file.size!==item.size||await sourceHash(file)!==item.sha256)throw new Error('The selected file changed or is still referenced. Nothing was recycled.');}
    s.check();const id=uid(),record:Record={version:1,id,created_at:now(),state:'moving',items:requested},journal=`recycle/${id}/record.json`;
    await writeFile(journal,JSON.stringify(record),s.base);s.check();
    for(let i=0;i<requested.length;i++){
      const item=requested[i],file=await localFile(item.path,s.base),target=`recycle/${id}/${i}.bin`;s.check();
      if(await sourceHash(file)!==item.sha256||await exists(target,s.base))throw new Error('Recycling was interrupted. Restore the recorded batch before retrying.');s.check();
      await writeFile(target,file,s.base);s.check();if(await sourceHash(await localFile(target,s.base))!==item.sha256)throw new Error('Recycling was interrupted. Restore the recorded batch before retrying.');s.check();
      await removeKnown(item.path,item.sha256,s.base,s.check);
    }
    record.state='stored';await writeFile(journal,JSON.stringify(record),s.base);s.check();return {id,recycled:requested.length,originals_untouched:true};
  });
}
export async function restoreDerived(id:string){
  return exclusive(async s=>{
    const record=await readRecord(id,s.base),moves:{source:string;target:string;sha:string}[]=[];s.check();
    for(let i=0;i<record.items.length;i++){
      const item=record.items[i],source=`recycle/${id}/${i}.bin`,target=item.path,hasSource=await exists(source,s.base),hasTarget=await exists(target,s.base);s.check();
      if(hasSource){
        if(hasTarget){if(await sourceHash(await localFile(target,s.base))!==item.sha256)throw new Error('A recycle restore path is occupied or damaged. No files were restored.');}
        else{if(await sourceHash(await localFile(source,s.base))!==item.sha256)throw new Error('A recycle restore path is occupied or damaged. No files were restored.');s.check();moves.push({source,target,sha:item.sha256});}
      }else if(!hasTarget||await sourceHash(await localFile(target,s.base))!==item.sha256)throw new Error('A recycled file is unavailable. Keep the journal and restore a backup.');s.check();
    }
    record.state='restoring';await writeFile(`recycle/${id}/record.json`,JSON.stringify(record),s.base);s.check();
    for(const item of moves){if(await exists(item.target,s.base))throw new Error('A recycle restore path is occupied or damaged. No files were restored.');s.check();await writeFile(item.target,await localFile(item.source,s.base),s.base);s.check();if(await sourceHash(await localFile(item.target,s.base))!==item.sha)throw new Error('A recycled file is unavailable. Keep the journal and restore a backup.');s.check();await removeKnown(item.source,item.sha,s.base,s.check);}
    record.state='restored';await writeFile(`recycle/${id}/record.json`,JSON.stringify(record),s.base);s.check();return {restored:moves.length,originals_untouched:true};
  });
}
