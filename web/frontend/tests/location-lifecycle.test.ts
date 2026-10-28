import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changeLocation,effectiveLocation,locationChange} from '../src/core/photo-location.ts';
import {LocationIndex} from '../src/core/location-index.ts';
import {mapSummary,WORLD} from '../src/core/photo-map.ts';
import {discover} from '../src/core/discover.ts';
import {rawCandidate,rawConfirmation} from '../src/core/raw-source.ts';
import type {RawSource} from '../src/core/raw-source.ts';
import {AssetGraph} from '../src/core/derived-graph.ts';
import {publicJpeg} from '../src/core/public-jpeg.ts';
import {enterLibraryMutation,maintainLibrary,mutationMethod} from '../src/browser/maintenance.ts';

const hash='a'.repeat(64),stamp='2026-10-26T01:00:00.000Z';
const photo={id:'p1',file_hash:hash,gps_latitude:35,gps_longitude:140};
const manual={latitude:null,longitude:null,country:'中国',city:'杭州',label:'西湖',accuracy_m:null};
test('manual names suppress old GPS; clear and undo preserve EXIF and reject stale writes',()=>{
  const before=structuredClone(photo),first=changeLocation(photo,undefined,{source_hash:hash,expected_revision:0,operation:'set',value:manual},stamp);
  assert.equal(effectiveLocation(photo,first).source,'manual');assert.equal(effectiveLocation(photo,first).latitude,null);
  const cleared=changeLocation(photo,first,{source_hash:hash,expected_revision:1,operation:'clear'},stamp);
  assert.equal(effectiveLocation(photo,cleared).latitude,35);
  const undone=changeLocation(photo,cleared,{source_hash:hash,expected_revision:2,operation:'undo'},stamp);
  assert.deepEqual(undone.manual,manual);assert.deepEqual(photo,before);
  assert.throws(()=>changeLocation(photo,undone,{source_hash:hash,expected_revision:1,operation:'clear'},stamp),/revision/);
  assert.throws(()=>locationChange({source_hash:hash,expected_revision:3,operation:'set',value:{...manual,latitude:NaN,longitude:100}}));
  let value=undone;for(let i=0;i<30;i++)value=changeLocation(photo,value,{source_hash:hash,expected_revision:value.revision,operation:'set',value:manual},stamp);
  assert.equal(value.history.length,20);
});
test('map indexes 100,000 positions with bounded responses and exact dateline filtering',()=>{
  const rows=Array.from({length:100000},(_,i)=>({id:'p'+i,gps_latitude:-89+(i%179),gps_longitude:-179+((i*17)%359)}));
  rows.push({id:'east',gps_latitude:0,gps_longitude:179.9},{id:'west',gps_latitude:0,gps_longitude:-179.9});
  const index=new LocationIndex([...rows,{id:'missing'}]);
  const all=mapSummary(index,index.rows.keys(),WORLD);assert.equal(all.total,100003);assert.equal(all.located,100002);assert.equal(all.unlocated,1);assert.equal(all.in_view,100002);assert.equal(all.clusters.length,300);assert.equal(all.truncated,true);
  const bounds={west:179.5,east:-179.5,south:-1,north:1};
  assert.deepEqual([...index.viewport(bounds)].map(p=>p.photo_id).sort(),['east','west']);
  const narrow=mapSummary(index,index.rows.keys(),bounds);assert.equal(narrow.in_view,2);assert.equal(narrow.clusters.reduce((sum,p)=>sum+p.count,0),2);
  assert.deepEqual([...index.filter({geo_presence:'unlocated'})!],['missing']);
});
test('Discover falls back to dates without GPS and leaves curated choices untouched',()=>{
  const rows=[{id:'old',date_taken:'2025-10-26T12:00:00'},{id:'month',date_taken:'2026-10-01T12:00:00'},{id:'future',date_taken:'2026-10-27T12:00:00'},{id:'unknown',date_taken:'2026-02-30T12:00:00'}],before=structuredClone(rows);
  const result=discover(rows,[],'2026-10-26','capture');assert.equal(result.memories[0].kind,'anniversary');assert.equal(result.memories[0].cover_id,'old');assert.equal(result.memories[1].count,1);assert.equal(result.unknown_date,1);assert.equal(result.located,0);assert.deepEqual(rows,before);
});
test('RAW candidate clues do not create associations and conflicting names stay visible',()=>{
  const source:RawSource={version:1,id:hash,file_hash:hash,file_name:'DSC001.ARW',file_size:10,path:'D:/raw/DSC001.ARW',source_id:null,date_taken:'2026-10-01T10:00:00',camera_model:'camera B',camera_make:null,lens_model:null,registered_at:stamp};
  const candidate=rawCandidate({file_name:'DSC001.jpg',date_taken:'2026-10-02T10:00:00',camera_model:'camera A'},source);
  assert.deepEqual(candidate.evidence,['name']);assert.deepEqual(candidate.conflicts,['time','camera']);assert.ok(candidate.score<0);
  const renamed=rawCandidate({file_name:'exported.jpg',date_taken:source.date_taken,camera_model:source.camera_model},source);assert.deepEqual(renamed.evidence,['time','camera']);
  assert.throws(()=>rawConfirmation({photo_hash:hash,expected_revision:0,raw_id:hash,confirmed:false}));
  assert.equal(rawConfirmation({photo_hash:hash,expected_revision:0,raw_id:null,confirmed:true}).raw_id,null);
});
test('asset graph keeps capture and RAW edges distinct and caps connected results',()=>{
  const graph=new AssetGraph();graph.node('photo','p','Photo',{removed:true});graph.node('capture','g','Capture');graph.node('raw',hash,'RAW');graph.link('photo:p','capture:g','capture-member');graph.link('photo:p','raw:'+hash,'raw-source',1);
  for(let i=0;i<100;i++){graph.node('edit','e'+i,'Edit');graph.link('edit:e'+i,'photo:p','edit-source');}
  const view=graph.view('photo','p');assert.equal(view.nodes.length,80);assert.equal(view.truncated,true);assert.equal(view.nodes[0].removed,true);assert.ok(view.links.some(e=>e.kind==='raw-source'));assert.ok(view.links.some(e=>e.kind==='capture-member'));
});
test('maintenance excludes one concurrent writer and releases admission after failed saves',async()=>{
  const release=enterLibraryMutation();await assert.rejects(maintainLibrary(async()=>0),/other saves/);release();release();
  await assert.rejects(mutationMethod(async()=>{throw new Error('save failed');})(),/save failed/);
  await maintainLibrary(async()=>{assert.throws(enterLibraryMutation,/maintenance/);await assert.rejects(maintainLibrary(async()=>0));});
  assert.equal(await maintainLibrary(async()=>42),42);
});
test('public JPEG scrubber removes EXIF, comments and application payloads without changing scan bytes',()=>{
  const segment=(marker:number,bytes:number[])=>[255,marker,(bytes.length+2)>>8,(bytes.length+2)&255,...bytes];
  // Structural JPEG fixture with stuffed and restart bytes in its scan.
  const frame=segment(192,[8,0,1,0,2,1,1,17,0]),scan=segment(218,[1,1,0,0,63,0]),pixels=[10,255,0,20,255,208,30];
  const clean=new Uint8Array([255,216,...frame,...scan,...pixels,255,217]);
  const privateData=Array.from(new TextEncoder().encode('GPS private/location key=secret'));
  const dirty=new Uint8Array([255,216,...segment(225,privateData),...segment(237,privateData),...frame,...segment(254,privateData),...scan,...pixels,255,217]);
  const result=publicJpeg(dirty);assert.deepEqual(result.bytes,clean);assert.equal(result.width,2);assert.equal(result.height,1);
  for(const invalid of [dirty.slice(0,-1),new Uint8Array([...dirty,1]),new Uint8Array([255,216,255,225,255,255])])assert.throws(()=>publicJpeg(invalid));
});
