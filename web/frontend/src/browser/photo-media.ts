import {ResourcePool} from '../core/resource-pool';
import {parseMediaSource} from '../core/media-source';
import {registerResourceReset} from '../core/resource-lifecycle';

export const photoMediaPool=new ResourcePool(async(source,signal)=>{
  const reference=parseMediaSource(source);if(!reference)throw new Error('Invalid photo media reference.');
  if(reference.session)return (await import('./local-file-service')).readLocalReference({...reference,session:reference.session},signal);
  signal.throwIfAborted();const storage=await import('./storage');
  const generation=storage.librarySession(),base=storage.directory();
  if(storage.current().id!==reference.libraryID)throw new DOMException('Library changed','AbortError');
  const file=await storage.localFile(reference.path);signal.throwIfAborted();
  if(storage.current().id!==reference.libraryID||storage.directory()!==base||storage.librarySession()!==generation)throw new DOMException('Library changed','AbortError');return file;
},{concurrency:2,maxEntries:256,maxBytes:96*1024*1024});
export const clearPhotoMedia=()=>photoMediaPool.reset();
registerResourceReset(clearPhotoMedia);
