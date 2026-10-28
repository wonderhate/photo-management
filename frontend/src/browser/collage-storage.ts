import {collageProjectQuery,collageSearchText,collageCompareText} from '../core/collage-project';
import type {CollageProjectQuery} from '../core/collage-project';
import {current,assertCurrentRevision,commit,writeFile,localFile,now} from './storage';
import {editScope,hashFile} from './edit-storage';
import {validateCollageSave,validateCollageProject,collageDocumentSources,collageAssetPath} from '../core/collage-project';
import type {CollageProjectSave,StoredCollageProject,CollageProject} from '../core/collage-project';
import {sameSplitValue} from '../core/split-record';
const conflict=()=>new Error('This collage changed in another window. Reopen it before saving.');
const damaged=()=>new Error('Collage project sources are missing or changed. Restore a backup.');
function publicRecord(value:StoredCollageProject):CollageProject{const {assets,...record}=structuredClone(value);return record;}
export async function listCollages(page=1,query:CollageProjectQuery={}){const q=collageProjectQuery(query);if(!Number.isSafeInteger(page)||page<1)throw new Error('Invalid collage project.');const scope=editScope();await assertCurrentRevision();scope.check();const all=(current().collages||[]).filter(p=>collageSearchText(p.name).includes(collageSearchText(q.search))).sort((a,b)=>{const x=q.sort==='name'?collageSearchText(a.name):a.updated_at,y=q.sort==='name'?collageSearchText(b.name):b.updated_at;return collageCompareText(x,y)*(q.direction==='asc'?1:-1)||collageCompareText(a.id,b.id);});return {items:all.slice((page-1)*20,page*20).map(publicRecord),total:all.length};}
export async function getCollage(id:string){const scope=editScope();await assertCurrentRevision();scope.check();const record=current().collages?.find(p=>p.id===id);if(!record)throw new Error('Collage project not found.');validateCollageProject(record,true);for(const asset of record.assets){if(await hashFile(await localFile(collageAssetPath(asset),scope.base))!==asset.sha256)throw damaged();scope.check();}return publicRecord(record);}
export async function collageSource(record:CollageProject,sourceId:string,signal?:AbortSignal){
 const scope=editScope();signal?.throwIfAborted();await assertCurrentRevision();scope.check();const stored=current().collages?.find(p=>p.id===record.id);if(!stored||stored.revision!==record.revision)throw conflict();validateCollageProject(stored,true);const source=collageDocumentSources(stored.document).find(s=>s.id===sourceId),asset=stored.assets.find(a=>a.sha256===source?.sha256);if(!source||!asset)throw damaged();const file=await localFile(collageAssetPath(asset),scope.base);if(await hashFile(file)!==source.sha256)throw damaged();scope.check();signal?.throwIfAborted();return new File([file],source.name,{type:file.type});
}
export async function saveCollage(payload:CollageProjectSave,files:File[]):Promise<CollageProject>{
 validateCollageSave(payload);payload=structuredClone(payload);const scope=editScope(),sources=collageDocumentSources(payload.document);if(files.length!==sources.length||files.reduce((s,f)=>s+f.size,0)>512*1024*1024||files.some(f=>!f.size||f.size>256*1024*1024))throw new Error('A collage batch needs 1–240 photos, at most 512 MiB in total.');
 return navigator.locks.request('photocollection-collage:'+scope.id+':'+payload.id,async()=>{
  scope.check();await assertCurrentRevision();scope.check();const previous=current().collages?.find(p=>p.id===payload.id);
  if(previous){validateCollageProject(previous,true);if(previous.request_id===payload.request_id){if(previous.revision!==payload.expected_revision+1||previous.name!==payload.name||!sameSplitValue(previous.document,payload.document))throw conflict();return getCollage(previous.id);}}
  if((previous?.revision||0)!==payload.expected_revision)throw conflict();const assets:StoredCollageProject['assets']=[];let parent:FileSystemDirectoryHandle|undefined,folder:FileSystemDirectoryHandle|undefined,published=false;
  try{
   for(const [i,source] of sources.entries()){
    if(await hashFile(files[i])!==source.sha256)throw new Error('Collage sources changed. Reopen the photos.');scope.check();if(assets.some(a=>a.sha256===source.sha256))continue;
    const existing=previous?.assets.find(a=>a.sha256===source.sha256);if(existing){if(await hashFile(await localFile(collageAssetPath(existing),scope.base))!==source.sha256)throw damaged();scope.check();assets.push(existing);continue;}
    if(!folder){parent=await(await scope.base.getDirectoryHandle('drafts',{create:true})).getDirectoryHandle('collages',{create:true});scope.check();try{await parent.getDirectoryHandle(payload.request_id);throw conflict();}catch(e){if(!(e instanceof DOMException)||e.name!=='NotFoundError')throw e;}folder=await parent.getDirectoryHandle(payload.request_id,{create:true});}
    scope.check();await writeFile(source.sha256+'.bin',files[i],folder);if(await hashFile(await localFile(source.sha256+'.bin',folder))!==source.sha256)throw damaged();scope.check();assets.push({sha256:source.sha256,storage_id:payload.request_id});
   }
   const timestamp=now(),record:StoredCollageProject={version:1,id:payload.id,request_id:payload.request_id,name:payload.name,revision:payload.expected_revision+1,document:payload.document,created_at:previous?.created_at||timestamp,updated_at:timestamp,origin_library_id:scope.id,photo_links:[],assets};
   await commit(s=>{scope.check();const latest=s.collages?.find(p=>p.id===payload.id);if((latest?.revision||0)!==payload.expected_revision)throw conflict();record.photo_links=sources.flatMap(source=>source.photo_id&&s.photos.some(p=>p.id===source.photo_id&&p.file_hash===source.sha256)?[{source_id:source.id,photo_id:source.photo_id}]:[]);validateCollageProject(record,true);s.collages=[record,...(s.collages||[]).filter(p=>p.id!==record.id)];});published=true;scope.check();return publicRecord(record);
  }finally{if(folder&&!published){let absent=false;try{const disk=JSON.parse(await(await localFile('library.json',scope.base)).text());absent=Array.isArray(disk.photos)&&!(disk.collages||[]).some((p:CollageProject)=>p.id===payload.id&&p.request_id===payload.request_id);}catch{/* Keep uncertain snapshots for recovery. */}if(absent)await parent!.removeEntry(payload.request_id,{recursive:true}).catch(()=>{});}}
 });
}
export async function removeCollage(record:CollageProject){const scope=editScope();await commit(s=>{scope.check();const found=s.collages?.find(p=>p.id===record.id);if(!found||found.revision!==record.revision)throw conflict();s.collages=s.collages!.filter(p=>p.id!==record.id);});}
