/** External RAW associations are manual catalog links, never CaptureGroups. */
export type RawSource={version:1;id:string;file_hash:string;file_name:string;file_size:number;path:string;source_id:string|null;date_taken:string|null;camera_make:string|null;camera_model:string|null;lens_model:string|null;registered_at:string};
export type RawRelation={version:1;photo_id:string;photo_hash:string;revision:number;raw_id:string|null;confirmed_at:string};
export type RawCandidate={source:RawSource;score:number;evidence:('name'|'time'|'camera')[];conflicts:('time'|'camera')[]};
export type RawConfirmation={photo_hash:string;expected_revision:number;raw_id:string|null;confirmed:true};
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw new Error('Invalid RAW source record.');};
const timestamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(v);
const text=(v:unknown,max:number)=>typeof v==='string'&&[...v].length<=max&&!/[\u0000-\u001f\u007f]/.test(v)&&![...v].some(c=>c.codePointAt(0)!>=0xd800&&c.codePointAt(0)!<=0xdfff);
export function validateRawSource(v:unknown):asserts v is RawSource{
  if(!object(v)||Object.keys(v).some(k=>!['version','id','file_hash','file_name','file_size','path','source_id','date_taken','camera_make','camera_model','lens_model','registered_at'].includes(k))||v.version!==1||!hash(v.id)||v.id!==v.file_hash||!text(v.file_name,512)||!v.file_name||!Number.isSafeInteger(v.file_size)||Number(v.file_size)<1||!text(v.path,32768)||!v.path||v.source_id!==null&&!id(v.source_id)||!timestamp(v.registered_at))return fail();
  for(const key of ['date_taken','camera_make','camera_model','lens_model'])if(v[key]!==null&&!text(v[key],512))return fail();
  if(v.source_id!==null&&(String(v.path).includes('\\')||String(v.path).includes(':')||String(v.path).split('/').some(p=>!p||p==='.'||p==='..')))return fail();
}
export function validateRawRelation(v:unknown):asserts v is RawRelation{
  if(!object(v)||Object.keys(v).some(k=>!['version','photo_id','photo_hash','revision','raw_id','confirmed_at'].includes(k))||v.version!==1||!id(v.photo_id)||!hash(v.photo_hash)||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||v.raw_id!==null&&!hash(v.raw_id)||!timestamp(v.confirmed_at))return fail();
}
export function rawConfirmation(v:unknown):RawConfirmation{
  if(!object(v)||Object.keys(v).some(k=>!['photo_hash','expected_revision','raw_id','confirmed'].includes(k))||!hash(v.photo_hash)||!Number.isSafeInteger(v.expected_revision)||Number(v.expected_revision)<0||v.raw_id!==null&&!hash(v.raw_id)||v.confirmed!==true)return fail();return v as RawConfirmation;
}
const stem=(name:string)=>name.replace(/\.[^.]+$/,'').normalize('NFKC').toLowerCase();
const camera=(name:string|null|undefined)=>(name||'').normalize('NFKC').trim().toLowerCase();
function seconds(value:string|null|undefined){if(!value||value.length<19)return null;const date=Date.parse(value.slice(0,19)+'Z');return Number.isFinite(date)?date/1000:null;}
export function rawCandidate(photo:{file_name:string;date_taken?:string|null;camera_model?:string|null},source:RawSource):RawCandidate{
  const evidence:RawCandidate['evidence']=[],conflicts:RawCandidate['conflicts']=[];
  if(stem(photo.file_name)===stem(source.file_name))evidence.push('name');
  const a=seconds(photo.date_taken),b=seconds(source.date_taken);if(a!==null&&b!==null)(Math.abs(a-b)<=2?evidence:conflicts).push('time');
  const ac=camera(photo.camera_model),bc=camera(source.camera_model);if(ac&&bc)(ac===bc?evidence:conflicts).push('camera');
  return {source,evidence,conflicts,score:(evidence.includes('name')?4:0)+(evidence.includes('time')?6:0)+(evidence.includes('camera')?1:0)-conflicts.length*8};
}
