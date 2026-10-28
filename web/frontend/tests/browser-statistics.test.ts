import test from 'node:test';
import assert from 'node:assert/strict';
import {histogram,statistics,report,matches} from '../src/browser/statistics.ts';
import type {Photo} from '../src/types.ts';

test('browser reports preserve unknown EXIF and disjoint numeric and date boundaries',()=>{
  const rows=[null,15,16,24,25,35,36,50,51,85,86,135,136,200,201].map((focal_length,i)=>({id:String(i),file_name:'synthetic.jpg',tags:[],focal_length,iso:i?100:null,f_number:i?2.8:null,exposure_seconds:i?1/125:null,date_taken:i?'2024-02-29T10:30:00':null,camera_model:null,lens_model:null}) as Photo);
  const bins=histogram(rows,'focal_length');
  assert.deepEqual(bins.map(b=>b.count),[1,2,2,2,2,2,2,1]);
  for(const field of ['focal_length','iso','f_number','exposure_seconds'] as const)assert.equal(histogram(rows,field).reduce((n,b)=>n+b.count,0),rows.length-1);
  assert.equal(statistics(rows).summary.unknown_date,1);
  assert.equal(matches(rows[0],{date_from:'2024-02-01'}),false);
  const monthly=report(rows,2024,2,[24,35,50,85,135]);
  assert.equal(monthly.timeline.length,29);assert.equal(monthly.summary.total,14);
  assert.equal(monthly.timeline.at(-1)?.count,14);
  assert.equal(Object.values(monthly.timeline.at(-1)!.focal_bands).reduce((n,v)=>n+v,0),14);
  assert.equal(report(rows,2024,null,[24,35,50,85,135]).timeline.length,12);
});

test('legacy scope dates include fractional end seconds and preserve false and missing shapes',()=>{
  const row={id:'scope-date',file_name:'fixture.jpg',tags:[],favorite:false,camera_make:'SONY',date_taken:'2026-01-01T23:59:59.999',width:null,height:null} as unknown as Photo;
  assert.equal(matches(row,{date_from:'2026-01-01',date_to:'2026-01-01'}),true);
  assert.equal(matches(row,{date_from:'2026-01-02'}),false);
  assert.equal(matches(row,{date_to:'2025-12-31'}),false);
  assert.equal(matches({...row,date_taken:'2026-01-01'},{date_from:'2026-01-01'}),true);
  assert.equal(matches({...row,date_taken:null},{date_to:'2026-01-01'}),false);
  assert.equal(matches(row,{favorite:'false',camera_make:'SONY'}),true);
  assert.equal(matches(row,{favorite:'true'}),false);
  assert.equal(matches(row,{camera_make:'Canon'}),false);
  assert.equal(matches(row,{orientation:'square'}),false);
  assert.equal(matches({...row,width:100,height:100},{orientation:'square'}),true);
});
