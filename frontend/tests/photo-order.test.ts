import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {photoOrder,photoSort} from '../src/core/photo-order.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/photo-order.json',import.meta.url),'utf8'));
test('photo order matches the shared SQL contract for ties, missing values, zero and Unicode',()=>{
  for(const [key,expected] of Object.entries(fixture.expected)){
    const [field,direction]=key.split(':');assert.deepEqual([...fixture.rows].sort(photoOrder(field,direction)).map(p=>p.id),expected);
    assert.deepEqual([...fixture.rows].reverse().sort(photoOrder(field,direction)).map(p=>p.id),expected);
  }
});
test('unknown photo sort fields fall back to time rather than arbitrary metadata',()=>{
  for(const field of [null,'__proto__','raw_exif','manual','unknown']){
    assert.equal(photoSort(field),'date_taken');assert.deepEqual([...fixture.rows].sort(photoOrder(field,'bad')).map(p=>p.id),fixture.expected['date_taken:desc']);
  }
});
