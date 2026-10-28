import {current,assertCurrentRevision,commit,localFile,writeFile,now} from './storage';
import type {LocalEdit} from './storage';
import {editScope,editSource,hashFile} from './edit-storage';
import {panelEditSource,validateEditLineageGraph} from '../core/edit-lineage-graph';
import {splitEditDefaults} from '../core/edit-lineage';
import {sameSplitValue,splitID} from '../core/split-record';

const conflict=()=>new Error('Split edit request conflicts with an existing edit.');
export async function createSplitEdit(groupId:string,panelId:string,requestId:string):Promise<LocalEdit>{
  if(!splitID(requestId))throw conflict();const scope=editScope();
  return navigator.locks.request('photocollection-edit:'+scope.id+':'+requestId,async()=>{
    scope.check();await assertCurrentRevision();scope.check();validateEditLineageGraph(current().edits||[],current().splits||[]);
    const group=current().splits?.find(g=>g.id===groupId);if(!group)throw new Error('Split group not found.');
    const frozen=structuredClone(group),lineage=panelEditSource(frozen,panelId),panel=frozen.panels[lineage.panel_index];
    const previous=current().edits?.find(e=>e.id===requestId);
    if(previous){if(!sameSplitValue(previous.derived_from,lineage))throw conflict();await editSource(previous);scope.check();return structuredClone(previous);}
    if([group.id,group.document_id,...group.panels.map(p=>p.id)].includes(requestId))throw conflict();
    const source=await localFile(panel.path,scope.base);scope.check();
    if(source.size>256*1024*1024)throw new Error('Photo exceeds the 256 MiB browser import limit.');
    if(await hashFile(source)!==lineage.source_hash)throw new Error('Split group is incomplete or damaged.');scope.check();
    const bitmap=await createImageBitmap(source);try{if(bitmap.width!==lineage.width||bitmap.height!==lineage.height)throw new Error('Split group is incomplete or damaged.');}finally{bitmap.close();}scope.check();
    const drafts=await scope.base.getDirectoryHandle('drafts',{create:true}),parent=await drafts.getDirectoryHandle('edits',{create:true});scope.check();
    try{await parent.getDirectoryHandle(requestId);throw conflict();}catch(e){if(!(e instanceof DOMException)||e.name!=='NotFoundError')throw e;}
    const folder=await parent.getDirectoryHandle(requestId,{create:true});let published=false;
    try{
      scope.check();await writeFile('source.'+frozen.format,source,folder);scope.check();
      if(await hashFile(await localFile('source.'+frozen.format,folder))!==lineage.source_hash||await hashFile(await localFile(panel.path,scope.base))!==lineage.source_hash)throw new Error('Split group is incomplete or damaged.');scope.check();
      const record:LocalEdit={id:requestId,photo_id:null,source_path:`drafts/edits/${requestId}/source.${frozen.format}`,source_name:panel.name,source_hash:lineage.source_hash,...splitEditDefaults(),derived_from:lineage,revision:1,updated_at:now()};
      await commit(s=>{scope.check();if(s.edits?.some(e=>e.id===requestId)||!sameSplitValue(s.splits?.find(g=>g.id===groupId),frozen))throw conflict();s.edits=[record,...(s.edits||[])];});published=true;scope.check();return structuredClone(record);
    }finally{if(!published){let absent=false;try{const disk=JSON.parse(await(await localFile('library.json',scope.base)).text());absent=Array.isArray(disk.edits)&&!disk.edits.some((e:{id:string})=>e.id===requestId);}catch{/* Preserve an uncertain snapshot for recovery. */}if(absent)await parent.removeEntry(requestId,{recursive:true}).catch(()=>{});}}
  });
}
