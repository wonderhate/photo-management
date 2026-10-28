import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollage,validateCollage,upgradeCollage,collageCanvasStyle,resetCollageCanvas,COLLAGE_TEMPLATES} from '../src/core/collage.ts';
import {collageFrameRect,collageRampStops,collageSceneHasGap} from '../src/core/collage-blend.ts';
import {createCollageBook,regroupCollage,upgradeCollageBook,validateCollageBook} from '../src/core/collage-book.ts';
const sources=(n:number)=>Array.from({length:n},(_,i)=>({id:'photo-'+i,name:i+'.png',sha256:String(i%10).repeat(64),width:640,height:480,bits:8 as const,profile:{version:2 as const,extra_orientation:1 as const}}));
test('v1 layouts and books upgrade without mutating old data; new blend fields are strictly versioned',()=>{
 const current=createCollage(sources(2)),{edge_blend,...fields}=current,old={...fields,version:1 as const},snapshot=JSON.stringify(old);validateCollage(old);const upgraded=upgradeCollage(old);assert.equal(upgraded.edge_blend,0);assert.equal(upgraded.version,2);assert.equal(JSON.stringify(old),snapshot);
 for(const value of [{...old,edge_blend:0},{...current,edge_blend:undefined},{...current,edge_blend:-1},{...current,edge_blend:10001},{...current,edge_blend:NaN}])assert.throws(()=>validateCollage(value));
 const book=createCollageBook(sources(5).map(source=>({source,capture_time:null})));const legacy={...book,version:1 as const,pages:book.pages.map(({edge_blend,...p})=>({...p,version:1 as const}))};validateCollageBook(legacy);const converted=upgradeCollageBook(legacy);assert.ok(converted.pages.every(p=>p.version===2&&p.edge_blend===0));assert.equal(legacy.pages[0].version,1);assert.throws(()=>validateCollageBook({...book,version:1}));
});
test('blend uses shared unrounded seam centres, preserves outer edges and controls overlap at every template',()=>{
 for(const template of COLLAGE_TEMPLATES){const scene={...createCollage(sources(template.cells.length)),template:template.id,width:317,height:211,padding:.031,gap:.017,edge_blend:25.5};validateCollage(scene);const pad=211*.031;for(const [i,c] of template.cells.entries()){const r=collageFrameRect(scene,i);assert.ok(r.width>0&&r.height>0);if(c.x===0)assert.equal(r.x,pad);if(c.y===0)assert.equal(r.y,pad);if(c.x+c.w>=1-1e-8)assert.ok(Math.abs(r.x+r.width-(317-pad))<1e-8);}}
 const scene={...createCollage(sources(2)),template:'2-lr',width:317,height:211,padding:.031,gap:.017,edge_blend:25.5};const a=collageFrameRect(scene,0),b=collageFrameRect(scene,1);assert.ok(Math.abs(a.x+a.width-b.x-25.5)<1e-8);assert.equal(a.ramps.left,0);assert.equal(b.ramps.right,0);assert.equal(collageSceneHasGap(scene,0),false);scene.cells[0].zoom=.25;assert.equal(collageSceneHasGap(scene,0),true);
 const stops=collageRampStops(100,100,50);assert.deepEqual(stops,[[0,0],[.5,1],[.5,1],[1,0]]);
});
test('batch regroup and canvas reset preserve framing while carrying or resetting blend settings',()=>{
 let book=createCollageBook(sources(13).map(source=>({source,capture_time:null})));for(const page of book.pages)page.edge_blend=56;book=regroupCollage(book,{size:6});assert.ok(book.pages.every(p=>p.edge_blend===56));
 const page=book.pages[0];page.cells[0].zoom=1.7;page.cells[0].pan.x=.3;page.radius=.12;const reset=resetCollageCanvas(page);assert.deepEqual(reset.cells,page.cells);assert.deepEqual(reset.sources,page.sources);assert.equal(reset.template,page.template);assert.equal(reset.edge_blend,0);assert.equal(reset.radius,0);assert.equal(collageCanvasStyle(page).edge_blend,56);
});
