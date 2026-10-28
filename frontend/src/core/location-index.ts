import {effectiveLocation,insideBounds,geoBounds,exactPlace} from './photo-location.ts';
import type {EffectiveLocation,StoredLocation,GeoBounds} from './photo-location.ts';
type Source={id:string;file_hash?:string;gps_latitude?:number|null;gps_longitude?:number|null};
export type LocatedPhoto=EffectiveLocation&{photo_id:string};
const step=2,lonCell=(n:number)=>Math.min(179,Math.max(0,Math.floor((n+180)/step))),latCell=(n:number)=>Math.min(89,Math.max(0,Math.floor((n+90)/step)));
/** A rebuildable fixed-grid spatial index; immutable library arrays are its cache key. */
export class LocationIndex{
  readonly rows=new Map<string,LocatedPhoto>();
  private buckets=new Map<number,LocatedPhoto[]>();
  private countries=new Map<string,Set<string>>();
  private cities=new Map<string,Set<string>>();
  private named=new Map<string,Set<string>>();
  private positioned=new Set<string>();
  private unpositioned=new Set<string>();
  constructor(photos:readonly Source[],records:readonly StoredLocation[]=[]){
    const saved=new Map(records.map(r=>[r.photo_id,r]));
    for(const photo of photos){
      const row={photo_id:photo.id,...effectiveLocation(photo,saved.get(photo.id))};this.rows.set(photo.id,row);
      const name=JSON.stringify([row.country,row.city,row.label]);let named=this.named.get(name);if(!named)this.named.set(name,named=new Set());named.add(photo.id);
      for(const [key,index] of [[row.country,this.countries],[row.city,this.cities]] as const){let ids=index.get(key);if(!ids)index.set(key,ids=new Set());ids.add(photo.id);}
      if(row.latitude===null){this.unpositioned.add(photo.id);continue;}
      this.positioned.add(photo.id);const key=latCell(row.latitude)*180+lonCell(row.longitude!);let list=this.buckets.get(key);if(!list)this.buckets.set(key,list=[]);list.push(row);
    }
  }
  *viewport(bounds:GeoBounds):Generator<LocatedPhoto>{
    const b=geoBounds(bounds),ranges=b.west<=b.east?[[b.west,b.east]]:[[b.west,180],[-180,b.east]],seen=new Set<number>();
    for(const [west,east] of ranges)for(let y=latCell(b.south);y<=latCell(b.north);y++)for(let x=lonCell(west);x<=lonCell(east);x++){
      const key=y*180+x;if(seen.has(key))continue;seen.add(key);
      for(const row of this.buckets.get(key)||[])if(insideBounds(row.latitude!,row.longitude!,b))yield row;
    }
  }
  filter(values:Record<string,string>):Set<string>|null{
    const sets:Set<string>[]=[];
    if(values.location_exact)sets.push(this.named.get(JSON.stringify(exactPlace(values.location_exact)))||new Set());
    for(const [key,index] of [['location_country',this.countries],['location_city',this.cities]] as const)if(values[key]){
      if([...values[key]].length>120||/[\u0000-\u001f]/.test(values[key]))throw new Error('Invalid photo location.');sets.push(index.get(values[key])||new Set());
    }
    if(values.geo_presence){if(!['located','unlocated'].includes(values.geo_presence))throw new Error('Invalid photo location.');sets.push(values.geo_presence==='located'?this.positioned:this.unpositioned);}
    if(values.geo_bounds){let b:GeoBounds;try{if(values.geo_bounds.length>512)throw 0;b=geoBounds(JSON.parse(values.geo_bounds));}catch{throw new Error('Invalid map bounds.');}sets.push(new Set([...this.viewport(b)].map(r=>r.photo_id)));}
    if(!sets.length)return null;sets.sort((a,b)=>a.size-b.size);return new Set([...sets[0]].filter(id=>sets.every(set=>set.has(id))));
  }
}
const cache=new WeakMap<readonly Source[],{records:readonly StoredLocation[]|undefined;index:LocationIndex}>();
export function locationIndex(photos:readonly Source[],records?:readonly StoredLocation[]){let saved=cache.get(photos);if(!saved||saved.records!==records){saved={records,index:new LocationIndex(photos,records)};cache.set(photos,saved);}return saved.index;}
