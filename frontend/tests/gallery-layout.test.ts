import {test} from 'node:test';
import assert from 'node:assert/strict';
import {galleryRows} from '../src/gallery-layout.ts';

test('justified rows retain portrait and panoramic proportions within the available width',()=>{
  const ids=['portrait','wide','unknown','square'];
  const cache={portrait:{width:200,height:400},wide:{width:800,height:200},square:{width:300,height:300}};
  for(const width of [350,1200]){
    const rows=galleryRows(ids,cache as never,width,230,14);
    assert.deepEqual(rows.flatMap(row=>row.ids),ids);
    assert.deepEqual(rows.flatMap(row=>row.ratios),[.5,4,1.5,1]);
    for(const row of rows){assert.ok(row.height>0);assert.ok(row.ratios.reduce((sum,ratio)=>sum+ratio*row.height,0)+14*(row.ids.length-1)<=width+.01);assert.equal(row.ids.length,row.end-row.start+1)}
  }
  assert.deepEqual(galleryRows([],{},350,230,14),[]);
});
