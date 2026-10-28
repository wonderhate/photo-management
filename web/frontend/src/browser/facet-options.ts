import {FACETS} from '../core/photo-facets';
import type {FacetField} from '../core/photo-facets';
import {photoShape} from '../core/photo-query';
import {photoTextValue} from '../core/photo-text';
import type {Photo} from '../types';
export function facetOptions(photos:Photo[],field:FacetField,term='',page=1,size=60){
  if(!Object.hasOwn(FACETS,field)||[...term].length>256||term.includes('\0')||!Number.isInteger(page)||page<1||page>1000000||!Number.isInteger(size)||size<1||size>100)throw new Error('Invalid photo facets.');
  const kind=FACETS[field],counts=new Map<string|number|boolean,number>();let missing=0;const all:(string|number|boolean)[]=[];
  for(const p of photos){
    const raw=field==='tag'?p.tags:field==='orientation'?photoShape(p):['description','user_description','ai_caption','detected_text'].includes(field)?photoTextValue(p,field as 'description'):p[field as keyof Photo];
    const values=field==='tag'?[...new Set(raw as string[])]:raw==null?[]:[raw as string|number|boolean];if(!values.length)missing++;
    for(const value of values){if(kind!=='text')counts.set(value,(counts.get(value)||0)+1);if(kind==='number'||kind==='date')all.push(value);}
  }
  const lexical=(a:string,b:string)=>{const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)!-y[i].codePointAt(0)!;if(d)return d;}return x.length-y.length;};
  const order=(a:string|number|boolean,b:string|number|boolean)=>typeof a==='number'&&typeof b==='number'?a-b:typeof a==='boolean'&&typeof b==='boolean'?Number(a)-Number(b):lexical(String(a),String(b));
  const rows=kind==='text'?[]:[...counts].filter(([v])=>String(v).toLowerCase().includes(term.toLowerCase())).sort(([a],[b])=>order(a,b)),start=(page-1)*size;
  const values=rows.slice(start,start+size).map(([value,count])=>({value,count})),bounds=kind==='number'||kind==='date'?{min:all.length?all.reduce((a,b)=>order(a,b)<0?a:b):null,max:all.length?all.reduce((a,b)=>order(a,b)>0?a:b):null}:{};
  return {field,total:photos.length,missing,values,page,has_more:rows.length>start+size,...bounds};
}
