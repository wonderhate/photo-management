import {normalizePhotoQuery} from './photo-query.ts';
import type {QueryField,QueryNode,QueryValue,PhotoQuery} from './photo-query.ts';

export const FACETS={camera_make:'values',camera_model:'values',lens_model:'values',tag:'values',file_format:'values',orientation:'values',color_label:'values',flag:'values',rating:'number',favorite:'boolean',is_raw:'boolean',focal_length:'number',f_number:'number',iso:'number',exposure_seconds:'number',date_taken:'date',created_at:'date',description:'text',user_description:'text',ai_caption:'text',detected_text:'text'} as const;
export type FacetField=keyof typeof FACETS;
export type FacetItem={field:FacetField;op:'in'|'range'|'contains';values?:QueryValue[];min?:string|number;max?:string|number;text?:string;missing?:boolean;exclude?:boolean;min_exclusive?:boolean;max_exclusive?:boolean;match?:'any'|'all'};
export type PhotoFacets={version:1;items:FacetItem[]};
export type FacetPreferences={hidden:FacetField[]};
export const facetDefaults:FacetPreferences={hidden:(Object.keys(FACETS) as FacetField[]).filter(f=>!['camera_model','lens_model','tag','rating','flag'].includes(f))};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw new Error('Invalid photo facets.');};
const single=(field:FacetField,op:string,value?:unknown)=>normalizePhotoQuery({version:1,root:{field,op,...(value===undefined?{}:{value})}}).root;
export function facetNode(item:FacetItem):QueryNode|null{
  const parts:QueryNode[]=[];
  if(item.op==='in'&&item.values?.length){if(item.field==='tag'&&item.match==='all')parts.push({op:'and',children:item.values.map(v=>single(item.field,'eq',v))});else parts.push(single(item.field,'in',item.values));}
  if(item.op==='contains'&&item.text)parts.push(single(item.field,'icontains',item.text));
  if(item.op==='range'){
    const ranges:QueryNode[]=[];if(item.min!==undefined)ranges.push(single(item.field,item.min_exclusive?'gt':'gte',item.min));if(item.max!==undefined)ranges.push(single(item.field,item.max_exclusive?'lt':'lte',FACETS[item.field]==='date'&&typeof item.max==='string'&&item.max.length===10&&!item.max_exclusive?item.max+'T23:59:59':item.max));
    if(ranges.length)parts.push(ranges.length===1?ranges[0]:{op:'and',children:ranges});
  }
  if(item.missing)parts.push(single(item.field,'is_null'));
  if(!parts.length)return null;
  const result:QueryNode=parts.length===1?parts[0]:{op:'or',children:parts};return item.exclude?{op:'not',child:result}:result;
}
export function normalizePhotoFacets(value:unknown):PhotoFacets{
  if(typeof value==='string'){if(new TextEncoder().encode(value).length>32768)return fail();try{value=JSON.parse(value);}catch{return fail();}}
  try{if(new TextEncoder().encode(JSON.stringify(value)).length>32768)return fail();}catch{return fail();}
  if(!object(value)||Object.keys(value).length!==2||value.version!==1||!Array.isArray(value.items)||value.items.length>Object.keys(FACETS).length)return fail();
  const used=new Set<string>(),items:FacetItem[]=[];
  for(const raw of value.items){
    if(!object(raw)||typeof raw.field!=='string'||!Object.hasOwn(FACETS,raw.field)||used.has(raw.field))return fail();used.add(raw.field);const field=raw.field as FacetField,kind=FACETS[field],op=raw.op;
    const allowed=['field','op','missing','exclude',...(op==='in'?['values','match']:op==='range'?['min','max','min_exclusive','max_exclusive']:op==='contains'?['text']:[])];
    if(Object.keys(raw).some(k=>!allowed.includes(k))||!['in','range','contains'].includes(op as string)||['missing','exclude','min_exclusive','max_exclusive'].some(k=>k in raw&&typeof raw[k]!=='boolean'))return fail();
    const item:FacetItem={field,op:op as FacetItem['op'],...(raw.missing?{missing:true}:{}),...(raw.exclude?{exclude:true}:{})};
    if(op==='in'){
      if(kind==='text'||!Array.isArray(raw.values)||raw.values.length>32||('match' in raw&&(field!=='tag'||!['any','all'].includes(raw.match as string))))return fail();
      if(raw.values.length){const leaf=single(field,'in',raw.values) as {value:QueryValue[]};item.values=leaf.value;}else item.values=[];
      if(raw.match==='all')item.match='all';
    }else if(op==='range'){
      if(!['number','date'].includes(kind))return fail();
      if(raw.min_exclusive)item.min_exclusive=true;if(raw.max_exclusive)item.max_exclusive=true;
      for(const key of ['min','max'] as const)if(key in raw){single(field,key==='min'?'gte':'lte',raw[key]);item[key]=raw[key] as string|number;}
      if(item.min!==undefined&&item.max!==undefined&&item.min>item.max)return fail();
    }else{
      if(kind!=='text'||typeof raw.text!=='string')return fail();single(field,'icontains',raw.text);item.text=raw.text;
    }
    if(facetNode(item))items.push(item);
  }
  if(items.length)normalizePhotoQuery({version:1,root:{op:'and',children:items.map(i=>facetNode(i)!)}});
  items.sort((a,b)=>Object.keys(FACETS).indexOf(a.field)-Object.keys(FACETS).indexOf(b.field));return {version:1,items};
}
export function facetsQuery(value:unknown,omit?:FacetField):PhotoQuery|null{const children=normalizePhotoFacets(value).items.filter(i=>i.field!==omit).map(i=>facetNode(i)!);return children.length?normalizePhotoQuery({version:1,root:children.length===1?children[0]:{op:'and',children}}):null;}
export function validateFacetPreferences(value:unknown):Partial<FacetPreferences>{
  if(!object(value)||Object.keys(value).some(k=>k!=='hidden'))throw new Error('Invalid filter bar preferences.');
  if('hidden' in value&&(!Array.isArray(value.hidden)||value.hidden.length>Object.keys(FACETS).length||new Set(value.hidden).size!==value.hidden.length||value.hidden.some(f=>typeof f!=='string'||!Object.hasOwn(FACETS,f))))throw new Error('Invalid filter bar preferences.');
  return value as Partial<FacetPreferences>;
}
export const facetKeys=(field:FacetField)=>field==='camera_model'?['camera_model','camera']:field==='lens_model'?['lens_model','lens']:field==='tag'?['tag']:field==='date_taken'?['date_from','date_to']:['focal_length','f_number','iso','exposure_seconds'].includes(field)?[field,...['_min','_max','_lt','_gt'].map(s=>field+s)]:['camera_make','camera_model','lens_model','orientation','color_label','flag','rating','favorite','is_raw'].includes(field)?[field]:[];
export function withoutFacet(filters:Record<string,string>,field:FacetField){const next={...filters};for(const key of facetKeys(field))delete next[key];if(next.facets){const state=normalizePhotoFacets(next.facets);state.items=state.items.filter(i=>i.field!==field);if(state.items.length)next.facets=JSON.stringify(state);else delete next.facets;}return next;}
export function legacyFacet(filters:Record<string,string>,field:FacetField):FacetItem|undefined{
  const found=filters.facets?normalizePhotoFacets(filters.facets).items.find(i=>i.field===field):undefined;if(found)return found;
  const kind=FACETS[field];if(field==='date_taken'&&(filters.date_from||filters.date_to))return {field,op:'range',...(filters.date_from?{min:filters.date_from}:{}),...(filters.date_to?{max:filters.date_to}:{})};
  if(kind==='number'&&facetKeys(field).some(k=>k!==field&&filters[k]))return {field,op:'range',...(filters[field+'_gt']?{min:Number(filters[field+'_gt']),min_exclusive:true}:filters[field+'_min']?{min:Number(filters[field+'_min'])}:{}),...(filters[field+'_lt']?{max:Number(filters[field+'_lt']),max_exclusive:true}:filters[field+'_max']?{max:Number(filters[field+'_max'])}:{})};
  const raw=filters[field]||(field==='camera_model'?filters.camera:field==='lens_model'?filters.lens:undefined);
  if(raw!==undefined&&raw!=='')return {field,op:'in',values:[kind==='number'?Number(raw):kind==='boolean'?['true','1'].includes(raw):raw]};
}
