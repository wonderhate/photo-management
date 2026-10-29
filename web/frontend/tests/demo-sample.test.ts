import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateDemoSample} from '../src/core/demo-sample.ts';

const sha256='a'.repeat(64);
const sample={version:1,src:`/demo/images/${sha256}.jpg`,width:2400,height:1600,sha256};

test('published demo sample retains only an exact content-addressed local JPEG descriptor',()=>{
  const clean=validateDemoSample(sample);
  assert.deepEqual(clean,sample);assert.notEqual(clean,sample);
  assert.deepEqual(validateDemoSample({...sample,width:1,height:8192}),{...sample,width:1,height:8192});
});

test('published demo sample rejects external, traversal, mixed-case and mismatched image paths',()=>{
  for(const src of [
    'https://example.test/sample.jpg','//example.test/sample.jpg','data:image/jpeg;base64,AAAA','blob:https://example.test/value',
    `/demo/images/${sha256}.png`,`/demo/images/${sha256}.jpeg`,`/demo/images/${sha256.toUpperCase()}.jpg`,
    `/demo/images/${'b'.repeat(64)}.jpg`,`/demo/images/../${sha256}.jpg`,`/demo/images/%2e%2e/${sha256}.jpg`,
    `/demo/images/${sha256}.jpg?private=1`,`/demo/images/${sha256}.jpg#private`,`demo/images/${sha256}.jpg`,
  ])assert.throws(()=>validateDemoSample({...sample,src}),/Invalid published demo photo/);
});

test('published demo sample rejects unsupported schemas, metadata fields and invalid dimensions',()=>{
  for(const value of [null,undefined,[],{},'sample',
    {...sample,version:2},{...sample,version:'1'},{...sample,width:0},{...sample,height:-1},
    {...sample,width:8193},{...sample,height:Infinity},{...sample,width:NaN},{...sample,height:1.5},{...sample,width:'2400'},
    {...sample,sha256:'A'.repeat(64)},{...sample,sha256:'a'.repeat(63)},{...sample,sha256:''},
    {...sample,private_path:'C:/synthetic-private-photo.jpg'},{...sample,gps_latitude:35},{...sample,caption:'extra field'},
  ])assert.throws(()=>validateDemoSample(value),/Invalid published demo photo/);
  for(const field of Object.keys(sample)){
    const incomplete:Record<string,unknown>={...sample};delete incomplete[field];
    assert.throws(()=>validateDemoSample(incomplete),/Invalid published demo photo/);
  }
});
