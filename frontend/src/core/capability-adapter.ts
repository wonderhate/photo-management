import {IS_BROWSER} from '../runtime';
import {api} from '../api';
import {capability,browserInferenceCapabilities,rendererCapabilities,validateCapabilities} from './capabilities';
import type {Capabilities} from './capabilities';

export async function readCapabilities(signal?:AbortSignal):Promise<Capabilities>{
  const rendering=rendererCapabilities({worker:typeof Worker!=='undefined',canvas:typeof OffscreenCanvas!=='undefined',bitmap:typeof createImageBitmap==='function',wasm:typeof WebAssembly!=='undefined',isolated:crossOriginIsolated});
  if(!IS_BROWSER){const result=await api<Capabilities>('/workspace/capabilities','GET',undefined,signal);return validateCapabilities({...result,items:{...result.items,...rendering}});}
  const [{current,directory},{cloudSettings}]=await Promise.all([import('../browser/storage'),import('../browser/cloud')]);
  const permission=await directory().queryPermission({mode:'readwrite'});signal?.throwIfAborted();current();
  const picker=isSecureContext&&'showDirectoryPicker' in window;
  const directoryPicker=capability(picker?'available':'unavailable',picker?'source_permission_on_action':'picker_unavailable',picker,[],{permission:'on_user_action'},'native');
  return {version:1,runtime:'browser',items:{
    library:capability(permission==='granted'?'available':'degraded',permission==='granted'?'ready':'library_permission',permission==='granted',permission==='granted'?[]:['reconnect-library'],{engine:'file-system-access',permission}),
    ...rendering,watermark:{...rendering.darkroom},...browserInferenceCapabilities(cloudSettings()),
    filePicker:capability('available','source_permission_on_action',true,[],{engine:'file-input'},'native'),directoryPicker}};
}
