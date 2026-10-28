import test from 'node:test';
import assert from 'node:assert/strict';
import {appendImportedPhotos,captures} from '../src/browser/capture-groups.ts';
import {albumOverview,captureMemberAdded} from '../src/browser/album-overview.ts';
import {albumMemberIds} from '../src/browser/album-members.ts';
import {removePhotoRecords,restorePhotoRecords} from '../src/browser/remove-photo.ts';
import type {Library,LocalPhoto,LocalAlbum} from '../src/browser/storage.ts';

const photo=(id:string,raw=false,patch:Partial<LocalPhoto>={}):LocalPhoto=>({id,capture_group_id:id,is_raw:raw,file_name:'scene.'+(raw?'DNG':'JPG'),file_format:raw?'DNG':'JPG',file_path:'originals/'+id,source_id:'directory',relative_path:'scene.'+(raw?'DNG':'JPG'),file_hash:id.padEnd(64,'0'),created_at:'2026-01-01T00:00:00',date_taken:'2025-12-31T23:59:59',favorite:false,rating:null,rating_source:'none',color_label:null,flag:'unmarked',tags:[],files:[],...patch} as LocalPhoto);
test('unique same-directory RAW/JPEG captures preserve manual decisions and RAW metadata',()=>{
  const raw=photo('raw',true,{favorite:true,rating:0,rating_source:'manual',color_label:'red',flag:'picked',tags:['manual'],camera_model:'camera',iso:800});
  const jpeg=photo('jpeg',false,{rating:5,rating_source:'xmp-embedded'}),rows=[raw];
  appendImportedPhotos(rows,[jpeg]);const index=captures(rows);
  assert.equal(index.representatives()[0].id,'jpeg');assert.equal(index.files(raw).length,2);
  assert.equal(jpeg.favorite,true);assert.equal(jpeg.rating,0);assert.equal(jpeg.rating_source,'manual');
  assert.equal(jpeg.color_label,'red');assert.equal(jpeg.flag,'picked');assert.deepEqual(jpeg.tags,['manual']);assert.equal(jpeg.iso,800);
  assert.equal(index.matchesType(jpeg,'paired'),true);assert.equal(index.matchesType(jpeg,'raw_only'),false);
  assert.deepEqual([...index.idsForGroups(['raw'])],['raw','jpeg']);
  const album={id:'album',type:'normal',photo_ids:['raw'],member_added_at:{raw:'2026-01-02T00:00:00'},cover_id:'raw',cover_mode:'manual'} as LocalAlbum;
  const before=JSON.stringify(album),overview=albumOverview(album,rows);
  assert.equal(overview.count,1);assert.deepEqual(overview.recent_photo_ids,['jpeg']);assert.equal(overview.cover_id,'raw');
  assert.equal(captureMemberAdded(album,jpeg,rows),'2026-01-02T00:00:00');
  assert.deepEqual(albumMemberIds(album,rows),['raw']);assert.equal(JSON.stringify(album),before);
});
test('ambiguous, different-directory, non-JPEG and incompatible camera dates never auto-pair',()=>{
  const ambiguous:LocalPhoto[]=[];appendImportedPhotos(ambiguous,[photo('raw',true),photo('jpg1'),photo('jpg2')]);
  assert.equal(captures(ambiguous).representatives().length,3);
  for(const patch of [{relative_path:'elsewhere/scene.JPG'},{source_id:'other'}, {file_format:'PNG',relative_path:'scene.PNG'},{camera_model:'different'}, {date_taken:'2026-01-02T00:00:00'}, {date_taken:'2025-12-31T23:59:59Z'}]){
    const rows=[photo('raw',true,{camera_model:'camera'})];appendImportedPhotos(rows,[photo('jpeg',false,patch)]);assert.equal(captures(rows).representatives().length,2);
  }
  const old=[photo('oldraw',true),photo('oldjpg')];assert.equal(captures(old).representatives().length,2);
});
test('capture and file removal change references only and retain saved work sources',()=>{
  const raw=photo('raw',true),jpeg=photo('jpeg',false,{capture_group_id:'raw'}),other=photo('other',false,{relative_path:'other.JPG'});
  const original={photos:[raw,jpeg,other],albums:[{id:'a',type:'normal',photo_ids:['raw','jpeg','other'],member_added_at:{raw:null,jpeg:'2026-01-01'},cover_id:'jpeg',cover_mode:'manual'}],drafts:[{id:'d',photo_id:'jpeg',source:{file_name:'scene.JPG'}}],works:[{id:'w',photo_id:'raw',source:{file_name:'scene.DNG'}}],edits:[],splits:[],showcase:{photo_ids:['jpeg','other']}} as unknown as Library;
  const files=structuredClone(original);assert.equal(removePhotoRecords(files,'jpeg','file'),1);assert.deepEqual(captures(files.photos).representatives().map(p=>p.id),['raw','other']);assert.equal(files.works[0].photo_id,'raw');
  const all=structuredClone(original);assert.equal(removePhotoRecords(all,'jpeg','capture'),2);assert.deepEqual(all.photos.map(p=>p.id),['other']);assert.equal(all.drafts[0].photo_id,'jpeg');assert.equal(all.works[0].photo_id,'raw');assert.equal(all.drafts[0].source.file_name,'scene.JPG');assert.equal(all.albums[0].cover_id,'jpeg');assert.deepEqual(all.showcase!.photo_ids,['jpeg','other']);
  assert.equal(all.removed_photos!.length,2);assert.equal(restorePhotoRecords(all,['raw','jpeg']).restored,2);assert.deepEqual(all.albums,original.albums);assert.deepEqual(all.drafts,original.drafts);assert.deepEqual(all.works,original.works);assert.equal(captures(all.photos).representatives().length,2);
  assert.equal(original.photos.length,3);
});
