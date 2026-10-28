import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateVideos,videoDuration,isVideoFile} from '../src/core/video.ts';

const record={id:'video-one',kind:'video',file_name:'clip.mp4',file_hash:'a'.repeat(64),file_size:100,file_path:'media/video-one/source.mp4',source_path:'media/video-one/source.mp4',cover_path:'media/video-one/cover.jpg',created_at:'2026-10-26T00:00:00Z',metadata:{width:320,height:240,duration:1.5,fps:24,codec:'h264'}};
test('video manifest validates independent managed storage and bounded media metadata',()=>{
  assert.doesNotThrow(()=>validateVideos([record]));
  for(const patch of [{source_path:'../photo.jpg'},{cover_path:'photos/private.jpg'},{file_path:'C:/private.mp4'},{file_size:257*1024**2},{kind:'photo'},{metadata:{...record.metadata,duration:Infinity}},{metadata:{...record.metadata,width:0}}])assert.throws(()=>validateVideos([{...record,...patch}]));
  assert.throws(()=>validateVideos([record,record]));
});
test('video file and duration labels preserve photo boundaries',()=>{
  assert.equal(isVideoFile('clip.MOV'),true);assert.equal(isVideoFile('photo.jpg'),false);assert.equal(isVideoFile('clip.mp4.exe'),false);
  assert.equal(videoDuration(65),'01:05');assert.equal(videoDuration(3661),'1:01:01');
});
