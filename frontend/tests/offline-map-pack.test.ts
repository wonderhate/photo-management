import test from 'node:test';
import assert from 'node:assert/strict';
import {Compression,TileType} from 'pmtiles';
import type {Header} from 'pmtiles';
import {fitMapPack,geographicTileBounds,inspectMapPack,MapPackError,mercatorY,packOverlaps,validatePackHeader} from '../src/core/offline-map-pack.ts';

function fixture(metadata:Record<string,unknown>={name:'Synthetic region',attribution:'Synthetic fixture',license:'CC0'}){
  const json=new TextEncoder().encode(JSON.stringify(metadata)),root=new Uint8Array([0]),tile=new Uint8Array([1,2,3]);
  const buffer=new ArrayBuffer(127+root.length+json.length+tile.length),v=new DataView(buffer),bytes=new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode('PMTiles'));v.setUint8(7,3);
  for(const [offset,value] of [[8,127],[16,root.length],[24,128],[32,json.length],[40,128+json.length],[48,0],[56,128+json.length],[64,tile.length]])v.setBigUint64(offset,BigInt(value),true);
  v.setUint8(97,1);v.setUint8(98,1);v.setUint8(99,TileType.Webp);v.setUint8(100,6);v.setUint8(101,14);
  for(const [offset,value] of [[102,110],[106,24],[110,111],[114,26]])v.setInt32(offset,value*1e7,true);
  bytes.set(root,127);bytes.set(json,128);bytes.set(tile,128+json.length);
  return new File([bytes],'synthetic.pmtiles');
}
test('reads a local archive without following metadata URLs, preserves source bytes',async()=>{
  const file=fixture({name:'Region <b>A</b>',attribution:'ESA <img src="https://bad.invalid">',license:'CC BY 4.0',tiles:['https://bad.invalid/{z}/{x}/{y}'],year:'2021'}),before=await file.arrayBuffer();
  const old=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('No external requests permitted');};
  try{const result=await inspectMapPack(file,'test');assert.equal(result.record.name,'Region A');assert.equal(result.record.attribution,'ESA');assert.equal(result.record.bytes,file.size);assert.equal(result.record.maxZoom,14);assert.deepEqual(await file.arrayBuffer(),before);}finally{globalThis.fetch=old;}
});
test('rejects missing metadata, wrong signature and truncated archives',async()=>{
  for(const file of [fixture({name:'Missing license'}),new File(['not a map'],'bad.pmtiles'),new File([await fixture().slice(0,130).arrayBuffer()],'truncated.pmtiles')])await assert.rejects(inspectMapPack(file),MapPackError);
});
test('validates offsets, projections, raster types and safe zoom limits',()=>{
  const h={specVersion:3,rootDirectoryOffset:127,rootDirectoryLength:10,jsonMetadataOffset:137,jsonMetadataLength:10,leafDirectoryOffset:147,leafDirectoryLength:0,tileDataOffset:147,tileDataLength:10,tileType:TileType.Webp,internalCompression:Compression.None,tileCompression:Compression.None,minZoom:6,maxZoom:14,minLon:110,maxLon:111,minLat:24,maxLat:26} as Header;
  validatePackHeader(h,157);
  for(const patch of [{tileType:TileType.Mvt},{maxZoom:30},{minLat:-90},{maxLon:100},{tileDataLength:200},{jsonMetadataLength:32*1024**2},{rootDirectoryOffset:NaN}])assert.throws(()=>validatePackHeader({...h,...patch},157),MapPackError);
});
test('coverage handles date line viewports, boundaries and geographic tile projection',()=>{
  const a={west:110,east:111,south:24,north:26};
  assert.equal(packOverlaps(a,{west:110.5,east:112,south:25,north:27}),true);
  assert.equal(packOverlaps(a,{west:111,east:112,south:25,north:27}),false);
  assert.equal(packOverlaps({west:170,east:-170,south:-10,north:10},{west:-179,east:-175,south:0,north:5}),true);
  assert.deepEqual(geographicTileBounds(0,0,0),{west:-180,east:0,north:90,south:-90});
  assert.deepEqual(geographicTileBounds(0,1,0),{west:0,east:180,north:90,south:-90});
  assert.equal(mercatorY(0,0),128);assert.ok(Math.abs(mercatorY(85.05112878,0))<1e-6);assert.ok(mercatorY(25,14)<mercatorY(24,14));
  for(const [width,height] of [[1360,680],[350,520]]){const fitted=fitMapPack(a,width,height),scale=256*2**fitted.zoom/180;assert.ok((a.east-a.west)*scale<=width*.78+1e-8);assert.ok((a.north-a.south)*scale<=height*.78+1e-8);assert.equal(fitted.latitude,25);assert.equal(fitted.longitude,110.5);}
});
