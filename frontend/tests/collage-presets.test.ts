import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollage,validateCollage,collageRects} from '../src/core/collage.ts';
import type {CollageSource} from '../src/core/collage.ts';
import {COLLAGE_PRESETS,applyCollagePreset,collagePresetCanvas,matchingCollagePreset} from '../src/core/collage-presets.ts';
import {createCollageBook,validateCollageBook,regroupCollage} from '../src/core/collage-book.ts';
const sources=(count:number):CollageSource[]=>Array.from({length:count},(_,i)=>({id:'photo-'+i,name:i+'.png',sha256:String(i%10).repeat(64),width:640,height:480,bits:8,profile:{version:2,extra_orientation:1}}));

test('six curated recipes adapt to all 1–12 counts without losing source identity, order or framing',()=>{
 assert.equal(COLLAGE_PRESETS.length,6);assert.equal(new Set(COLLAGE_PRESETS.map(p=>p.id)).size,6);
 for(let count=1;count<=12;count++){
  const original=createCollage(sources(count));original.cells.reverse();original.cells[0].pan={x:.2,y:-.1};original.cells[0].zoom=1.3;
  const snapshot=JSON.stringify(original),signatures=new Set();
  for(const p of COLLAGE_PRESETS){const next=applyCollagePreset(original,p.id);validateCollage(next);assert.equal(matchingCollagePreset(next),p.id);assert.deepEqual(next.cells,original.cells);assert.deepEqual(next.sources,original.sources);assert.equal(JSON.stringify(original),snapshot);
   assert.equal(collageRects(next).length,count);for(const r of collageRects(next))assert.ok(r.width>0&&r.height>0&&r.x>=0&&r.y>=0&&r.x+r.width<=next.width&&r.y+r.height<=next.height);
   assert.deepEqual(JSON.parse(JSON.stringify(next)),next);signatures.add(JSON.stringify(collagePresetCanvas(p.id,count)));
   next.cells[0].pan.x=1;assert.equal(original.cells[0].pan.x,.2);
  }assert.equal(signatures.size,6);
 }
});
test('preset selection is derived from actual serialized settings and never overwrites custom style on restore',()=>{
 const original=applyCollagePreset(createCollage(sources(3)),'travel');assert.equal(matchingCollagePreset(original),'travel');assert.equal(matchingCollagePreset({...original,gap:.01}),null);assert.equal(matchingCollagePreset({...original,width:1200}),null);
 for(const count of [0,13,NaN,1.5])assert.throws(()=>collagePresetCanvas('gallery',count));
});
test('all-page preset recipes handle remainder pages and regrouping while preserving source hashes',()=>{
 const book=createCollageBook(sources(11).map(source=>({source,capture_time:null})),{size:4,remainder:'own',order:'selection'}),before=JSON.stringify(book);
 for(const p of COLLAGE_PRESETS){const next={...book,pages:book.pages.map(page=>applyCollagePreset(page,p.id))};validateCollageBook(next);assert.deepEqual(next.items,book.items);assert.deepEqual(next.placements,book.placements);assert.deepEqual(next.pages.map(page=>page.cells.length),[4,4,3]);const regrouped=regroupCollage(next,{size:9});regrouped.pages=regrouped.pages.map(page=>applyCollagePreset(page,p.id));validateCollageBook(regrouped);assert.deepEqual(regrouped.pages.map(page=>page.cells.length),[9,2]);assert.equal(JSON.stringify(book),before);}
});
