import {ResourcePool} from '../core/resource-pool';
import {parseDisplayKey} from '../core/display-request';
import {editorServices,sourceHash} from '../core/editor-adapter';
import {registerResourceReset} from '../core/resource-lifecycle';
import {IS_BROWSER} from '../runtime';
import {readDisplayCache,writeDisplayCache,browserDisplayEngine,DISPLAY_WORKER_NATIVE_VERSION} from '../core/display-cache';
import {sourceDecodeProfile} from '../core/source-decode-profile';
import {displayLibraryId} from './display-library';

// One heavy decoder at a time. Idle entries contain compressed display JPEGs only.
export const displayPool=new ResourcePool(async(key,signal)=>{
  const request=parseDisplayKey(key),services=await editorServices();signal.throwIfAborted();
  if(IS_BROWSER){const {current}=await import('../browser/storage');if(current().id!==request.scope)throw new DOMException('Library changed','AbortError');}
  const {file,photo}=await services.library.photo(request.id,signal);
  if(file.size>256*1024*1024)throw new Error('Photo exceeds the 256 MiB browser import limit.');
  if(photo.file_hash!==request.hash||await sourceHash(file)!==request.hash)throw new Error('The source photo changed. Reopen it before saving.');
  const profile=sourceDecodeProfile(photo.decode_profile);
  if(IS_BROWSER&&JSON.stringify(profile)!==JSON.stringify(sourceDecodeProfile(request.profile)))throw new Error('Unsupported source decoding profile.');
  signal.throwIfAborted();
  const native=IS_BROWSER?null:await import('./native-display');
  const fallback=!!native?.needsNativeDisplay(file.name),engine=fallback?(await native!.nativeDisplayFacts()).engine:IS_BROWSER?browserDisplayEngine(profile):DISPLAY_WORKER_NATIVE_VERSION;
  const spec={library:await displayLibraryId(),request,engine};signal.throwIfAborted();
  const cached=await readDisplayCache(spec,signal);signal.throwIfAborted();if(cached)return cached;
  if(fallback){const blob=await native!.renderNativeDisplay(request,signal);signal.throwIfAborted();await writeDisplayCache(spec,blob,signal);return blob;}
  const worker=services.render.session(),cancel=()=>worker.dispose();signal.addEventListener('abort',cancel,{once:true});
  try{signal.throwIfAborted();const orientation=IS_BROWSER?profile.extra_orientation:await(await import('./native-orientation')).nativeDisplayOrientation(file,photo.orientation,signal);const result=await worker.display(file,request.edge,IS_BROWSER?'black':'white',orientation);signal.throwIfAborted();await writeDisplayCache(spec,result.blob,signal);return result.blob;}
  finally{signal.removeEventListener('abort',cancel);worker.dispose();}
},{concurrency:1,maxEntries:12,maxBytes:48*1024*1024});
registerResourceReset(()=>displayPool.reset());
