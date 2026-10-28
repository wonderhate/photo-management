import type {GeoBounds} from './photo-location.ts';
import type {LocatedPhoto,LocationIndex} from './location-index.ts';
export const WORLD:GeoBounds={west:-180,south:-90,east:180,north:90};
export type MapCluster={latitude:number;longitude:number;count:number;photo_id:string};
export type MapResult={total:number;located:number;unlocated:number;in_view:number;cluster_count:number;truncated:boolean;clusters:MapCluster[];countries:{value:string;count:number}[];cities:{value:string;count:number}[];facets_truncated:boolean};
export const longitudeSpan=(b:GeoBounds)=>b.east>=b.west?b.east-b.west:360-b.west+b.east;
export const longitudeOffset=(longitude:number,west:number)=>longitude<west?longitude-west+360:longitude-west;
export function normalizeLongitude(value:number){return ((value+180)%360+360)%360-180;}
export function centeredBounds(longitude:number,latitude:number,width:number):GeoBounds{
  width=Math.min(360,Math.max(.02,width));const height=width/2,center=Math.min(90-height/2,Math.max(-90+height/2,latitude));
  return {west:width===360?-180:normalizeLongitude(longitude-width/2),east:width===360?180:normalizeLongitude(longitude+width/2),south:center-height/2,north:center+height/2};
}
export function mapSummary(index:LocationIndex,ids:Iterable<string>,bounds:GeoBounds,limit=300):MapResult{
  const scope=new Set(ids),countries=new Map<string,number>(),cities=new Map<string,number>();let located=0;
  for(const id of scope){const p=index.rows.get(id);if(!p)continue;if(p.latitude!==null)located++;for(const [value,counts] of [[p.country,countries],[p.city,cities]] as const)if(value)counts.set(value,(counts.get(value)||0)+1);}
  const groups=new Map<number,{lat:number;lon:number;count:number;photo_id:string}>(),width=Math.max(longitudeSpan(bounds),1e-9),height=Math.max(bounds.north-bounds.south,1e-9);let inView=0;
  for(const p of index.viewport(bounds)){
    if(!scope.has(p.photo_id))continue;inView++;
    const x=longitudeOffset(p.longitude!,bounds.west),key=Math.min(31,Math.floor((bounds.north-p.latitude!)/height*32))*64+Math.min(63,Math.floor(x/width*64));
    const old=groups.get(key);if(old){old.lat+=p.latitude!;old.lon+=x;old.count++;if(p.photo_id<old.photo_id)old.photo_id=p.photo_id;}else groups.set(key,{lat:p.latitude!,lon:x,count:1,photo_id:p.photo_id});
  }
  const facets=(values:Map<string,number>)=>[...values].map(([value,count])=>({value,count})).sort((a,b)=>b.count-a.count||(a.value<b.value?-1:a.value>b.value?1:0)).slice(0,100);
  const clusters=[...groups.values()].sort((a,b)=>b.count-a.count||(a.photo_id<b.photo_id?-1:1)).slice(0,limit).map(p=>({latitude:p.lat/p.count,longitude:normalizeLongitude(bounds.west+p.lon/p.count),count:p.count,photo_id:p.photo_id}));
  return {total:scope.size,located,unlocated:scope.size-located,in_view:inView,cluster_count:groups.size,truncated:groups.size>limit,clusters,countries:facets(countries),cities:facets(cities),facets_truncated:countries.size>100||cities.size>100};
}
export function placeText(p:Pick<LocatedPhoto,'country'|'city'|'label'>){return [p.country,p.city,p.label].filter(Boolean).join(' · ');}
