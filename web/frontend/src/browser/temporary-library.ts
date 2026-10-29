import {createMemoryDirectory} from './memory-directory';
import {closeLibrary,current,hasLibrary,isTemporaryLibrary,librarySession,openTemporaryLibrary} from './storage';

/** A disposable editing sandbox; the user's remembered library is untouched. */
export async function createTemporaryLibrary(){
  const memory=createMemoryDirectory();
  try{
    const value=await openTemporaryLibrary(memory.directory),generation=librarySession(),id=value.id;
    const active=()=>hasLibrary()&&isTemporaryLibrary()&&librarySession()===generation&&current().id===id;
    let disposed=false;
    return {id,generation,active,async dispose(){if(disposed)return;disposed=true;if(active())closeLibrary();memory.dispose();}};
  }catch(error){memory.dispose();throw error;}
}

/** Reuse the real import/decode pipeline and wait for its durable completion. */
export async function importTemporaryPhoto(file:File):Promise<string>{
  if(!isTemporaryLibrary())throw new Error('Start a temporary session before opening a photo.');
  const id=current().id,generation=librarySession();
  const check=()=>{if(!isTemporaryLibrary()||librarySession()!==generation||current().id!==id)throw new DOMException('The temporary session has ended.','AbortError');};
  const [{importSelectedFiles},{getTask,cancelTask}]=await Promise.all([import('./api'),import('./task-service')]);check();
  const job=await importSelectedFiles([file]),started=performance.now();check();
  for(;;){
    check();const latest=getTask(job.id);
    if(latest.status==='completed'){
      let photoId=latest.new_photo_ids?.find((value:string)=>current().photos.some(photo=>photo.id===value));
      if(!photoId){
        const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('');check();
        photoId=current().photos.find(photo=>photo.file_hash===hash)?.id;
      }
      if(!photoId)throw new Error('The selected photo could not be imported.');return photoId;
    }
    if(latest.status==='failed')throw new Error(latest.error||latest.errors?.[0]||'The selected photo could not be imported.');
    if(latest.status==='cancelled')throw new DOMException('The photo import was cancelled.','AbortError');
    if(performance.now()-started>180000){await cancelTask(job.id);check();throw new Error('Photo processing timed out. Try a smaller photo.');}
    await new Promise<void>(resolve=>setTimeout(resolve,100));
  }
}
