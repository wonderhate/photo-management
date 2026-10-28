import {exactPlace,geoBounds} from '../core/photo-location';
import {bt} from '../browser/text';
export function locationFilterLabel(key:string,value:string):string|undefined{
  if(key==='geo_presence')return value==='located'?bt('有坐标','With coordinates'):bt('无坐标','Without coordinates');
  try{
    if(key==='location_exact')return exactPlace(value).filter(Boolean).join(' · ')||bt('未命名地点','Unnamed place');
    if(key==='geo_bounds'){const b=geoBounds(JSON.parse(value));return `${b.south.toFixed(2)}° – ${b.north.toFixed(2)}° / ${b.west.toFixed(2)}° – ${b.east.toFixed(2)}°`+(b.west>b.east?bt('（跨日界线）',' (across the date line)'):'');}
  }catch{return bt('地点条件无效','Invalid location filter');}
}
