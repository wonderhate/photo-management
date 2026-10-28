import {useState} from 'react';
import {bt} from '../browser/text';
import {normalizeQueryScope} from '../core/query-scope';
import type {Filters} from '../types';

export function useAnalysisRange(source:Filters,countMode:string){
  const [scoped,setScoped]=useState(false);
  let mode=countMode,error='';
  if(scoped){try{mode=source.scope?normalizeQueryScope(source.scope).mode:source.count_mode||countMode;}catch{error=bt('照片范围无效，请返回照片库重新选择。','The photo scope is invalid. Select it again in the library.');}}
  const filters:Filters={...(scoped?source:{}),count_mode:mode};
  const control=<label className="row analysis-range"><input type="checkbox" checked={scoped} onChange={e=>setScoped(e.target.checked)}/>{bt('使用当前照片库筛选范围','Use the current library filter scope')}<small>{mode==='file'?bt('按文件','Files'):bt('按拍摄','Captures')}</small></label>;
  return {filters,mode,error,control,key:JSON.stringify(filters)};
}
