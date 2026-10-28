import type {GeoBounds} from './photo-location.ts';
import {longitudeOffset,longitudeSpan,normalizeLongitude} from './photo-map.ts';
import type {MapCluster} from './photo-map.ts';

export const MAP_KEY_STORAGE='photo-google-maps-key-v1';
export const MAP_MODE_STORAGE='photo-map-mode-v1';
export type MapCamera={latitude:number;longitude:number;zoom:number};
export type MapPosition={id:string;x:number;y:number};
export function validMapKey(value:string){return /^[A-Za-z0-9_-]{20,200}$/.test(value);}
export function validMapBounds(value:unknown):value is GeoBounds{
  if(!value||typeof value!=='object')return false;
  const b=value as GeoBounds;
  return [b.west,b.east,b.south,b.north].every(Number.isFinite)&&b.west>=-180&&b.west<=180&&b.east>=-180&&b.east<=180&&b.south>=-90&&b.north<=90&&b.south<b.north;
}
export function validMapPositions(value:unknown):value is MapPosition[]{
  return Array.isArray(value)&&value.length<=300&&value.every(p=>p&&typeof p.id==='string'&&p.id.length<=200&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<1000000&&Math.abs(p.y)<1000000);
}
export function readMapSetting(key:string){try{return localStorage.getItem(key)||'';}catch{return '';}}
export function writeMapSetting(key:string,value:string){try{value?localStorage.setItem(key,value):localStorage.removeItem(key);}catch{/* The active map still works without persistent storage. */}}
// Same 64 × 32 local aggregation cells as mapSummary; no geocoding service.
export function clusterCellBounds(point:MapCluster,bounds:GeoBounds):GeoBounds{
  const w=longitudeSpan(bounds)/64,h=(bounds.north-bounds.south)/32;
  const x=Math.min(63,Math.max(0,Math.floor(longitudeOffset(point.longitude,bounds.west)/w))),y=Math.min(31,Math.max(0,Math.floor((bounds.north-point.latitude)/h)));
  return {west:normalizeLongitude(bounds.west+x*w),east:normalizeLongitude(bounds.west+(x+1)*w),north:bounds.north-y*h,south:bounds.north-(y+1)*h};
}
