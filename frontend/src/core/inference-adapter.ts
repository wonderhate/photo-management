import {IS_BROWSER} from '../runtime';
import {api} from '../api';
import {bt} from '../browser/text';
import type {AIStatus,Job} from '../types';
export type ArtLayout={title:string;title_source:'manual'|'suggested'|'none';title_evidence:string;layout:'airy'|'reference';font:string;paper:number};
export type ArtBatchResult={photo_id:string;file_name:string;artwork_id?:string;error?:string;title?:string;title_status?:string;title_error?:string;billing_state?:string;title_billing_state?:string;request_id?:string;title_request_id?:string};
export type ArtJob=Omit<Job,'results'>&{photo_id?:string;photo_ids?:string[];artwork_id?:string;suggestions?:{title:string;evidence:string}[];results?:ArtBatchResult[];stage?:string;title_processed?:number;title_total?:number};
export type TitleRequest={photo_id:string;keywords:string;language:'zh'|'en'};
export type WatercolorRequest={photo_id:string;layout:ArtLayout;title_confirmed:boolean;quality:string;description:string};
export type BatchWatercolorRequest={photo_ids:string[];layout:ArtLayout;quality:string;description:string;generate_titles:boolean;keywords:string;language:'zh'|'en'};
export interface InferenceAdapter {
  semanticStatus(signal?:AbortSignal):Promise<AIStatus>;
  loadSemantic(download:boolean):Promise<AIStatus>;
  faceModels():Promise<Job>;
  analyzeFaces(threshold:number):Promise<Job>;
  titles(value:TitleRequest):Promise<ArtJob>;
  watercolor(value:WatercolorRequest):Promise<ArtJob>;
  batchWatercolor(value:BatchWatercolorRequest):Promise<ArtJob>;
}
function nativeOnly(){if(IS_BROWSER)throw new Error('This local model requires the desktop or local backend version.');}
async function watercolorCloud(path:string,value:TitleRequest|WatercolorRequest|BatchWatercolorRequest):Promise<ArtJob>{
  const payload=structuredClone(value);
  if(IS_BROWSER)return api(path,'POST',payload); // Browser transport confirms the exact relay before upload.
  const settings=await api<{endpoint:string;image_model:string;title_model:string}>('/art/settings');
  const count='photo_ids' in payload?payload.photo_ids.length:1;
  const titles=path.endsWith('/titles')||'generate_titles' in payload&&payload.generate_titles;
  const models=path.endsWith('/titles')?settings.title_model:settings.image_model+(titles?' + '+settings.title_model:'');
  if(!confirm(bt(`将发送 ${count} 张所选照片到 ${settings.endpoint}。模型：${models}。已移除 EXIF/GPS，服务可能计费${titles?'（包含标题建议）':''}；断连后不会自动重试。继续？`,`Send ${count} selected photo(s) to ${settings.endpoint}? Models: ${models}. EXIF/GPS are removed. Charges may apply${titles?' (including title suggestions)':''}; disconnections are never retried automatically. Continue?`)))throw new Error(bt('已取消云端请求。','Cloud request cancelled.'));
  return api(path,'POST',{...payload,cloud_confirmed:true});
}
// Adapters reuse the existing local engines and cloud consent/submission workflows.
// Creating/reading the adapter never starts inference, downloads or a paid retry.
export const inferenceAdapter:InferenceAdapter={
  semanticStatus:signal=>api('/ai/status','GET',undefined,signal),
  loadSemantic(download){nativeOnly();return api('/ai/load?download='+download,'POST');},
  faceModels(){nativeOnly();return api('/faces/models','POST',{});},
  analyzeFaces(threshold){nativeOnly();return api('/faces/analyze','POST',{threshold});},
  titles:value=>watercolorCloud('/art/titles',value),
  watercolor:value=>watercolorCloud('/art/generate',value),
  batchWatercolor(value){nativeOnly();return watercolorCloud('/art/batch',value);}
};
