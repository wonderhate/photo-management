import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeGalleryCache} from '../src/gallery-cache.ts';
import type {Photo} from '../src/types';
test('gallery cache is bounded and preserves the visible window',()=>{
  const photos=Array.from({length:1000},(_,i)=>({id:String(i)} as Photo));
  const cache=mergeGalleryCache({},photos,new Set(['999','998']));
  assert.equal(Object.keys(cache).length,600);assert.ok(cache['999']&&cache['998']);
});
