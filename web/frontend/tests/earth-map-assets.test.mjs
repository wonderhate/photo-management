import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

function jpegSize(bytes){
  assert.equal(bytes.readUInt16BE(0),0xffd8,'Map imagery must be JPEG');
  for(let offset=2;offset+9<bytes.length;){
    assert.equal(bytes[offset],0xff,'Invalid JPEG marker');
    const marker=bytes[offset+1],length=bytes.readUInt16BE(offset+2);
    if([0xc0,0xc1,0xc2].includes(marker))return {width:bytes.readUInt16BE(offset+7),height:bytes.readUInt16BE(offset+5)};
    offset+=length+2;
  }
  throw Error('JPEG dimensions not found');
}

test('the bundled Earth imagery has a complete offline pyramid with matching dimensions and SHA-256',async()=>{
  const root=new URL('../public/maps/earth/',import.meta.url),manifest=JSON.parse(await readFile(new URL('metadata.json',root),'utf8'));
  assert.equal(manifest.projection,'equirectangular');assert.equal(manifest.crs,'EPSG:4326');
  assert.equal(manifest.rowOrigin,'north');assert.equal(manifest.tileSize,512);assert.equal(manifest.maxZoom,4);
  assert.deepEqual(manifest.bounds,[-180,-90,180,90]);assert.equal(manifest.tileUrl,'{z}/{x}-{y}.jpg');
  const expected=['globe.jpg'];
  for(let z=0;z<=manifest.maxZoom;z++)for(let x=0;x<2**(z+1);x++)for(let y=0;y<2**z;y++)expected.push(`${z}/${x}-${y}.jpg`);
  assert.equal(expected.length,683);assert.deepEqual(Object.keys(manifest.files).sort(),expected.slice().sort());
  let total=0;
  for(const path of expected){
    const bytes=await readFile(new URL(path,root)),entry=manifest.files[path];total+=bytes.length;
    assert.equal(bytes.length,entry.bytes,`${path}: length`);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,`${path}: digest`);
    assert.deepEqual(jpegSize(bytes),path==='globe.jpg'?{width:2048,height:1024}:{width:512,height:512},`${path}: dimensions`);
  }
  assert(total<25*1024*1024,'The complete offline Earth pyramid should stay below 25 MiB');
});
