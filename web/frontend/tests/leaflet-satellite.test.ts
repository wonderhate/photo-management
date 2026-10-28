import test from 'node:test';
import assert from 'node:assert/strict';
import {ARCGIS_IMAGERY,MAPTILER_IMAGERY,MapViewportEpoch,nasaMinimumZoom,nasaViewportCamera,nearestWorldLongitude,satelliteBounds,satelliteCamera,satelliteTiles,SatelliteSourceError,validSatelliteKey} from '../src/core/leaflet-satellite.ts';

const key='synthetic-owner-key-only';
const response=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const signal=()=>new AbortController().signal;

test('NASA is entirely local and online sources issue no request without an owner key',async()=>{
  let calls=0;const request=(async()=>{calls++;throw new Error('unexpected network');}) as typeof fetch;
  const nasa=await satelliteTiles({provider:'nasa',key:''},signal(),request);
  assert.equal(calls,0);assert.equal(nasa.url,'/maps/earth/{z}/{x}-{y}.jpg');assert.equal(nasa.maxNativeZoom,4);assert.equal(nasa.maxZoom,8);assert.equal(nasa.geographic,true);
  for(const provider of ['arcgis','maptiler'] as const)for(const bad of ['', 'short', 'unsafe key', '<script>'])await assert.rejects(satelliteTiles({provider,key:bad},signal(),request),(error:unknown)=>error instanceof SatelliteSourceError&&error.code==='key');
  assert.equal(calls,0);assert.equal(validSatelliteKey(key),true);
});

test('ArcGIS uses the authenticated official endpoint and neutralizes remote attribution markup',async()=>{
  const request=(async(url,options)=>{
    assert.equal(String(url),`${ARCGIS_IMAGERY}?f=json&token=${key}`);
    assert.equal(options?.credentials,'omit');assert.ok(options?.signal);
    return response({copyrightText:'Sources: Esri & Vantor <img src=x onerror="bad()">',tileInfo:{lods:[{level:0},{level:19}]}});
  }) as typeof fetch;
  const spec=await satelliteTiles({provider:'arcgis',key},signal(),request);
  assert.equal(spec.url,`${ARCGIS_IMAGERY}/tile/{z}/{y}/{x}?token=${key}`);assert.equal(spec.maxNativeZoom,19);assert.equal(spec.geographic,false);
  assert.ok(spec.attribution.includes('Powered by'));assert.ok(spec.attribution.includes('Esri &amp; Vantor'));assert.ok(!spec.attribution.includes('<img'));
});

test('MapTiler takes native zoom and credits from TileJSON and never forwards a key to another host',async()=>{
  const tile='https://api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}.jpg?key=discarded';
  const request=(async(url,options)=>{assert.equal(String(url),`${MAPTILER_IMAGERY}?key=${key}`);assert.equal(options?.credentials,'omit');return response({tiles:[tile],maxzoom:18,attribution:'<a href="https://example.invalid">Imagery provider</a>'});}) as typeof fetch;
  const spec=await satelliteTiles({provider:'maptiler',key},signal(),request);
  assert.equal(spec.url,`https://api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}.jpg?key=${key}`);assert.equal(spec.maxNativeZoom,18);assert.match(spec.attribution,/Imagery provider/);assert.ok(!spec.attribution.includes('example.invalid'));
  for(const url of ['https://other.invalid/{z}/{x}/{y}.jpg','http://api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}.jpg','https://api.maptiler.com/private/{z}/{x}/{y}.jpg','https://api.maptiler.com/tiles/satellite-v4/image.jpg']){
    await assert.rejects(satelliteTiles({provider:'maptiler',key},signal(),(async()=>response({tiles:[url]})) as typeof fetch),SatelliteSourceError);
  }
});

test('network and authorization failures never expose a service key; cancelled metadata cannot win',async()=>{
  for(const request of [async()=>{throw new Error('Unable to fetch '+ARCGIS_IMAGERY+'?token='+key);},async()=>new Response('no',{status:403}),async()=>response({error:{message:key}})]){
    await assert.rejects(satelliteTiles({provider:'arcgis',key},signal(),request as typeof fetch),(error:unknown)=>error instanceof SatelliteSourceError&&!error.message.includes(key));
  }
  const controller=new AbortController();let release!:(value:Response)=>void;
  const pending=satelliteTiles({provider:'arcgis',key},controller.signal,(()=>new Promise<Response>(resolve=>{release=resolve;})) as typeof fetch);
  controller.abort();release(response({copyrightText:'Esri'}));
  await assert.rejects(pending,(error:unknown)=>error instanceof DOMException&&error.name==='AbortError');
});

test('date-line bounds and camera handling preserve WGS84 and keep the full world nonempty',()=>{
  assert.deepEqual(satelliteBounds(-240,-100,240,100),{west:-180,south:-90,east:180,north:90});
  assert.deepEqual(satelliteBounds(170,-10,195,10),{west:170,south:-10,east:-165,north:10});
  const original=satelliteCamera({latitude:35.4,longitude:139.7,zoom:7},'nasa');assert.equal(original.latitude,35.4);assert.ok(Math.abs(original.longitude-139.7)<1e-9);assert.equal(original.zoom,7);
  const high=satelliteCamera({latitude:90,longitude:540,zoom:22},'arcgis');assert.equal(high.longitude,-180);assert.equal(high.zoom,20);assert.ok(high.latitude<86);
  assert.equal(nearestWorldLongitude(-179,179),181);assert.equal(nearestWorldLongitude(179,-179),-181);
});

test('a late viewport completion cannot mark a later navigation or an unmounted map ready',()=>{
  const epochs=new MapViewportEpoch(),first=epochs.next(),second=epochs.next();
  assert.equal(epochs.current(first),false);assert.equal(epochs.current(second),true);epochs.cancel();assert.equal(epochs.current(second),false);
});

test('NASA overview covers wide and narrow containers without repeated full worlds or polar gaps',()=>{
  for(const [width,height] of [[1360,680],[1200,520],[360,520],[512,256]]){
    const minimum=nasaMinimumZoom(width,height),worldWidth=512*2**minimum,worldHeight=256*2**minimum;
    assert.ok(worldWidth>=width-1e-9);assert.ok(worldHeight>=height-1e-9);
    assert.ok(Math.abs(worldWidth-width)<1e-9||Math.abs(worldHeight-height)<1e-9);
    const camera=nasaViewportCamera({latitude:0,longitude:0,zoom:0},width,height);
    assert.equal(camera.zoom,minimum);assert.equal(camera.latitude,0);
  }
  const photoGps={latitude:89,longitude:179,zoom:3};
  const camera=nasaViewportCamera(photoGps,1360,680),halfLatitude=680*90/(256*2**camera.zoom);
  assert.ok(camera.latitude+halfLatitude<=90+1e-9);assert.equal(camera.longitude,179);assert.equal(photoGps.latitude,89);
  assert.equal(nasaViewportCamera({latitude:0,longitude:-179,zoom:6},360,520).zoom,6);
});

test('fractional overview zoom survives an online source round trip without crossing the detail threshold',()=>{
  for(const [width,height] of [[1360,680],[1200,520],[360,520]]){
    const zoom=nasaMinimumZoom(width,height)+3;
    const overview=nasaViewportCamera({latitude:20,longitude:179,zoom},width,height);
    assert.ok(overview.zoom>4);
    for(const provider of ['arcgis','maptiler'] as const){
      const online=satelliteCamera({...overview,zoom:overview.zoom+1},provider);
      assert.ok(online.zoom>5);assert.equal(online.zoom,overview.zoom+1);
      const restored=nasaViewportCamera(satelliteCamera({...online,zoom:online.zoom-1},'nasa'),width,height);
      assert.ok(Math.abs(restored.zoom-overview.zoom)<1e-12);
      assert.equal(restored.longitude,overview.longitude);
    }
  }
});
