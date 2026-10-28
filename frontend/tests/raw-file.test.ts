import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isRawFile,isImportPhoto,photoFileAccept,rawGeometry} from '../src/browser/raw-file.ts';

test('RAW identification keeps source formats distinct from display JPEGs',()=>{
  for(const name of ['camera.CR2','camera.nef','camera.ARW','camera.DNG','camera.IIQ','camera.RAF'])assert.equal(isRawFile(name),true);
  for(const name of ['camera.jpg','camera.cr2.jpg','camera.raw.txt','camera',''])assert.equal(isRawFile(name),false);
  assert.equal(isImportPhoto('camera.AVIF'),true);assert.equal(isImportPhoto('notes.txt'),false);assert.equal(isImportPhoto('camera.HEIC'),true);
  assert.ok(photoFileAccept.includes('.dng'));assert.ok(photoFileAccept.includes('.cr3'));
});
test('RAW metadata dimensions already oriented by LibRaw are not swapped a second time',()=>{
  assert.deepEqual(rawGeometry({width:4000,height:6000,flip:6}),{width:4000,height:6000,orientation:6});
  assert.deepEqual(rawGeometry({width:4000,height:6000,flip:5}),{width:4000,height:6000,orientation:8});
  assert.deepEqual(rawGeometry({width:6000,height:4000,flip:3}),{width:6000,height:4000,orientation:3});
  for(const [width,height] of [[0,8],[-1,8],[8.5,9],[1e10,1],[NaN,9],[20000,20000]])assert.throws(()=>rawGeometry({width,height,flip:0}));
});
