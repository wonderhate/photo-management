import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRecent,recentExportPayload} from '../src/recent.ts';
test('recent exports retain one stable scoped file rather than blob or process session URLs',()=>{
  const job={id:'job',scope:{library_id:'library'},results:[{url:'https://local.test/api/exports/a.png?pc_session=old',path:'exports/a.png',file_name:'a.png'},{url:'blob:unused',path:'exports/b.png',file_name:'b.png'}]};
  assert.deepEqual(recentExportPayload(job,true,'https://local.test'),{job:'job',libraryId:'library',file:{path:'exports/a.png',name:'a.png'}});
  assert.deepEqual(recentExportPayload(job,false,'https://local.test'),{job:'job',libraryId:'library',file:{url:'/api/exports/a.png',name:'a.png'}});
});
test('recent history tolerates damaged storage while retaining old URI records and draft navigation',()=>{
  const legacy={kind:'export',label:'old',time:1,payload:{urls:['https://local.test/_pc-file/nonce/library/exports/a.png','blob:unused']}},draft={kind:'draft',label:'draft',time:2,payload:{draft:'draft-1'}};
  assert.deepEqual(normalizeRecent({}),[]);assert.deepEqual(normalizeRecent([null,{kind:'unknown'},...Array(20).fill(legacy)]).length,12);
  const items=normalizeRecent([legacy,draft]);assert.deepEqual(items[0].payload?.urls,[legacy.payload.urls[0]]);assert.equal(items[1].payload?.draft,'draft-1');
  assert.equal(normalizeRecent([{kind:'export',label:'x',time:3,payload:{urls:'bad',file:{name:42}}}])[0].payload?.file,undefined);
});
