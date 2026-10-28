/** The source is rendered panel bytes. Parent adjustments must never run twice. */
import {neutralRecipe} from './editing.ts';
import type {SourceDecodeProfile} from './source-decode-profile.ts';

export type SplitEditSource={version:1;kind:'split-panel';group_id:string;variant_id:string;document_id:string;document_revision:number;panel_index:number;source_hash:string;parent_source_hash:string;master_hash:string;width:number;height:number};
const keys=['version','kind','group_id','variant_id','document_id','document_revision','panel_index','source_hash','parent_source_hash','master_hash','width','height'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
export function validateSplitEditSource(value:unknown):asserts value is SplitEditSource{
  function fail():never{throw new Error('Unsupported or damaged edit source lineage.');}
  if(!value||typeof value!=='object'||Array.isArray(value))fail();
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k))||v.version!==1||v.kind!=='split-panel')fail();
  for(const key of ['group_id','variant_id'])if(typeof v[key]!=='string'||!uuid.test(v[key]))fail();
  if(typeof v.document_id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(v.document_id)||new Set([v.group_id,v.variant_id,v.document_id]).size!==3)fail();
  for(const key of ['source_hash','parent_source_hash','master_hash'])if(typeof v[key]!=='string'||!hash.test(v[key]))fail();
  if(!Number.isSafeInteger(v.document_revision)||Number(v.document_revision)<1||!Number.isSafeInteger(v.panel_index)||Number(v.panel_index)<0||Number(v.panel_index)>9)fail();
  for(const key of ['width','height'])if(!Number.isSafeInteger(v[key])||Number(v[key])<1||Number(v[key])>100_000_000)fail();
  if(Number(v.width)*Number(v.height)>100_000_000)fail();
}
export function splitEditDefaults(){return {recipe:neutralRecipe(),decode_profile:{version:2,extra_orientation:1} satisfies SourceDecodeProfile};}
