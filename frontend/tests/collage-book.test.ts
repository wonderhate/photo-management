import test from 'node:test';
import assert from 'node:assert/strict';
import {collageGroups,COLLAGE_GROUP_SIZES,createCollageBook,regroupCollage,swapCollagePages,applyCollagePage,validateCollageBook} from '../src/core/collage-book.ts';
import type {CollageItem} from '../src/core/collage-book.ts';
import {exportCollagePages} from '../src/core/collage-batch-export.ts';
import {zipStore,crc32Update} from '../src/core/zip-store.ts';
const items=(n:number):CollageItem[]=>Array.from({length:n},(_,i)=>({source:{id:'photo-'+i,name:String(n-i).padStart(3,'0')+'.png',sha256:String(i%10).repeat(64),width:640,height:480,bits:8,profile:{version:2,extra_orientation:1}},capture_time:i%3===0?null:`2026-10-${String(10+i%10).padStart(2,'0')}T12:00:00`}));
test('every batch grouping preserves all photos or explicitly lists omissions, including merge overflow',()=>{
 for(let n=1;n<=31;n++)for(const size of COLLAGE_GROUP_SIZES)for(const remainder of ['own','merge','drop'] as const){const list=items(n),book=createCollageBook(list,{size,order:'selection',remainder});validateCollageBook(book);assert.deepEqual([...book.pages.flatMap(p=>p.cells.map(c=>c.source_id)),...book.omitted],list.map(i=>i.source.id));assert.ok(book.pages.every(p=>p.cells.length<=12));assert.equal(book.omitted.length,remainder==='drop'?n%size:0);}
 assert.deepEqual(collageGroups(Array.from({length:14},(_,i)=>i),9,'merge').groups.map(g=>g.length),[9,5]);assert.deepEqual(collageGroups(Array.from({length:12},(_,i)=>i),9,'merge').groups.map(g=>g.length),[12]);
});
test('sorting is stable, missing dates last, omitted framing survives regroup and cross-page swaps carry identity',()=>{
 let book=createCollageBook(items(13));const before=JSON.stringify(book);let page=structuredClone(book.pages[0]);page.cells[0].zoom=2;page.cells[0].pan.x=.3;book=applyCollagePage(book,0,page);const framed=structuredClone(page.cells[0]);book=swapCollagePages(book,{page:0,cell:0},{page:3,cell:0});assert.deepEqual(book.pages[3].cells[0],framed);assert.equal(book.order,'selection');assert.equal(book.pages[3].sources[0].id,framed.source_id);validateCollageBook(book);
 book=regroupCollage(book,{remainder:'drop'});assert.ok(book.omitted.includes(framed.source_id));book=regroupCollage(book,{remainder:'own'});assert.deepEqual(book.pages[3].cells[0],framed);
 book=regroupCollage(book,{order:'filename'});assert.equal(book.pages[0].sources[0].name,'001.png');book=regroupCollage(book,{order:'capture_time'});const order=book.pages.flatMap(p=>p.cells.map(c=>book.items.find(i=>i.source.id===c.source_id)!));const firstNull=order.findIndex(i=>!i.capture_time);assert.ok(order.slice(firstNull).every(i=>!i.capture_time));assert.notEqual(JSON.stringify(book),before);
 const equal=items(4).map(i=>({...i,capture_time:'2026-10-10T12:00:00'}));assert.deepEqual(createCollageBook(equal,{size:4,order:'capture_time',remainder:'own'}).sequence,equal.map(i=>i.source.id));
});
test('batch documents reject tampering, duplicates, future versions and changed source identity',()=>{
 const book=createCollageBook(items(5));for(const patch of [{version:9},{items:[]},{items:items(241)},{sequence:['bad']},{omitted:['bad']},{placements:[]},{secret:'x'}])assert.throws(()=>validateCollageBook({...book,...patch}));
 const mismatch=structuredClone(book);mismatch.placements[0].zoom=2;assert.throws(()=>validateCollageBook(mismatch));const changed=structuredClone(book);changed.pages[0].sources[0].sha256='f'.repeat(64);assert.throws(()=>validateCollageBook(changed));assert.throws(()=>applyCollagePage(book,0,changed.pages[0]));assert.throws(()=>createCollageBook([items(1)[0],items(1)[0]]));assert.throws(()=>createCollageBook([{...items(1)[0],capture_time:'2026-13-01T12:00:00'}]));
});
test('batch exports retain success across failure, cancellation and explicit retries, with bounded archive bytes',async()=>{
 const pages=createCollageBook(items(10)).pages,controller=new AbortController(),calls:number[]=[];
 let result=await exportCollagePages(pages,[],async(_,i)=>{calls.push(i);if(i===1)throw new Error('broken');return new Blob(['image']);},controller.signal,()=>{});assert.deepEqual(result.map(r=>r.status),['completed','failed','completed']);
 result=await exportCollagePages(pages,result,async(_,i)=>{calls.push(i);return new Blob(['retry']);},controller.signal,()=>{});assert.deepEqual(calls,[0,1,2,1]);assert.ok(result.every(r=>r.status==='completed'));
 const cancel=new AbortController();result=await exportCollagePages(pages,[],async(_,i)=>{if(i===1)cancel.abort();return new Blob(['image']);},cancel.signal,()=>{});assert.deepEqual(result.map(r=>r.status),['completed','cancelled','pending']);
 result=await exportCollagePages(pages,[],async()=>new Blob(['12345']),controller.signal,()=>{},6);assert.deepEqual(result.map(r=>r.status),['completed','failed','failed']);assert.equal(result[0].blob?.size,5);
});
test('ZIP store uses standard CRC and rejects unsafe names, duplicates and archive overflow',async()=>{
 assert.equal((crc32Update(0xffffffff,new TextEncoder().encode('123456789'))^0xffffffff)>>>0,0xcbf43926);
 const blob=await zipStore([{name:'Collage-001.png',blob:new Blob(['PNG'])},{name:'report.json',blob:new Blob(['{"ok":true}'])}]);const bytes=new Uint8Array(await blob.arrayBuffer()),data=new DataView(bytes.buffer);assert.equal(data.getUint32(0,true),0x04034b50);assert.equal(data.getUint16(bytes.length-14,true),2);assert.equal(data.getUint32(bytes.length-22,true),0x06054b50);
 for(const name of ['../secret','folder/a.png','/secret','a\\b','a\n'])await assert.rejects(zipStore([{name,blob:new Blob()}]));await assert.rejects(zipStore([{name:'a',blob:new Blob()},{name:'A',blob:new Blob()}]));await assert.rejects(zipStore([{name:'a',blob:new Blob(['12345'])}],60));await assert.rejects(zipStore([],0x100000000));
});
