import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pageFromURL} from '../src/routes.ts';
test('navigation survives refresh and rejects unknown pages',()=>{
  assert.equal(pageFromURL('/',''),'home');
  assert.equal(pageFromURL('/','?lang=en'),'home');
  for(const page of ['home','photos','albums','smart','stats','reports','settings'] as const)assert.equal(pageFromURL('/',`?page=${page}`),page);
  assert.equal(pageFromURL('/compare','?ids=a,b'),'compare');
  assert.equal(pageFromURL('/watermark/workshop','?draft=123'),'watermark');
  assert.equal(pageFromURL('/watermark/gallery',''),'watermark-gallery');
  assert.equal(pageFromURL('/','?page=unknown'),'home');
  for(const tool of ['darkroom','analyze','raw','edit']){
    assert.equal(pageFromURL('/tools/'+tool,''),'darkroom');
    assert.equal(pageFromURL('/',`?page=${tool}`),'darkroom');
  }
});
