import {cameraDay} from './timeline.ts';
import {effectiveLocation} from './photo-location.ts';
import type {StoredLocation} from './photo-location.ts';
import type {Filters} from '../types';
type Source={id:string;file_hash?:string;date_taken?:string|null;gps_latitude?:number|null;gps_longitude?:number|null};
export type DiscoverCard={key:string;kind:'anniversary'|'month'|'place';label:string;count:number;cover_id:string;filters:Filters};
export type DiscoverResult={memories:DiscoverCard[];places:DiscoverCard[];located:number;unknown_date:number;count_mode:'capture'|'file'};
export function discover(photos:readonly Source[],locations:readonly StoredLocation[],today:string,mode:'capture'|'file'):DiscoverResult{
  if(cameraDay(today)!==today)throw new Error('Invalid timeline date.');
  const anniversaries=new Map<string,DiscoverCard>(),months=new Map<string,DiscoverCard>(),places=new Map<string,DiscoverCard>(),records=new Map(locations.map(r=>[r.photo_id,r]));let located=0,unknown=0;
  function add(map:Map<string,DiscoverCard>,key:string,photo:Source,card:Omit<DiscoverCard,'key'|'count'|'cover_id'>){const old=map.get(key);if(old){old.count++;if(photo.id<old.cover_id)old.cover_id=photo.id;}else map.set(key,{...card,key,count:1,cover_id:photo.id});}
  for(const p of photos){
    const day=cameraDay(p.date_taken);
    if(!day)unknown++;else if(day<=today){
      if(day<today&&day.slice(5)===today.slice(5))add(anniversaries,day,p,{kind:'anniversary',label:day,filters:{date_from:day,date_to:day}});
      const month=day.slice(0,7),date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+1,0);const to=date.toISOString().slice(0,10);
      add(months,month,p,{kind:'month',label:month,filters:{date_from:month+'-01',date_to:to>today?today:to}});
    }
    const place=effectiveLocation(p,records.get(p.id));if(place.latitude!==null)located++;
    const label=[place.country,place.city,place.label].filter(Boolean).join(' · ');
    if(label){
      // Explicit empty fields keep two places with the same city but different
      // country/label separate, without broadening the card's displayed count.
      const key=JSON.stringify([place.country,place.city,place.label]);add(places,key,p,{kind:'place',label,filters:{location_exact:key}});
    }
  }
  const memories=[...anniversaries.values()].sort((a,b)=>b.key.localeCompare(a.key)).slice(0,6);
  const seenMonths=new Set(memories.map(m=>m.key.slice(0,7)));
  memories.push(...[...months.values()].filter(m=>!seenMonths.has(m.key)).sort((a,b)=>b.key.localeCompare(a.key)).slice(0,6-memories.length));
  return {memories,places:[...places.values()].sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key)).slice(0,6),located,unknown_date:unknown,count_mode:mode};
}
