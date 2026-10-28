// Immutable, per-library PNG assets. Filenames/paths/URLs never enter recipes.
export type VisionSource={sha256:string;width:number;height:number};
export type VisionModel={id:'depth-anything-v2-small'|'slimsam-uniform-50'|'slimsam-uniform-77';revision:string;engine:'transformers-cpu'|'onnx-wasm';license:'Apache-2.0'};
export type VisionAsset={version:1;id:string;kind:'sticker'|'depth';name:string;width:number;height:number;bytes:number;created_at:string;source:VisionSource|null;model:VisionModel|null;instance_id:string|null;hidden:boolean};
export type DepthOcclusion={asset_hash:string;source_hash:string;threshold:number;feather:number;invert:boolean};
export const VISION_MAX_PIXELS=16_777_216;
export const VISION_MAX_BYTES=64*1024*1024;
export const assetHash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function fail():never{throw new Error('Invalid local vision asset.');}
function object(v:unknown,keys:string[]):asserts v is Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))fail();}
const integer=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
export function validateVisionAsset(v:unknown):asserts v is VisionAsset{
  object(v,['version','id','kind','name','width','height','bytes','created_at','source','model','instance_id','hidden']);
  if(v.version!==1||!assetHash(v.id)||!['sticker','depth'].includes(v.kind as string)||typeof v.name!=='string'||!v.name.trim()||v.name.length>120||/[\u0000-\u001f\u007f]/.test(v.name)||typeof v.hidden!=='boolean')fail();
  if(!integer(v.width,1,8192)||!integer(v.height,1,8192)||(v.width as number)*(v.height as number)>VISION_MAX_PIXELS||!integer(v.bytes,1,VISION_MAX_BYTES)||typeof v.created_at!=='string'||!Number.isFinite(Date.parse(v.created_at)))fail();
  if(v.source!==null){object(v.source,['sha256','width','height']);if(!assetHash(v.source.sha256)||!integer(v.source.width,1,100_000_000)||!integer(v.source.height,1,100_000_000)||(v.source.width as number)*(v.source.height as number)>100_000_000)fail();}
  if(v.model!==null){object(v.model,['id','revision','engine','license']);if(!['depth-anything-v2-small','slimsam-uniform-50','slimsam-uniform-77'].includes(v.model.id as string)||typeof v.model.revision!=='string'||!/^[a-f0-9]{40,64}$/.test(v.model.revision)||!['transformers-cpu','onnx-wasm'].includes(v.model.engine as string)||v.model.license!=='Apache-2.0')fail();}
  if(v.instance_id!==null&&(typeof v.instance_id!=='string'||!/^[a-z0-9-]{1,80}$/.test(v.instance_id)))fail();
  if(v.kind==='depth'&&(!v.source||!v.model||v.model.id!=='depth-anything-v2-small'))fail();
}
export function validateDepthOcclusion(v:unknown):asserts v is DepthOcclusion{
  object(v,['asset_hash','source_hash','threshold','feather','invert']);
  if(!assetHash(v.asset_hash)||!assetHash(v.source_hash)||typeof v.threshold!=='number'||!Number.isFinite(v.threshold)||v.threshold<0||v.threshold>1||typeof v.feather!=='number'||!Number.isFinite(v.feather)||v.feather<0||v.feather>.5||typeof v.invert!=='boolean')fail();
}
// White is near; threshold is relative inverse depth, never a metric distance.
export function depthVisibility(value:number,settings:DepthOcclusion){
  const near=settings.invert?1-value:value,w=settings.feather;
  if(w===0)return near>settings.threshold?0:1;
  const t=Math.max(0,Math.min(1,(near-settings.threshold+w)/(2*w)));
  return 1-t*t*(3-2*t);
}
