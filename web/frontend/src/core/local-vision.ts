import catalog from './vision-models.json';
import type {VisionSource} from './vision-assets';
export type VisionModelSpec=typeof catalog[number];
export type VisionModelStatus=VisionModelSpec&{installed:boolean;dependency:boolean;engine:string;network:'never'};
export type VisionPoint={x:number;y:number;label:0|1};
export type VisionInstance={id:string;points:VisionPoint[];feather:number};
export type VisionRequest={kind:'depth'|'segment';model_id:string;photo_id?:string|null;source:VisionSource;name:string;instances:VisionInstance[]};
export function localVisionModel(id:string,runtime:'native'|'browser'){const spec=catalog.find(m=>m.id===id&&m.runtime===runtime);if(!spec)throw new Error('Unknown local vision model.');return spec;}
export const localVisionModels=(runtime:'native'|'browser')=>catalog.filter(m=>m.runtime===runtime);
export function validateVisionRequest(v:VisionRequest,runtime:'native'|'browser'){
  const spec=localVisionModel(v.model_id,runtime);
  if(spec.kind!==v.kind||!v.source||!/^[a-f0-9]{64}$/.test(v.source.sha256)||!Number.isInteger(v.source.width)||!Number.isInteger(v.source.height)||v.source.width<1||v.source.height<1||v.source.width*v.source.height>100_000_000||typeof v.name!=='string'||!v.name.trim()||v.name.length>110||/[\u0000-\u001f\u007f]/.test(v.name)||!Array.isArray(v.instances)||v.instances.length>8||v.kind==='depth'&&v.instances.length||v.kind==='segment'&&!v.instances.length)throw new Error('Invalid local subject selection.');
  const ids=new Set<string>();for(const i of v.instances){if(!/^[a-z0-9-]{1,80}$/.test(i.id)||ids.has(i.id)||typeof i.feather!=='number'||!Number.isFinite(i.feather)||i.feather<0||i.feather>8||!Array.isArray(i.points)||!i.points.length||i.points.length>32||!i.points.some(p=>p.label===1))throw new Error('Invalid local subject selection.');ids.add(i.id);for(const p of i.points)if(![0,1].includes(p.label)||![p.x,p.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1))throw new Error('Invalid local subject selection.');}
  return spec;
}
