import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitScale,boundedPan,boundedZoom,zoomAt,zoomStep} from '../src/core/viewer-geometry.ts';
test('fit preserves aspect and avoids upscaling small previews in portrait and landscape stages',()=>{
  assert.equal(fitScale({width:1200,height:800},{width:600,height:600}),.5);
  assert.equal(fitScale({width:600,height:900},{width:1200,height:600}),2/3);
  assert.equal(fitScale({width:80,height:60},{width:800,height:600}),1);
  assert.equal(fitScale({width:0,height:0},{width:800,height:600}),1);
});
test('zoom keeps the image point under the cursor and clamps only when a frame edge is reached',()=>{
  const image={width:2000,height:1000},area={width:800,height:600},pan={x:10,y:-20},anchor={x:100,y:50},next=zoomAt(pan,1,2,anchor,image,area);
  assert.deepEqual(next,{x:-80,y:-90});assert.equal((anchor.x-pan.x),(anchor.x-next.x)/2);assert.equal((anchor.y-pan.y),(anchor.y-next.y)/2);
  assert.deepEqual(boundedPan({x:9999,y:-9999},image,area,1),{x:600,y:-200});
  assert.deepEqual(boundedPan({x:-9999,y:9999},{width:80,height:60},area,1),{x:0,y:0});
});
test('zoom percentage and steps remain finite and bounded for empty and extreme input',()=>{
  assert.equal(boundedZoom(NaN),1);assert.equal(boundedZoom(-100),.01);assert.equal(boundedZoom(1000),8);
  assert.equal(boundedZoom(Infinity),8);assert.equal(boundedZoom(-Infinity),.01);
  assert.equal(zoomStep(.68,1),.75);assert.equal(zoomStep(.68,-1),.5);assert.equal(zoomStep(.01,-1),.01);assert.equal(zoomStep(8,1),8);
});
