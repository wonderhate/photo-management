import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compilePhotoQuery,normalizePhotoQuery} from '../src/core/photo-query.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/photo-query.json',import.meta.url),'utf8'));
test('metadata queries match the shared SQLite truth table including nested NOT and known zero',()=>{
  for(const item of fixture.cases){const query={version:1,root:item.root};assert.deepEqual(fixture.rows.filter(compilePhotoQuery(query)).map(p=>p.id),item.ids,item.name);assert.deepEqual(normalizePhotoQuery(normalizePhotoQuery(query)),normalizePhotoQuery(query));}
});
test('queries reject unknown structure, types, oversized groups and invalid calendar dates',()=>{
  const leaf={op:'eq',field:'rating',value:0},wrap=(root:unknown)=>({version:1,root});
  for(const query of [null,{version:2,root:leaf},{version:true,root:leaf},{...wrap(leaf),extra:1},...[
    {...leaf,field:'raw_exif'},{...leaf,op:'LIKE'},{...leaf,value:null},{...leaf,value:true},{...leaf,value:6},{...leaf,value:.5},{...leaf,value:Infinity},
    {op:'contains',field:'favorite',value:'yes'},{op:'eq',field:'favorite',value:0},{op:'gt',field:'tag',value:'a'},
    {op:'in',field:'rating',value:[]},{op:'in',field:'rating',value:Array(33).fill(1)},{op:'is_null',field:'rating',value:0},
    {op:'and',children:[]},{op:'or',children:Array(33).fill(leaf)},
    ...['2026-02-30','0000-01-01','2026-01-01T24:00:00','2026-01-01Z'].map(value=>({op:'eq',field:'date_taken',value})),
    ...['a'.repeat(257),'\0','\ud800'].map(value=>({op:'eq',field:'file_name',value})),
    Array.from({length:9}).reduce<unknown>(child=>({op:'not',child}),leaf),
    {op:'or',children:Array(32).fill({op:'and',children:Array(4).fill(leaf)})}
  ].map(wrap)])assert.throws(()=>normalizePhotoQuery(query),/Invalid photo query/);
});
