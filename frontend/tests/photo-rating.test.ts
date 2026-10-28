import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {externalRating,xmpRating,ratingProtected} from '../src/core/photo-rating.ts';
const contract=JSON.parse(readFileSync(new URL('./fixtures/photo-rating.json',import.meta.url),'utf8'));
test('XMP stars follow the same bounded value and provenance contract as the native reader',()=>{
  for(const [input,expected] of contract.values)assert.equal(xmpRating(input),expected);
  for(const {raw,expected} of contract.cases)assert.deepEqual(externalRating(raw),expected);
});
test('unknown legacy decisions and manual clears remain protected',()=>{
  for(const source of [undefined,'manual','legacy'] as const)assert.equal(ratingProtected(source),true);
  for(const source of ['none','xmp-sidecar','xmp-embedded'] as const)assert.equal(ratingProtected(source),false);
});
