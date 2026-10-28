import test from 'node:test';
import assert from 'node:assert/strict';
import {collageHit,collagePan,collageZoom,collageWheelFactor,collageRatioSize} from '../src/core/collage-interaction.ts';
import {createCollage,collageRects} from '../src/core/collage.ts';
test('collage center snapping stays eight display pixels at different output scales and Shift bypasses it',()=>{
 const cell={source_id:'photo',zoom:1,pan:{x:0,y:0}};
 for(const scale of [.1,.5,1,2]){const rect={x:0,y:0,width:300/scale,height:200/scale};const near=collagePan(cell,rect,7,9,scale);assert.equal(near.pan.x,0);assert.equal(near.guides.x,true);assert.equal(near.guides.y,false);assert.equal(near.pan.y,9/200);const bypass=collagePan(cell,rect,7,0,scale,true);assert.equal(bypass.pan.x,7/300);assert.equal(bypass.guides.x,false);assert.equal(collagePan(cell,rect,10000,-10000,scale).pan.x,2);}
});
test('collage wheel and pinch scale proportionally, fine wheel is smaller, zero is inert, zoom stays bounded',()=>{
 assert.equal(collageWheelFactor(0),1);assert.ok(collageWheelFactor(-1)>collageWheelFactor(-1,false,true));assert.equal(collageWheelFactor(10,true),Math.exp(-.1));assert.equal(collageZoom(.25,.1),.25);assert.equal(collageZoom(5,10),5);assert.equal(collageZoom(1,2),2);
});
test('collage drag hit testing excludes padding, gaps, and far boundaries; ratio presets preserve their long edge',()=>{
 const sources=[0,1].map(i=>({id:'source-'+i,name:i+'.png',sha256:String(i).repeat(64),width:640,height:480,bits:8 as const,profile:{version:2 as const,extra_orientation:1}})),scene=createCollage(sources);scene.width=600;scene.height=400;const rects=collageRects(scene);
 assert.equal(collageHit(scene,0,0),-1);assert.equal(collageHit(scene,600,400),-1);assert.equal(collageHit(scene,300,200),-1);for(const [i,r] of rects.entries())assert.equal(collageHit(scene,r.x+r.width/2,r.y+r.height/2),i);
 assert.deepEqual(collageRatioSize(1600,16,9),{width:1600,height:900});assert.deepEqual(collageRatioSize(2400,3,4),{width:1800,height:2400});
});
