import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSplitEditSource,splitEditDefaults} from '../src/core/edit-lineage.ts';
import {renderPixels} from '../src/browser/editing.ts';

test('derived panel source contract rejects unknown versions, missing fields, unsafe IDs and invalid dimensions',()=>{
  const contract=JSON.parse(readFileSync(new URL('./fixtures/edit-lineage-contract.json',import.meta.url),'utf8'));
  assert.doesNotThrow(()=>validateSplitEditSource(contract.valid));
  for(const patch of contract.invalidPatches)assert.throws(()=>validateSplitEditSource({...contract.valid,...patch}));
  for(const key of Object.keys(contract.valid)){const value={...contract.valid};delete value[key];assert.throws(()=>validateSplitEditSource(value));}
  for(const value of [null,[],undefined,1,'source'])assert.throws(()=>validateSplitEditSource(value));
});

test('neutral child editing preserves every rendered RGBA byte and does not repeat the parent grade',()=>{
  const data=new Uint8ClampedArray(101*37*4);for(let i=0;i<data.length;i++)data[i]=(i*73+Math.floor(i/19)*11)%256;
  const pixels={width:101,height:37,channels:4 as const,data};
  const defaults=splitEditDefaults(),parent={...defaults.recipe,exposure:.7,temperature:25,contrast:12,sharpen:30};
  const panel=renderPixels(pixels,parent),child=renderPixels(panel,defaults.recipe);
  assert.deepEqual(child,panel);assert.notDeepEqual(renderPixels(panel,parent).data,panel.data);
  assert.deepEqual(defaults.decode_profile,{version:2,extra_orientation:1});
  defaults.recipe.crop.width=.5;defaults.recipe.curve[0]=.2;
  assert.equal(splitEditDefaults().recipe.crop.width,1);assert.equal(splitEditDefaults().recipe.curve[0],0);
});
