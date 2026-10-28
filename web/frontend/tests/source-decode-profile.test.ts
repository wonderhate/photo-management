import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceDecodeProfile,legacySourceDecode,embeddedSourceProfile} from '../src/core/source-decode-profile.ts';

test('old edit profiles stay identity; new profiles retain every supported source orientation',()=>{
  assert.deepEqual(sourceDecodeProfile(undefined),legacySourceDecode);
  for(let n=1;n<=8;n++)assert.deepEqual(sourceDecodeProfile({version:2,extra_orientation:n}),{version:2,extra_orientation:n});
  const result=sourceDecodeProfile(undefined);result.extra_orientation=6;assert.equal(legacySourceDecode.extra_orientation,1);
});
test('future, malformed and non-identity legacy profiles fail instead of changing input pixels',()=>{
  for(const profile of [null,[],{},true,{version:1,extra_orientation:6},{version:3,extra_orientation:1},{version:true,extra_orientation:1},{version:2,extra_orientation:true},{version:2,extra_orientation:'6'},{version:2,extra_orientation:0},{version:2,extra_orientation:9},{version:2,extra_orientation:1,other:1}])assert.throws(()=>sourceDecodeProfile(profile));
});
test('only embedded JPEG directions with absent EXIF affect new sources',()=>{
  for(let n=1;n<=8;n++)assert.deepEqual(embeddedSourceProfile(true,false,{'XMP-tiff:Orientation':String(n)}),{version:2,extra_orientation:n});
  for(const p of [embeddedSourceProfile(false,false,{'XMP-tiff:Orientation':'6'}),embeddedSourceProfile(true,true,{'XMP-tiff:Orientation':'6'}),embeddedSourceProfile(true,false,{'XMP-tiff:Orientation':'99'}),embeddedSourceProfile(true,false,{'XMP-exif:Orientation':'6'}),embeddedSourceProfile(true,false,null)])assert.deepEqual(p,{version:2,extra_orientation:1});
});
