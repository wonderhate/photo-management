import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compilePhotoQuery,normalizePhotoQuery} from '../src/core/photo-query.ts';
import {photoTextValue} from '../src/core/photo-text.ts';
const contract=JSON.parse(readFileSync(new URL('./fixtures/text-search-contract.json',import.meta.url),'utf8'));
test('descriptions, OCR, effective tags and literal phrases follow the shared SQL contract',()=>{
  const before=JSON.stringify(contract.rows);
  for(const c of contract.cases){const f=compilePhotoQuery({version:1,root:c.root});assert.deepEqual(contract.rows.filter(f).map((r:{id:string})=>r.id),c.ids,c.name);}
  assert.equal(photoTextValue(contract.rows[1],'description'),null);assert.equal(photoTextValue(contract.rows[1],'user_description'),'');
  assert.equal(photoTextValue(contract.rows[1],'ai_caption'),'海边隐藏 beach');assert.equal(JSON.stringify(contract.rows),before);
  assert.throws(()=>normalizePhotoQuery({version:1,root:{op:'icontains',field:'rating',value:'4'}}));
});
