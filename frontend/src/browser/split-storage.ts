import {current,assertCurrentRevision,commit,localFile,writeFile,imageURLs,uid} from './storage';
import {hashFile,editSource,editScope} from './edit-storage';
import type {EditRecord,EditSplitGroup,EditVariant} from '../core/editor-adapter';
import type {EncodedSplit} from '../core/split-render';
import {validateStoredSplit,sameSplitValue,splitID} from '../core/split-record';
import type {StoredSplit} from '../core/split-record';
import {sourceDecodeProfile} from '../core/source-decode-profile';

const changed=()=>new Error('The edit changed. Reopen it before splitting.');
const conflict=()=>new Error('Split request ID was already used for a different result.');
async function view(g:StoredSplit):Promise<EditSplitGroup>{
  validateStoredSplit(g);const files=[g.master,...g.panels],urls=await imageURLs(files.map(p=>p.path));
  const assets=files.map((p,i)=>({id:p.id,document_id:g.document_id,name:p.name,preview_url:urls[i],width:p.width,height:p.height}));
  return {id:g.id,document_id:g.document_id,document_revision:g.document_revision,source_hash:g.source_hash,spec:structuredClone(g.spec),plan:structuredClone(g.plan),recipe:structuredClone(g.recipe),parent_recipe:structuredClone(g.parent_recipe),format:g.format,quality:g.quality,master:assets[0],panels:assets.slice(1)};
}
export async function splitGroup(id:string){
  const scope=editScope();await assertCurrentRevision();scope.check();const found=current().splits?.find(g=>g.id===id);if(!found)throw new Error('Split group not found.');
  // Verify every asset before presenting a saved group, including copies opened
  // from a backup. The source recipe can evolve; these encoded pixels cannot.
  validateStoredSplit(found);
  for(const p of [found.master,...found.panels]){if(await hashFile(await localFile(p.path,scope.base))!==p.sha256)throw new Error('Split group is incomplete or damaged.');scope.check();}
  return view(found);
}
export async function listSplits(documentId:string,page=1){
  if(!Number.isSafeInteger(page)||page<1)throw new Error('Invalid seamless split.');
  const scope=editScope();await assertCurrentRevision();scope.check();
  const rows=(current().splits||[]).filter(g=>g.document_id===documentId),items=await Promise.all(rows.slice((page-1)*20,page*20).map(view));scope.check();
  return {items,total:rows.length};
}
export async function splitVariants(page=1):Promise<{items:EditVariant[];total:number}>{
  const scope=editScope(),groups=current().splits||[],all=groups.flatMap(g=>g.panels.map(p=>({group:g,asset:p}))),rows=all.slice((page-1)*20,page*20);
  const urls=await imageURLs(rows.map(p=>p.asset.path));scope.check();
  return {total:all.length,items:rows.map(({group,asset},i)=>({id:asset.id,document_id:group.document_id,name:asset.name,preview_url:urls[i],width:asset.width,height:asset.height}))};
}
export async function saveSplit(record:EditRecord,result:EncodedSplit,name:string,requestId:string):Promise<EditSplitGroup>{
  const scope=editScope(),scopeID=scope.id;
  record=structuredClone(record);result=structuredClone(result);
  if(!splitID(requestId)||![1,2].includes(result.version)||typeof name!=='string'||name.length>255)throw new Error('Invalid seamless split.');
  if(record.recipe.version>=3?result.version!==2||!sameSplitValue(result.parent_recipe,record.recipe):result.version!==1||result.parent_recipe!==undefined)throw changed();
  const stem=name.replace(/\.[^.]*$/,'').replace(/[\\/\x00-\x1f]/g,'_').slice(0,200)||'split';
  const g:StoredSplit={version:1,id:requestId,document_id:record.id,document_revision:record.revision??0,source_hash:record.source_hash,name,
    spec:result.spec,plan:result.plan,recipe:result.recipe,parent_recipe:record.recipe,decode_profile:sourceDecodeProfile(record.decode_profile),format:result.format,quality:result.quality,
    master:{id:requestId,name:stem+'-master.png',path:`drafts/splits/${requestId}/master.png`,sha256:result.master.sha256,width:result.plan.width,height:result.plan.height},
    panels:result.panels.map((p,i)=>({id:uid(),name:`${stem}-${String(i+1).padStart(2,'0')}.${result.format}`,path:`drafts/splits/${requestId}/panel-${String(i+1).padStart(2,'0')}.${result.format}`,sha256:p.sha256,width:result.plan.panels[i]?.width,height:result.plan.height}))};
  validateStoredSplit(g);if(result.panels.some((p,i)=>p.index!==i))throw new Error('Invalid split pixels.');
  return navigator.locks.request('photocollection-split:'+scopeID+':'+requestId,()=>navigator.locks.request('photocollection-edit:'+scopeID+':'+record.id,async()=>{
    scope.check();await assertCurrentRevision();scope.check();
    const existing=current().splits?.find(v=>v.id===requestId);
    if(existing){
      const compare=(v:StoredSplit)=>({...v,panels:v.panels.map(({id,...p})=>p)});
      if(!sameSplitValue(compare(existing),compare(g)))throw conflict();return splitGroup(requestId);
    }
    const ensureRecord=()=>{scope.check();const latest=current().edits?.find(e=>e.id===record.id);
      if(!latest||(latest.revision??0)!==(record.revision??0)||latest.source_hash!==record.source_hash||!sameSplitValue(latest.recipe,record.recipe)||!sameSplitValue(sourceDecodeProfile(latest.decode_profile),g.decode_profile))throw changed();return latest;};
    const source=await editSource(ensureRecord()),needsSnapshot=!ensureRecord().source_path;scope.check();
    const blobs=[result.master.blob,...result.panels.map(p=>p.blob)],assets=[g.master,...g.panels];
    if(blobs.reduce((n,b)=>n+b.size,0)>512*1024*1024)throw new Error('Split output exceeds the 512 MiB limit.');
    for(const [i,b] of blobs.entries()){
      if(b.type!==(i===0||g.format==='png'?'image/png':'image/jpeg')||await hashFile(b)!==assets[i].sha256)throw new Error('Split image hash or dimensions do not match the pixel plan.');
      const bitmap=await createImageBitmap(b);try{if(bitmap.width!==assets[i].width||bitmap.height!==assets[i].height)throw new Error('Split image hash or dimensions do not match the pixel plan.');}finally{bitmap.close();}scope.check();
    }
    const drafts=await scope.base.getDirectoryHandle('drafts',{create:true}),parent=await drafts.getDirectoryHandle('splits',{create:true});scope.check();
    try{await parent.getDirectoryHandle(requestId);throw conflict();}catch(e){if(!(e instanceof DOMException)||e.name!=='NotFoundError')throw e;}
    const owned=await parent.getDirectoryHandle(requestId,{create:true});let published=false;
    try{
      if(needsSnapshot){scope.check();await writeFile('source.bin',source,owned);if(await hashFile(await localFile('source.bin',owned))!==record.source_hash)throw new Error('The source photo changed. Reopen it before saving.');}
      for(const [i,blob] of blobs.entries()){scope.check();await writeFile(assets[i].path.split('/').at(-1)!,blob,owned);}
      await editSource(ensureRecord());scope.check();
      await commit(s=>{ensureRecord();if(s.splits?.some(v=>v.id===requestId))throw conflict();const parent=s.edits!.find(e=>e.id===record.id)!;if(needsSnapshot)parent.source_path=`drafts/splits/${requestId}/source.bin`;s.splits=[g,...(s.splits||[])];});published=true;
      scope.check();return await view(g);
    }finally{
      // Only this freshly created UUID directory is eligible for rollback.
      // Keep it after a successful manifest commit even if the user switches libraries.
      if(!published){let absent=false;try{const disk=JSON.parse(await(await localFile('library.json',scope.base)).text());absent=Array.isArray(disk.edits)&&!(disk.splits||[]).some((g:{id:string})=>g.id===requestId);}catch{/* Keep uncertain groups for recovery. */}if(absent)await parent.removeEntry(requestId,{recursive:true}).catch(()=>{});}
    }
  }));
}
