import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {metadataFromTags,formatShutter,metadataNumber,originalMetadata,supplementMetadata} from '../src/core/metadata.ts';

const vectors=JSON.parse(readFileSync(new URL('./fixtures/metadata-contract.json',import.meta.url),'utf8'));
const blank=Object.fromEntries(Object.keys(metadataFromTags({})).map(key=>[key,null]));
test('the shared metadata contract preserves camera time, GPS, unknowns and source geometry',()=>{
  for(const vector of vectors.cases)assert.deepEqual(metadataFromTags(vector.tags),{...blank,...vector.expected},vector.name);
  for(const [value,expected] of vectors.shutters)assert.equal(formatShutter(value),expected);
  for(const value of [null,undefined,'',true,false,NaN,'Infinity','0x10','1/0',[]])assert.equal(metadataNumber(value),null);
});
test('XMP fills missing facts while retaining original values and a separate provenance record',()=>{
  const base=originalMetadata({Model:'original',ExposureTime:.8,Orientation:1});
  const result=supplementMetadata(base,{'XMP-tiff:Model':'external','XMP-exif:ISOSpeedRatings':'400','XMP-tiff:Orientation':6,'XMP-xmp:Rating':5,'XMP-dc:subject':['external']},'xmp-sidecar');
  assert.equal(result.camera_model,'original');assert.equal(result.exposure_time,'0.8');assert.equal(result.iso,400);assert.equal(result.orientation,1);
  assert.equal(result.raw_exif['xmp-sidecar:XMP-xmp:Rating'],'5');assert.equal((result as any).rating,undefined);assert.equal((result as any).tags,undefined);
  assert.deepEqual(JSON.parse(result.raw_exif['PhotoCollection:MetadataSources']),{camera_model:'original',exposure_seconds:'original',exposure_time:'original',orientation:'original',iso:'xmp-sidecar'});
  assert.equal(base.iso,null);assert.equal(base.raw_exif['xmp-sidecar:XMP-xmp:Rating'],undefined);
});
