import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageHeader} from '../src/browser/image-header.ts';

test('JPEG dimensions come from the frame after metadata segments, including progressive frames',()=>{
  for(const marker of [0xc0,0xc2]){
    const bytes=Uint8Array.from([255,216,255,225,0,6,0,0,0,0,255,marker,0,8,8,3,32,4,176,1]);
    assert.deepEqual(imageHeader(bytes),{width:1200,height:800});
    assert.throws(()=>imageHeader(bytes.subarray(0,bytes.length-2)),/decoded/);
  }
});
test('PNG rejects pixel bombs before decoding and WebP reads the canvas rather than EXIF thumbnails',()=>{
  const png=new Uint8Array(33),view=new DataView(png.buffer);png.set([137,80,78,71,13,10,26,10]);view.setUint32(8,13);png.set([73,72,68,82],12);view.setUint32(16,1200);view.setUint32(20,800);
  assert.deepEqual(imageHeader(png),{width:1200,height:800});view.setUint32(16,500000);assert.throws(()=>imageHeader(png),/100 megapixel/);
  const webp=new Uint8Array(30),wv=new DataView(webp.buffer);webp.set(new TextEncoder().encode('RIFF'));wv.setUint32(4,22,true);webp.set(new TextEncoder().encode('WEBPVP8X'),8);wv.setUint32(16,10,true);webp.set([175,4,0,31,3,0],24);
  assert.deepEqual(imageHeader(webp),{width:1200,height:800});wv.setUint32(16,100,true);assert.throws(()=>imageHeader(webp),/decoded/);
});
test('AVIF delegates item transforms to the decoder while damaged containers cannot be admitted',()=>{
  const avif=new Uint8Array(24);new DataView(avif.buffer).setUint32(0,24);avif.set(new TextEncoder().encode('ftypavif'),4);
  assert.equal(imageHeader(avif),null);assert.throws(()=>imageHeader(new TextEncoder().encode('damaged')),/supports JPEG/);
});
