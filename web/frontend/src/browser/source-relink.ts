import {current,librarySession,connectSource,commit} from './storage';
import type {Directory} from './storage';
import {sourceHash} from '../core/editor-adapter';

/** Explicit folder selection; exact bytes decide identity, never names or EXIF guesses. */
export async function relinkSource(id:string,handle:Directory,signal:AbortSignal){
  const scope=current().id,session=librarySession(),photo=current().photos.find(p=>p.id===id);
  if(!photo)throw new Error('Photo record no longer exists.');
  const check=()=>{signal.throwIfAborted();if(session!==librarySession()||current().id!==scope)throw new Error('Library changed. Reopen the current library.');};
  const sourceId=await connectSource(handle);check();
  async function find(folder:Directory,prefix=''):Promise<{path:string;file:File}|null>{
    for await(const entry of folder.values()){
      check();const path=prefix+entry.name;
      if(entry.kind==='directory'){const result=await find(await folder.getDirectoryHandle(entry.name) as Directory,path+'/');if(result)return result;}
      else{const file=await(await folder.getFileHandle(entry.name)).getFile();check();if(file.size===photo!.file_size&&await sourceHash(file)===photo!.file_hash){check();return {path,file};}}
    }
    return null;
  }
  const found=await find(handle);check();if(!found)throw new Error('No file with the original content hash was found in this folder.');
  const previous={path:photo.relative_path,source:photo.source_id,managed:photo.managed_path};
  const parts=found.path.split('/');let parent:FileSystemDirectoryHandle=handle;for(const part of parts.slice(0,-1))parent=await parent.getDirectoryHandle(part);
  if(await sourceHash(await(await parent.getFileHandle(parts.at(-1)!)).getFile())!==photo.file_hash)throw new Error('The source photo changed. Reopen it before saving.');check();
  await commit(value=>{
    check();const live=value.photos.find(p=>p.id===id);
    if(!live||live.file_hash!==photo.file_hash||live.relative_path!==previous.path||live.source_id!==previous.source||live.managed_path!==previous.managed)throw new Error('Library changed. Reopen the current library.');
    if(value.photos.some(p=>p.id!==id&&!p.managed_path&&p.source_id===sourceId&&p.relative_path===found.path))throw new Error('The selected path belongs to another photo record.');
    live.source_id=sourceId;live.relative_path=found.path;live.file_path=handle.name+'/'+found.path;live.file_name=found.file.name;delete live.managed_path;
  });check();return {id,file_path:handle.name+'/'+found.path,originals_untouched:true};
}
