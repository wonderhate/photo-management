import test from 'node:test';
import assert from 'node:assert/strict';
import {locationPointFromFields,pickedLocationPoint} from '../src/core/location-point.ts';

test('blank or invalid coordinates never become an implicit point at zero',()=>{
  for(const pair of [['',''],['0',''],['','0'],[' ','1'],['91','0'],['0','181'],['NaN','0'],['1','Infinity']])assert.equal(locationPointFromFields(...pair as [string,string]),null);
  assert.deepEqual(locationPointFromFields('0','0'),{latitude:0,longitude:0});
  assert.deepEqual(locationPointFromFields('-90','180'),{latitude:-90,longitude:180});
  assert.deepEqual(locationPointFromFields(' 25.123456789 ','110.123456789'),{latitude:25.123456789,longitude:110.123456789});
});
test('map clicks normalize wrapped longitude without changing the WGS84 hemisphere',()=>{
  assert.deepEqual(pickedLocationPoint(25.1234567,470.2),{latitude:25.123457,longitude:110.2});
  assert.deepEqual(pickedLocationPoint(-30.1234567,-480.25),{latitude:-30.123457,longitude:-120.25});
  assert.deepEqual(pickedLocationPoint(-0,540),{latitude:0,longitude:-180});
  assert.equal(pickedLocationPoint(91,110),null);assert.equal(pickedLocationPoint(NaN,110),null);assert.equal(pickedLocationPoint(0,Infinity),null);
});
