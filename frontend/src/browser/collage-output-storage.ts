import {current,assertCurrentRevision,commit,writeFile,localFile,now} from './storage';
import {editScope,hashFile} from './edit-storage';
import {collageDocumentSources,collageAssetPath} from '../core/collage-project';
import {validateCollageOutputSave,validateCollageOutput,collageOutputScene,collageOutputPath,collageOutputMime} from '../core/collage-output';
import type {CollageOutputSave,CollageOutput,StoredCollageOutput} from '../core/collage-output';
const conflict=()=>new Error('This collage output request conflicts with a saved output.');
const damaged=()=>new Error('Collage output is missing or changed. Restore a backup.');
function publicRecord(v:StoredCollageOutput):CollageOutput{const {assets,storage_id,...record}=structuredClone(v);return record;}
function stored(id:string){const record=current().collage_outputs?.find(v=>v.id===id);if(!record)throw new Error('Collage output not found.');validateCollageOutput(record,true);return record;}
export async function listCollageOutputs(page=1){if(!Number.isSafeInteger(page)||page<1)throw new Error('Invalid collage output.');const scope=editScope();await assertCurrentRevision();scope.check();const all=[...(current().collage_outputs||[])].sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));return {items:all.slice((page-1)*20,page*20).map(publicRecord),total:all.length};}
export async function getCollageOutput(id:string){const scope=editScope();await assertCurrentRevision();scope.check();const v=stored(id);for(const asset of v.assets){if(await hashFile(await localFile(collageAssetPath(asset),scope.base))!==asset.sha256)throw damaged();scope.check();}if(await hashFile(await localFile(collageOutputPath(v),scope.base))!==v.sha256)throw damaged();scope.check();return publicRecord(v);}
export async function collageOutputImage(id:string){const scope=editScope();await assertCurrentRevision();scope.check();const v=stored(id),file=await localFile(collageOutputPath(v),scope.base);if(await hashFile(file)!==v.sha256)throw damaged();scope.check();return new Blob([file],{type:collageOutputMime(v.format)});}
export async function collageOutputSource(record:CollageOutput,sourceId:string,signal?:AbortSignal){const scope=editScope();signal?.throwIfAborted();await assertCurrentRevision();scope.check();const v=stored(record.id),source=collageDocumentSources(v.project.document).find(s=>s.id===sourceId),asset=v.assets.find(a=>a.sha256===source?.sha256);if(!source||!asset)throw damaged();const file=await localFile(collageAssetPath(asset),scope.base);if(await hashFile(file)!==source.sha256)throw damaged();scope.check();signal?.throwIfAborted();return new File([file],source.name,{type:file.type});}
export async function saveCollageOutput(payload:CollageOutputSave,blob:Blob){
 validateCollageOutputSave(payload);payload=structuredClone(payload);const scope=editScope();if(!blob.size||blob.size>256*1024*1024)throw new Error('Collage output exceeds the size limit.');
 if(blob.type!==collageOutputMime(payload.format)||await hashFile(blob)!==payload.sha256)throw damaged();scope.check();
 // Check the actual encoded signature, not only the caller supplied MIME.
 const header=new Uint8Array(await blob.slice(0,12).arrayBuffer()),ascii=(a:number,b:number)=>String.fromCharCode(...header.slice(a,b));
 if(payload.format==='png'&&!(header[0]===137&&ascii(1,4)==='PNG')||payload.format==='jpg'&&!(header[0]===255&&header[1]===216&&header[2]===255)||payload.format==='webp'&&!(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'))throw new Error('Invalid collage output image.');
 const image=await createImageBitmap(blob),width=image.width,height=image.height;image.close();scope.check();
 return navigator.locks.request('photocollection-collage-output:'+scope.id+':'+payload.id,async()=>{
  scope.check();await assertCurrentRevision();scope.check();const previous=current().collage_outputs?.find(v=>v.id===payload.id);
  if(previous){validateCollageOutput(previous,true);if(['page','format','quality','sha256'].some(k=>previous[k as 'page']!==payload[k as 'page'])||previous.project.id!==payload.project_id||previous.project.revision!==payload.project_revision)throw conflict();return getCollageOutput(previous.id);}
  const project=current().collages?.find(p=>p.id===payload.project_id);if(!project||project.revision!==payload.project_revision)throw new Error('This collage changed in another window. Reopen it before saving.');
  const {assets,...snapshot}=structuredClone(project),record:StoredCollageOutput={version:1,id:payload.id,project:snapshot,page:payload.page,format:payload.format,quality:payload.quality,sha256:payload.sha256,width,height,created_at:now(),assets,storage_id:payload.id};validateCollageOutput(record,true);
  if(!collageOutputScene(record))throw damaged();for(const asset of assets){if(await hashFile(await localFile(collageAssetPath(asset),scope.base))!==asset.sha256)throw damaged();scope.check();}
  const parent=await(await scope.base.getDirectoryHandle('drafts',{create:true})).getDirectoryHandle('collage-outputs',{create:true});scope.check();try{await parent.getDirectoryHandle(payload.id);throw conflict();}catch(e){if(!(e instanceof DOMException)||e.name!=='NotFoundError')throw e;}
  const folder=await parent.getDirectoryHandle(payload.id,{create:true});let published=false;
  try{scope.check();const name=payload.sha256+'.'+payload.format;await writeFile(name,blob,folder);if(await hashFile(await localFile(name,folder))!==payload.sha256)throw damaged();scope.check();await commit(s=>{scope.check();if(s.collage_outputs?.some(v=>v.id===payload.id))throw conflict();if(s.collages?.find(p=>p.id===payload.project_id)?.revision!==payload.project_revision)throw new Error('This collage changed in another window. Reopen it before saving.');s.collage_outputs=[record,...(s.collage_outputs||[])];});published=true;scope.check();return publicRecord(record);}
  finally{if(!published){let absent=false;try{const disk=JSON.parse(await(await localFile('library.json',scope.base)).text());absent=Array.isArray(disk.photos)&&!(disk.collage_outputs||[]).some((v:CollageOutput)=>v.id===payload.id);}catch{/* Retain uncertain writes for recovery. */}if(absent)await parent.removeEntry(payload.id,{recursive:true}).catch(()=>{});}}
 });
}
export async function removeCollageOutput(id:string){const scope=editScope();await commit(s=>{scope.check();if(!s.collage_outputs?.some(v=>v.id===id))throw new Error('Collage output not found.');s.collage_outputs=s.collage_outputs.filter(v=>v.id!==id);});}
