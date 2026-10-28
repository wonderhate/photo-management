import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCube,prepareLut,applyLut} from '../src/core/cube-lut.ts';
import {validateLutAsset,validateLutSelection} from '../src/core/lut-contract.ts';
import {withLut} from '../src/core/lut-recipe.ts';
import {keepLayerFormat,recipeLayers} from '../src/core/layer-recipe.ts';
import {neutralRecipe,validateRecipe} from '../src/browser/editing.ts';
import {compositionBase} from '../src/core/composition-recipe.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/cube-lut-contract.json',import.meta.url),'utf8'));
const identity=()=>parseCube(fixture.valid[0].text);
test('CUBE parser shares strict source-byte contracts with native imports',()=>{
  for(const row of fixture.valid){const parsed=parseCube(row.text);assert.equal(parsed.title,row.title,row.name);assert.equal(parsed.size,row.size,row.name);assert.equal(parsed.table.length,row.size**3*3);}
  for(const row of fixture.invalid)assert.throws(()=>parseCube(row.text),undefined,row.name);
  assert.throws(()=>parseCube('LUT_3D_SIZE 65\n0 0 0'));assert.equal(identity().table[3],1);assert.equal(identity().table[4],0);
});
test('identity and zero strength preserve every channel and alpha exactly',()=>{
  const pixels=new Uint8ClampedArray(256*4);for(let i=0;i<256;i++)pixels.set([i,255-i,(i*31)%256,i],i*4);
  const before=pixels.slice(),prepared=prepareLut(identity());applyLut(pixels,prepared,1);assert.deepEqual(pixels,before);
  prepared.table.fill(10);applyLut(pixels,prepared,0);assert.deepEqual(pixels,before);assert.throws(()=>applyLut(pixels,prepared,NaN));
});
test('all six tetrahedra match a separate sorted-corner reference',()=>{
  const cube=identity();cube.table=Float32Array.from(cube.table,(_,i)=>(i*13%29)/29);const prepared=prepareLut(cube);
  for(const rgb of [[51,102,204],[51,204,102],[102,51,204],[102,204,51],[204,51,102],[204,102,51],[128,128,128]]){
    const axes=rgb.map((v,c)=>({value:v/255,bit:2**c})).sort((a,b)=>b.value-a.value),vertices=[0,axes[0].bit,axes[0].bit|axes[1].bit,7],weights=[1-axes[0].value,axes[0].value-axes[1].value,axes[1].value-axes[2].value,axes[2].value];
    const expected=new Uint8ClampedArray([...Array.from({length:3},(_,c)=>vertices.reduce((sum,v,i)=>sum+cube.table[v*3+c]*weights[i],0)*255),91]),actual=new Uint8ClampedArray([...rgb,91]);applyLut(actual,prepared,1);assert.deepEqual(actual,expected);
  }
});
test('domain and unclipped nodes affect interpolation before final strength mix',()=>{
  const cube=identity();cube.domainMin=[.25,.25,.25];cube.domainMax=[.75,.75,.75];const p=new Uint8ClampedArray([0,128,255,37]);applyLut(p,prepareLut(cube),1);assert.deepEqual([...p],[0,128,255,37]); // Uint8ClampedArray uses ties-to-even at 128.5.
  const out=identity();for(let i=0;i<out.table.length;i++)out.table[i]=out.table[i]*4-1;const prepared=prepareLut(out);out.table.fill(0);
  const pixels=new Uint8ClampedArray([128,0,255,7]);applyLut(pixels,prepared,.25);assert.deepEqual([...pixels],[160,0,255,7]);
});
test('LUT metadata and selection reject unknown formats and malformed values',()=>{
  const selection={version:1,asset_hash:'a'.repeat(64),strength:.5,input:'srgb'},asset={version:1,id:'a'.repeat(64),name:'Look.cube',title:'Look',size:2,bytes:100,favorite:false,hidden:false,used_at:null};validateLutSelection(selection);validateLutAsset(asset);
  for(const patch of [{version:2},{strength:true},{input:'log'},{asset_hash:'../look'},{extra:1}])assert.throws(()=>validateLutSelection({...selection,...patch}));
  for(const patch of [{version:2},{size:66},{bytes:0},{favorite:1},{used_at:'2026-02-30T00:00:00.000Z'}])assert.throws(()=>validateLutAsset({...asset,...patch}));
});
test('LUT recipe keeps immutable layer and crop semantics across saved-format undo',()=>{
  const source={width:100,height:80},original=neutralRecipe(),selection={version:1 as const,asset_hash:'a'.repeat(64),strength:.5,input:'srgb' as const},recipe=withLut(original,source,selection);validateRecipe(recipe);assert.equal(original.version,1);assert.equal(recipe.version,5);
  const cleared=withLut(recipe,source);assert.equal(cleared.lut,undefined);assert.deepEqual(recipeLayers(cleared),{version:1,layers:[]});validateRecipe(compositionBase(recipe));assert.equal((compositionBase(recipe) as typeof recipe).lut,selection);
  const old=keepLayerFormat(original,source,5);assert.equal(old.version,5);assert.equal((old as typeof recipe).lut,undefined);assert.throws(()=>validateRecipe({...recipe,version:4}));
});
