import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparisonDefault,comparisonFrame,moveComparison,zoomComparison,comparisonZoom} from '../src/core/comparison-view.ts';

test('comparison links relative image positions across different dimensions without stretching',()=>{
  const landscape={width:1200,height:800},portrait={width:600,height:900},area={width:500,height:500};
  const moved=moveComparison({...comparisonDefault(),zoom:4},{x:40,y:30},landscape,area);
  const a=comparisonFrame(moved,landscape,area),b=comparisonFrame(moved,portrait,area);
  assert.ok(Math.abs(a.pan.x-40)<1e-9);assert.ok(Math.abs(a.pan.y-30)<1e-9);
  assert.ok(Math.abs(a.pan.x/(landscape.width*a.scale)-b.pan.x/(portrait.width*b.scale))<1e-9);
  assert.ok(Math.abs(a.pan.y/(landscape.height*a.scale)-b.pan.y/(portrait.height*b.scale))<1e-9);
  assert.ok(Math.abs(a.scale*landscape.width/(a.scale*landscape.height)-1.5)<1e-9);
});
test('comparison cursor zoom holds the subject, and image edges bound dragging',()=>{
  const image={width:1200,height:800},area={width:600,height:600},pose={...comparisonDefault(),zoom:2},anchor={x:100,y:40};
  const before=comparisonFrame(pose,image,area),zoomed=zoomComparison(pose,4,image,area,anchor),after=comparisonFrame(zoomed,image,area);
  assert.ok(Math.abs((anchor.x-before.pan.x)/before.scale-(anchor.x-after.pan.x)/after.scale)<1e-9);
  const moved=moveComparison(zoomed,{x:1e6,y:-1e6},image,area),frame=comparisonFrame(moved,image,area);
  assert.equal(frame.pan.x,(image.width*frame.scale-area.width)/2);assert.equal(frame.pan.y,-(image.height*frame.scale-area.height)/2);
  const fit=comparisonFrame(comparisonDefault(),image,area);assert.deepEqual(fit.pan,{x:0,y:0});assert.equal(fit.scale,.5);
});
test('empty comparison previews and extreme zoom input cannot create invalid coordinates',()=>{
  const empty={width:0,height:0};assert.deepEqual(moveComparison(comparisonDefault(),{x:12,y:4},empty,empty),comparisonDefault());
  assert.equal(comparisonZoom(NaN),1);assert.equal(comparisonZoom(Infinity),8);assert.equal(comparisonZoom(-Infinity),.5);
});
