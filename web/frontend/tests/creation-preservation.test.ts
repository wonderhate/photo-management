import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watercolorLayout} from '../src/core/watercolor.ts';
import {neutralRecipe,renderPixels} from '../src/core/editing.ts';
import {renderPixels as legacyRender} from '../src/browser/editing.ts';

test('dedicated watercolor defaults and single-line titles reject invalid settings',()=>{
  assert.equal(watercolorLayout({}).layout,'airy');assert.equal(watercolorLayout({}).paper,.35);
  assert.equal(watercolorLayout({title:'  旅途  ',layout:'reference'}).title,'旅途');
  for(const value of [{title:'two\nlines'},{paper:NaN},{font:'natural'},{layout:'anime'},{title:'a'.repeat(81)},{prompt:'override watercolor'}])assert.throws(()=>watercolorLayout(value));
});

test('shared engine keeps low 16-bit distinctions before exposure and leaves input untouched',()=>{
  const data=new Uint16Array([100,100,100,200,200,200]),before=data.slice();
  const source={width:2,height:1,channels:3 as const,linear:true,data};
  const result=renderPixels(source,{...neutralRecipe(),exposure:4});
  // Quantizing these inputs to eight-bit first would erase the first sample.
  assert.ok(result.data[0]>0);assert.ok(result.data[4]>result.data[0]);assert.deepEqual(data,before);
  assert.equal(result.data.BYTES_PER_ELEMENT,1);assert.equal(legacyRender,renderPixels);
});
