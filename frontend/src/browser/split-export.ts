import {current,localFile} from './storage';
import type {Directory} from './storage';
import {editScope,hashFile} from './edit-storage';
import {splitID,validateStoredSplit} from '../core/split-record';
import {splitExportNames,splitExportStem} from '../core/split-export';
import type {SplitOutputFolder,SplitExportResult} from '../core/editor-adapter';
import {registerResourceReset} from '../core/resource-lifecycle';

type Scope=ReturnType<typeof editScope>;
type Destination={handle:Directory;scope:Scope};
const folders=new Map<string,Destination>();
type Receipt={signature:string;result:SplitExportResult;files:FileSystemFileHandle[];directory:FileSystemDirectoryHandle};
const receipts=new Map<string,Receipt>();
registerResourceReset(()=>{folders.clear();receipts.clear();});
const receiptChanged=()=>new Error('Export receipt changed or files are missing. Start a new export.');
export async function chooseSplitFolder():Promise<SplitOutputFolder|null>{
  const scope=editScope(),picker=(window as unknown as {showDirectoryPicker?:(options:object)=>Promise<Directory>}).showDirectoryPicker;
  if(!picker)throw new Error('Use the current desktop Chrome or Edge over HTTPS.');
  try{const handle=await picker({mode:'readwrite',id:'photo-split-output'});scope.check();const id=crypto.randomUUID();folders.set(id,{handle,scope});return {id,label:handle.name};}
  catch(e){if(e instanceof DOMException&&e.name==='AbortError')return null;throw e;}
}
async function present(folder:FileSystemDirectoryHandle,name:string){
  try{await folder.getFileHandle(name);return true;}catch(e){if(e instanceof DOMException&&e.name==='TypeMismatchError')return true;if(e instanceof DOMException&&e.name==='NotFoundError')return false;throw e;}
}
type Owned={handle:FileSystemFileHandle;name:string;stream:FileSystemWritableFileStream|null;closed:boolean;hash:string|null};
async function cleanup(folder:FileSystemDirectoryHandle,owned:Owned[]){
  for(const item of owned){
    if(!item.closed)await item.stream?.abort().catch(()=>{});
    try{const actual=await folder.getFileHandle(item.name);if(!await actual.isSameEntry(item.handle))continue;const file=await actual.getFile();if(file.size===0||item.hash&&await hashFile(file)===item.hash)await folder.removeEntry(item.name);}catch(e){if(!(e instanceof DOMException)||e.name!=='NotFoundError')throw e;}
  }
}
export async function exportSplit(groupId:string,folder:SplitOutputFolder|null,subfolder:boolean,requestId:string):Promise<SplitExportResult>{
  if(!splitID(requestId)||typeof subfolder!=='boolean')throw new Error('Invalid seamless split.');
  const scope=editScope(),selected=folder?folders.get(folder.id):null;if(folder&&!selected)throw new Error('Export directory is unavailable. Choose it again.');selected?.scope.check();
  // Serialize chosen folders across libraries, then share the existing export
  // lock with ordinary exports into this library's default directory.
  return navigator.locks.request('photocollection-split-output',()=>navigator.locks.request('photocollection-export:'+scope.id,async()=>{
    scope.check();selected?.scope.check();const signature=JSON.stringify({groupId,folder:folder?.id??null,subfolder,library:scope.id}),previous=receipts.get(requestId);
    if(previous){if(previous.signature!==signature)throw receiptChanged();for(const [i,handle] of previous.files.entries()){const file=previous.result.files[i];try{if(!await handle.isSameEntry(await previous.directory.getFileHandle(file.file_name))||await hashFile(await handle.getFile())!==file.sha256)throw receiptChanged();}catch{throw receiptChanged();}scope.check();}return structuredClone(previous.result);}
    const stored=current().splits?.find(g=>g.id===groupId);if(!stored)throw new Error('Split group not found.');validateStoredSplit(stored);const group=structuredClone(stored);
    // Verify all inputs before creating the first destination. They are checked
    // again while copying, so a late modified asset cannot publish a mixed set.
    for(const panel of [group.master,...group.panels]){if(await hashFile(await localFile(panel.path,scope.base))!==panel.sha256)throw new Error('Split group is incomplete or damaged.');scope.check();}
    const root=selected?.handle??await scope.base.getDirectoryHandle('exports',{create:true}) as Directory;scope.check();
    let target:FileSystemDirectoryHandle=root,folderName='',owned:Owned[]=[],published=false;
    const stem=splitExportStem(group.master.name),existing=new Set<string>();for await(const entry of (root as Directory).values())existing.add(entry.name.toLowerCase());
    try{
      for(let attempt=0;attempt<10000;attempt++){
        scope.check();const names=splitExportNames(stem,group.format,group.plan.count,subfolder,attempt);
        if(subfolder){if(existing.has(names.folder.toLowerCase())||await present(root,names.folder))continue;target=await root.getDirectoryHandle(names.folder,{create:true});const entries=[];for await(const entry of (target as Directory).values())entries.push(entry);if(entries.length){existing.add(names.folder.toLowerCase());continue;}folderName=names.folder;}
        else if(names.files.some(name=>existing.has(name.toLowerCase())))continue;
        let collision=false;
        for(const name of names.files){
          scope.check();if(await present(target,name)){collision=true;break;}
          const handle=await target.getFileHandle(name,{create:true});
          // File System Access has no O_EXCL create. Inspect the late result and
          // obtain an exclusive writer before touching bytes; nonempty or busy
          // files introduced by another writer are never truncated.
          if((await handle.getFile()).size){collision=true;break;}
          const item:Owned={handle,name,stream:null,closed:false,hash:null};
          try{item.stream=await handle.createWritable({mode:'exclusive'} as FileSystemCreateWritableOptions);}catch(e){if(e instanceof DOMException&&e.name==='NoModificationAllowedError'){collision=true;break;}owned.push(item);throw e;}
          owned.push(item);if((await handle.getFile()).size){collision=true;break;}
        }
        if(!collision)break;
        await cleanup(target,owned);owned=[];
        if(subfolder){try{await root.removeEntry(folderName);}catch(e){if(!(e instanceof DOMException)||e.name!=='InvalidModificationError')throw e;}folderName='';}
        if(attempt===9999)throw new Error('Too many export name collisions. Choose another directory.');
      }
      if(owned.length!==group.panels.length)throw new Error('Too many export name collisions. Choose another directory.');
      for(const [i,item] of owned.entries()){
        scope.check();const source=await localFile(group.panels[i].path,scope.base);if(await hashFile(source)!==group.panels[i].sha256)throw new Error('Split group is incomplete or damaged.');scope.check();
        item.hash=group.panels[i].sha256;await item.stream!.write(source);scope.check();await item.stream!.close();item.closed=true;
        if(await hashFile(await item.handle.getFile())!==item.hash)throw new Error('Export files changed before completion. Try again.');scope.check();
      }
      for(const item of owned){if(!await item.handle.isSameEntry(await target.getFileHandle(item.name))||await hashFile(await item.handle.getFile())!==item.hash)throw new Error('Export files changed before completion. Try again.');scope.check();}
      const result={directory:(selected?root.name:'exports')+(folderName?'/'+folderName:''),files:owned.map((p,i)=>({file_name:p.name,sha256:group.panels[i].sha256}))};scope.check();
      receipts.set(requestId,{signature,result,files:owned.map(p=>p.handle),directory:target});published=true;return structuredClone(result);
    }finally{
      if(!published){await cleanup(target,owned);if(subfolder&&folderName){try{await root.removeEntry(folderName);}catch(e){if(!(e instanceof DOMException)||!['NotFoundError','InvalidModificationError'].includes(e.name))throw e;}}}
    }
  }));
}
