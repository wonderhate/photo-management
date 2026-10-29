import {localVisionModel,localVisionModels} from '../core/local-vision';
import type {VisionModelSpec,VisionModelStatus} from '../core/local-vision';
import {sourceHash} from '../core/editor-adapter';
import {registerResourceReset} from '../core/resource-lifecycle';
import {isTemporaryLibrary,librarySession} from './storage';

type Package={id:string;files:{name:string;blob:Blob}[]};
// Demo model imports are private to this session, just like its photos/assets.
const temporaryModels=new Map<string,Package>();
let temporaryGeneration=librarySession();
registerResourceReset(()=>{if(temporaryGeneration!==librarySession()){temporaryModels.clear();temporaryGeneration=librarySession();}});
function scope(){
  const generation=librarySession(),temporary=isTemporaryLibrary();
  const check=()=>{if(librarySession()!==generation||isTemporaryLibrary()!==temporary)throw new DOMException('The editing session has ended.','AbortError');};
  return {temporary,check};
}
function open(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('photocollection-local-vision',1);request.onupgradeneeded=()=>request.result.createObjectStore('models',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Local model storage is unavailable.'));request.onblocked=()=>reject(new Error('Close other PhotoCollection tabs before importing a model.'));});}
async function read(spec:VisionModelSpec){
  const session=scope();session.check();
  if(session.temporary)return temporaryModels.get(spec.id+':'+spec.revision);
  const db=await open();try{session.check();const data=await new Promise<Package|undefined>((resolve,reject)=>{const tx=db.transaction('models','readonly'),r=tx.objectStore('models').get(spec.id+':'+spec.revision);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Local model storage is unavailable.'));});session.check();return data;}finally{db.close();}
}
export async function browserVisionModels():Promise<VisionModelStatus[]>{const session=scope();const values=await Promise.all(localVisionModels('browser').map(async spec=>({...spec,installed:!!await read(spec),dependency:typeof WebAssembly!=='undefined',engine:'onnx-wasm',network:'never' as const})));session.check();return values;}
export async function importVisionModel(id:string,files:File[],confirmed:boolean){
  const session=scope();
  if(!confirmed)throw new Error('Confirm the local model license before importing.');const spec=localVisionModel(id,'browser');if(files.length!==spec.files.length||new Set(files.map(f=>f.name)).size!==files.length)throw new Error('Choose every file in the pinned model manifest.');const data:Package={id:id+':'+spec.revision,files:[]};
  for(const expected of spec.files){const file=files.find(f=>f.name===expected.name.split('/').at(-1));if(!file||file.size!==expected.bytes||await sourceHash(file)!==expected.sha256)throw new Error('Model file does not match its pinned checksum.');session.check();data.files.push({name:expected.name,blob:file});}
  session.check();if(session.temporary){temporaryModels.set(data.id,data);return;}
  const db=await open();try{session.check();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('models','readwrite');tx.objectStore('models').put(data);tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(new Error('Local model storage is unavailable.'));});session.check();}finally{db.close();}
}
export async function visionModelFiles(id:string){const session=scope(),spec=localVisionModel(id,'browser'),data=await read(spec);session.check();if(!data)throw new Error('Import the pinned local model files before running inference.');for(const expected of spec.files){const f=data.files.find(f=>f.name===expected.name);if(!f||f.blob.size!==expected.bytes||await sourceHash(f.blob)!==expected.sha256)throw new Error('Model file does not match its pinned checksum.');session.check();}return data.files;}
