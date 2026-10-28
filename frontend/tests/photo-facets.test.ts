import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizePhotoFacets,facetsQuery,validateFacetPreferences,withoutFacet} from '../src/core/photo-facets.ts';
import {compilePhotoQuery} from '../src/core/photo-query.ts';
const contract=JSON.parse(readFileSync(new URL('./fixtures/facet-contract.json',import.meta.url),'utf8'));
test('facets share SQL values, NULL, exclusion, shapes and date boundaries',()=>{
  const before=JSON.stringify(contract);for(const c of contract.cases){const ast=facetsQuery(c.state);assert.ok(ast);assert.deepEqual(contract.rows.filter(compilePhotoQuery(ast)).map((p:{id:string})=>p.id),c.ids,c.name);}assert.equal(JSON.stringify(contract),before);
  const base={album_id:'album',query:'immutable rule',camera:'SONY',camera_model:'SONY',facets:JSON.stringify(contract.cases[19].state)};const next=withoutFacet(base,'camera_model');assert.equal(next.album_id,base.album_id);assert.equal(next.query,base.query);assert.equal(next.camera,undefined);assert.equal(JSON.parse(next.facets).items.length,2);
});
test('facet input and bar preferences reject malformed or oversized state',()=>{
  for(const items of [[{field:'unknown',op:'in',values:['x']}],[{field:'orientation',op:'in',values:['rotate']}],[{field:'rating',op:'in',values:[true]}],[{field:'rating',op:'range',min:5,max:0}],[{field:'date_taken',op:'range',max:'2026-02-30'}],[{field:'camera_model',op:'in',values:['x'],match:'all'}],[{field:'tag',op:'in',values:Array(33).fill('x')}],[{field:'tag',op:'in',values:['x']},{field:'tag',op:'in',values:['y']}],[{field:'tag',op:'in',values:['x'],exclude:'true'}]])assert.throws(()=>normalizePhotoFacets({version:1,items}));
  assert.throws(()=>normalizePhotoFacets({version:2,items:[]}));assert.throws(()=>validateFacetPreferences({hidden:['tag','tag']}));assert.throws(()=>validateFacetPreferences({hidden:['not-a-field']}));assert.throws(()=>validateFacetPreferences({hidden:null}));assert.deepEqual(normalizePhotoFacets({version:1,items:[{field:'tag',op:'in',values:[]}]}),{version:1,items:[]});
});
