import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,cp,unlink,truncate,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const script=fileURLToPath(new URL('../scripts/package-showcase.py',import.meta.url));
const validateCode="import importlib.util,sys; spec=importlib.util.spec_from_file_location('public_package',sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); files,catalog=module.validate_public(sys.argv[2]); print(len(files),len(catalog['photos']))";
function validate(root){return spawnSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',validateCode,script,root],{encoding:'utf8'});}
async function fixture(){
  const base=fileURLToPath(new URL('../../.test-artifacts/',import.meta.url));await mkdir(base,{recursive:true});
  const root=await mkdtemp(join(base,'package-public-'));
  await mkdir(join(root,'assets'));await mkdir(join(root,'portfolio/images'),{recursive:true});
  await writeFile(join(root,'index.html'),'<div id="root"></div>');await writeFile(join(root,'windows.html'),'<div>Download</div>');
  await writeFile(join(root,'assets/main.js'),'const relay="wss://ai.photomanagement.online/cloud-art";');
  await writeFile(join(root,'portfolio/images/frame.jpg'),'synthetic public display copy');
  await writeFile(join(root,'portfolio/manifest.json'),JSON.stringify({photos:[{src:'/portfolio/images/frame.jpg',thumbnail:'/portfolio/images/frame.jpg'}]}));
  return root;
}

async function mapFixture(root){
  await cp(fileURLToPath(new URL('../public/maps',import.meta.url)),join(root,'maps'),{recursive:true});
  await mkdir(join(root,'licenses'),{recursive:true});
  for(const name of ['nasa-blue-marble.json','leaflet-BSD-2-Clause.txt','leaflet-source.json'])await copyFile(fileURLToPath(new URL('../public/licenses/'+name,import.meta.url)),join(root,'licenses',name));
  await cp(fileURLToPath(new URL('../public/demo',import.meta.url)),join(root,'demo'),{recursive:true});
}

test('public package validation accepts the complete registered map and its source record without making a release',async()=>{
  const root=await fixture();
  try{
    await mapFixture(root);
    for(const name of ['site-glass.css','site-glass.js','local-file-worker.js','assets/runtime.mjs','assets/runtime.wasm'])await writeFile(join(root,name),'synthetic public asset');
    const result=validate(root);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/706 1/);
    await writeFile(join(root,'maps/private.json'),'synthetic private data');
    const rejected=validate(root);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/Unexpected public artifact: maps\/private\.json/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('public package keeps only registered demo outputs and rejects missing or changed provenance',async()=>{
  const root=await fixture();
  try{
    await mapFixture(root);
    for(const relative of ['demo/lumina-original.png','demo/lumina-adjusted.png','demo/lumina-framed.png','demo/source.json']){
      const file=join(root,relative),original=await readFile(file);
      await writeFile(file,'synthetic replacement');
      const changed=validate(root);assert.notEqual(changed.status,0,relative);assert.match(changed.stderr,/Demo asset does not match its bundled source/);
      await unlink(file);
      const missing=validate(root);assert.notEqual(missing.status,0,relative);assert.match(missing.stderr,/Incomplete bundled demo assets/);
      await writeFile(file,original);
    }
    for(const relative of ['demo/private.png','demo/extra.json']){
      const file=join(root,relative);await writeFile(file,'synthetic unregistered file');
      const result=validate(root);assert.notEqual(result.status,0);assert.match(result.stderr,/Unexpected public artifact/);await unlink(file);
    }
    assert.equal(validate(root).status,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('public package validation rejects altered, missing and unregistered map resources',async()=>{
  const root=await fixture();
  try{
    await mapFixture(root);
    for(const relative of ['maps/earth/4/31-15.jpg','maps/earth/metadata.json','maps/satellite.js','licenses/nasa-blue-marble.json','licenses/leaflet-BSD-2-Clause.txt','licenses/leaflet-source.json']){
      const file=join(root,relative),original=await readFile(file);
      await writeFile(file,'synthetic replacement');
      const changed=validate(root);assert.notEqual(changed.status,0,relative);assert.match(changed.stderr,/Map asset does not match its bundled source/);
      await unlink(file);
      const missing=validate(root);assert.notEqual(missing.status,0,relative);assert.match(missing.stderr,/Incomplete offline map assets/);
      await writeFile(file,original);
    }
    for(const relative of ['maps/earth/4/99-99.jpg','maps/earth/private.json','maps/new-bridge.js']){
      const file=join(root,relative);await writeFile(file,'synthetic unregistered map');
      const result=validate(root);assert.notEqual(result.status,0,relative);assert.match(result.stderr,/Unexpected public artifact/);await unlink(file);
    }
    assert.equal(validate(root).status,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('public package validation rejects private records, credentials and author bundles inside allowed directories',async()=>{
  const root=await fixture();
  try{
    for(const name of ['library.db','library.sqlite3','debug.log','.env.production','token.dpapi','session.key','PublishPortfolio-private.js','local-publisher.js','code.js.map','weights.onnx','model.safetensors','pytorch_model.bin']){
      const file=join(root,'assets',name);await writeFile(file,'synthetic forbidden data');
      const result=validate(root);assert.notEqual(result.status,0,name);assert.match(result.stderr,/Private author code cannot be published/);await unlink(file);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});

test('public package validation rejects oversized assets and unselected display copies',async()=>{
  const root=await fixture();
  try{
    const large=join(root,'assets/oversized.wasm');await writeFile(large,'');await truncate(large,25*1024*1024+1);
    const oversized=validate(root);assert.notEqual(oversized.status,0);assert.match(oversized.stderr,/Public file exceeds 25 MiB/);await unlink(large);
    await writeFile(join(root,'portfolio/images/unselected.jpg'),'synthetic unselected display');
    const unselected=validate(root);assert.notEqual(unselected.status,0);assert.match(unselected.stderr,/Unselected images in the public build/);
  }finally{await rm(root,{recursive:true,force:true});}
});
