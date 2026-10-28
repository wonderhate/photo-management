import type {GeoBounds} from './photo-location.ts';
import {centeredBounds,normalizeLongitude} from './photo-map.ts';
import type {MapCluster} from './photo-map.ts';
export function fitEarthPlaces(points:MapCluster[]):GeoBounds{
  if(!points.length)return {west:-180,east:180,south:-90,north:90};
  const longitudes=points.map(p=>(p.longitude+360)%360).sort((a,b)=>a-b);let gap=-1,start=longitudes[0];
  for(let i=0;i<longitudes.length;i++){const next=longitudes[(i+1)%longitudes.length]+(i===longitudes.length-1?360:0),space=next-longitudes[i];if(space>gap){gap=space;start=next%360;}}
  const south=Math.min(...points.map(p=>p.latitude)),north=Math.max(...points.map(p=>p.latitude)),span=360-gap;
  return centeredBounds(normalizeLongitude(start+span/2),(north+south)/2,Math.min(360,Math.max(24,span*1.4,(north-south)*2.8)));
}
