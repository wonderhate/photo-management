import test from 'node:test';
import assert from 'node:assert/strict';
import {validMapBounds,validMapKey,validMapPositions,clusterCellBounds} from '../src/core/satellite-map.ts';
import {WORLD,mapSummary} from '../src/core/photo-map.ts';

test('satellite bridge rejects malformed coordinates, keys and oversized messages',()=>{
  assert.equal(validMapKey('synthetic_map_key_for_test_only_123'),true);
  for(const key of ['short','https://attacker.test/a','abc\n'.repeat(20),'<script>'.repeat(10)])assert.equal(validMapKey(key),false);
  assert.equal(validMapBounds(WORLD),true);
  assert.equal(validMapBounds({...WORLD,south:100}),false);
  assert.equal(validMapBounds({...WORLD,west:NaN}),false);
  assert.equal(validMapPositions([{id:'local-photo',x:12,y:34}]),true);
  assert.equal(validMapPositions([{id:'local-photo',x:Infinity,y:34}]),false);
  assert.equal(validMapPositions(Array.from({length:301},()=>({id:'p',x:0,y:0}))),false);
});
test('hover previews use the same aggregation cell across the date line and poles',()=>{
  for(const bounds of [WORLD,{west:170,east:-170,south:-20,north:20},{west:-180,east:180,south:80,north:90}]){
    const width=bounds.east<bounds.west?bounds.east+360-bounds.west:bounds.east-bounds.west;
    for(const cell of [0,31,63]){
      let longitude=bounds.west+width*(cell+.45)/64;if(longitude>180)longitude-=360;
      const latitude=bounds.south+(bounds.north-bounds.south)*.68;
      const result=clusterCellBounds({longitude,latitude,count:2,photo_id:'p'},bounds);
      assert.equal(validMapBounds(result),true);
      assert.ok(latitude>=result.south&&latitude<=result.north);
      assert.ok(result.west<result.east?longitude>=result.west&&longitude<=result.east:longitude>=result.west||longitude<=result.east);
    }
  }
});
