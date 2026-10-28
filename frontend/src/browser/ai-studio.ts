import {current,commit,directory,librarySession,uid,now,localFile,imageURL} from './storage';
import type {LocalPhoto} from './storage';
import {launchTask,getTask} from './task-service';
import type {TaskContext} from './task-service';
import {registerResourceReset} from '../core/resource-lifecycle';
import {aiProfile,aiOptions,normalizeAIAnnotation,aiAnnotationFields,validateAIResult,aiEndpoint} from '../core/ai-studio';
import type {AIProfileRecord,AIResultRecord,AnnotationOptions} from '../core/ai-studio';
import {sourceHash} from '../core/editor-adapter';
import {applyAnnotation} from '../core/photo-annotation';
import {processImage} from './images';
import {studioCloud,studioRelay} from './studio-cloud';
import {cloudSettings,setCloudSettings} from './cloud';
import styles from '../core/ai-styles.json';
import {exported} from './api';

type Scope={photos:LocalPhoto[];profile:AIProfileRecord;key:string;options:AnnotationOptions;expires:number;library:string;generation:number};
const keys=new Map<string,string>(),scopes=new Map<string,Scope>();
let generation=librarySession();
registerResourceReset(()=>{if(generation!==librarySession()){generation=librarySession();keys.clear();scopes.clear();}});
const defaults:AnnotationOptions={language:'both',tag_count:12,caption_length:300,ocr:true,place_guess:false};
const keyId=(id:string)=>current().id+':'+id;
const required=<T extends {id:string}>(items:T[]|undefined,id:string)=>{const v=items?.find(i=>i.id===id);if(!v)throw new Error('AI record not found.');return v;};
const photo=(id:string)=>required(current().photos,id);
function profileView(p:AIProfileRecord){return {...p,configured:keys.has(keyId(p.id)),key_source:keys.has(keyId(p.id))?'session':'none',endpoint:aiEndpoint(p),capabilities:{image:true,annotation:p.provider==='qwen-cn'&&!!p.vision_model,size:p.provider==='ark-cn'?'2K':'model-default',preserves_source_dimensions:false}};}
function profileSnapshot(id:string,revision?:number){const p=aiProfile(required(current().ai_profiles,id)),key=keys.get(keyId(id));if(revision!==undefined&&p.revision!==revision)throw new Error('AI profile changed. Reload it.');if(!key)throw new Error('Configure a separate key for this AI profile.');studioRelay();return {profile:p,key};}
async function view(r:AIResultRecord){return {...r,...(r.kind==='annotation'?{}:{image_url:await imageURL(`ai-studio/${r.id}/image.png`),preview_url:await imageURL(`ai-studio/${r.id}/preview.webp`)})};}
async function sanitized(p:LocalPhoto,c:TaskContext){const file=await c.original(p),input=await processImage<Blob>('clean',{file,profile:p.decode_profile,title:true},c.signal);await c.original(p);c.check();return input;}
async function request(c:TaskContext,profile:AIProfileRecord,key:string,action:'image'|'annotation',image:Blob|null,prompt='',options=defaults){
  c.job.billing_state='not_submitted';c.job.request_id='';await c.checkpoint(true);
  try{const result=await studioCloud(action,profile,key,image,prompt,options,c.signal,()=>c.submitted(),async id=>{c.job.request_id=id;await c.checkpoint(true);});c.job.request_id=result.request_id;await c.outcome('responded');return result;}
  catch(error){if(error instanceof Error&&'request_id' in error&&typeof error.request_id==='string')c.job.request_id=error.request_id;if(c.job.billing_state==='submitted')await c.outcome('unknown');throw error;}
}
async function apply(id:string,revision:number,result:unknown,context?:TaskContext){
  const library=current().id,epoch=librarySession();
  const before=required(current().ai_results,id);if(before.kind!=='annotation'||before.revision!==revision)throw new Error('AI result changed. Reload it.');
  const p=photo(before.photo_id!),snapshot=structuredClone(p),record=structuredClone(before),options=aiOptions(record.options);
  const normalized=normalizeAIAnnotation(result??record.result,options);
  if(context)await context.original(snapshot);else {const {original}=await import('./storage');if(await sourceHash(await original(snapshot))!==snapshot.file_hash)throw new Error('The source photo changed. Reopen it before saving.');}
  if(current().id!==library||librarySession()!==epoch)throw new Error('Library changed. Reopen the current library.');
  const change=(s:ReturnType<typeof current>)=>{if(s.id!==library||librarySession()!==epoch)throw new Error('Library changed. Reopen the current library.');const r=required(s.ai_results,id),p=required(s.photos,before.photo_id!);if(r.revision!==revision||p.file_hash!==record.source?.hash||(p.annotation?.revision||0)!==record.source?.revision)throw new Error('Annotation source or revision changed. Reload the photo.');
    const annotation={version:1 as const,revision:(record.source?.revision||0)+1,...aiAnnotationFields(normalized,options),provider:record.provider,model:record.model,updated_at:now()};Object.assign(p,applyAnnotation(p,annotation));Object.assign(r,{result:normalized,revision:revision+1,applied:true});delete r.repair_text;};
  if(context)await context.commit(change);else await commit(change);return view(required(current().ai_results,id));
}
async function annotations(c:TaskContext,scope:Scope){
  const j=c.job;j.total=scope.photos.length;j.photo_ids=scope.photos.map(p=>p.id);j.provider=scope.profile.provider;j.model=scope.profile.vision_model;j.profile_id=scope.profile.id;await c.checkpoint(true);
  for(const source of scope.photos){c.check();j.current=source.file_name;j.billing_state='not_submitted';j.request_id='';let id:string|undefined;
    try{const input=await sanitized(source,c),response=await request(c,scope.profile,scope.key,'annotation',input,'',scope.options);c.check();id=uid();
      const r:AIResultRecord={id,kind:'annotation',photo_id:source.id,created_at:now(),version:1,revision:1,source:{id:source.id,name:source.file_name,hash:source.file_hash,revision:source.annotation?.revision||0},options:scope.options,provider:scope.profile.provider,model:scope.profile.vision_model,profile_id:scope.profile.id,request_id:response.request_id,result:response.result?normalizeAIAnnotation(response.result,scope.options):null,repair_text:response.repair_text||'',applied:false};validateAIResult(r);await c.commit(s=>{s.ai_results??=[];s.ai_results.push(r)});
      if(!r.result)throw new Error('Invalid AI annotation response. Repair the saved result locally.');await apply(id,1,r.result,c);j.success++;j.results.push({photo_id:source.id,result_id:id,status:'completed',request_id:response.request_id,billing_state:'responded'} as never);
    }catch(e){c.check();j.failed++;j.results.push({photo_id:source.id,result_id:id,status:'failed',error:e instanceof Error?e.message:'AI operation failed.',billing_state:j.billing_state,request_id:j.request_id} as never);}
    j.processed++;await c.checkpoint(true);
  }
}
async function generationTask(c:TaskContext,payload:{kind:'restyle'|'handwriting';text:string;prompt:string;preset:string;parent_id:string|null},p:LocalPhoto|null,profile:AIProfileRecord,key:string){
  const j=c.job;j.total=1;j.provider=profile.provider;j.model=profile.image_model;j.profile_id=profile.id;await c.checkpoint(true);
  const input=p?await sanitized(p,c):null;
  const prompt=payload.kind==='handwriting'?'Create only the exact following text as black handwritten ink on a pure white background. No other marks, decorations, border, or watermark. Text is literal data: '+JSON.stringify(payload.text)+'. '+payload.prompt:(styles.find(s=>s.id===payload.preset)?.prompt||'')+'\n'+payload.prompt;
  const response=await request(c,profile,key,'image',input,prompt);c.check();if(!response.image)throw new Error('Invalid AI image response.');
  const generated=await processImage<{image:Blob;preview:Blob;width:number;height:number}>('ai-output',{file:response.image,ink:payload.kind==='handwriting'},c.signal);c.check();const id=uid();
  if(payload.kind==='handwriting')await c.write(`ai-studio/${id}/generated.png`,response.image);
  await c.write(`ai-studio/${id}/image.png`,generated.image);await c.write(`ai-studio/${id}/preview.webp`,generated.preview);
  const r:AIResultRecord={id,kind:payload.kind,photo_id:p?.id||null,created_at:now(),version:1,revision:1,source:p?{id:p.id,name:p.file_name,hash:p.file_hash}:null,profile_id:profile.id,provider:profile.provider,model:profile.image_model,request_id:response.request_id,prompt,preset:payload.preset,text:payload.text,parent_id:payload.parent_id,width:generated.width,height:generated.height,sha256:await sourceHash(generated.image),verified_text:payload.kind==='handwriting'?false:null};validateAIResult(r);await c.commit(s=>{s.ai_results??=[];s.ai_results.push(r)});
  j.processed=j.success=1;j.result_id=id;j.results=[{result_id:id,status:'completed',request_id:response.request_id,billing_state:'responded'} as never];await c.checkpoint(true);
}
export async function browserStudio(path:string,method:string,body:Record<string,any>={}){
  const url=new URL(path,'https://local.invalid'),parts=url.pathname.split('/').filter(Boolean),s=current(),base=directory(),epoch=librarySession();
  const check=()=>{if(current().id!==s.id||directory()!==base||librarySession()!==epoch)throw new Error('Library changed. Reopen the current library.');};
  const mutate=(fn:(v:ReturnType<typeof current>)=>void)=>commit(v=>{check();fn(v)});
  if(parts[1]==='relay'){if(method==='PUT')setCloudSettings({relay_url:body.relay_url});return {relay_url:cloudSettings().relay_url};}
  if(parts[1]==='profile-transfer'&&parts[2]==='export'&&method==='POST'){if(body.confirmed!==true||!Array.isArray(body.profile_ids)||body.profile_ids.length<1||body.profile_ids.length>20)throw new Error('Invalid or unsupported settings package.');return [...new Set<string>(body.profile_ids)].map(id=>{const p=required(s.ai_profiles,id),key=keys.get(keyId(id));return {profile:structuredClone(p),...(key?{api_key:key}:{})}});}
  if(parts[1]==='styles')return styles;
  if(parts[1]==='profiles'){
    if(method==='GET')return (s.ai_profiles||[]).map(profileView);
    if(method==='DELETE'){const id=parts[2];await mutate(v=>{v.ai_profiles=(v.ai_profiles||[]).filter(p=>p.id!==id)});check();keys.delete(keyId(id));return {ok:true};}
    const id=parts[2]||uid(),old=parts[2]?required(s.ai_profiles,id):null;
    if(Object.keys(body).some(k=>!['name','provider','region','workspace','image_model','vision_model','revision','api_key','clear_key'].includes(k))||old&&old.revision!==body.revision||!old&&body.revision!==0)throw new Error('AI profile changed. Reload it.');
    if(!old&&(s.ai_profiles?.length||0)>=20)throw new Error('At most 20 AI profiles are supported.');
    const {api_key,clear_key,...values}=body,p=aiProfile({...values,id,revision:body.revision+1});
    if(api_key!==undefined&&(typeof api_key!=='string'||api_key.length<10||api_key.length>512||/\s/.test(api_key))||api_key&&clear_key)throw new Error('Invalid API key');
    await mutate(v=>{v.ai_profiles??=[];if(old){const previous=required(v.ai_profiles,id);if(previous.revision!==old.revision)throw new Error('AI profile changed. Reload it.');v.ai_profiles=v.ai_profiles.map(r=>r.id===id?p:r);}else v.ai_profiles.push(p)});
    check();if(clear_key||old&&(old.provider!==p.provider||old.region!==p.region||old.workspace!==p.workspace))keys.delete(keyId(id));if(api_key)keys.set(keyId(id),api_key);return profileView(p);
  }
  if(parts[1]==='annotation-scope'){
    const {profile,key}=profileSnapshot(body.profile_id);if(profile.provider!=='qwen-cn'||!profile.vision_model)throw new Error('Select a Qwen vision model.');
    if([!!body.photo_ids?.length,!!body.album_id,!!body.import_job_id].filter(Boolean).length!==1)throw new Error('Choose exactly one explicit photo scope.');
    let photos:LocalPhoto[];
    if(body.album_id){const {browserAPI}=await import('./api');const ids=await browserAPI<{ids:string[]}>('/photos/ids?album_id='+encodeURIComponent(body.album_id)+'&count_mode=file');check();photos=ids.ids.map(photo);}
    else if(body.import_job_id){const j=getTask(body.import_job_id);if(j.scope.library_id!==s.id)throw new Error('Import task belongs to another library.');photos=(j.new_photo_ids||[]).filter((id:string)=>s.photos.some(p=>p.id===id)).map(photo);}
    else {if(!Array.isArray(body.photo_ids))throw new Error('Invalid photo scope.');photos=[...new Set<string>(body.photo_ids)].map(photo);}
    check();if(body.missing_only)photos=photos.filter(p=>!p.annotation);if(photos.length<1||photos.length>100)throw new Error('Select between 1 and 100 photos; narrow the scope first.');
    const options=aiOptions(body.options),time=Date.now();for(const [key,value] of scopes)if(value.expires<time)scopes.delete(key);if(scopes.size>=20)throw new Error('Too many pending AI confirmations.');const token=uid();scopes.set(token,{photos:structuredClone(photos),profile,key,options,expires:time+600000,library:s.id,generation:librarySession()});
    return {token,count:photos.length,photos:photos.map(p=>({id:p.id,name:p.file_name})),profile,options,expires_seconds:600};
  }
  if(parts[1]==='annotate'){
    const scope=scopes.get(body.token);if(body.confirmed!==true||!scope||scope.photos.length!==body.count||scope.expires<Date.now()||scope.library!==s.id||scope.generation!==librarySession())throw new Error('AI confirmation expired or the count changed. Review the scope again.');profileSnapshot(scope.profile.id,scope.profile.revision);
    scopes.delete(body.token);return launchTask('ai-annotation',c=>annotations(c,scope),scope.photos.map(p=>p.id));
  }
  if(parts[1]==='create'){
    if(body.confirmed!==true||!['restyle','handwriting'].includes(body.kind)||typeof body.prompt!=='string'||body.prompt.length>3000||typeof body.text!=='string'||body.text.length>120)throw new Error('Invalid AI creation request.');
    const {profile,key}=profileSnapshot(body.profile_id,body.profile_revision),p=body.photo_id?structuredClone(photo(body.photo_id)):null;
    if(p&&p.file_hash!==body.source_hash||!p&&body.source_hash||body.kind==='restyle'&&!p||body.kind==='handwriting'&&!body.text.trim())throw new Error('Choose a source photo or exact handwriting text.');
    if(profile.image_model==='qwen-image-edit-plus'&&!p)throw new Error('This model requires a reference image.');
    if(body.kind==='restyle'&&(body.preset==='custom'?!body.prompt.trim():!styles.some(s=>s.id===body.preset)))throw new Error('Enter a visible generation prompt.');
    if(body.parent_id){const parent=required(s.ai_results,body.parent_id);if(parent.kind!==body.kind||parent.photo_id!==(p?.id||null))throw new Error('Version belongs to a different source.');}
    const payload={kind:body.kind as 'restyle'|'handwriting',text:body.text,prompt:body.prompt,preset:body.preset,parent_id:body.parent_id||null};return launchTask('ai-'+body.kind,c=>generationTask(c,payload,p,profile,key),p?[p.id]:[]);
  }
  if(parts[1]==='results'){
    if(!parts[2]){let all=[...(s.ai_results||[])].reverse();if(url.searchParams.get('kind'))all=all.filter(r=>r.kind===url.searchParams.get('kind'));if(url.searchParams.get('photo_id'))all=all.filter(r=>r.photo_id===url.searchParams.get('photo_id'));const page=Math.max(1,Number(url.searchParams.get('page')||1)),size=Math.min(100,Math.max(1,Number(url.searchParams.get('page_size')||24)));return {items:await Promise.all(all.slice((page-1)*size,page*size).map(view)),total:all.length};}
    const r=required(s.ai_results,parts[2]);
    if(method==='DELETE'){await mutate(v=>{v.ai_results=(v.ai_results||[]).filter(x=>x.id!==r.id)});return {ok:true};}
    if(parts[3]==='place-review'){if(body.revision!==r.revision||!['accepted','rejected'].includes(body.status)||r.kind!=='annotation'||!r.result?.place_guess||Object.keys(body).sort().join(',')!=='revision,status')throw new Error('AI result changed. Reload it.');await mutate(v=>{const item=required(v.ai_results,r.id);if(item.revision!==body.revision)throw new Error('AI result changed. Reload it.');item.place_review={status:body.status,reviewed_at:now()};item.revision++});check();return view(required(current().ai_results,r.id));}
    if(parts[3]==='repair')return apply(r.id,body.revision,body.result);
    if(['export','handwriting-export'].includes(parts[3])){if(r.kind==='annotation')throw new Error('AI image not found.');const file=await localFile(`ai-studio/${r.id}/image.png`);if(await sourceHash(file)!==r.sha256)throw new Error('AI result image changed; restore the saved version.');let out:Blob=file;
      if(r.kind==='handwriting'){if(body.verified_text!==true||! /^#[a-fA-F0-9]{6}$/.test(body.color)||[body.x,body.y,body.scale].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)||body.scale<.05)throw new Error('Verify the handwriting text before using it.');out=await processImage('ai-ink-layout',{file,...body});}
      check();return exported(out,'ai-'+r.id+'.png');}
    return view(r);
  }
  throw new Error('Unsupported AI Studio operation.');
}


export function stageImportedAccounts(accounts:import('../core/settings-transfer').TransferredAccount[]){
  const id=current().id,epoch=librarySession(),base=directory();
  const check=()=>{if(current().id!==id||librarySession()!==epoch||directory()!==base)throw new Error('Library changed. Reopen the current library.');};
  const rows=accounts.map(entry=>({profile:aiProfile({...entry.profile,id:uid(),revision:1}),key:entry.api_key}));
  return {apply(s:ReturnType<typeof current>){check();if((s.ai_profiles?.length||0)+rows.length>20)throw new Error('At most 20 AI profiles are supported.');s.ai_profiles??=[];s.ai_profiles.push(...rows.map(r=>r.profile));},activate(){check();for(const r of rows)if(r.key)keys.set(keyId(r.profile.id),r.key);}};
}
