import type {EditRecipe} from './editing.ts';
import {validateRecipe,validateRecipeSource} from './editing.ts';
import type {SourceDecodeProfile} from './source-decode-profile.ts';
import {sourceDecodeProfile} from './source-decode-profile.ts';
import {validateSplitEditSource} from './edit-lineage.ts';
import type {SplitEditSource} from './edit-lineage.ts';
import {sameSplitValue,validateStoredSplit} from './split-record.ts';
import type {StoredSplit} from './split-record.ts';

type RecordSource={id:string;photo_id:string|null;source_hash:string;source_path?:string;decode_profile?:SourceDecodeProfile;revision?:number;derived_from?:SplitEditSource};
export type SplitEditOutput={version:1|2;document_id:string;document_revision:number;source_hash:string;recipe:EditRecipe;derived_from?:SplitEditSource};
function damaged():never{throw new Error('Unsupported or damaged edit source lineage.');}
export function panelEditSource(group:StoredSplit,panelId:string):SplitEditSource{
  validateStoredSplit(group);const index=group.panels.findIndex(p=>p.id===panelId),p=group.panels[index];if(!p)damaged();
  const value:SplitEditSource={version:1,kind:'split-panel',group_id:group.id,variant_id:p.id,document_id:group.document_id,document_revision:group.document_revision,panel_index:index,source_hash:p.sha256,parent_source_hash:group.source_hash,master_hash:group.master.sha256,width:p.width,height:p.height};
  validateSplitEditSource(value);return value;
}
export function validateEditLineageGraph(records:RecordSource[],groups:StoredSplit[]){
  const edits=new Map(records.map(e=>[e.id,e])),splits=new Map(groups.map(g=>[g.id,g])),checked=new Set<string>();
  for(const record of records){
    const seen=new Set<string>();let row=record;
    while(row.derived_from!==undefined&&!checked.has(row.id)){
      if(seen.has(row.id))damaged();seen.add(row.id);const source=row.derived_from;validateSplitEditSource(source);
      const group=splits.get(source.group_id),parent=edits.get(source.document_id);
      if(!group||!parent||row.photo_id!==null||row.id===source.document_id||row.source_hash!==source.source_hash||parent.source_hash!==source.parent_source_hash||(parent.revision??0)<source.document_revision||!sameSplitValue(sourceDecodeProfile(row.decode_profile),{version:2,extra_orientation:1})||!sameSplitValue(panelEditSource(group,source.variant_id),source))damaged();
      if(row.source_path!==`drafts/edits/${row.id}/source.${group.format}`)damaged();
      row=parent;
    }
    for(const id of seen)checked.add(id);
  }
}
export function validateSplitEditOutput(value:unknown,records:RecordSource[]):asserts value is SplitEditOutput{
  if(!value||typeof value!=='object'||Array.isArray(value))damaged();
  const v=value as SplitEditOutput;
  if(Object.keys(v).length!==(v.derived_from?6:5)||Object.keys(v).some(k=>!['version','document_id','document_revision','source_hash','recipe','derived_from'].includes(k))||![1,2].includes(v.version)||!Number.isSafeInteger(v.document_revision)||v.document_revision<1)damaged();
  validateRecipe(v.recipe);if(v.version===1&&!v.derived_from||v.version===2&&v.recipe.version<3)damaged();
  if(v.derived_from){validateSplitEditSource(v.derived_from);validateRecipeSource(v.recipe,v.derived_from);}
  const parent=records.find(e=>e.id===v.document_id);
  if(!parent||parent.source_hash!==v.source_hash||(parent.revision??0)<v.document_revision||!sameSplitValue(parent.derived_from,v.derived_from))damaged();
}
