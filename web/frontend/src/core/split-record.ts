import type {EditSplitGroup} from './editor-adapter';
import type {SourceDecodeProfile} from './source-decode-profile';
import {sourceDecodeProfile} from './source-decode-profile.ts';
import {splitPlan,validateSplit} from './seamless-split.ts';
import {splitRecipe} from './split-render.ts';
import {validateRecipe} from './editing.ts';

export type SplitAsset={id:string;name:string;path:string;sha256:string;width:number;height:number};
export type StoredSplit=Omit<EditSplitGroup,'master'|'panels'>&{version:1;name:string;decode_profile:SourceDecodeProfile;master:SplitAsset;panels:SplitAsset[]};
export const splitID=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export function splitSourceGroup(path:string){const parts=path.split('/');return parts.length===4&&parts[0]==='drafts'&&parts[1]==='splits'&&splitID(parts[2])&&parts[3]==='source.bin'?parts[2]:null;}
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function sameSplitValue(a:unknown,b:unknown):boolean{
  if(a===b)return true;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>sameSplitValue(v,b[i]));
  return object(a)&&object(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&sameSplitValue(a[k],b[k]));
}
function damaged():never{throw new Error('Split group is incomplete or damaged.');}
export function validateStoredSplit(value:unknown):asserts value is StoredSplit{
  if(!object(value)||Object.keys(value).some(k=>!['version','id','document_id','document_revision','source_hash','spec','plan','recipe','parent_recipe','format','quality','master','panels','name','decode_profile'].includes(k)))damaged();
  const g=value as unknown as StoredSplit;
  if(g.version!==1||!splitID(g.id)||typeof g.document_id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(g.document_id)||!Number.isSafeInteger(g.document_revision)||g.document_revision<0||!hash(g.source_hash)||!['png','jpg'].includes(g.format)||!Number.isInteger(g.quality)||g.quality<1||g.quality>100||typeof g.name!=='string'||g.name.length>255)damaged();
  validateSplit(g.spec);validateRecipe(g.parent_recipe);validateRecipe(g.recipe);
  if(!sameSplitValue(sourceDecodeProfile(g.decode_profile),g.decode_profile)||!sameSplitValue(splitPlan(g.spec),g.plan))damaged();
  const swapped=g.parent_recipe.rotation===90||g.parent_recipe.rotation===270;
  const source=swapped?{width:g.spec.basis.height,height:g.spec.basis.width}:g.spec.basis;
  if(!sameSplitValue(splitRecipe(g.parent_recipe,source,g.spec),g.recipe)||!Array.isArray(g.panels)||g.panels.length!==g.plan.count)damaged();
  const ids=new Set<string>();
  for(const [i,p] of [g.master,...g.panels].entries()){
    const rect=i===0?g.plan:g.plan.panels[i-1],path=`drafts/splits/${g.id}/${i===0?'master.png':`panel-${String(i).padStart(2,'0')}.${g.format}`}`;
    if(!object(p)||Object.keys(p).some(k=>!['id','name','path','sha256','width','height'].includes(k))||!splitID(p.id)||ids.has(p.id)||p.id===(i===0?'':g.id)||i===0&&p.id!==g.id||typeof p.name!=='string'||p.name.length>255||p.path!==path||!hash(p.sha256)||p.width!==rect.width||p.height!==rect.height)damaged();
    ids.add(p.id);
  }
}
