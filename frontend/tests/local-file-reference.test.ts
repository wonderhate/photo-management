import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localFileURL,parseLocalFileURL,validDerivedPath} from '../src/core/local-file-reference.ts';
const origin='https://local.test';
test('derived file references round-trip Unicode, literal percent and fragment characters in export names',()=>{
  for(const path of ['photos/photo-1-thumb.jpg','drafts/draft-1/preview-2.webp','works/work-1/scene.png','works/work-1/poster-12.png','exports/山 #1 100%.png']){
    const url=localFileURL('library','session',path,origin);
    assert.deepEqual(parseLocalFileURL(url,origin),{libraryID:'library',session:'session',path});
    assert.equal(new URL(url).hash,'');assert.equal(new URL(url).search,'');
  }
});
test('file references cannot address originals, manifests, credentials or encoded directory traversal',()=>{
  for(const path of ['library.json','qwen-art-key.dpapi','photos/p-original.jpg','drafts/edits/p/source.png','exports/../library.json','works/w/../scene.png','exports/.private.png','exports/a/b.png']){
    assert.equal(validDerivedPath(path),false);assert.throws(()=>localFileURL('library','session',path,origin),/Invalid local file/);
  }
  const base=localFileURL('library','session','exports/photo.png',origin);
  assert.throws(()=>parseLocalFileURL(base+'?path=library.json',origin),/Invalid/);
  assert.throws(()=>parseLocalFileURL(base.replace('photo.png','a%2Fb.png'),origin),/Invalid/);
  assert.throws(()=>parseLocalFileURL(base.replace('/session/','/%00/'),origin),/Invalid/);
  assert.equal(parseLocalFileURL(base.replace(origin,'https://outside.test'),origin),null);
});

test('split references allow only saved master and numbered panels inside a UUID group',()=>{
  const prefix='drafts/splits/125e8616-7585-49a8-a99e-b985a81026cd/';
  for(const file of ['master.png','panel-01.jpg','panel-10.png'])assert.equal(parseLocalFileURL(localFileURL('library','session',prefix+file,origin),origin)?.path,prefix+file);
  for(const file of ['source.png','source.bin','panel-00.png','panel-11.png','master.jpg','../source.png'])assert.equal(validDerivedPath(prefix+file),false);
  assert.equal(validDerivedPath(prefix.replace('125e8616','..')+'master.png'),false);
});
