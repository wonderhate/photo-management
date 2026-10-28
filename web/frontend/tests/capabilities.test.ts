import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rendererCapabilities,browserInferenceCapabilities,capability,validateCapabilities} from '../src/core/capabilities.ts';
test('RAW distinguishes renderer, WASM and isolation support without loading a decoder',()=>{
  const facts={worker:true,canvas:true,bitmap:true,wasm:true,isolated:true};
  assert.equal(rendererCapabilities(facts).darkroom.state,'available');
  assert.deepEqual([rendererCapabilities(facts).raw.state,rendererCapabilities(facts).raw.runnable],['degraded',true]);
  assert.equal(rendererCapabilities({...facts,isolated:false}).raw.reason,'raw_isolation_missing');
  assert.equal(rendererCapabilities({...facts,isolated:false}).raw.runnable,false);
  assert.equal(rendererCapabilities({...facts,wasm:false}).raw.reason,'wasm_missing');
  assert.equal(rendererCapabilities({...facts,worker:false}).darkroom.state,'unavailable');
});
test('cloud credentials, relay configuration and verified connectivity are separate facts',()=>{
  assert.equal(browserInferenceCapabilities({key_configured:true,relay_configured:false}).watercolor.reason,'relay_missing');
  assert.equal(browserInferenceCapabilities({key_configured:false,relay_configured:true}).watercolor.reason,'credential_missing');
  const ready=browserInferenceCapabilities({key_configured:true,relay_configured:true});
  assert.equal(ready.watercolor.runnable,true);assert.equal(ready.watercolor.state,'degraded');
  assert.equal(ready.watercolor.facts.connection,'not_checked');assert.equal(ready.semantic.runnable,false);assert.equal(ready.batchWatercolor.runnable,false);
});
test('invalid or mismatched capability snapshots cannot crash the main settings renderer',()=>{
  const base={version:1,runtime:'native',items:{library:capability('available','ready',true)}};
  for(const invalid of [null,{},base,{...base,version:2}])assert.throws(()=>validateCapabilities(invalid));
});
