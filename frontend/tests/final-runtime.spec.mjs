import {test,expect} from './fixtures/native-runtime.mjs';
import {installSatelliteSDK,exerciseSatelliteMap} from './fixtures/satellite-map.mjs';
import {installOfflineEarthProbe,exerciseOfflineEarth} from './fixtures/offline-earth-map.mjs';
import {installRegionalTiles,exerciseRegionalSatellite} from './fixtures/regional-satellite.mjs';

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`regional Leaflet loads viewport tiles and recovers safely ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(90000);const probe=await installRegionalTiles(page);
  await page.addInitScript(lang=>{if(window!==top)return;localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='zh'?'dark':'light');},lang);
  const photo={id:'regional-synthetic',file_name:'Regional synthetic.jpg',file_hash:'1'.repeat(64),width:80,height:50,thumbnail_url:'/maps/synthetic-test.svg'};
  await page.route('**/maps/synthetic-test.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><path fill="#367b89" d="M0 0h80v50H0z"/><circle fill="#f4d68c" cx="40" cy="25" r="15"/></svg>'}));
  await page.route('**/api/photos/regional-synthetic*',route=>route.fulfill({json:photo}));
  await page.route('**/api/photos?*',route=>route.fulfill({json:{photos:[photo],total:1,page:1,page_size:6}}));
  await page.route('**/api/locations/map?*',route=>route.fulfill({json:{total:1,located:1,unlocated:0,in_view:1,cluster_count:1,truncated:false,facets_truncated:false,clusters:[{photo_id:photo.id,latitude:30,longitude:120,count:1}],countries:[{value:'China',count:1}],cities:[{value:'Hangzhou',count:1}]}}));
  await page.setViewportSize({width,height:1000});await page.goto('/?page=locations');await exerciseRegionalSatellite(page,probe,info,lang,{failures:lang==='zh'});
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`NASA offline satellite uses real bundled imagery and local interactions ${width} ${lang}`,async({page},info)=>{
  const probe=await installOfflineEarthProbe(page);
  await page.addInitScript(lang=>{if(window!==top)return;localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='zh'?'dark':'light');},lang);
  const photo={id:'earth-synthetic',file_name:'Earth synthetic.jpg',file_hash:'1'.repeat(64),width:80,height:50,thumbnail_url:'/maps/synthetic-test.svg'};
  await page.route('**/maps/synthetic-test.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><path fill="#367b89" d="M0 0h80v50H0z"/><circle fill="#f4d68c" cx="40" cy="25" r="15"/></svg>'}));
  await page.route('**/api/photos/earth-synthetic*',route=>route.fulfill({json:photo}));
  await page.route('**/api/locations/map?*',route=>{const country=new URL(route.request().url()).searchParams.get('location_country'),count=!country||country==='China'?1:0;return route.fulfill({json:{total:count,located:count,unlocated:0,in_view:count,cluster_count:count,truncated:false,facets_truncated:false,clusters:count?[{photo_id:photo.id,latitude:30,longitude:120,count:1}]:[],countries:[{value:'China',count}],cities:count?[{value:'Hangzhou',count}]:[]}});});
  await page.setViewportSize({width,height:1000});await page.goto('/?page=locations');await exerciseOfflineEarth(page,probe,info,lang);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`satellite map isolates Google and preserves local photo interaction ${width} ${lang}`,async({page},info)=>{
  const probe=await installSatelliteSDK(page);
  await page.addInitScript(lang=>{if(window!==top)return;localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='zh'?'dark':'light');},lang);
  const photo={id:'map-synthetic',file_name:'Map synthetic.jpg',file_hash:'1'.repeat(64),width:80,height:50,thumbnail_url:'/maps/synthetic-test.svg'};
  await page.route('**/maps/synthetic-test.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><path fill="#367b89" d="M0 0h80v50H0z"/><circle fill="#f4d68c" cx="40" cy="25" r="15"/></svg>'}));
  await page.route('**/api/photos/map-synthetic*',route=>route.fulfill({json:photo}));
  await page.route('**/api/locations/map?*',route=>route.fulfill({json:{total:1,located:1,unlocated:0,in_view:1,cluster_count:1,truncated:false,facets_truncated:false,clusters:[{photo_id:photo.id,latitude:30,longitude:120,count:1}],countries:[{value:'China',count:1}],cities:[{value:'Hangzhou',count:1}]}}));
  await page.setViewportSize({width,height:1000});await page.goto('/?page=locations');
  await exerciseSatelliteMap(page,probe,info,lang);
});

for(const [width,lang,theme] of [[1440,'zh','dark'],[390,'en','light']])test(`local runtime legacy links and launch page without internet ${width}`,async({page})=>{
  const external=[],errors=[];
  await page.setViewportSize({width,height:900});
  await page.addInitScript(({lang,theme})=>{localStorage.setItem('onboarded','1');localStorage.setItem('lang',lang);localStorage.setItem('theme',theme)},{lang,theme});
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);return route.abort();}
    return route.continue();
  });
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto('/');await expect(page.locator('.home-page')).toBeVisible();
  await page.locator('.hero-primary').click();await expect(page.locator('.library-toolbar')).toBeVisible();
  await page.locator('.photography-space-link').click();await expect(page.locator('.home-page')).toBeVisible();
  for(const path of ['/tools/analyze','/tools/raw','/tools/edit','/?page=raw']){
    await page.goto(path);await expect(page.locator('.editor-toolbar')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.goto('/watercolor');await expect(page.locator('.art-page')).toBeVisible();
  await page.goto('/watermark/gallery');await expect(page.locator('.app-shell .topbar')).toBeVisible();
  await page.locator('.photography-space-link').click();await expect(page.locator('.home-page')).toBeVisible();
  expect(errors).toEqual([]);expect(external).toEqual([]);
});
