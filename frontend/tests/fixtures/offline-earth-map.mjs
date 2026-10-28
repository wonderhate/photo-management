import {expect} from '@playwright/test';
import {assertMapPhotoFan} from './satellite-map.mjs';

export async function installOfflineEarthProbe(page){
  const external=[];
  await page.addInitScript(()=>{if(window!==top)return;localStorage.setItem('onboarded','1');localStorage.removeItem('photo-google-maps-key-v1');localStorage.removeItem('photo-map-mode-v1');});
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/)|localhost(?::|\/))/,route=>{external.push(route.request().url());return route.abort();});
  return {external};
}

async function loadedTiles(page){
  const map=page.locator('.leaflet-satellite-map[data-provider="nasa"]');await expect(map).toHaveAttribute('data-status','ready');
  const tiles=map.locator('.leaflet-tile-loaded');await expect(tiles.first()).toBeVisible();
  const urls=await tiles.evaluateAll(nodes=>[...new Set(nodes.map(node=>new URL(node.src).pathname))]);
  expect(urls.length).toBeGreaterThan(0);expect(urls.length).toBeLessThanOrEqual(96);
  for(const url of urls)expect(url).toMatch(/^\/maps\/earth\/[0-4]\/\d+-\d+\.jpg$/);
  // Decode the actual bundled JPEGs. These are never fulfilled by a test route.
  const sizes=await page.evaluate(urls=>Promise.all(urls.map(async src=>{const image=new Image();image.src=src;await image.decode();return [image.naturalWidth,image.naturalHeight];})),urls);
  expect(sizes.every(([w,h])=>w===512&&h===512)).toBe(true);return urls;
}

async function assertFittedWorld(map){
  const coverage=await map.evaluate(node=>{const box=node.getBoundingClientRect(),tiles=[...node.querySelectorAll('.leaflet-tile-loaded')].map(image=>({src:image.src,box:image.getBoundingClientRect()})).filter(({box:r})=>Math.min(r.right,box.right)-Math.max(r.left,box.left)>3&&Math.min(r.bottom,box.bottom)-Math.max(r.top,box.top)>3),fragments={};for(const tile of tiles){const r=tile.box,area=(Math.min(r.right,box.right)-Math.max(r.left,box.left))*(Math.min(r.bottom,box.bottom)-Math.max(r.top,box.top)),previous=fragments[tile.src]||{visible:0,full:0};fragments[tile.src]={visible:previous.visible+area,full:Math.max(previous.full,r.width*r.height)};}return {width:box.width,height:box.height,extentWidth:Math.min(box.right,Math.max(...tiles.map(t=>t.box.right)))-Math.max(box.left,Math.min(...tiles.map(t=>t.box.left))),extentHeight:Math.min(box.bottom,Math.max(...tiles.map(t=>t.box.bottom)))-Math.max(box.top,Math.min(...tiles.map(t=>t.box.top))),fragments:Object.values(fragments)};});
  expect(coverage.extentWidth).toBeGreaterThan(coverage.width-8);expect(coverage.extentHeight).toBeGreaterThan(coverage.height-8);
  // A dateline tile may appear as two complementary edge fragments. Fractional
  // zoom rounds neighboring tile positions independently, leaving a pixel seam.
  for(const tile of coverage.fragments)expect(tile.visible).toBeLessThanOrEqual(tile.full*1.01+64);
}

export async function exerciseOfflineEarth(page,probe,info,lang,{checkOfflineCache=false}={}){
  const t=(zh,en)=>lang==='zh'?zh:en,button=(zh,en)=>page.getByRole('button',{name:t(zh,en),exact:true});
  const globe=page.locator('.photo-globe'),map=page.locator('.leaflet-satellite-map[data-provider="nasa"]');
  const position=()=>map.evaluate(node=>[node.dataset.latitude,node.dataset.longitude,node.dataset.zoom]);
  const mapCanvas=()=>map.locator('.leaflet-container');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(globe).toHaveAttribute('data-texture','ready');await expect(page.locator('.map-place-card')).toHaveCount(1);
  expect(await page.locator('.globe-pin').first().evaluate(node=>getComputedStyle(node).borderTopLeftRadius)).toBe('50%');
  await expect(page.locator('.globe-pause')).toBeDisabled();
  await globe.screenshot({path:info.outputPath('nasa-globe-'+lang+'.png')});
  const oldGlobe=await globe.locator('canvas').evaluate(node=>node.toDataURL());await globe.focus();await page.keyboard.press('ArrowRight');
  await expect.poll(()=>globe.locator('canvas').evaluate(node=>node.toDataURL())).not.toBe(oldGlobe);
  await button('展开卫星地图','Explore the satellite map').click();await expect(map).toBeVisible();await expect(page.locator('.satellite-map iframe')).toHaveCount(0);
  await expect(page.locator('.map-connection')).toHaveCount(0);await expect(map).toContainText('NASA Earth Observatory');
  const initial=await loadedTiles(page),world=await position(),initialZoom=Number(world[2]);await assertFittedWorld(map);
  for(const control of await map.locator('.leaflet-control-zoom a').all()){const box=await control.boundingBox();expect(box.width).toBeCloseTo(44,0);expect(box.height).toBeCloseTo(44,0);}
  if(lang==='zh'){const color=await map.locator('.leaflet-control-attribution').evaluate(node=>{const c=document.createElement('canvas');c.width=c.height=1;const context=c.getContext('2d');context.fillStyle=getComputedStyle(node).backgroundColor;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data];});expect(Math.max(...color.slice(0,3))).toBeLessThan(180);}
  await mapCanvas().focus();await page.keyboard.press('+');await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeCloseTo(initialZoom+1,4);
  await page.keyboard.press('+');await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeCloseTo(initialZoom+2,4);
  const zoomed=await loadedTiles(page);expect(Math.max(...zoomed.map(url=>Number(url.split('/')[3])))).toBeGreaterThan(Math.max(...initial.map(url=>Number(url.split('/')[3]))));
  const beforePan=await position();await page.keyboard.press('ArrowRight');await expect.poll(position).not.toEqual(beforePan);
  await map.scrollIntoViewIfNeeded();const beforeDrag=await position(),box=await map.boundingBox(),dragX=box.x+box.width*.35,dragY=box.y+box.height*.6;await page.mouse.move(dragX,dragY);await page.mouse.down();await page.mouse.move(dragX+60,dragY+24,{steps:4});await page.mouse.up();await expect.poll(position).not.toEqual(beforeDrag);
  await button('全世界','Whole world').click();await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeCloseTo(initialZoom,4);
  // A narrow viewport crops the fitted world horizontally; focus the photo's country.
  await page.locator('input[list="map-countries"]').fill('China');await expect(page.locator('.satellite-photo-pin')).toHaveCount(1);
  const pin=page.locator('.satellite-photo-pin');await pin.hover();await expect(page.locator('.map-photo-fan button')).toHaveCount(1);await expect(page.locator('.map-photo-fan button img')).toBeVisible();
  await assertMapPhotoFan(page);
  await pin.focus();await page.keyboard.press('Escape');await expect(page.locator('.map-photo-fan')).toHaveCount(0);
  await pin.click();await expect(page.locator('.map-selected-card')).toBeVisible();expect(await page.locator('.map-selected-card').evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
  await button('关闭地点预览','Close location preview').click();await button('全世界','Whole world').click();
  await page.locator('input[list="map-countries"]').fill('Atlantis');await expect(page.locator('.satellite-photo-pin')).toHaveCount(0);
  await button('清除地点筛选','Clear place filters').click();await expect(page.locator('input[list="map-countries"]')).toHaveValue('');
  await page.locator('input[list="map-countries"]').fill('China');await expect(page.locator('.map-country-chips button[aria-pressed="true"]')).toContainText('China');await expect(page.locator('.satellite-photo-pin')).toHaveCount(1);
  await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeGreaterThan(0);
  await expect.poll(async()=>Math.abs(Number(await map.getAttribute('data-longitude'))-120)).toBeLessThan(.1);
  await button('全世界','Whole world').click();await page.locator('input[list="map-cities"]').fill('Hangzhou');await expect.poll(async()=>Math.abs(Number(await map.getAttribute('data-longitude'))-120)).toBeLessThan(.1);await expect(page.locator('.satellite-photo-pin')).toHaveCount(1);
  await button('清除地点筛选','Clear place filters').click();
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await loadedTiles(page);
  await map.locator('.leaflet-map-host').evaluate(node=>{window.__earthFrames=[];window.__earthObserver=new MutationObserver(records=>{if(records.some(record=>record.target.matches('.leaflet-tile-container,.leaflet-map-pane')))window.__earthFrames.push(1);});window.__earthObserver.observe(node,{subtree:true,attributes:true,attributeFilter:['style']});});
  await page.locator('.map-actions').getByRole('button',{name:t('放大','Zoom in'),exact:true}).click();await map.scrollIntoViewIfNeeded();await expect.poll(()=>page.evaluate(()=>window.__earthFrames.length)).toBeGreaterThan(1);
  // A new action interrupts the in-flight camera and completes at a valid view.
  await button('全世界','Whole world').click();await map.scrollIntoViewIfNeeded();await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeCloseTo(initialZoom,4);await page.evaluate(()=>window.__earthObserver.disconnect());
  await page.emulateMedia({reducedMotion:'reduce'});
  // Pan across the antimeridian; reported GPS stays normalized while tiles wrap.
  let crossed=false;
  for(let n=0;n<8&&!crossed;n++){const before=await position(),previous=Number(before[1]);await page.locator('.map-actions').getByRole('button',{name:t('向东','Pan east'),exact:true}).click();await expect.poll(position).not.toEqual(before);const longitude=Number(await map.getAttribute('data-longitude'));expect(longitude).toBeGreaterThanOrEqual(-180);expect(longitude).toBeLessThan(180);crossed=longitude<previous-100;}
  expect(crossed).toBe(true);
  await loadedTiles(page);await button('全世界','Whole world').click();await loadedTiles(page);await map.screenshot({path:info.outputPath('nasa-satellite-'+lang+'.png')});await page.evaluate(()=>window.scrollTo(0,0));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:info.outputPath('nasa-page-'+lang+'.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(probe.external).toEqual([]);
  if(checkOfflineCache){
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await expect.poll(()=>page.evaluate(async()=>{const paths=[];for(const key of await caches.keys())for(const r of await(await caches.open(key)).keys())paths.push(new URL(r.url).pathname);return new Set(paths.filter(p=>/^\/maps\/earth\/.+\.jpg$/.test(p))).size;}),{timeout:30000}).toBe(683);
    await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
    await page.context().setOffline(true);
    try{
      await page.reload();await expect(globe).toHaveAttribute('data-texture','ready');await button('展开卫星地图','Explore the satellite map').click();await loadedTiles(page);
      // A high-resolution tile on the other side of Earth was not previously viewed.
      expect(await page.evaluate(async()=>{const image=new Image();image.src='/maps/earth/4/0-0.jpg';await image.decode();return image.naturalWidth;})).toBe(512);
      await mapCanvas().focus();await page.keyboard.press('+');await page.keyboard.press('ArrowLeft');await loadedTiles(page);
      await page.screenshot({path:info.outputPath('nasa-offline-reload-'+lang+'.png'),fullPage:true});expect(probe.external).toEqual([]);
    }finally{await page.context().setOffline(false);}
  }
}
