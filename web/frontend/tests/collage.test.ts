import test from 'node:test';
import assert from 'node:assert/strict';
import {COLLAGE_TEMPLATES,createCollage,validateCollage,collageRects,collageImageRect,collageHasGap,swapCollage} from '../src/core/collage.ts';
import type {CollageSource} from '../src/core/collage.ts';
const sources=(count:number):CollageSource[]=>Array.from({length:count},(_,i)=>({id:'photo-'+i,name:i+'.png',sha256:String(i%10).repeat(64),width:640,height:480,bits:8,profile:{version:2,extra_orientation:1}}));
test('all 80 collage layouts cover every output pixel once at awkward dimensions',()=>{
 assert.equal(COLLAGE_TEMPLATES.length,80);assert.equal(new Set(COLLAGE_TEMPLATES.map(t=>t.id)).size,80);
 for(const template of COLLAGE_TEMPLATES){for(const [width,height] of [[317,211],[131,353]]){const scene={...createCollage(sources(template.cells.length)),template:template.id,width,height,gap:0,padding:0};validateCollage(scene);const count=new Uint8Array(width*height);
  for(const rect of collageRects(scene)){assert.ok(rect.width>0&&rect.height>0&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width&&rect.y+rect.height<=height,template.id);for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++)count[y*width+x]++;}
  assert.ok(count.every(n=>n===1),template.id);
 }}
});
test('collage source identities and framing travel together when swapped, without changing original scene',()=>{
 const scene=createCollage(sources(3));scene.cells[0].pan={x:.3,y:-.2};scene.cells[0].zoom=1.4;const frozen=JSON.stringify(scene),next=swapCollage(scene,0,2);assert.deepEqual(next.cells[2],scene.cells[0]);assert.deepEqual(next.sources,scene.sources);assert.equal(JSON.stringify(scene),frozen);validateCollage(next);
});
test('collage cover framing, gaps and normalized panning scale consistently',()=>{
 const scene=createCollage(sources(2));scene.template='2-lr';scene.gap=0;scene.padding=0;scene.width=1000;scene.height=600;const rect=collageRects(scene)[0],cell=scene.cells[0];assert.equal(collageHasGap(scene.sources[0],rect,cell),false);const original=collageImageRect(scene.sources[0],rect,cell);assert.equal(original.height,600);cell.zoom=.5;assert.equal(collageHasGap(scene.sources[0],rect,cell),true);cell.pan.x=.4;const image=collageImageRect(scene.sources[0],rect,cell);assert.equal(image.x,rect.x+(rect.width-image.width)/2+200);
});
test('collage documents reject future versions, unsafe sources, missing cells and impossible output budgets',()=>{
 const scene=createCollage(sources(2));for(const patch of [{version:99},{template:'missing'},{width:12000,height:12000},{background:'url(secret)'},{cells:scene.cells.slice(1)},{extra:'secret'}])assert.throws(()=>validateCollage({...scene,...patch}));
 for(const patch of [{name:'../source.png'},{sha256:'bad'},{profile:{version:9,extra_orientation:1}},{profile:undefined},{width:Infinity}]){const next=structuredClone(scene);Object.assign(next.sources[0],patch);assert.throws(()=>validateCollage(next));}
 const duplicate=structuredClone(scene);duplicate.cells[1].source_id=duplicate.cells[0].source_id;assert.throws(()=>validateCollage(duplicate));const gap={...createCollage(sources(12)),template:'12-3x4',gap:.08,padding:.2};validateCollage(gap);
 const narrow={...createCollage(sources(9)),template:'9-cols',gap:.08,padding:.2};assert.throws(()=>validateCollage(narrow),/Spacing/);assert.throws(()=>createCollage(sources(13)));
});
