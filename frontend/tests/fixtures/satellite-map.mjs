import {expect} from '@playwright/test';

export const syntheticMapKey='AIzaSyntheticMapBrowserKey0000000000001';
const replacementKey='AIzaSyntheticMapBrowserKey0000000000002';
const storageKey='photo-google-maps-key-v1';

export async function assertMapPhotoFan(page){
  for(const button of await page.locator('.map-photo-fan button').all()){
    const shape=await button.evaluate(node=>{const box=node.getBoundingClientRect(),image=node.querySelector('img').getBoundingClientRect(),style=getComputedStyle(node);return {width:box.width,height:box.height,imageWidth:image.width,imageHeight:image.height,radius:style.borderTopLeftRadius,display:style.display};});
    expect(shape.radius).toBe('50%');expect(shape.display).toBe('block');expect(shape.width).toBeCloseTo(shape.height,1);
    expect(shape.imageWidth).toBeGreaterThan(30);expect(shape.imageWidth).toBeCloseTo(shape.imageHeight,1);expect(shape.width-shape.imageWidth).toBeLessThanOrEqual(8);
  }
}

// Only the Google SDK is replaced. The shipped opaque iframe, bridge,
// projection layer, photo components and application remain real.
function sdkStub(){
  const state=window.__mapSdk={messages:[],moves:[],type:'',options:null};
  addEventListener('message',event=>state.messages.push(event.data));
  class LatLng{constructor(lat,lng){this.latitude=lat;this.longitude=lng;}lat(){return this.latitude;}lng(){return this.longitude;}}
  class Map{
    constructor(element,options){this.element=element;this.center=new LatLng(options.center.lat,options.center.lng);this.zoom=options.zoom;this.listeners={};state.map=this;state.options=options;state.type=options.mapTypeId;}
    addListener(name,fn){(this.listeners[name]??=[]).push(fn);return {remove:()=>this.listeners[name]=this.listeners[name].filter(value=>value!==fn)};}
    emit(name){for(const fn of this.listeners[name]||[])fn();}
    getBounds(){return {toJSON:()=>({west:-180,east:180,south:-90,north:90})};}
    getCenter(){return this.center;}
    getZoom(){return this.zoom;}
    setMapTypeId(value){state.type=value;}
    moveCamera(value){this.center=new LatLng(value.center.lat,value.center.lng);this.zoom=value.zoom;state.moves.push(value);this.emit('bounds_changed');this.emit('idle');}
  }
  class OverlayView{
    setMap(map){this.map=map;this.onAdd();this.draw();}
    getProjection(){return {fromLatLngToContainerPixel:p=>({x:innerWidth*.58+p.lng()*.01,y:innerHeight*.55-p.lat()*.01})};}
  }
  window.google={maps:{Map,OverlayView,LatLng,importLibrary:async()=>({Map}),event:{trigger:(map,name)=>map.emit(name)}}};
  window.__luminaMapReady();
}

export async function installSatelliteSDK(page){
  const requests=[],blocked=[],parentKeyLeaks=[],iframeRequests=[],iframeIds=new Set(),networkHeaders=new Map();let authorizationFailure=false;
  const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent',({requestId,request})=>{if(new URL(request.url).pathname==='/maps/satellite.html')iframeIds.add(requestId);});
  cdp.on('Network.requestWillBeSentExtraInfo',({requestId,headers})=>networkHeaders.set(requestId,headers));
  await page.addInitScript(()=>{if(window!==top)return;localStorage.setItem('onboarded','1');localStorage.removeItem('photo-google-maps-key-v1');localStorage.removeItem('photo-map-mode-v1');});
  page.on('request',request=>{
    if(new URL(request.url()).pathname==='/maps/satellite.html')iframeRequests.push(request);
    if(!request.url().startsWith('https://maps.googleapis.com/maps/api/js')&&(request.url().includes(syntheticMapKey)||request.url().includes(replacementKey)||(request.postData()||'').includes(syntheticMapKey)))parentKeyLeaks.push(request.url());
  });
  // Keep the shipped iframe resources real. With route interception enabled,
  // Playwright allHeaders() includes unsent context cookies; CDP ExtraInfo below
  // observes the actual network headers, verified against a loopback server.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/)|localhost(?::|\/))/,route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='maps.googleapis.com'&&url.pathname==='/maps/api/js'){
      requests.push(url);return route.fulfill({status:200,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'},body:authorizationFailure?'window.gm_authFailure();':`(${sdkStub.toString()})();`});
    }
    if(['https:','http:'].includes(url.protocol)&&!['localhost','127.0.0.1'].includes(url.hostname)){blocked.push(url.origin);return route.abort();}
    return route.fallback();
  });
  return {requests,blocked,parentKeyLeaks,iframeRequests,iframeIds,networkHeaders,failAuthorization(value){authorizationFailure=value;}};
}

async function settle(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
const sdkFrame=page=>page.frames().find(frame=>new URL(frame.url()||'about:blank').pathname==='/maps/satellite.html');

export async function exerciseSatelliteMap(page,probe,info,lang='en'){
  const t=(zh,en)=>lang==='zh'?zh:en,button=(zh,en)=>page.getByRole('button',{name:t(zh,en),exact:true});
  const keyInput=()=>page.getByLabel(t('Google Maps 浏览器 Key','Google Maps browser key'),{exact:true});
  await expect(page.locator('.photo-globe')).toBeVisible();await expect(page.locator('.map-place-card')).toHaveCount(1);
  await page.context().addCookies([{name:'map-private-probe',value:'must-stay-in-parent',url:new URL(page.url()).origin}]);
  expect(probe.requests).toHaveLength(0);expect(probe.blocked).toEqual([]);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('.globe-pause')).toBeDisabled();
  const globe=await page.locator('.photo-globe canvas').evaluate(node=>node.toDataURL());
  await settle(page);expect(await page.locator('.photo-globe canvas').evaluate(node=>node.toDataURL())).toBe(globe);
  await page.locator('.photo-globe').focus();await page.keyboard.press('ArrowRight');
  await expect.poll(()=>page.locator('.photo-globe canvas').evaluate(node=>node.toDataURL())).not.toBe(globe);
  await button('Google 卫星','Google satellite').click();await expect(keyInput()).toBeVisible();expect(probe.requests).toHaveLength(0);
  await keyInput().fill('bad');await button('保存并连接','Save and connect').click();await expect(page.getByRole('alert')).toBeVisible();expect(probe.requests).toHaveLength(0);
  await keyInput().fill(syntheticMapKey);await button('保存并连接','Save and connect').click();
  await expect.poll(()=>probe.requests.length).toBe(1);await expect(page.locator('.satellite-photo-pin')).toHaveCount(1);
  const frame=sdkFrame(page);expect(frame).toBeTruthy();
  const iframe=page.locator('.satellite-map iframe');await expect(iframe).toHaveAttribute('sandbox','allow-scripts allow-popups allow-popups-to-escape-sandbox');
  await expect(iframe).toHaveAttribute('credentialless','');expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
  await expect.poll(()=>[...probe.iframeIds].some(id=>probe.networkHeaders.has(id))).toBe(true);
  const actualHeaders=probe.networkHeaders.get([...probe.iframeIds].find(id=>probe.networkHeaders.has(id)));
  expect(actualHeaders.Cookie||actualHeaders.cookie||'').not.toContain('map-private-probe');
  expect(await frame.evaluate(()=>{try{return parent.localStorage.length>=0;}catch{return false;}})).toBe(false);
  expect(await frame.evaluate(()=>{try{localStorage.setItem('sdk-access','1');return true;}catch{return false;}})).toBe(false);
  expect(await page.evaluate(key=>localStorage.getItem(key),storageKey)).toBe(syntheticMapKey);
  expect(await iframe.getAttribute('src')).not.toContain(syntheticMapKey);
  expect(await page.locator('body').innerText()).not.toContain(syntheticMapKey);
  expect(probe.requests[0].searchParams.get('key')).toBe(syntheticMapKey);
  expect(probe.requests[0].searchParams.get('language')).toBe(lang==='zh'?'zh-CN':'en');
  expect(await frame.evaluate(()=>window.__mapSdk.type)).toBe('satellite');
  expect(await frame.evaluate(()=>window.__mapSdk.options.disableDefaultUI)).toBe(true);
  const pin=page.locator('.satellite-photo-pin');await expect(pin.locator('img')).toBeVisible();
  await expect.poll(()=>pin.locator('img').evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);
  await expect.poll(()=>frame.evaluate(()=>window.__mapSdk.messages.some(message=>message.type==='points'&&message.points.length===1))).toBe(true);
  const points=await frame.evaluate(()=>window.__mapSdk.messages.find(message=>message.type==='points'&&message.points.length===1).points);
  expect(Object.keys(points[0]).sort()).toEqual(['id','latitude','longitude']);
  await pin.hover();await expect.poll(()=>pin.evaluate(node=>getComputedStyle(node).scale)).toBe('1.24');
  await expect(page.locator('.map-photo-fan button')).toHaveCount(1);await expect(page.locator('.map-photo-fan button img')).toBeVisible();
  await assertMapPhotoFan(page);
  await pin.focus();await page.keyboard.press('Escape');await expect(page.locator('.map-photo-fan')).toHaveCount(0);
  const movesBeforeSelection=await frame.evaluate(()=>window.__mapSdk.moves.length);
  await pin.click();await expect(page.locator('.map-selected-card')).toBeVisible();
  expect(await page.locator('.map-selected-card').evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
  await expect.poll(()=>frame.evaluate(()=>window.__mapSdk.moves.length)).toBe(movesBeforeSelection+1);
  const reducedMove=await frame.evaluate(()=>window.__mapSdk.moves.at(-1));expect(reducedMove.center).toEqual({lat:30,lng:120});
  await button('显示地名','Show labels').click();await expect.poll(()=>frame.evaluate(()=>window.__mapSdk.type)).toBe('hybrid');
  await button('隐藏地名','Hide labels').click();await expect.poll(()=>frame.evaluate(()=>window.__mapSdk.type)).toBe('satellite');
  const channel=new URL(frame.url()).hash.slice(1),before=await pin.getAttribute('style');
  // Actual messages from the right iframe with a wrong channel are rejected.
  await frame.evaluate(()=>parent.postMessage({channel:'wrong-channel',type:'error',reason:'authorization'},'*'));
  await frame.evaluate(id=>parent.postMessage({channel:'wrong-channel',type:'positions',positions:[{id,x:1,y:1}]},'*'),points[0].id);
  // An opaque sibling has origin "null" and a valid channel, but the wrong source.
  await page.evaluate(channel=>{const f=document.createElement('iframe');f.id='map-foreign-frame';f.sandbox='allow-scripts';f.setAttribute('credentialless','');f.src='/maps/satellite.html#'+channel;document.body.append(f);},channel);
  const foreign=await page.locator('#map-foreign-frame').elementHandle();const foreignFrame=await foreign.contentFrame();
  await foreignFrame.waitForURL(/\/maps\/satellite\.html/);await foreignFrame.waitForLoadState();await foreignFrame.evaluate(channel=>parent.postMessage({channel,type:'error',reason:'authorization'},'*'),channel);
  await settle(page);await expect(page.locator('.map-connection-error')).toHaveCount(0);expect(await pin.getAttribute('style')).toBe(before);
  await page.locator('#map-foreign-frame').evaluate(node=>node.remove());
  // The child rejects messages with an invalid channel and messages not from parent.
  const moves=await frame.evaluate(()=>window.__mapSdk.moves.length);
  await page.evaluate(()=>document.querySelector('.satellite-map iframe').contentWindow.postMessage({channel:'wrong-channel',type:'camera',camera:{latitude:0,longitude:0,zoom:20}},'*'));
  await frame.evaluate(channel=>window.postMessage({channel,type:'camera',camera:{latitude:0,longitude:0,zoom:20}},'*'),channel);
  await settle(page);expect(await frame.evaluate(()=>window.__mapSdk.moves.length)).toBe(moves);
  await page.emulateMedia({reducedMotion:'no-preference'});await settle(page);await button('全世界','Whole world').click();await iframe.scrollIntoViewIfNeeded();
  await expect.poll(()=>frame.evaluate(()=>window.__mapSdk.moves.length)).toBeGreaterThan(moves+1);
  await expect.poll(()=>frame.evaluate(()=>window.__mapSdk.map.getZoom())).toBe(2);
  expect(await frame.evaluate(start=>window.__mapSdk.moves.slice(start).some(move=>move.zoom>2&&move.zoom<12),moves)).toBe(true);
  await pin.click();await expect(page.locator('.map-selected-card')).toBeVisible();
  await frame.evaluate(()=>window.__mapSdk.map.emit('click'));await expect(page.locator('.map-selected-card')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('satellite-'+lang+'.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  // Authentication failure is recoverable without echoing the key or retrying itself.
  await frame.evaluate(()=>window.gm_authFailure());await expect(page.locator('.map-connection-error')).toContainText(t('Google 地图授权失败','Google Maps authorization failed'));
  expect(probe.requests).toHaveLength(1);await button('重试连接','Retry connection').click();
  await expect.poll(()=>probe.requests.length).toBe(2);await expect(page.locator('.satellite-photo-pin')).toHaveCount(1);
  await button('地图设置','Map settings').click();await expect(keyInput()).toHaveValue('');await keyInput().fill(replacementKey);await button('保存并连接','Save and connect').click();
  await expect.poll(()=>probe.requests.length).toBe(3);await expect(page.locator('.satellite-photo-pin')).toHaveCount(1);
  expect(probe.requests[2].searchParams.get('key')).toBe(replacementKey);
  expect(await page.evaluate(key=>localStorage.getItem(key),storageKey)).toBe(replacementKey);
  await button('地图设置','Map settings').click();await button('移除 Key','Remove key').click();
  await expect(page.locator('.photo-globe')).toBeVisible();await expect(page.locator('.satellite-map iframe')).toHaveCount(0);
  expect(await page.evaluate(key=>localStorage.getItem(key),storageKey)).toBeNull();
  expect(probe.parentKeyLeaks).toEqual([]);expect(probe.blocked).toEqual([]);expect(probe.requests).toHaveLength(3);
}
