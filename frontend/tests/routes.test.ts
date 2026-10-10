import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pageFromURL} from '../src/routes.ts';
test('navigation survives refresh and rejects unknown pages',()=>{
  for(const page of ['albums','smart','stats','reports','settings'] as const)assert.equal(pageFromURL('/',`?page=${page}`),page);
  assert.equal(pageFromURL('/compare','?ids=a,b'),'compare');
  assert.equal(pageFromURL('/watermark/workshop','?draft=123'),'watermark');
  assert.equal(pageFromURL('/watermark/gallery',''),'watermark-gallery');
  assert.equal(pageFromURL('/','?page=unknown'),'photos');
});
