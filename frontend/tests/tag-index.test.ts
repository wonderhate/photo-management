import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TagIndex,validateTagOptions} from '../src/core/tag-index.ts';

test('tag index preserves current tags, scoped counts, stable manual order and literal Unicode search',()=>{
  const rows=[{id:'a',tags:['旅行','AI first','%_','😀','𐀀','\ue000','人工'],tag_origins:{'AI first':'ai'}},{id:'b',tags:['旅行','旅行','AI first'],tag_origins:{旅行:'ai','AI first':'ai'}},{id:'c',tags:[]}],index=new TagIndex(rows);
  assert.deepEqual(index.query({term:'旅行',origins:true}).values,[{value:'旅行',count:2,user_count:1}]);
  assert.deepEqual(index.query({ids:['b','unknown','b'],term:'旅行',origins:true}).values,[{value:'旅行',count:1,user_count:0}]);
  assert.equal(index.query({ids:[]}).total,0);assert.equal(index.query().missing,1);
  assert.equal(index.query({term:'%_'}).values[0].value,'%_');assert.equal(index.query({term:'ai FIRST'}).values[0].value,'AI first');
  assert.deepEqual(index.query({term:'',size:100}).values.slice(-3).map(v=>v.value),['\ue000','𐀀','😀']);
  assert.equal(index.query({order:'manual',size:100}).values.at(-1)?.value,'AI first');
  assert.equal(index.query({ids:['b'],order:'manual'}).values[0].value,'AI first');
  rows[0].tags.length=0;assert.equal(index.query({term:'%_'}).values.length,1); // The rebuildable index owns its snapshot.
  for(const bad of [{term:'x'.repeat(257)},{term:'\0'},{page:0},{page:1.2},{size:101},{size:0},{order:'random'}])assert.throws(()=>validateTagOptions(bad as any));
});

test('ten thousand tags paginate without duplicates and rebuild after edits',()=>{
  const rows=Array.from({length:100},(_,i)=>({id:'p'+i,tags:Array.from({length:100},(_,j)=>'Tag-'+String(i*100+j).padStart(5,'0'))})),index=new TagIndex(rows);
  let result:string[]=[];for(let page=1;page<=100;page++){const r=index.query({page,size:100});assert.equal(r.has_more,page<100);assert.equal(r.total,100);result.push(...r.values.map(v=>v.value));}
  assert.equal(new Set(result).size,10000);assert.deepEqual(index.query({term:'09999'}).values,[{value:'Tag-09999',count:1}]);
  assert.equal(index.query({ids:['p99']}).values.length,60);rows[99].tags=['new manual'];assert.deepEqual(new TagIndex(rows).query({term:'new'}).values,[{value:'new manual',count:1}]);
});
