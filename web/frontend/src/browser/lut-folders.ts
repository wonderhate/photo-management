import {lutRootLabel} from '../core/lut-context';
import {current,commit,handleValue,uid,assertCurrentRevision,isTemporaryLibrary} from './storage';
import type {Directory} from './storage';
import {editScope,hashFile} from './edit-storage';
import {MAX_CUBE_BYTES} from '../core/cube-lut';
import {lutHeader,validateLutFolders,LUT_FOLDER_LIMIT,LUT_ENTRY_LIMIT,LUT_DEPTH_LIMIT,validLutPath} from '../core/lut-folders';
import type {LutFolder,LutFolderEntry} from '../core/lut-folders';
import {validateLutAsset} from '../core/lut-contract';
const key=(library:string,id:string)=>'lut-folder:'+library+':'+id;
const stamp=(file:File)=>file.lastModified+':'+file.size;
const proofs=new WeakMap<File,{id:string;binding:string;revision:number;groups:string[]}>();
export function externalLutGroups(file:File){return proofs.get(file)?.groups||[];}
export function verifyExternalLut(file:File){const proof=proofs.get(file);if(proof){const f=current().lut_folders?.find(f=>f.id===proof.id);if(!f||f.binding!==proof.binding||f.revision!==proof.revision)throw new Error('LUT folder changed. Refresh the list.');}}
export async function listLutFolders(){const scope=editScope();await assertCurrentRevision();scope.check();const rows=structuredClone(current().lut_folders||[]);validateLutFolders(rows);return rows;}
export async function linkLutFolder(id?:string):Promise<LutFolder|null>{
  const scope=editScope();let directory:Directory;
  try{directory=await (window as any).showDirectoryPicker({mode:'read',id:'photo-lut-folder'});}catch(e){if(e instanceof DOMException&&e.name==='AbortError')return null;throw e;}
  scope.check();if(!isTemporaryLibrary()&&await directory.isSameEntry(scope.base)||await scope.base.resolve(directory)!==null)throw new Error('Choose a directory outside the library.');scope.check();
  const previous=id?current().lut_folders?.find(f=>f.id===id):undefined;if(id&&!previous)throw new Error('LUT folder not found.');
  for(const f of current().lut_folders||[]){const existing=await handleValue<Directory>(key(scope.id,f.binding));scope.check();if(existing&&await existing.isSameEntry(directory)){scope.check();if(id&&id!==f.id)throw new Error('This LUT directory is already linked.');return f;}}
  if(!id&&(current().lut_folders?.length||0)>=LUT_FOLDER_LIMIT)throw new Error('Too many LUT folders.');
  const record:LutFolder={version:1,id:id||uid(),binding:uid(),name:directory.name,revision:(previous?.revision??-1)+1,state:'ready',entries:[],truncated:false};validateLutFolders([record]);
  // A fresh binding cannot redirect the old registration if publication fails.
  await handleValue(key(scope.id,record.binding),directory);scope.check();
  await commit(s=>{scope.check();const old=s.lut_folders?.find(f=>f.id===id);if(id&&old?.revision!==previous?.revision)throw new Error('LUT folder changed. Refresh the list.');s.lut_folders=id?s.lut_folders!.map(f=>f.id===id?record:f):[...(s.lut_folders||[]),record];});scope.check();
  return record;
}
async function folderHandle(scope:ReturnType<typeof editScope>,f:LutFolder){const handle=await handleValue<Directory>(key(scope.id,f.binding));scope.check();return handle;}
export async function removeLutFolder(id:string){const scope=editScope();await commit(s=>{scope.check();if(!s.lut_folders?.some(f=>f.id===id))throw new Error('LUT folder not found.');s.lut_folders=s.lut_folders.filter(f=>f.id!==id);});scope.check();}
export async function scanLutFolder(id:string):Promise<LutFolder>{
  const scope=editScope();await assertCurrentRevision();scope.check();const saved=current().lut_folders?.find(f=>f.id===id);if(!saved)throw new Error('LUT folder not found.');const before=structuredClone(saved),result=structuredClone(saved),root=await folderHandle(scope,before),old=new Map(before.entries.map(e=>[e.path,e])),entries:LutFolderEntry[]=[];let truncated=false;
  async function walk(dir:Directory,prefix:string,depth:number){
    if(depth>LUT_DEPTH_LIMIT){truncated=true;return;}
    const children=[];for await(const h of dir.values()){scope.check();children.push(h);if(children.length>20000){truncated=true;break;}}
    children.sort((a,b)=>a.name.localeCompare(b.name));
    for(const h of children){scope.check();if(h.name.startsWith('.'))continue;if(entries.length>=LUT_ENTRY_LIMIT){truncated=true;return;}
      const path=prefix+h.name;if(!validLutPath(path)){truncated=true;continue;}
      if(h.kind==='directory'){const next=await dir.getDirectoryHandle(h.name) as Directory;if(!isTemporaryLibrary()&&await next.isSameEntry(scope.base))continue;await walk(next,path+'/',depth+1);continue;}
      if(!/\.cube$/i.test(h.name))continue;
      const entry:LutFolderEntry={path,stamp:'',asset:null,comments:[],error:'unreadable'};
      try{
        const handle=await dir.getFileHandle(h.name),file=await handle.getFile();scope.check();entry.stamp=stamp(file);const previous=old.get(path);
        if(previous?.stamp===entry.stamp&&previous.asset){entries.push(previous);continue;}
        if(!file.size||file.size>MAX_CUBE_BYTES){entry.error='size';entries.push(entry);continue;}
        const bytes=await file.arrayBuffer();scope.check();const latest=await handle.getFile();scope.check();if(stamp(latest)!==entry.stamp)throw new Error('changed');
        const info=lutHeader(new TextDecoder().decode(bytes.slice(0,65536))),hash=await hashFile(new Blob([bytes]));scope.check();
        const asset={version:1 as const,id:hash,name:h.name,title:info.title,size:info.size,bytes:file.size,favorite:false,hidden:false,used_at:null};validateLutAsset(asset);entry.asset=asset;entry.comments=info.comments;entry.error=null;
      }catch(e){scope.check();entry.error=e instanceof Error&&e.message==='changed'?'changed':e instanceof Error&&e.message==='header'?'header':'unreadable';}
      entries.push(entry);
    }
  }
  try{
    if(!root||await root.queryPermission({mode:'read'})!=='granted')result.state='permission';
    else{await walk(root,'',0);result.state='ready';result.entries=entries;result.truncated=truncated;}
  }catch(e){scope.check();result.state=e instanceof DOMException&&e.name==='NotFoundError'?'missing':e instanceof DOMException&&e.name==='NotAllowedError'?'permission':'error';}
  scope.check();if(JSON.stringify(result)===JSON.stringify(before))return result;
  result.revision++;validateLutFolders([result]);await commit(s=>{scope.check();if(s.lut_folders?.find(f=>f.id===id)?.revision!==before.revision)throw new Error('LUT folder changed. Refresh the list.');s.lut_folders=s.lut_folders.map(f=>f.id===id?result:f);});scope.check();return result;
}
export async function readExternalLut(id:string):Promise<File>{
  const scope=editScope();for(const f of structuredClone(current().lut_folders||[])){if(f.state!=='ready')continue;for(const entry of f.entries){if(entry.asset?.id!==id)continue;
    try{
      const root=await folderHandle(scope,f);scope.check();if(!root||await root.queryPermission({mode:'read'})!=='granted')continue;
      let dir:FileSystemDirectoryHandle=root;const parts=entry.path.split('/');for(const part of parts.slice(0,-1)){dir=await dir.getDirectoryHandle(part);scope.check();}
      const handle=await dir.getFileHandle(parts.at(-1)!),file=await handle.getFile();scope.check();if(stamp(file)!==entry.stamp||file.size>MAX_CUBE_BYTES)continue;
      const bytes=await file.arrayBuffer();scope.check();if(stamp(await handle.getFile())!==entry.stamp||await hashFile(new Blob([bytes]))!==id)continue;scope.check();
      if(current().lut_folders?.find(row=>row.id===f.id)?.revision!==f.revision)throw new Error('LUT folder changed. Refresh the list.');
      const copy=new File([bytes],entry.asset.name);proofs.set(copy,{id:f.id,binding:f.binding,revision:f.revision,groups:[lutRootLabel(f.name),...parts.slice(0,-1)]});return copy;
    }catch(e){scope.check();if(e instanceof Error&&e.message.startsWith('LUT folder changed'))throw e;}
  }}throw new Error('LUT source changed or unavailable. Refresh or relink its directory.');
}
