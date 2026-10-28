import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisBrowse,analysisCounting,analysisPeriod,refineAnalysis} from '../src/core/analysis-scope.ts';
import {compilePhotoQuery} from '../src/core/photo-query.ts';
import {enterScope,normalizeQueryScope} from '../src/core/query-scope.ts';
import {matches,lensLifecycle} from '../src/browser/statistics.ts';
import {cameraDay,timelinePrefix} from '../src/core/timeline.ts';
import type {Photo} from '../src/types.ts';

test('chart drilldown intersects numeric/date bins and preserves a locked scope',()=>{
  const base={...enterScope('library-a',{favorite:'true'},'file'),focal_length_min:'30',date_from:'2024-02-15',date_to:'2024-02-20'};
  const next=refineAnalysis(base,{focal_length_min:25,focal_length_lt:36,date_from:'2024-02-01',date_to:'2024-02-29'});
  const predicate=compilePhotoQuery(JSON.parse(next.query));
  const row={tags:[],date_taken:'2024-02-19T23:59:59.900+09:00',focal_length:32} as unknown as Photo;
  assert.ok(matches(row,next)&&predicate(row));
  assert.ok(!matches({...row,focal_length:28},next));
  assert.ok(!predicate({...row,focal_length:36}));
  assert.ok(!matches({...row,date_taken:'2024-02-21'},next));
  assert.equal(analysisBrowse('library-a',next,'capture','stats').scope,base.scope);
  assert.throws(()=>analysisBrowse('library-b',next,'capture','stats'));
  assert.equal(normalizeQueryScope(analysisCounting(next,'capture').scope).mode,'capture');
  assert.equal(normalizeQueryScope(next.scope).mode,'file');
  assert.equal(normalizeQueryScope(analysisBrowse('library-a',{count_mode:'file',favorite:'true'},'capture').scope).mode,'file');
  assert.equal(analysisPeriod(base,'2024-02-01','2024-02-29').date_from,'2024-02-15');
  assert.equal(analysisPeriod(base,'2024-02-01','2024-02-29').date_to,'2024-02-20');
});

test('camera dates, invalid dates, leap periods and lifecycle retain wall-clock semantics',()=>{
  assert.equal(cameraDay('2024-02-29T00:30:00+14:00'),'2024-02-29');
  for(const value of [null,'','2026-02-30','0000-01-01','bad'])assert.equal(cameraDay(value),null);
  assert.equal(timelinePrefix(['2024','2','29']),'2024-02-29');
  assert.equal(timelinePrefix(['2026','2']),'2026-02');
  for(const parts of [['2026','2','29'],['2024','13'],['2024','1','1','extra'],['0']])assert.throws(()=>timelinePrefix(parts));
  const rows=['2025-01-30','2025-01-31','2026-01-31','2026-02-01'].map((date_taken,i)=>({id:String(i),date_taken,tags:[],lens_model:'lens'} as unknown as Photo));
  const life=lensLifecycle(rows,'lens',new Date(2026,0,31));
  assert.equal(life.past_12_months,2);assert.equal(life.total,4);
  const leap=lensLifecycle([{...rows[0],date_taken:'2023-02-28'}],'lens',new Date(2024,1,29));
  assert.equal(leap.past_12_months,1);
});
