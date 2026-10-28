import {readFile} from 'node:fs/promises';
import {expect} from '@playwright/test';

export const syntheticArcGISKey='SyntheticArcGISBrowserKey0000000001';
export const syntheticMapTilerKey='SyntheticMapTilerBrowserKey000000001';
const externalPattern=/^https?:\/\/(?!127\.0\.0\.1(?::|\/)|localhost(?::|\/))/;

// Keep Leaflet, its camera and rendering, and all bundled NASA assets real.
// Substitute only provider responses so tests never use a billable credential.
export async function installRegionalTiles(page){
  const tile=await readFile(new URL('../../public/maps/earth/1/1-0.jpg',import.meta.url));
  const requests=[],unexpected=[],pending=[];let mode='ready';
  await page.addInitScript(()=>{if(window!==top)return;localStorage.setItem('onboarded','1');for(const key of ['photo-map-mode-v1','photo-google-maps-key-v1','photo-arcgis-map-key-v1','photo-maptiler-map-key-v1','photo-regional-map-provider-v1'])localStorage.removeItem(key);});
  async function answer(route){
    if(mode==='error')return route.fulfill({status:503,headers:{'Access-Control-Allow-Origin':'*'},body:'Synthetic tile unavailable'});
    const url=new URL(route.request().url());
    if(/(?:\.json|MapServer\/?$)/.test(url.pathname)){
      const arcgis=url.hostname==='ibasemaps-api.arcgis.com';
      return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:arcgis?{currentVersion:11,capabilities:'Map,Tilemap',singleFusedMapCache:true,spatialReference:{wkid:102100,latestWkid:3857},fullExtent:{xmin:-20037508.3427892,ymin:-20037508.3427892,xmax:20037508.3427892,ymax:20037508.3427892,spatialReference:{wkid:102100}},tileInfo:{rows:256,cols:256,dpi:96,format:'JPEG',origin:{x:-20037508.3427892,y:20037508.3427892},spatialReference:{wkid:102100},lods:Array.from({length:20},(_,level)=>({level,resolution:156543.033928/2**level,scale:591657527.591555/2**level}))}}:{tilejson:'2.2.0',tiles:['https://api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}.jpg?key='+syntheticMapTilerKey],minzoom:0,maxzoom:20,bounds:[-180,-85,180,85],attribution:'Synthetic provider response'}});
    }
    return route.fulfill({contentType:'image/jpeg',headers:{'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','Cache-Control':'no-store'},body:tile});
  }
  await page.route(externalPattern,async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['ibasemaps-api.arcgis.com','api.maptiler.com'].includes(url.hostname)){unexpected.push(request.url());return route.abort();}
    requests.push({url:request.url(),method:request.method(),body:request.postData()});
    if(mode==='hold'){pending.push(route);return;}
    return answer(route);
  });
  return {requests,unexpected,setMode(value){mode=value;},async release(value='ready'){mode=value;await Promise.all(pending.splice(0).map(route=>answer(route).catch(()=>{})));}};
}

export function assertRegionalRequestPrivacy(probe){
  expect(probe.unexpected).toEqual([]);
  expect(probe.requests.length).toBeGreaterThan(0);
  for(const request of probe.requests){
    expect(request.method).toBe('GET');expect(request.body).toBeNull();
    expect(request.url).not.toMatch(/synthetic\.jpg|file_hash|file_name|photo_id|latitude|longitude|Hangzhou|Lake/);
  }
}

export async function exerciseRegionalSatellite(page,probe,info,lang,{failures=false}={}){
  const t=(zh,en)=>lang==='zh'?zh:en,button=(zh,en)=>page.getByRole('button',{name:t(zh,en),exact:true});
  const map=page.locator('.leaflet-satellite-map'),settings=page.getByRole('region',{name:t('高清卫星地图设置','Detailed satellite map settings'),exact:true});
  const key=()=>page.getByLabel(t('地图服务 Key','Map service key'),{exact:true});
  const onlineTiles=()=>map.locator('.leaflet-tile-loaded');
  const position=()=>map.evaluate(node=>[node.dataset.latitude,node.dataset.longitude,node.dataset.zoom]);
  const ready=async provider=>{await expect(map).toHaveAttribute('data-provider',provider);await expect(map).toHaveAttribute('data-status','ready');await expect(onlineTiles().first()).toBeVisible();};
  async function configure(provider,value){
    if(!await key().isVisible())await button('进阶设置','Advanced settings').click();
    await expect(settings.locator('select')).toBeVisible();await settings.locator('select').selectOption(provider);await key().fill(value);await button('保存服务配置','Save service settings').click();
  }
  await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.photo-globe')).toHaveAttribute('data-texture','ready');expect(probe.requests).toHaveLength(0);
  await button('展开卫星地图','Explore the satellite map').click();await ready('nasa');
  const zoomIn=()=>page.locator('.map-actions').getByRole('button',{name:t('放大','Zoom in'),exact:true}).click(),zoomOut=()=>page.locator('.map-actions').getByRole('button',{name:t('缩小','Zoom out'),exact:true}).click();
  for(let step=0;step<8&&Number(await map.getAttribute('data-zoom'))<=4;step++){const before=Number(await map.getAttribute('data-zoom'));await zoomIn();await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeGreaterThan(before);await ready('nasa');}
  const detailThresholdZoom=Number(await map.getAttribute('data-zoom'));expect(detailThresholdZoom).toBeGreaterThan(4);
  await expect(page.locator('.map-detail-setup')).toBeVisible();expect(probe.requests).toHaveLength(0);
  await button('配置高清服务','Configure detailed imagery').click();await key().fill('bad');await button('保存服务配置','Save service settings').click();await expect(page.getByRole('alert')).toBeVisible();expect(probe.requests).toHaveLength(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await ready('nasa');
  await map.evaluate(node=>{window.__tileStates=[];window.__tileObserver=new MutationObserver(()=>window.__tileStates.push(node.dataset.transition));window.__tileObserver.observe(node,{attributes:true,attributeFilter:['data-transition']});});
  probe.setMode('hold');await configure('arcgis',syntheticArcGISKey);
  await expect(map).toHaveAttribute('data-transition','holding');await expect(map.locator('.leaflet-map-snapshot canvas')).toBeVisible();
  const pixels=await map.locator('.leaflet-map-snapshot canvas').evaluate(canvas=>{const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;return [...p].filter((n,i)=>i%4===3&&n>0).length;});expect(pixels).toBeGreaterThan(100);
  await expect.poll(()=>probe.requests.length).toBeGreaterThan(0);await probe.release();await ready('arcgis');
  await expect.poll(()=>page.evaluate(()=>window.__tileStates.includes('fading'))).toBe(true);await expect(map).toHaveAttribute('data-transition','none');await page.evaluate(()=>window.__tileObserver.disconnect());
  expect(await page.evaluate(()=>localStorage.getItem('photo-arcgis-map-key-v1'))).toBe(syntheticArcGISKey);expect(await page.locator('body').innerText()).not.toContain(syntheticArcGISKey);
  await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeCloseTo(detailThresholdZoom+1,4);
  const tilesBefore=probe.requests.filter(r=>/\/tile\//.test(r.url)).length,zoom=Number(await map.getAttribute('data-zoom'));
  await page.emulateMedia({reducedMotion:'reduce'});await ready('arcgis');await zoomIn();await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeCloseTo(zoom+1,4);await ready('arcgis');
  await expect.poll(()=>probe.requests.filter(r=>/\/tile\//.test(r.url)).length).toBeGreaterThan(tilesBefore);
  expect(probe.requests.filter(r=>/\/tile\//.test(r.url)).length-tilesBefore).toBeLessThan(100);
  const beforePan=await position();await map.locator('.leaflet-container').focus();await page.keyboard.press('ArrowRight');await expect.poll(position).not.toEqual(beforePan);await ready('arcgis');
  // Shrinking crosses the matching ground-scale boundary once, without bouncing.
  for(let step=0;step<4&&await map.getAttribute('data-provider')==='arcgis';step++){const previous=Number(await map.getAttribute('data-zoom'));await zoomOut();await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeLessThan(previous);}
  await ready('nasa');expect(Number(await map.getAttribute('data-zoom'))).toBeLessThanOrEqual(4);
  const atBoundary=probe.requests.length;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));expect(probe.requests.length).toBe(atBoundary);
  await zoomIn();await ready('arcgis');expect(Number(await map.getAttribute('data-zoom'))).toBeGreaterThan(5);
  await page.locator('input[list="map-countries"]').fill('China');await expect.poll(async()=>Math.abs(Number(await map.getAttribute('data-longitude'))-120)).toBeLessThan(.1);await ready('arcgis');
  await expect(page.locator('.satellite-photo-pin')).toHaveCount(1);await page.locator('.satellite-photo-pin').hover();await expect(page.locator('.map-photo-fan button')).toHaveCount(1);await page.keyboard.press('Escape');
  await map.screenshot({path:info.outputPath('leaflet-online-synthetic-'+lang+'.png')});
  if(failures){
    // Leave real time running: the actual ten-second deadline must recover.
    probe.setMode('hold');await configure('maptiler',syntheticMapTilerKey);
    await expect(map).toHaveAttribute('data-provider','maptiler');await expect(page.locator('.map-connection-error')).toBeVisible({timeout:14000});await ready('nasa');await expect(map).toHaveAttribute('data-transition','none');
    const failedRequests=probe.requests.length;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));expect(probe.requests.length).toBe(failedRequests);
    await probe.release();const retried=probe.requests.length;await page.locator('.map-connection-error').getByRole('button',{name:t('重试连接','Retry connection'),exact:true}).click();await ready('maptiler');expect(probe.requests.length).toBeGreaterThan(retried);await expect(page.locator('.map-connection-error')).toHaveCount(0);
    probe.setMode('error');await configure('arcgis',syntheticArcGISKey+'2');await expect(page.locator('.map-connection-error')).toBeVisible({timeout:14000});await ready('nasa');
    await button('使用离线卫星概览','Use offline satellite overview').click();await ready('nasa');await expect(page.locator('.map-connection-error')).toHaveCount(0);
    const suspendedRequests=probe.requests.length;await zoomIn();await ready('nasa');expect(probe.requests.length).toBe(suspendedRequests);
    probe.setMode('ready');await button('全世界','Whole world').click();await ready('nasa');await configure('maptiler',syntheticMapTilerKey);
  }else{await configure('maptiler',syntheticMapTilerKey);await ready('maptiler');}
  const atRest=probe.requests.length;await button('全世界','Whole world').click();await ready('nasa');expect(probe.requests.length).toBe(atRest);
  if(!await key().isVisible())await button('进阶设置','Advanced settings').click();await settings.locator('select').selectOption('maptiler');await button('移除高清 Key','Remove detail key').click();await ready('nasa');
  expect(await page.evaluate(()=>localStorage.getItem('photo-maptiler-map-key-v1')||'')).toBe('');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  assertRegionalRequestPrivacy(probe);expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
}
