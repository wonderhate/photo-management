import type {GeoBounds} from './photo-location.ts';
import type {MapCamera} from './satellite-map.ts';
import {normalizeLongitude} from './photo-map.ts';

export type SatelliteSource={provider:'nasa'|'arcgis'|'maptiler';key:string};
export type SatelliteTiles={url:string;attribution:string;minZoom:number;maxZoom:number;maxNativeZoom:number;geographic:boolean};
export const ARCGIS_IMAGERY='https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';
export const MAPTILER_IMAGERY='https://api.maptiler.com/tiles/satellite-v4/tiles.json';
export class SatelliteSourceError extends Error {
  code:'key'|'unavailable';
  constructor(code:'key'|'unavailable'){super(code==='key'?'A map service key is required.':'The map service could not be loaded.');this.code=code;}
}
export function validSatelliteKey(key:string){return key.length>=8&&key.length<=4096&&!/[\s<>"'\\]/.test(key);}
function safeAttribution(value:unknown){
  return typeof value==='string'?value.slice(0,2000).replace(/<[^>]*>/g,'').replace(/&(?:amp|copy|nbsp);/g,s=>({'&amp;':'&','&copy;':'©','&nbsp;':' '}[s]||s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)):'';
}
function nativeZoom(value:unknown,fallback:number){return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=23?value:fallback;}

/** Only our own local data, or the owner's explicitly configured official service. */
export async function satelliteTiles(source:SatelliteSource,signal:AbortSignal,request:typeof fetch=fetch):Promise<SatelliteTiles>{
  if(source.provider==='nasa')return {url:'/maps/earth/{z}/{x}-{y}.jpg',attribution:'<a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/" target="_blank" rel="noopener noreferrer">NASA Earth Observatory</a>',minZoom:0,maxZoom:8,maxNativeZoom:4,geographic:true};
  if(!validSatelliteKey(source.key))throw new SatelliteSourceError('key');
  try{
    const key=encodeURIComponent(source.key);
    const url=source.provider==='arcgis'?`${ARCGIS_IMAGERY}?f=json&token=${key}`:`${MAPTILER_IMAGERY}?key=${key}`;
    const response=await request(url,{signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});
    if(!response.ok)throw new SatelliteSourceError('unavailable');
    const data=await response.json();
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    if(!data||data.error)throw new SatelliteSourceError('unavailable');
    if(source.provider==='arcgis'){
      const levels=Array.isArray(data.tileInfo?.lods)?data.tileInfo.lods.map((p:{level?:number})=>p.level).filter((z:unknown)=>typeof z==='number'&&Number.isInteger(z)):[];
      const credit=safeAttribution(data.copyrightText)||'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community';
      return {url:`${ARCGIS_IMAGERY}/tile/{z}/{y}/{x}?token=${key}`,attribution:`Powered by <a href="https://www.esri.com" target="_blank" rel="noopener noreferrer">Esri</a> | ${credit}`,minZoom:0,maxZoom:20,maxNativeZoom:nativeZoom(Math.max(...levels),19),geographic:false};
    }
    const template=Array.isArray(data.tiles)&&typeof data.tiles[0]==='string'?data.tiles[0]:'';
    const parsed=new URL(template);
    // A remote TileJSON cannot redirect the user's key or local map traffic.
    if(parsed.protocol!=='https:'||parsed.hostname!=='api.maptiler.com'||parsed.port||parsed.username||parsed.password||!/^\/tiles\/satellite-v4\//.test(parsed.pathname)||!['{z}','{x}','{y}'].every(v=>template.includes(v)))throw new SatelliteSourceError('unavailable');
    parsed.searchParams.set('key',source.key);
    const tileUrl=parsed.toString().replace(/%7B/gi,'{').replace(/%7D/gi,'}');
    const credit=safeAttribution(data.attribution);
    return {url:tileUrl,attribution:`<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer">© MapTiler</a>${credit?' | '+credit:''}`,minZoom:0,maxZoom:20,maxNativeZoom:nativeZoom(data.maxzoom,19),geographic:false};
  }catch(error){
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    // Fetch errors may include the requested URL and therefore the user's key.
    throw error instanceof SatelliteSourceError?error:new SatelliteSourceError('unavailable');
  }
}

export function satelliteCamera(value:MapCamera,provider:SatelliteSource['provider']):MapCamera{
  const lat=provider==='nasa'?89.999:85.05112878,max=provider==='nasa'?8:20;
  return {latitude:Math.max(-lat,Math.min(lat,Number.isFinite(value.latitude)?value.latitude:0)),longitude:normalizeLongitude(Number.isFinite(value.longitude)?value.longitude:0),zoom:Math.max(0,Math.min(max,Number.isFinite(value.zoom)?value.zoom:provider==='nasa'?0:2))};
}
/** EPSG:4326 is 512 x 256 display pixels at zoom 0 (two geographic tiles). */
export function nasaMinimumZoom(width:number,height:number){
  return Math.max(0,Math.log2(Math.max(Math.max(1,width)/512,Math.max(1,height)/256)));
}
export function nasaViewportCamera(value:MapCamera,width:number,height:number):MapCamera{
  const zoom=Math.max(nasaMinimumZoom(width,height),value.zoom);
  const limit=Math.max(0,90-Math.max(1,height)*90/(256*2**zoom));
  // Clamp only the viewport center. Photo GPS coordinates remain untouched.
  return {...value,zoom,latitude:Math.max(-limit,Math.min(limit,value.latitude))};
}
export function satelliteBounds(west:number,south:number,east:number,north:number):GeoBounds{
  return {west:east-west>=359.999?-180:normalizeLongitude(west),east:east-west>=359.999?180:normalizeLongitude(east),south:Math.max(-90,Math.min(90,south)),north:Math.max(-90,Math.min(90,north))};
}
export function nearestWorldLongitude(longitude:number,center:number){return longitude+360*Math.round((center-longitude)/360);}
/** Every navigation owns its completion callbacks; a late load cannot finish a newer move. */
export class MapViewportEpoch {
  private value=0;
  next(){return ++this.value;}
  current(value:number){return this.value===value;}
  cancel(){this.value++;}
}
