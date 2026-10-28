import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cameraDisplayName,validCameraAliases,parseCameraNameFile} from '../src/core/camera-names.ts';

test('camera names use exact make/model matches, retain unknown codes and prefer aliases',()=>{
  assert.equal(cameraDisplayName(' DJI ','FC3411'),'DJI Air 2S');
  assert.equal(cameraDisplayName('Other','FC3411'),'FC3411');
  assert.equal(cameraDisplayName('DJI','FC34110'),'FC34110');
  assert.equal(cameraDisplayName('DJI','FC3411',[{make:'dji',model:'fc3411',name:'旅行相机'}]),'旅行相机');
  assert.equal(cameraDisplayName('DJI','FC3411',[]),'DJI Air 2S');
  assert.equal(cameraDisplayName('constructor','name'),'name');
  assert.equal(cameraDisplayName(null,null),'');
});
test('alias import rejects duplicate normalized camera identities and malformed mappings',()=>{
  const row={make:'DJI',model:'FC3411',name:'My camera'};
  assert.deepEqual(parseCameraNameFile(JSON.stringify({version:1,aliases:[row]})),[row]);
  for(const value of [null,{},[row,{...row,make:' dji '}],[{...row,model:''}],[{...row,name:'\n'}],[{...row,path:'private'}],Array(501).fill(row)])assert.equal(validCameraAliases(value),false);
  assert.throws(()=>parseCameraNameFile(JSON.stringify({version:2,aliases:[row]})));
  assert.throws(()=>parseCameraNameFile(JSON.stringify({version:1,aliases:[row],credentials:'private'})));
});
