import {normalizePhotoQuery} from './photo-query.ts';
import type {QueryNode,QueryField,QueryLeaf} from './photo-query.ts';
import {normalizeQueryScope,enterScope,normalizeScopeBase} from './query-scope.ts';
import type {CountMode,ScopeOrigin} from './query-scope.ts';
import type {Filters} from '../types.ts';

/** A chart adds predicates; it must never replace a narrower existing filter. */
export function refineAnalysis(filters:Filters,conditions:Record<string,string|number>):Filters{
  const children:QueryNode[]=[];
  if(filters.query){const root=normalizePhotoQuery(JSON.parse(filters.query)).root;children.push(...(root.op==='and'?root.children:[root]));}
  for(const [key,value] of Object.entries(conditions)){
    if(key==='date_from'||key==='date_to')children.push({op:key==='date_from'?'gte':'lte',field:'date_taken',value:key==='date_to'?String(value).slice(0,10)+'T23:59:59':String(value)});
    else if(key==='lens_model'||key==='camera_model')children.push({op:'eq',field:key,value:String(value)});
    else{
      const match=key.match(/^(focal_length|f_number|iso|exposure_seconds)(_min|_max|_lt|_gt)?$/);
      if(!match)throw new Error('Invalid photo query.');
      const op=({'_min':'gte','_max':'lte','_lt':'lt','_gt':'gt'} as Record<string,QueryLeaf['op']>)[match[2]]||'eq';
      children.push({op,field:match[1] as QueryField,value:Number(value)});
    }
  }
  if(!children.length)return {...filters};
  return {...filters,query:JSON.stringify(normalizePhotoQuery({version:1,root:children.length===1?children[0]:{op:'and',children}}))};
}

export function analysisPeriod(filters:Filters,start:string,end:string):Filters{
  return {...filters,date_from:filters.date_from&&filters.date_from>start?filters.date_from:start,date_to:filters.date_to&&filters.date_to.slice(0,10)<end?filters.date_to.slice(0,10):end};
}
export function analysisCounting(filters:Filters,mode:CountMode):Filters{
  return {...filters,count_mode:mode,...(filters.scope?{scope:JSON.stringify({...normalizeQueryScope(filters.scope),mode})}:{})};
}

/** Existing scopes remain locked to their library and count mode. */
export function analysisBrowse(libraryId:string,filters:Filters,mode:CountMode,origin?:ScopeOrigin):Filters{
  const {scope,count_mode,...base}=filters;
  const normalized=normalizeScopeBase(base);
  if(scope){const locked=normalizeQueryScope(scope);if(locked.library_id!==libraryId)throw new Error('Search scope belongs to another library.');return {scope:JSON.stringify(locked),...normalized};}
  const chosen=count_mode||mode;if(chosen!=='capture'&&chosen!=='file')throw new Error('Invalid photo scope.');
  return enterScope(libraryId,normalized,chosen,origin);
}
