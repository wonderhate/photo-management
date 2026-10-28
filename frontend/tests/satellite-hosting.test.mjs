import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import fs,{readFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createServer as createPortProbe} from 'node:net';
import {createServer,loadConfigFromFile} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));
const files=['/maps/satellite.html','/maps/satellite.js','/maps/satellite.css'];

async function generatedWorker(replacements=new Map()){
  const loaded=await loadConfigFromFile({command:'build',mode:'browser'},fileURLToPath(new URL('../vite.config.ts',import.meta.url)),root,'error');
  const plugin=loaded.config.plugins.flat(Infinity).find(plugin=>plugin?.name==='browser-local-assets');
  const generated=new Map(),originalRead=fs.readFileSync;
  const generate=typeof plugin.generateBundle==='function'?plugin.generateBundle:plugin.generateBundle.handler;
  // Change only this synchronous build invocation's input bytes. No real public
  // asset is edited, so another build or browser check cannot see a test fixture.
  try{
    fs.readFileSync=(path,options)=>{
      const replacement=replacements.get(resolve(path instanceof URL?fileURLToPath(path):String(path)));
      if(replacement===undefined)return originalRead(path,options);
      const encoding=typeof options==='string'?options:options?.encoding;
      return encoding?replacement.toString(encoding):replacement;
    };
    syncBuiltinESMExports();
    generate.call({emitFile(asset){generated.set(asset.fileName,asset.source);}}, {}, {'assets/app-test.js':{type:'chunk'}});
  }finally{fs.readFileSync=originalRead;syncBuiltinESMExports();}
  return generated.get('sw.js');
}

test('development serves the isolated map document without injecting HMR or relaxing neighboring routes',async t=>{
  const probe=createPortProbe();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const server=await createServer({root,mode:'browser',server:{host:'127.0.0.1',port,strictPort:true,watch:null,preTransformRequests:false},optimizeDeps:{noDiscovery:true,include:[]},logLevel:'error'});
  t.after(()=>server.close());await server.listen();
  const origin='http://127.0.0.1:'+server.httpServer.address().port;
  for(const path of files){
    const response=await fetch(origin+path+'?v=header-test');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cross-origin-embedder-policy'),'unsafe-none');
    assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN');
    assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
    const csp=response.headers.get('content-security-policy');
    assert.ok(csp.includes("frame-ancestors 'self'"));
    assert.ok(csp.includes('https://maps.googleapis.com'));
    assert.ok(!csp.includes("connect-src 'self'"));
    assert.equal(await response.text(),readFileSync(new URL('../public'+path,import.meta.url),'utf8'));
  }
  for(const path of ['/','/maps/land-110m.json']){
    const response=await fetch(origin+path);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cross-origin-embedder-policy'),'require-corp');
    assert.equal(response.headers.get('x-frame-options'),'DENY');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    const csp=response.headers.get('content-security-policy');
    assert.ok(csp.includes("frame-src 'self'"));
    assert.ok(!csp.includes('google'));
    assert.ok(!csp.includes('unsafe-eval'));
  }
});

test('the generated worker precaches the complete offline Earth and ignores external map requests',async()=>{
  const worker=await generatedWorker();
  const listeners=new Map();let cachedFiles,install;
  runInNewContext(worker,{
    URL,location:{origin:'https://library.invalid'},
    self:{addEventListener(type,handler){listeners.set(type,handler);}},
    caches:{async open(){return {async addAll(paths){cachedFiles=paths;}};}},
  });
  listeners.get('install')({waitUntil(work){install=work;}});
  await install;
  for(const path of files)assert.ok(cachedFiles.includes(path),path);
  const metadata=JSON.parse(readFileSync(new URL('../public/maps/earth/metadata.json',import.meta.url),'utf8'));
  const earthFiles=Object.keys(metadata.files).map(path=>'/maps/earth/'+path);
  assert.equal(earthFiles.length,683);
  assert.equal(cachedFiles.filter(path=>path.startsWith('/maps/earth/')).length,685);
  for(const path of [...earthFiles,'/maps/earth/metadata.json','/maps/earth/SHA256SUMS.txt','/licenses/nasa-blue-marble.json'])assert.ok(cachedFiles.includes(path),path);
  assert.equal(new Set(cachedFiles).size,cachedFiles.length);
  assert.ok(cachedFiles.every(path=>path.startsWith('/')&&!path.startsWith('//')));
  for(const url of [
    'https://maps.googleapis.com/maps/api/js?key=synthetic',
    'https://khms0.googleapis.com/kh?v=synthetic',
    'https://maps.gstatic.com/mapfiles/example.png',
    'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/2/1/2?token=synthetic',
    'https://api.maptiler.com/tiles/satellite-v4/2/1/2.jpg?key=synthetic',
    metadata.source.url,
  ]){
    let intercepted=false;
    listeners.get('fetch')({request:{method:'GET',url},respondWith(){intercepted=true;}});
    assert.equal(intercepted,false,url);
  }
});

test('the cache version changes with a tile or source record and rejects unsafe manifest paths',async()=>{
  const original=await generatedWorker(),cacheVersion=worker=>worker.match(/const CACHE='([^']+)'/)[1];
  for(const relative of ['maps/earth/4/0-0.jpg','maps/earth/metadata.json','licenses/nasa-blue-marble.json']){
    const path=fileURLToPath(new URL('../public/'+relative,import.meta.url));
    const altered=Buffer.concat([readFileSync(path),Buffer.from('\n')]);
    assert.notEqual(cacheVersion(await generatedWorker(new Map([[resolve(path),altered]]))),cacheVersion(original),relative);
  }
  const metadataPath=fileURLToPath(new URL('../public/maps/earth/metadata.json',import.meta.url));
  const metadata=JSON.parse(readFileSync(metadataPath,'utf8'));
  for(const path of ['https://example.invalid/tile.jpg','../private.jpg','//example.invalid/tile.jpg']){
    const altered=Buffer.from(JSON.stringify({...metadata,files:{...metadata.files,[path]:{}}}));
    await assert.rejects(generatedWorker(new Map([[resolve(metadataPath),altered]])),/Invalid offline Earth asset path/);
  }
});

test('an incomplete Earth cache rejects worker installation',async()=>{
  const listeners=new Map();let install;
  runInNewContext(await generatedWorker(),{
    URL,location:{origin:'https://library.invalid'},
    self:{addEventListener(type,handler){listeners.set(type,handler);}},
    caches:{async open(){return {async addAll(paths){assert.ok(paths.includes('/maps/earth/4/31-15.jpg'));throw new Error('synthetic offline tile');}};}},
  });
  listeners.get('install')({waitUntil(work){install=work;}});
  await assert.rejects(install,/synthetic offline tile/);
});
