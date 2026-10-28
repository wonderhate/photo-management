import {current,now} from './storage';
import {launchTask} from './task-service';
import type {TaskContext} from './task-service';
import {sourceHash} from '../core/editor-adapter';
import {validateVisionAsset} from '../core/vision-assets';
import type {VisionAsset} from '../core/vision-assets';
import {validateVisionRequest} from '../core/local-vision';
import type {VisionRequest} from '../core/local-vision';
import {visionModelFiles} from './vision-models';
import {createVisionAssets} from './vision-assets';
type Output={blob:Blob;width:number;height:number;instance_id:string|null};
function infer(payload:VisionRequest,image:Blob,files:{name:string;blob:Blob}[],signal:AbortSignal){return new Promise<Output[]>((resolve,reject)=>{const worker=new Worker(new URL('./vision-worker.ts',import.meta.url),{type:'module'}),timer=setTimeout(()=>{done();reject(new Error('Local vision request timed out.'));},300000),cancel=()=>{done();reject(new DOMException('Cancelled','AbortError'));};function done(){clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.terminate();}signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return;}worker.onmessage=({data})=>{done();if(data.error)reject(new Error(data.error));else resolve(data.items);};worker.onerror=()=>{done();reject(new Error('Local vision inference failed. Check the model files and available memory.'));};worker.postMessage({payload,image,files});});}
async function sourceCheck(c:TaskContext,p:VisionRequest){c.check();if(p.photo_id){const photo=current().photos.find(photo=>photo.id===p.photo_id);if(!photo||photo.file_hash!==p.source.sha256)throw new Error('The source photo changed. Reopen it before saving.');await c.original(photo);}}
export async function startLocalVision(payload:VisionRequest,image:Blob){
  const spec=validateVisionRequest(payload,'browser'),frozen=structuredClone(payload);
  return launchTask('vision-'+payload.kind,async c=>{
    await sourceCheck(c,frozen);const files=await visionModelFiles(spec.id);c.check();c.job.total=frozen.kind==='depth'?1:frozen.instances.length;await c.checkpoint(true);
    const cacheId=frozen.kind==='depth'?'depth-'+await sourceHash(image):null;
    if(cacheId){const previous=current().vision_assets?.find(a=>a.kind==='depth'&&a.instance_id===cacheId&&JSON.stringify(a.source)===JSON.stringify(frozen.source)&&a.model?.revision===spec.revision);if(previous){await createVisionAssets().source(previous.id);await sourceCheck(c,frozen);c.job.results=[{asset_id:previous.id,instance_id:cacheId} as never];c.job.processed=c.job.success=1;await c.checkpoint(true);return;}}
    const outputs=await infer(frozen,image,files,c.signal);await sourceCheck(c,frozen);if(outputs.length!==c.job.total)throw new Error('Invalid local vision output.');
    for(const [i,out] of outputs.entries()){
      c.check();const id=await sourceHash(out.blob);await sourceCheck(c,frozen);
      const record:VisionAsset={version:1,id,kind:frozen.kind==='depth'?'depth':'sticker',name:frozen.kind==='depth'?frozen.name:frozen.name+' '+(i+1),width:out.width,height:out.height,bytes:out.blob.size,created_at:now(),source:frozen.source,model:{id:spec.id as NonNullable<VisionAsset['model']>['id'],revision:spec.revision,engine:'onnx-wasm',license:'Apache-2.0'},instance_id:cacheId||out.instance_id,hidden:false};validateVisionAsset(record);
      const existing=current().vision_assets?.find(a=>a.id===id);if(existing&&(existing.kind!==record.kind||record.kind==='depth'&&JSON.stringify(existing.source)!==JSON.stringify(record.source)))throw new Error('Local vision asset provenance conflicts.');
      if(!existing){await c.write('stickers/'+id+'.png',out.blob);await c.commit(s=>{s.vision_assets??=[];if(!s.vision_assets.some(a=>a.id===id))s.vision_assets.push(record);});}
      c.job.results.push({asset_id:id,instance_id:record.instance_id} as never);c.job.processed++;c.job.success++;await c.checkpoint(true);
    }
  },payload.photo_id?[payload.photo_id]:[]);
}
