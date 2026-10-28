import test from 'node:test';
import assert from 'node:assert/strict';
import {visualFingerprint,validateFingerprint,VisualHashIndex,analyzedColor} from '../src/core/visual-hash.ts';

test('appearance samples keep full color range and identify low detail without mixing manual labels',()=>{
  const pixels=new Uint8ClampedArray(4096);for(let i=0;i<1024;i++)pixels.set([255,0,0,255],i*4);
  const value=visualFingerprint(pixels);assert.equal(value.phash,'0000000000000000');assert.ok(value.contrast<1e-9);assert.deepEqual(value.palette,['#f01010']);
  const stored={...value,photo_id:'photo-1',source_hash:'a'.repeat(64),preview_hash:'b'.repeat(64),source_signature:'100:200',preview_signature:'90:210'};
  assert.doesNotThrow(()=>validateFingerprint(stored));
  for(const key of ['photo_id','source_hash','preview_hash','source_signature','preview_signature','phash']){
    const damaged={...stored};delete damaged[key];assert.throws(()=>validateFingerprint(damaged));
  }
  for(const patch of [{version:true},{engine:'other'},{palette:['red']},{contrast:Infinity},{photo_id:['photo-1']}])assert.throws(()=>validateFingerprint({...stored,...patch}));
  assert.equal(analyzedColor('#AB12CD'),'#ab12cd');assert.throws(()=>analyzedColor('red'));
});

test('BK tree matches brute force for all radii including repeated hashes and deterministic ties',()=>{
  let seed=17n;const items=Array.from({length:500},(_,i)=>{seed=BigInt.asUintN(64,seed*6364136223846793005n+1442695040888963407n);return {id:String(i).padStart(4,'0'),phash:seed.toString(16).padStart(16,'0')};});
  items.push({id:'same-a',phash:items[0].phash},{id:'same-b',phash:items[0].phash});
  const tree=new VisualHashIndex(items.reverse());
  for(let radius=0;radius<=16;radius++){
    const query=items.at(-1)!.phash;
    const expected=items.map(item=>({id:item.id,distance:(BigInt('0x'+item.phash)^BigInt('0x'+query)).toString(2).replace(/0/g,'').length})).filter(item=>item.distance<=radius).sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));
    assert.deepEqual(tree.candidates(query,radius),expected);
  }
  assert.throws(()=>tree.candidates(items[0].phash,17));
});
