import {test} from 'node:test';
import assert from 'node:assert/strict';
import {galleryRows,waterfallLayout,waterfallWindow,indexRuns,storedGalleryLayout,photoAspect} from '../src/gallery-layout.ts';

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

test('waterfall keeps complete photo proportions, stays within width and indexes the same visible items as a full scan',()=>{
  const ids=Array.from({length:137},(_,i)=>String(i)),ratios=new Map(ids.map((id,i)=>[id,[.4,1,1.5,4][i%4]]));
  for(const width of [350,1200]){
    const layout=waterfallLayout(ids,ratios,width,230,14,38,width<500),all=layout.columns.flat();
    assert.deepEqual(all.map(p=>p.index).sort((a,b)=>a-b),ids.map((_,i)=>i));
    for(const column of layout.columns){
      for(let i=0;i<column.length;i++){
        const p=column[i];assert.ok(p.left>=0&&p.left+p.width<=width+.001);assert.ok(Math.abs(p.width/p.imageHeight-ratios.get(ids[p.index])!)<.00001);
        if(i)assert.ok(p.top>=column[i-1].top+column[i-1].height+14-.001);
      }
    }
    for(const top of [0,100,1500,layout.totalHeight-400]){
      const actual=waterfallWindow(layout,top,700,200).map(p=>p.index);
      const expected=all.filter(p=>p.top+p.height>=Math.max(0,top-200)&&p.top<=top+900).map(p=>p.index).sort((a,b)=>a-b);
      assert.deepEqual(actual,expected);
    }
  }
  assert.deepEqual(waterfallLayout([],new Map(),350,230,14),{columns:[],totalHeight:0});
});

test('50,000-photo waterfall retains thin geometry and a bounded render window',()=>{
  const ids=Array.from({length:50000},(_,i)=>String(i)),ratios=new Map(ids.map((id,i)=>[id,[.67,1,1.5,3][i%4]]));
  const layout=waterfallLayout(ids,ratios,1440,230,14);
  assert.equal(layout.columns.flat().length,50000);
  for(const progress of [0,.2,.5,.95]){
    const window=waterfallWindow(layout,layout.totalHeight*progress,900,800);
    assert.ok(window.length>0&&window.length<160,`window at ${progress}: ${window.length}`);
    assert.ok(window.every(p=>!('photo' in p)&&!('thumbnail_url' in p)));
    assert.ok(indexRuns(window.map(p=>p.index)).every(([start,end])=>end-start<128));
  }
});

test('layout preference keeps all four modes and defaults unknown values; cached aspect survives record eviction',()=>{
  for(const mode of ['grid','justified','tiles','waterfall'])assert.equal(storedGalleryLayout(mode),mode);
  assert.equal(storedGalleryLayout('unknown'),'justified');assert.equal(storedGalleryLayout(null),'justified');
  assert.equal(photoAspect({width:-1,height:20}),1.5);
  const rows=galleryRows(['portrait'],{},350,230,14,new Map([['portrait',.5]]));assert.deepEqual(rows[0].ratios,[.5]);
});
