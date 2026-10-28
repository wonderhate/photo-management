import type {Job} from './types';
export interface RecentPayload {draft?:string;urls?:string[];libraryId?:string;job?:string;file?:{path?:string;url?:string;name:string}}
export interface RecentOp {kind:'import'|'export'|'draft';label:string;time:number;payload?:RecentPayload}
const KEY='recent-ops';
export function normalizeRecent(value:unknown):RecentOp[]{
  if(!Array.isArray(value))return [];
  return value.filter((op):op is RecentOp=>!!op&&['import','export','draft'].includes(op.kind)&&typeof op.label==='string'&&op.label.length<=512&&Number.isFinite(op.time)&&(!op.payload||typeof op.payload==='object'&&!Array.isArray(op.payload))).slice(0,12).map(op=>{
    const p=op.payload,short=(v:unknown,max=2048)=>typeof v==='string'&&v.length<=max?v:undefined;
    return {...op,payload:p?{draft:short(p.draft,80),libraryId:short(p.libraryId,80),job:short(p.job,80),urls:Array.isArray(p.urls)?p.urls.filter((v:unknown)=>short(v)).slice(0,1):undefined,file:p.file&&typeof p.file==='object'&&short(p.file.name,255)?{path:short(p.file.path),url:short(p.file.url),name:p.file.name}:undefined}:undefined};
  });
}
export function recentExportPayload(job:Pick<Job,'id'|'scope'|'results'>,browser:boolean,origin:string):RecentPayload{
  const result=job.results[0];let url=result?.url;
  if(!browser&&url){const parsed=new URL(url,origin);parsed.searchParams.delete('pc_session');url=parsed.pathname+parsed.search;}
  return {job:job.id,libraryId:job.scope?.library_id,file:result?{name:result.file_name,...(browser?{path:result.path}:{url})}:undefined};
}
export function getRecent():RecentOp[] {try{return normalizeRecent(JSON.parse(localStorage.getItem(KEY)||'[]'))}catch{return[]}}
export function recordRecent(op:RecentOp) {try{const list=getRecent().filter(o=>!(o.kind==='draft'&&op.kind==='draft'&&o.payload?.draft===op.payload?.draft));list.unshift(op);localStorage.setItem(KEY,JSON.stringify(list.slice(0,12)))}catch{}}
export function clearRecent() {try{localStorage.removeItem(KEY)}catch{}}
