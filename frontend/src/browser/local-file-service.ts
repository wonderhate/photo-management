import {isLocalFileURL,parseLocalFileURL,validDerivedPath} from '../core/local-file-reference';
import {registerResourceReset} from '../core/resource-lifecycle';
import type {LocalFileReference} from '../core/local-file-reference';

export async function readLocalReference(reference:LocalFileReference,signal?:AbortSignal){
  if(!validDerivedPath(reference.path))throw new Error('Invalid local file reference.');
  signal?.throwIfAborted();const storage=await import('./storage'),base=storage.directory(),generation=storage.librarySession();
  const check=()=>{signal?.throwIfAborted();if(storage.current().id!==reference.libraryID||storage.mediaSession()!==reference.session||storage.directory()!==base||storage.librarySession()!==generation)throw new DOMException('Library changed','AbortError');};
  check();const file=await storage.localFile(reference.path,base);check();return file;
}

// No handles, files or blob URLs are stored in the worker. It asks the window
// that initiated this request, which must still own this exact library session.
if(typeof navigator!=='undefined'&&navigator.serviceWorker)navigator.serviceWorker.addEventListener('message',event=>{
  if(event.data?.type!=='photocollection-local-file'||!event.ports[0])return;
  const port=event.ports[0];
  void(async()=>{
    try{
      const reference=parseLocalFileURL(event.data.url);if(!reference)throw new Error('Invalid local file reference.');
      port.postMessage({file:await readLocalReference(reference)});
    }catch(error){port.postMessage({status:error instanceof DOMException&&error.name==='NotFoundError'?404:409});}
    finally{port.close();}
  })();
});

let preparation:Promise<boolean>|undefined;
export function prepareLocalFiles(){return preparation??=new Promise<boolean>(resolve=>{
  if(!navigator.serviceWorker){resolve(false);return;}
  if(navigator.serviceWorker.controller){resolve(true);return;}
  const finish=(ready:boolean)=>{clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',changed);resolve(ready);};
  const changed=()=>{if(navigator.serviceWorker.controller)finish(true);};
  const timer=setTimeout(()=>finish(false),3000);navigator.serviceWorker.addEventListener('controllerchange',changed);
});}

const downloads=new Set<string>();
registerResourceReset(()=>{for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();});
function hold(url:string){downloads.add(url);setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(url);},60000);}
export async function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);try{await downloadFile(url,name);}finally{hold(url);}}
export async function openFile(source:string,target:Window){
  if(target.closed)return;
  const reference=parseLocalFileURL(source),file=reference?await readLocalReference(reference):null,url=file?URL.createObjectURL(file):source;
  if(target.closed){if(file)URL.revokeObjectURL(url);return;}
  try{target.location.replace(url);}catch(error){if(file)URL.revokeObjectURL(url);throw error;}
  if(file)hold(url);
}
export async function downloadFile(source:string,name=''){
  const reference=isLocalFileURL(source)?parseLocalFileURL(source):null;
  const file=reference?await readLocalReference(reference):null,url=file?URL.createObjectURL(file):source;
  const link=document.createElement('a');link.href=url;link.download=name||reference?.path.split('/').at(-1)||'';link.click();
  if(file)hold(url);
}
