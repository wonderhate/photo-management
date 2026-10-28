import {TaskQueue} from '../core/task-queue';
import {assertLibraryWritable} from './maintenance';
import type {TaskResource} from '../core/task-queue';
import {registerResourceReset} from '../core/resource-lifecycle';
import {sourceHash} from '../core/editor-adapter';
import {summarizeTask} from '../workspace/task-summary';
import type {Job} from '../types';
import {current,directory,librarySession,commit,writeFile,localFile,original,uid,now} from './storage';
import type {Directory,Library,LocalPhoto} from './storage';

export type LocalTask=Job&Record<string,any>&{scope:{library_id:string;selected_ids?:string[]};updated_at:string};
const queue=new TaskQueue(),records=new Map<string,LocalTask>(),saved=new Map<string,number>();
const key=(scope:string,id:string)=>scope+':'+id;
const active=(j:Job)=>['queued','running'].includes(j.status);
const fields=['new_photo_ids','result_id','provider','model','profile_id','request_id','id','kind','status','phase','total','processed','success','skipped','failed','current','errors','error','results','parent_id','resource','billable','billing_state','billing_uncertain','child_count','active_child_id','scope','updated_at','finished_at','resume_policy','photo_id','photo_ids','artwork_id','suggestions','stage','stage_index','mirror_progress','preview_total','preview_processed','preview_failed'];
const mirrored=['total','processed','success','skipped','failed','current','errors','results','photo_id','photo_ids','artwork_id','suggestions','phase','stage','billing_state','request_id','provider','model'];
function snapshot(j:LocalTask):Job{
  const data=structuredClone(Object.fromEntries(fields.filter(k=>j[k]!==undefined).map(k=>[k,j[k]]))) as unknown as Job;
  for(const result of data.results||[])result.url='';return data;
}
function record(scope:string,id:string):LocalTask|undefined{return records.get(key(scope,id));}
function trim(value:Library){
  const ids=new Set(value.jobs.map(j=>j.id));
  const roots=value.jobs.filter(j=>!j.parent_id||!ids.has(j.parent_id));
  const finished=roots.filter(j=>!active(j)&&!queue.has(j.id)).sort((a,b)=>String((b as LocalTask).finished_at||(b as LocalTask).updated_at||'').localeCompare(String((a as LocalTask).finished_at||(a as LocalTask).updated_at||'')));
  const keep=new Set(roots.filter(j=>active(j)||queue.has(j.id)).concat(finished.slice(0,30)).map(j=>j.id));
  value.jobs=value.jobs.filter(j=>keep.has(j.id)||!!j.parent_id&&keep.has(j.parent_id));
}
export class TaskContext {
  constructor(readonly job:LocalTask,readonly root:LocalTask,readonly base:Directory,readonly signal:AbortSignal,readonly generation=librarySession()){}
  check(allowCancelled=false){if(current().id!==this.root.scope.library_id||directory()!==this.base||librarySession()!==this.generation)throw new Error('Library changed. Reopen the current library.');if(!allowCancelled)this.signal.throwIfAborted();}
  async commit(change:(value:Library)=>void,allowCancelled=false){this.check(allowCancelled);const result=await commit(s=>{this.check(allowCancelled);change(s);});this.check(allowCancelled);return result;}
  async file(path:string){this.check();const result=await localFile(path,this.base);this.check();return result;}
  async write(path:string,data:Blob|string,allowCancelled=false){this.check(allowCancelled);await writeFile(path,data,this.base);this.check(allowCancelled);}
  async original(photo:LocalPhoto){
    this.check();const file=await original(photo);this.check();
    if(file.size>256*1024*1024)throw new Error('Photo exceeds the 256 MiB browser import limit.');
    if(await sourceHash(file)!==photo.file_hash)throw new Error('The source photo changed. Reopen it before saving.');this.check();return file;
  }
  async checkpoint(force=false){
    this.check(true);this.job.updated_at=now();
    if(this.job!==this.root){for(const name of this.job.mirror_progress?mirrored:['current','billing_state'])if(this.job[name]!==undefined)this.root[name]=this.job[name];if(this.job.billing_uncertain)this.root.billing_uncertain=true;}
    this.root.updated_at=now();const scope=this.root.scope.library_id;
    if(!force&&Date.now()-(saved.get(key(scope,this.root.id))||0)<500)return;
    await this.commit(s=>{
      const family=[...records.values()].filter(j=>j.scope.library_id===scope&&(j.id===this.root.id||j.parent_id===this.root.id));
      const ids=new Set(family.map(j=>j.id));s.jobs=[...family.map(snapshot),...s.jobs.filter(j=>!ids.has(j.id))];trim(s);
    },true);saved.set(key(scope,this.root.id),Date.now());
    const retained=new Set(current().jobs.map(j=>j.id));for(const [id,j] of records)if(j.scope.library_id===scope&&!retained.has(j.id)&&!queue.has(j.parent_id||j.id))records.delete(id);
  }
  async stage(kind:string,run:(context:TaskContext)=>Promise<void>,mirror=true){
    this.check();if(this.job!==this.root||this.root.active_child_id)throw new Error('Only one active stage level is supported.');
    if((this.root.child_count||0)>=16)throw new Error('Too many task stages.');
    const child=baseTask(kind,this.root.scope,'running',this.root.resource as TaskResource);child.parent_id=this.root.id;child.mirror_progress=mirror;child.billable=this.root.billable;child.stage_index=this.root.child_count||0;
    const context=new TaskContext(child,this.root,this.base,this.signal,this.generation);records.set(key(child.scope.library_id,child.id),child);
    this.root.child_count=(this.root.child_count||0)+1;this.root.active_child_id=child.id;await context.checkpoint(true);
    try{await run(context);context.check();child.status='completed';}
    catch(error){child.status=this.signal.aborted?'cancelled':'failed';if(!this.signal.aborted)child.error=error instanceof Error?error.message:'Local operation failed.';throw error;}
    finally{child.finished_at=now();child.current='';this.root.active_child_id=null;await context.checkpoint(true);}
  }
  async activate(){this.check();const changed=this.job.status!=='running'||this.root.active_child_id!==this.job.id;this.job.status='running';this.root.active_child_id=this.job.id;if(changed)await this.checkpoint(true);}
  async complete(){this.check();this.job.status='completed';this.job.finished_at=now();this.job.current='';await this.checkpoint(true);}
  async stages(definitions:{kind:string;resource:TaskResource;mirror:boolean}[],run:(contexts:TaskContext[])=>Promise<void>){
    this.check();if(this.job!==this.root||this.root.active_child_id||(this.root.child_count||0)+definitions.length>16)throw new Error('Too many task stages.');
    const contexts=definitions.map(definition=>{
      const child=baseTask(definition.kind,this.root.scope,'queued',definition.resource);child.parent_id=this.root.id;child.mirror_progress=definition.mirror;child.stage_index=this.root.child_count||0;this.root.child_count=(this.root.child_count||0)+1;
      records.set(key(child.scope.library_id,child.id),child);return new TaskContext(child,this.root,this.base,this.signal,this.generation);
    });
    await this.checkpoint(true);let failure:unknown;
    try{await run(contexts);this.check();}catch(error){failure=error;throw error;}
    finally{
      for(const context of contexts)if(active(context.job)){context.job.status=this.signal.aborted?'cancelled':failure?'failed':'completed';context.job.finished_at=now();context.job.current='';if(failure&&!this.signal.aborted)context.job.error=failure instanceof Error?failure.message:'Local operation failed.';}
      this.root.active_child_id=null;await this.checkpoint(true);
    }
  }
  async render<T>(run:()=>Promise<T>){
    this.check();if(this.root.kind!=='import'||this.job.resource!=='render')throw new Error('Invalid render lease.');
    const resource=queue.snapshot(this.root.scope.library_id).items.find(item=>item.name==='render')!;
    if(resource.running||resource.queued){this.job.status='queued';this.root.active_child_id=this.job.id;await this.checkpoint(true);}
    return queue.borrow(this.root.id,this.job.id,async()=>{await this.activate();return run();});
  }
  async submitted(){this.check();this.job.billing_state='submitted';await this.checkpoint(true);this.check();}
  async outcome(state:'responded'|'unknown'){this.job.billing_state=state;if(state==='unknown')this.job.billing_uncertain=true;await this.checkpoint(true);}
}
function baseTask(kind:string,scope:LocalTask['scope'],status:string,resource:TaskResource):LocalTask{return {id:uid(),kind,status,total:0,processed:0,success:0,skipped:0,failed:0,current:'',errors:[],results:[],scope,resource,updated_at:now(),billable:(kind.startsWith('watercolor')||kind.startsWith('ai-')),billing_state:(kind.startsWith('watercolor')||kind.startsWith('ai-'))?'not_submitted':undefined,child_count:0,resume_policy:'manual'};}
export async function launchTask(kind:string,run:(context:TaskContext)=>Promise<void>,selectedIds:string[]=[]):Promise<LocalTask>{
  assertLibraryWritable();
  const scope={library_id:current().id,selected_ids:[...selectedIds]},base=directory(),generation=librarySession(),resource:TaskResource=kind.startsWith('vision-')?'local-ai':(kind.startsWith('watercolor')||kind.startsWith('ai-'))?'cloud':['export','appearance-index'].includes(kind)?'render':'io';
  const root=baseTask(kind,scope,'queued',resource);if(kind==='import')root.phase='scanning';
  let ready!:()=>void,rejectReady!:(error:unknown)=>void;const persisted=new Promise<void>((resolve,reject)=>{ready=resolve;rejectReady=reject;});
  void persisted.catch(()=>{});
  const done=queue.schedule(root.id,scope.library_id,resource,async signal=>{
    await persisted;const context=new TaskContext(root,root,base,signal,generation);context.check();root.status='running';await context.checkpoint(true);
    try{if(kind==='import'||kind==='video-import'||kind.startsWith('ai-')||kind.startsWith('vision-'))await run(context);else await context.stage(kind==='appearance-index'?'appearance-photos':kind==='export'?'export-render':kind==='watercolor'?'watercolor-image':'watercolor-titles',run);context.check();root.status='completed';}
    catch(error){root.status=signal.aborted?'cancelled':'failed';if(!signal.aborted)root.error=error instanceof Error?error.message:'Local operation failed.';throw error;}
    finally{root.current='';root.finished_at=now();await context.checkpoint(true);}
  });
  // Attach immediately, including when a queued cancellation rejects before start.
  void done.catch(async error=>{if(generation!==librarySession()||current().id!==scope.library_id||directory()!==base)return;if(root.status!=='cancelled'){root.status='failed';root.error=error instanceof Error?error.message:'Local operation failed.';}try{await new TaskContext(root,root,base,new AbortController().signal,generation).checkpoint(true);}catch{/* Existing durable records remain available for interruption recovery. */}});
  records.set(key(scope.library_id,root.id),root);
  try{await new TaskContext(root,root,base,new AbortController().signal,generation).checkpoint(true);ready();}
  catch(error){rejectReady(error);queue.cancel(root.id);throw error;}
  return structuredClone(root);
}
export function getTask(id:string):LocalTask{
  const scope=current().id,stored=record(scope,id)||current().jobs.find(j=>j.id===id);if(!stored)throw new Error('Record not found.');return stored as LocalTask;
}
export function recentTasks(summary=false){
  const all=current().jobs.map(j=>record(current().id,j.id)||j),ids=new Set(all.map(j=>j.id));
  const roots=all.filter(j=>!j.parent_id||!ids.has(j.parent_id)).sort((a,b)=>Number(active(b))-Number(active(a))||String((b as LocalTask).updated_at||'').localeCompare(String((a as LocalTask).updated_at||''))).slice(0,100);
  return summary?roots.map(j=>summarizeTask(j as Job&Record<string,unknown>)):roots;
}
export function taskChildren(id:string,page=1,pageSize=20){getTask(id);const all=current().jobs.map(j=>record(current().id,j.id)||j).filter(j=>j.parent_id===id).sort((a,b)=>Number((a as LocalTask).stage_index||0)-Number((b as LocalTask).stage_index||0));return {items:all.slice((page-1)*pageSize,page*pageSize).map(j=>summarizeTask(j as Job&Record<string,unknown>)),total:all.length};}
export async function cancelTask(id:string){
  const selected=getTask(id),rootId=selected.parent_id||selected.id,scope=current().id,root=getTask(rootId);
  if(!active(selected))return structuredClone(selected);
  const candidates=new Map([...current().jobs.filter(j=>j.id===rootId||j.parent_id===rootId),...[...records.values()].filter(j=>j.scope.library_id===scope&&(j.id===rootId||j.parent_id===rootId))].map(j=>[j.id,j]));
  const family=[...candidates.values()].map(j=>record(scope,j.id)||({...structuredClone(j),scope:{library_id:scope},updated_at:now()} as LocalTask));
  for(const j of family){records.set(key(scope,j.id),j);if(active(j)){j.status='cancelled';j.cancelled=true;j.finished_at=now();if(j.billing_state==='submitted'){j.billing_state='unknown';j.billing_uncertain=true;}}}
  queue.cancel(rootId);const currentRoot=record(scope,rootId)||root;
  await new TaskContext(currentRoot,currentRoot,directory(),new AbortController().signal).checkpoint(true);return structuredClone(getTask(id));
}
export const taskResources=()=>queue.snapshot(current().id);
export async function stopTasks(){
  const scope=current().id,roots=new Map([...current().jobs,...[...records.values()].filter(j=>j.scope.library_id===scope)].filter(j=>!j.parent_id&&active(j)).map(j=>[j.id,j]));
  await Promise.all([...roots.keys()].map(cancelTask));
}
let observedGeneration=librarySession();
registerResourceReset(()=>{
  if(observedGeneration===librarySession())return;observedGeneration=librarySession();
  for(const old of new Set([...records.values()].map(j=>j.scope.library_id)))queue.cancelScope(old);
  records.clear();saved.clear();
});
