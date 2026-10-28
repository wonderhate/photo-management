/** Bounded metadata predicates. Semantic retrieval remains a separate capability. */
import {ANNOTATION_QUERY_FIELDS,photoTextValue,textContains} from './photo-text.ts';
export const QUERY_FIELDS={file_name:'text',camera_make:'text',camera_model:'text',lens_model:'text',color_label:'text',file_format:'text',tag:'tag',orientation:'shape',
  text:'text',description:'text',user_description:'text',ai_caption:'text',detected_text:'text',
  rating:'rating',flag:'flag',favorite:'boolean',is_raw:'boolean',date_taken:'date',created_at:'date',
  width:'number',height:'number',focal_length:'number',focal_length_35mm:'number',f_number:'number',iso:'number',exposure_seconds:'number'} as const;
export type QueryField=keyof typeof QUERY_FIELDS;
export type QueryValue=string|number|boolean;
export type QueryLeaf={op:'eq'|'ne'|'lt'|'lte'|'gt'|'gte'|'contains'|'icontains'|'in'|'is_null'|'not_null';field:QueryField;value?:QueryValue|QueryValue[]};
export type QueryNode=QueryLeaf|{op:'and'|'or';children:QueryNode[]}|{op:'not';child:QueryNode};
export type PhotoQuery={version:1;root:QueryNode};
const fail=():never=>{throw new Error('Invalid photo query.');};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function text(value:unknown){
  if(typeof value!=='string'||[...value].length>256||value.includes('\0')||[...value].some(c=>c.codePointAt(0)!>=0xd800&&c.codePointAt(0)!<=0xdfff))return fail();
  return value;
}
function scalar(field:QueryField,value:unknown):QueryValue{
  const kind=QUERY_FIELDS[field];
  if(kind==='shape')return typeof value==='string'&&['landscape','portrait','square'].includes(value)?value:fail();
  if(kind==='flag')return typeof value==='string'&&['picked','rejected','unmarked'].includes(value)?value:fail();
  if(kind==='boolean')return typeof value==='boolean'?value:fail();
  if(kind==='number'||kind==='rating')return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e12&&(kind!=='rating'||Number.isInteger(value)&&value<=5)?value:fail();
  const s=text(value);
  if(kind==='date'){
    if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?$/.test(s))return fail();
    const full=s.length===10?s+'T00:00:00':s,date=new Date(full+'Z');
    if(!Number.isFinite(date.getTime())||full.startsWith('0000')||date.toISOString().slice(0,19)!==full)return fail();
  }
  return kind==='date'&&s.length===10?s+'T00:00:00':s;
}
export function normalizePhotoQuery(value:unknown):PhotoQuery{
  try{if(new TextEncoder().encode(JSON.stringify(value)).length>32768)return fail();}catch{return fail();}
  if(!object(value)||Object.keys(value).length!==2||value.version!==1||!Object.hasOwn(value,'root'))return fail();
  let count=0;
  function node(value:unknown,depth:number):QueryNode{
    if(depth>8||++count>128||!object(value))return fail();
    const op=value.op;
    if(op==='and'||op==='or'){
      if(Object.keys(value).length!==2||!Array.isArray(value.children)||value.children.length<1||value.children.length>32)return fail();
      return {op,children:value.children.map(child=>node(child,depth+1))};
    }
    if(op==='not'){
      if(Object.keys(value).length!==2||!Object.hasOwn(value,'child'))return fail();
      return {op,child:node(value.child,depth+1)};
    }
    if(typeof value.field!=='string'||!Object.hasOwn(QUERY_FIELDS,value.field)||!['eq','ne','lt','lte','gt','gte','contains','icontains','in','is_null','not_null'].includes(op as string))return fail();
    const field=value.field as QueryField,kind=QUERY_FIELDS[field],empty=op==='is_null'||op==='not_null';
    if(Object.keys(value).length!==(empty?2:3)||Object.keys(value).some(k=>!['op','field',...(empty?[]:['value'])].includes(k)))return fail();
    if(empty)return {op,field} as QueryLeaf;
    if(['contains','icontains'].includes(op as string)&&!['text','tag'].includes(kind)||['lt','lte','gt','gte'].includes(op as string)&&!['number','rating','date'].includes(kind))return fail();
    if(op==='in'){
      if(!Array.isArray(value.value)||!value.value.length||value.value.length>32)return fail();
      return {op,field,value:[...new Set(value.value.map(v=>scalar(field,v)))]};
    }
    return {op:op as QueryLeaf['op'],field,value:scalar(field,value.value)};
  }
  return {version:1,root:node(value.root,0)};
}
export function compilePhotoQuery(value:unknown):(photo:object)=>boolean{
  const query=normalizePhotoQuery(value);
  function compile(node:QueryNode):(photo:Record<string,unknown>)=>boolean{
    if(node.op==='and'||node.op==='or'){const children=node.children.map(compile);return row=>node.op==='and'?children.every(f=>f(row)):children.some(f=>f(row));}
    if(node.op==='not'){const child=compile(node.child);return row=>!child(row);}
    const leaf=node as QueryLeaf,kind=QUERY_FIELDS[leaf.field],wanted=leaf.value;
    return row=>{
      const source=leaf.field==='orientation'?photoShape(row):(ANNOTATION_QUERY_FIELDS as readonly string[]).includes(leaf.field)?photoTextValue(row,leaf.field as typeof ANNOTATION_QUERY_FIELDS[number]):kind==='flag'?(row[leaf.field]??'unmarked'):row[leaf.field];
      const actual=kind==='tag'?(Array.isArray(row.tags)?row.tags as string[]:[]):kind==='date'&&typeof source==='string'?(source.length===10?source+'T00:00:00':source.slice(0,19)):source;
      const missing=kind==='tag'?(actual as string[]).length===0:actual==null;
      if(leaf.op==='is_null')return missing;
      if(leaf.op==='not_null')return !missing;
      if(kind==='tag'){
        const tags=actual as string[];
        if(leaf.op==='contains')return tags.some(tag=>tag.includes(wanted as string));
        if(leaf.op==='icontains')return tags.some(tag=>textContains(tag,wanted as string));
        if(leaf.op==='in')return tags.some(tag=>(wanted as QueryValue[]).includes(tag));
        const equal=tags.includes(wanted as string);return leaf.op==='eq'?equal:!equal;
      }
      if(missing)return false;
      if(leaf.op==='icontains')return textContains(actual,wanted as string);
      if(leaf.op==='eq')return actual===wanted;
      if(leaf.op==='ne')return actual!==wanted;
      if(leaf.op==='in')return (wanted as QueryValue[]).includes(actual as QueryValue);
      if(leaf.op==='contains')return typeof actual==='string'&&actual.includes(wanted as string);
      if(typeof actual!==typeof wanted||!['string','number'].includes(typeof actual))return false;
      const order=typeof actual==='number'?actual-(wanted as number):(actual as string)<(wanted as string)?-1:actual===wanted?0:1;
      return leaf.op==='lt'?order<0:leaf.op==='lte'?order<=0:leaf.op==='gt'?order>0:order>=0;
    };
  }
  return compile(query.root) as (photo:object)=>boolean;
}

export function photoShape(photo:object):'landscape'|'portrait'|'square'|null{const p=photo as {width?:number|null;height?:number|null};return typeof p.width==='number'&&typeof p.height==='number'&&p.width>0&&p.height>0?p.width>p.height?'landscape':p.width<p.height?'portrait':'square':null;}
