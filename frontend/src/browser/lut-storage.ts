import {lutImportGroups,lutInputComments} from '../core/lut-context';
import {folderAssets} from '../core/lut-folders';
import {readExternalLut,verifyExternalLut,externalLutGroups} from './lut-folders';
import {current,commit,localFile,writeFile,assertCurrentRevision,now} from './storage';
import {editScope,hashFile} from './edit-storage';
import {MAX_CUBE_BYTES,parseCube} from '../core/cube-lut';
import {validateLutAsset} from '../core/lut-contract';
import type {LutAsset,LutImportResult} from '../core/lut-contract';
const path=(id:string)=>'drafts/luts/'+id+'.cube';
export async function listLuts(){const scope=editScope();await assertCurrentRevision();scope.check();return structuredClone(folderAssets(current().luts||[],current().lut_folders||[]));}
export async function ensureLutAsset(id:string){const scope=editScope();if(!current().luts?.some(a=>a.id===id)){const file=await readExternalLut(id);scope.check();await importLut(file,()=>verifyExternalLut(file),externalLutGroups(file));scope.check();}}
export async function lutPreviewSource(id:string):Promise<File>{return current().luts?.some(a=>a.id===id)?lutSource(id):readExternalLut(id);}
export async function lutSource(id:string):Promise<File>{
  const scope=editScope();await ensureLutAsset(id);scope.check();
  if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid LUT data.');
  const asset=current().luts?.find(a=>a.id===id);if(!asset)throw new Error('LUT not found.');validateLutAsset(asset);
  const file=await localFile(path(id),scope.base);scope.check();
  if(file.size!==asset.bytes||await hashFile(file)!==id)throw new Error('LUT source changed. Restore a backup.');scope.check();return new File([file],asset.name);
}
export async function importLut(file:File,guard:()=>void=()=>{},groups=lutImportGroups(file)):Promise<LutAsset>{return (await importLutDetailed(file,guard,groups)).asset;}
export async function importLutDetailed(file:File,guard:()=>void=()=>{},groups=lutImportGroups(file)):Promise<LutImportResult>{
  guard();
  const scope=editScope();if(!file.size||file.size>MAX_CUBE_BYTES)throw new Error('Invalid CUBE LUT: file_size');
  const bytes=await file.arrayBuffer();scope.check();const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),parsed=parseCube(text),id=await hashFile(new Blob([bytes]));scope.check();
  const asset:LutAsset={version:2,context:{groups,comments:lutInputComments(text.slice(0,65536))},id,name:file.name.replace(/\\/g,'/').split('/').at(-1)!,title:parsed.title,size:parsed.size,bytes:file.size,favorite:false,hidden:false,used_at:null};validateLutAsset(asset);
  return navigator.locks.request('photocollection-lut:'+scope.id+':'+id,async()=>{
    scope.check();await assertCurrentRevision();scope.check();let existing:File|undefined;
    try{existing=await localFile(path(id),scope.base);}catch(e){if(!(e instanceof DOMException)||e.name!=='NotFoundError')throw e;}scope.check();
    if(existing){if(await hashFile(existing)!==id)throw new Error('LUT source changed. Restore a backup.');scope.check();}
    else{await writeFile(path(id),new Blob([bytes]),scope.base);scope.check();}
    // On uncertain manifest publication keep the immutable bytes. They are
    // harmless orphan assets, never user originals or a mutable imported file.
    let kind:LutImportResult['kind']='added';
    const result=await commit(s=>{scope.check();guard();const previous=s.luts?.find(a=>a.id===id);if(previous)kind=previous.hidden?'restored':'existing';s.luts=previous?s.luts!.map(a=>a.id===id?{...a,version:2,context:a.context||asset.context,hidden:false}:a):[...(s.luts||[]),asset];});scope.check();
    return {asset:structuredClone(result.luts!.find(a=>a.id===id)!),kind};
  });
}
export async function updateLut(id:string,patch:{favorite?:boolean;hidden?:boolean}):Promise<LutAsset>{
  const scope=editScope();await ensureLutAsset(id);scope.check();
  if(Object.keys(patch).some(k=>!['favorite','hidden'].includes(k)))throw new Error('Invalid LUT data.');
  const result=await commit(s=>{scope.check();const asset=s.luts?.find(a=>a.id===id);if(!asset)throw new Error('LUT not found.');const next={...asset,...patch};validateLutAsset(next);s.luts=s.luts!.map(a=>a.id===id?next:a);});scope.check();return structuredClone(result.luts!.find(a=>a.id===id)!);
}
export async function noteLutUsed(id:string):Promise<LutAsset>{
  const scope=editScope();await ensureLutAsset(id);scope.check();
  const result=await commit(s=>{scope.check();const asset=s.luts?.find(a=>a.id===id);if(!asset)throw new Error('LUT not found.');asset.used_at=now();});scope.check();return structuredClone(result.luts!.find(a=>a.id===id)!);
}
export async function setLutLibraryHidden(hidden:boolean){
 if(typeof hidden!=='boolean')throw new Error('Invalid LUT data.');const scope=editScope();let changed=0;
 const result=await commit(s=>{scope.check();changed=0;s.luts=(s.luts||[]).map(asset=>{validateLutAsset(asset);if(asset.hidden!==hidden)changed++;return {...asset,hidden};});});scope.check();
 return {assets:structuredClone(result.luts||[]),changed};
}
