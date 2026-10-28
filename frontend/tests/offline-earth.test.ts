import test from 'node:test';
import assert from 'node:assert/strict';
import {fitEarthPlaces} from '../src/core/offline-earth.ts';
import {WORLD,longitudeSpan} from '../src/core/photo-map.ts';

test('country focus follows the short arc around the date line and keeps latitude extent',()=>{
  const point=(longitude:number,latitude:number)=>({longitude,latitude,count:1,photo_id:String(longitude)});
  const crossing=fitEarthPlaces([point(175,-15),point(-175,-10)]);assert.ok(crossing.west>crossing.east);assert.ok(longitudeSpan(crossing)<30);assert.ok(crossing.south<-15&&crossing.north>-10);
  assert.deepEqual(fitEarthPlaces([]),WORLD);
  const vertical=fitEarthPlaces([point(120,-45),point(120,45)]);assert.ok(vertical.south<=-45&&vertical.north>=45);
});
