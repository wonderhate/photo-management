export type TagOrigin='user'|'ai';
export type PhotoAnnotation={version:1;revision:number;caption:string;tags:string[];detected_text:string|null;provider:string;model:string;updated_at:string};
export type AnnotationFields={tags:string[];tag_origins?:Record<string,TagOrigin>;rejected_ai_tags?:string[];user_description?:string|null;annotation?:PhotoAnnotation|null};
export type MetadataChanges={user_description?:string|null;tags?:string[];add_tags?:string[];remove_tags?:string[];restore_ai_tags?:string[]};
const fail=()=>{throw new Error('Invalid photo annotation.');};
export function annotationTags(value:unknown,limit=100,maxChars=100):string[]{
  if(!Array.isArray(value)||value.length>limit||value.some(v=>typeof v!=='string'))return fail();
  return [...new Set(value.map(v=>Array.from(v.trim()).slice(0,maxChars).join('')).filter(Boolean))];
}
export function userDescription(value:unknown):string|null{
  if(value===null)return null;if(typeof value!=='string'||Array.from(value).length>4000)return fail();return value.trim();
}
export function readAnnotation(value:unknown):PhotoAnnotation{
  const a=value as PhotoAnnotation;
  if(!a||Array.isArray(a)||typeof a!=='object'||Object.keys(a).some(k=>!['version','revision','caption','tags','detected_text','provider','model','updated_at'].includes(k))||a.version!==1||!Number.isSafeInteger(a.revision)||a.revision<1||typeof a.caption!=='string'||Array.from(a.caption).length>4000||a.detected_text!==null&&(typeof a.detected_text!=='string'||Array.from(a.detected_text).length>20000)||typeof a.provider!=='string'||!a.provider.trim()||a.provider.length>80||typeof a.model!=='string'||!a.model.trim()||a.model.length>160||typeof a.updated_at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(a.updated_at)||!Number.isFinite(Date.parse(a.updated_at)))return fail();
  return {...a,tags:annotationTags(a.tags),caption:a.caption.trim(),provider:a.provider.trim(),model:a.model.trim()};
}
export function annotationInput(value:unknown){
  const v=value as Record<string,unknown>;
  if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).some(k=>!['version','caption','tags','detected_text','provider','model','expected_revision','source_hash'].includes(k))||!Number.isSafeInteger(v.expected_revision)||Number(v.expected_revision)<0||typeof v.source_hash!=='string'||!/^[a-f0-9]{64}$/.test(v.source_hash))return fail();
  return {annotation:readAnnotation({version:v.version,revision:Number(v.expected_revision)+1,caption:v.caption,tags:v.tags,detected_text:v.detected_text??null,provider:v.provider,model:v.model,updated_at:new Date().toISOString()}),expected_revision:Number(v.expected_revision),source_hash:v.source_hash};
}
export function annotationView(p:AnnotationFields){
  const user=p.user_description!=null,caption=p.annotation?.caption||'';
  return {user_description:p.user_description??null,annotation:p.annotation??null,tag_origins:Object.fromEntries(p.tags.map(t=>[t,Object.hasOwn(p.tag_origins||{},t)?p.tag_origins![t]:'user'])) as Record<string,TagOrigin>,rejected_ai_tags:p.rejected_ai_tags||[],description:(user?p.user_description:caption)?.trim()||null,description_source:user?'user' as const:caption?'ai' as const:null};
}
export function editPhotoTags(p:AnnotationFields,changes:MetadataChanges){
  const manualNames=(value:unknown,limit=100)=>annotationTags(value,limit,200);
  let tags=[...p.tags];const origins=Object.assign(Object.create(null),annotationView(p).tag_origins) as Record<string,TagOrigin>,rejected=new Set(p.rejected_ai_tags||[]);
  const remove=(name:string)=>{tags=tags.filter(t=>t!==name);delete origins[name];rejected.add(name);};
  const add=(name:string,origin:TagOrigin)=>{if(!tags.includes(name))tags.push(name);origins[name]=origin;};
  if(changes.tags!==undefined){const wanted=manualNames(changes.tags,200);for(const old of tags)if(!wanted.includes(old))remove(old);tags=wanted;for(const tag of tags){origins[tag]='user';rejected.delete(tag);}}
  for(const tag of manualNames(changes.add_tags||[])){add(tag,'user');rejected.delete(tag);}
  for(const tag of manualNames(changes.remove_tags||[]))remove(tag);
  for(const tag of manualNames(changes.restore_ai_tags||[])){rejected.delete(tag);if(p.annotation?.tags.includes(tag)&&!tags.includes(tag))add(tag,'ai');}
  if(rejected.size>5000)return fail();
  return {tags,tag_origins:Object.fromEntries(tags.map(tag=>[tag,origins[tag]||'user'])) as Record<string,TagOrigin>,rejected_ai_tags:[...rejected].sort()};
}
export function applyAnnotation(p:AnnotationFields,a:PhotoAnnotation){
  const origins=annotationView(p).tag_origins,rejected=new Set(p.rejected_ai_tags||[]),tags=p.tags.filter(t=>origins[t]==='user');
  for(const tag of a.tags)if(!rejected.has(tag)&&!tags.includes(tag))tags.push(tag);
  return {annotation:a,tags,tag_origins:Object.fromEntries(tags.map(t=>[t,origins[t]==='user'?'user':'ai'])) as Record<string,TagOrigin>};
}
export function validateAnnotationFields(p:AnnotationFields){
  if(p.user_description!==undefined)userDescription(p.user_description);
  if(p.annotation!=null)readAnnotation(p.annotation);
  if(p.rejected_ai_tags!==undefined){const names=annotationTags(p.rejected_ai_tags,5000,200);if(names.length!==p.rejected_ai_tags.length||names.some((v,i)=>v!==p.rejected_ai_tags![i]))return fail();}
  if(p.tag_origins!==undefined&&(!p.tag_origins||typeof p.tag_origins!=='object'||Array.isArray(p.tag_origins)||Object.entries(p.tag_origins).some(([name,origin])=>!p.tags.includes(name)||!['user','ai'].includes(origin))))return fail();
  if(p.tags.some(t=>p.rejected_ai_tags?.includes(t)))return fail();
}
