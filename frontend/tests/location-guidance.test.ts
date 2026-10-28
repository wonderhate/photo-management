import {test} from 'node:test';
import assert from 'node:assert/strict';
import {locationGuidance,locationFieldIssue} from '../src/core/location-guidance.ts';
import {manualLocation} from '../src/core/photo-location.ts';

test('map guidance separates an empty library, filtered scope, missing GPS and an empty viewport',()=>{
  assert.equal(locationGuidance(null,false),null);
  assert.equal(locationGuidance({total:0,located:0,in_view:0},false),'import');
  assert.equal(locationGuidance({total:0,located:0,in_view:0},true),'filtered');
  assert.equal(locationGuidance({total:4,located:0,in_view:0},false),'coordinates');
  assert.equal(locationGuidance({total:4,located:0,in_view:0},true),'coordinates');
  assert.equal(locationGuidance({total:4,located:2,in_view:0},false),'viewport');
  assert.equal(locationGuidance({total:4,located:2,in_view:1},true),null);
});

test('place names do not invent coordinates and zero/negative/edge coordinates remain valid',()=>{
  const fields={latitude:'',longitude:'',country:'',city:'Hangzhou',label:'',accuracy_m:''};
  assert.equal(locationFieldIssue(fields),null);
  assert.equal(manualLocation({...fields,latitude:null,longitude:null,accuracy_m:null}).latitude,null);
  for(const [latitude,longitude] of [['0','0'],['-90','-180'],['90','180'],['-34.6','-58.4']]){
    const value={...fields,latitude,longitude,accuracy_m:'0'};
    assert.equal(locationFieldIssue(value),null);
    assert.doesNotThrow(()=>manualLocation({...value,latitude:Number(latitude),longitude:Number(longitude),accuracy_m:0}));
  }
});

test('coordinate validation rejects partial pairs, invalid ranges and accuracy without coordinates',()=>{
  const fields={latitude:'',longitude:'',country:'',city:'',label:'',accuracy_m:''};
  assert.equal(locationFieldIssue(fields),'empty');
  assert.equal(locationFieldIssue({...fields,latitude:'0'}),'pair');
  assert.equal(locationFieldIssue({...fields,longitude:'0'}),'pair');
  for(const latitude of ['90.001','-90.001','Infinity','NaN'])assert.equal(locationFieldIssue({...fields,latitude,longitude:'0'}),'latitude');
  for(const longitude of ['180.001','-180.001','Infinity'])assert.equal(locationFieldIssue({...fields,latitude:'0',longitude}),'longitude');
  assert.equal(locationFieldIssue({...fields,city:'Paris',accuracy_m:'10'}),'accuracyCoordinates');
  for(const accuracy_m of ['-1','20040001','NaN'])assert.equal(locationFieldIssue({...fields,latitude:'0',longitude:'0',accuracy_m}),'accuracy');
});
