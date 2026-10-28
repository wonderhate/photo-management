export type AIProfileRecord={id:string;name:string;provider:'qwen-cn'|'ark-cn';region:'cn-beijing';workspace:string;image_model:string;vision_model:string;revision:number};
export type AnnotationOptions={language:'zh'|'en'|'both';tag_count:number;caption_length:number;ocr:boolean;place_guess:boolean};
export type AIAnnotation={version:1;caption_zh:string;caption_en:string;tags:{zh:string;en:string}[];detected_text:string;place_guess:{name:string;confidence:number;evidence:string}|null};
export type AIResultRecord={id:string;kind:'annotation'|'restyle'|'handwriting';photo_id:string|null;created_at:string;version:1;revision:number;source:{id:string;name:string;hash:string;revision?:number}|null;provider:string;model:string;profile_id:string;request_id:string;options?:AnnotationOptions;result?:AIAnnotation|null;repair_text?:string;applied?:boolean;parent_id?:string|null;prompt?:string;preset?:string;text?:string;width?:number;height?:number;sha256?:string;verified_text?:boolean|null;place_review?:{status:'accepted'|'rejected';reviewed_at:string}};
const fail=()=>{throw new Error('Invalid AI configuration or result.');};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const token=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(v);
export function aiProfile(v:unknown):AIProfileRecord{
  if(!obj(v)||Object.keys(v).some(k=>!['id','name','provider','region','workspace','image_model','vision_model','revision'].includes(k))||!token(v.id)||typeof v.name!=='string'||!v.name.trim()||v.name.length>80||!['qwen-cn','ark-cn'].includes(String(v.provider))||v.region!=='cn-beijing'||typeof v.workspace!=='string'||! /^[a-zA-Z0-9-]{0,80}$/.test(v.workspace)||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||typeof v.image_model!=='string'||v.image_model.length>160||typeof v.vision_model!=='string'||v.vision_model.length>160)return fail();
  if(v.provider==='qwen-cn'&&(!['qwen-image-3.0','qwen-image-3.0-pro','qwen-image-edit-plus'].includes(v.image_model)||v.vision_model&&!/^qwen[\w.-]+$/.test(v.vision_model)))return fail();
  if(v.provider==='ark-cn'&&(v.workspace||v.vision_model||! /^(doubao-seedream-(4-0|4-5)-[0-9]+|ep-[a-zA-Z0-9-]+)$/.test(v.image_model)))return fail();
  return structuredClone(v) as AIProfileRecord;
}
export function aiOptions(v:unknown):AnnotationOptions{
  if(!obj(v)||Object.keys(v).sort().join(',')!=='caption_length,language,ocr,place_guess,tag_count'||!['zh','en','both'].includes(String(v.language))||!Number.isSafeInteger(v.tag_count)||Number(v.tag_count)<1||Number(v.tag_count)>30||!Number.isSafeInteger(v.caption_length)||Number(v.caption_length)<30||Number(v.caption_length)>1500||typeof v.ocr!=='boolean'||typeof v.place_guess!=='boolean')return fail();return {...v} as AnnotationOptions;
}
export function normalizeAIAnnotation(raw:unknown,options:AnnotationOptions):AIAnnotation{
  let v=raw;if(typeof v==='string'){if(v.length>64000)return fail();v=JSON.parse(v.trim().replace(/^```(?:json)?\s*|\s*```$/g,''));}
  if(!obj(v)||v.version!==1||Object.keys(v).some(k=>!['version','caption_zh','caption_en','tags','detected_text','place_guess'].includes(k))||!Array.isArray(v.tags)||v.tags.length>100)return fail();
  const str=(v:unknown,max:number)=>{if(typeof v!=='string'||v.includes('\0')||/[\uD800-\uDFFF]/u.test(v))return fail();return [...v.trim().normalize('NFKC')].slice(0,max).join('');};
  const seen=new Set<string>(),tags:{zh:string;en:string}[]=[];
  for(const t of v.tags){if(!obj(t)||Object.keys(t).sort().join(',')!=='en,zh')return fail();const pair={zh:str(t.zh,100),en:str(t.en,100)},id=pair.zh.toLowerCase()+'\0'+pair.en.toLowerCase();if(pair.zh&&pair.en&&!seen.has(id)){seen.add(id);tags.push(pair);}}
  const place=v.place_guess;let guess:AIAnnotation['place_guess']=null;
  if(place!=null){if(!obj(place)||Object.keys(place).sort().join(',')!=='confidence,evidence,name'||typeof place.confidence!=='number'||!Number.isFinite(place.confidence)||place.confidence<0||place.confidence>1)return fail();guess={name:str(place.name,120),evidence:str(place.evidence,500),confidence:place.confidence};}
  return {version:1,caption_zh:str(v.caption_zh,options.caption_length),caption_en:str(v.caption_en,options.caption_length),tags:tags.slice(0,options.tag_count),detected_text:options.ocr?str(v.detected_text??'',20000):'',place_guess:options.place_guess?guess:null};
}
export function aiAnnotationFields(r:AIAnnotation,o:AnnotationOptions){const languages:('zh'|'en')[]=o.language==='both'?['zh','en']:[o.language];return {caption:languages.map(l=>r[l==='zh'?'caption_zh':'caption_en']).filter(Boolean).join('\n'),tags:[...new Set(r.tags.flatMap(t=>languages.map(l=>t[l])))],detected_text:r.detected_text||null};}
export function validateAIResult(v:unknown):AIResultRecord{
  if(!obj(v)||!token(v.id)||v.version!==1||!['annotation','restyle','handwriting'].includes(String(v.kind))||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||typeof v.created_at!=='string'||!Number.isFinite(Date.parse(v.created_at))||v.photo_id!==null&&!token(v.photo_id)||!token(v.profile_id)||!['qwen-cn','ark-cn'].includes(String(v.provider))||typeof v.model!=='string'||v.model.length>160||typeof v.request_id!=='string'||v.request_id.length>200||JSON.stringify(v).length>100000)return fail();
  if(Object.keys(v).some(k=>!['id','kind','photo_id','created_at','version','revision','source','provider','model','profile_id','request_id','options','result','repair_text','applied','parent_id','prompt','preset','text','width','height','sha256','verified_text','place_review'].includes(k)))return fail();
  if(v.source!==null&&(!obj(v.source)||!token(v.source.id)||typeof v.source.name!=='string'||typeof v.source.hash!=='string'||! /^[a-f0-9]{64}$/.test(v.source.hash)))return fail();
  if(v.place_review!==undefined&&(!obj(v.place_review)||Object.keys(v.place_review).sort().join(',')!=='reviewed_at,status'||!['accepted','rejected'].includes(String(v.place_review.status))||typeof v.place_review.reviewed_at!=='string'||!Number.isFinite(Date.parse(v.place_review.reviewed_at))))return fail();
  if(v.parent_id!=null&&!token(v.parent_id))return fail();
  if(v.source&&obj(v.source)&&(Object.keys(v.source).some(k=>!['id','name','hash','revision'].includes(k))||String(v.source.name).length>1024||v.photo_id!==null&&v.source.id!==v.photo_id))return fail();
  if(v.kind==='annotation'){if(!obj(v.source)||!Number.isSafeInteger(v.source.revision)||Number(v.source.revision)<0||typeof v.applied!=='boolean'||v.applied&&v.result==null||v.place_review&&(!obj(v.result)||!v.result.place_guess))return fail();const o=aiOptions(v.options);if(v.result!=null)normalizeAIAnnotation(v.result,o);if(v.repair_text!==undefined&&(typeof v.repair_text!=='string'||v.repair_text.length>64000))return fail();}
  else if(!Number.isSafeInteger(v.width)||!Number.isSafeInteger(v.height)||Number(v.width)<1||Number(v.height)<1||Number(v.width)>8192||Number(v.height)>8192||v.kind==='restyle'&&!v.source||v.place_review!==undefined||Number(v.width)*Number(v.height)>40000000||typeof v.sha256!=='string'||! /^[a-f0-9]{64}$/.test(v.sha256)||typeof v.prompt!=='string'||v.prompt.length>5000||typeof v.text!=='string'||v.text.length>120)return fail();
  return structuredClone(v) as AIResultRecord;
}
export function aiEndpoint(p:AIProfileRecord){return p.provider==='ark-cn'?'https://ark.cn-beijing.volces.com/api/v3/images/generations':`https://${p.workspace?p.workspace+'.cn-beijing.maas.aliyuncs.com':'dashscope.aliyuncs.com'}/api/v1/services/aigc/multimodal-generation/generation`;}
