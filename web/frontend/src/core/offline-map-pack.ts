import {bytesToHeader,Compression,FileSource,PMTiles,SharedPromiseCache,TileType} from 'pmtiles';
import type {Header} from 'pmtiles';
import type {GeoBounds} from './photo-location';

export type OfflineMapPack={id:string;name:string;filename:string;bytes:number;enabled:boolean;installedAt:string;bounds:GeoBounds;minZoom:number;maxZoom:number;attribution:string;license:string;year:string;resolution:string};
export type OpenMapPack={record:OfflineMapPack;archive:PMTiles};
const MAX_READ=16*1024*1024;
export class MapPackError extends Error {
  code:'invalid'|'format'|'storage'|'quota'|'missing';
  constructor(code:MapPackError['code']){super(code);this.code=code;}
}
/** Never interpret metadata URLs as requests, or read a whole archive into memory. */
class LocalSource extends FileSource {
  async getBytes(offset:number,length:number){
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||length>MAX_READ||(offset!==0&&offset+length>this.file.size))throw new MapPackError('invalid');
    return super.getBytes(offset,Math.min(length,this.file.size-offset));
  }
}
async function decompress(data:ArrayBuffer,compression:Compression){
  if(compression===Compression.None)return data;
  if(compression!==Compression.Gzip)throw new MapPackError('format');
  const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>MAX_READ)throw new MapPackError('invalid');chunks.push(next.value);}}
  finally{await reader.cancel().catch(()=>{});}
  const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result.buffer;
}
export function validatePackHeader(h:Header,size:number){
  const ranges=[[h.rootDirectoryOffset,h.rootDirectoryLength],[h.jsonMetadataOffset,h.jsonMetadataLength],[h.leafDirectoryOffset,h.leafDirectoryLength],[h.tileDataOffset,h.tileDataLength]] as [number,number][];
  if(h.specVersion!==3||!Number.isSafeInteger(size)||size<127||size>8*1024**3||ranges.some(([offset,length])=>!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<127||length<0||offset+length>size)||h.rootDirectoryLength>MAX_READ||h.jsonMetadataLength>MAX_READ)throw new MapPackError('invalid');
  if(![TileType.Jpeg,TileType.Png,TileType.Webp].includes(h.tileType)||![Compression.None,Compression.Gzip].includes(h.internalCompression)||![Compression.None,Compression.Gzip].includes(h.tileCompression))throw new MapPackError('format');
  if(!Number.isInteger(h.minZoom)||!Number.isInteger(h.maxZoom)||h.minZoom<0||h.maxZoom<h.minZoom||h.maxZoom>18||![h.minLon,h.maxLon,h.minLat,h.maxLat].every(Number.isFinite)||h.minLon< -180||h.maxLon>180||h.minLon>=h.maxLon||h.minLat< -85.051129||h.maxLat>85.051129||h.minLat>=h.maxLat)throw new MapPackError('invalid');
}
function plain(value:unknown,max:number){return typeof value==='string'?value.replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):'';}
export async function inspectMapPack(file:File,id:string=crypto.randomUUID()):Promise<OpenMapPack>{
  try{
    if(file.size<127)throw new MapPackError('invalid');
    const raw=await file.slice(0,127).arrayBuffer();if(new TextDecoder().decode(raw.slice(0,7))!=='PMTiles')throw new MapPackError('invalid');
    const header=bytesToHeader(raw);validatePackHeader(header,file.size);
    const archive=new PMTiles(new LocalSource(new File([file],id,{lastModified:file.lastModified})),new SharedPromiseCache(64,true,decompress),decompress);
    const metadata=await archive.getMetadata() as Record<string,unknown>;
    const name=plain(metadata.name,160),attribution=plain(metadata.attribution,1000),license=plain(metadata.license,160);
    if(!name||!attribution||!license)throw new MapPackError('invalid');
    return {archive,record:{id,name,filename:file.name,bytes:file.size,enabled:true,installedAt:new Date().toISOString(),bounds:{west:header.minLon,east:header.maxLon,south:header.minLat,north:header.maxLat},minZoom:header.minZoom,maxZoom:header.maxZoom,attribution,license,year:plain(metadata.year,40),resolution:plain(metadata.resolution,80)}};
  }catch(error){throw error instanceof MapPackError?error:new MapPackError('invalid');}
}
export function packOverlaps(a:GeoBounds,b:GeoBounds){
  if(a.north<=b.south||a.south>=b.north)return false;
  const ranges=a.west>a.east?[[a.west,180],[-180,a.east]]:[[a.west,a.east]];
  return ranges.some(([w,e])=>e>b.west&&w<b.east);
}
export function geographicTileBounds(z:number,x:number,y:number):GeoBounds{
  const n=2**z,w=180/n;return {west:x*w-180,east:(x+1)*w-180,north:90-y*w,south:90-(y+1)*w};
}
export function mercatorY(latitude:number,z:number){const r=Math.max(-85.05112878,Math.min(85.05112878,latitude))*Math.PI/180;return (1-Math.asinh(Math.tan(r))/Math.PI)/2*2**z*256;}
export function fitMapPack(bounds:GeoBounds,width:number,height:number,maxZoom=18){
  const pixelsPerDegree=Math.min(Math.max(200,width)*.78/(bounds.east-bounds.west),Math.max(200,height)*.78/(bounds.north-bounds.south));
  return {latitude:(bounds.south+bounds.north)/2,longitude:(bounds.west+bounds.east)/2,zoom:Math.max(5,Math.min(maxZoom,Math.log2(pixelsPerDegree*180/256)))};
}
