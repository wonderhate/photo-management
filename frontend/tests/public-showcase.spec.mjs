import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
const catalog=JSON.parse(readFileSync(new URL('../dist-showcase/portfolio/manifest.json',import.meta.url),'utf8'));
async function readyImages(page){for(const img of await page.locator('.public-image img').all()){await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);}await page.evaluate(()=>scrollTo(0,0));}

test('anonymous visitors browse, search, open collections and deep-linked photographs',async({page},info)=>{
  expect(existsSync(new URL('../dist-showcase/private-test.txt',import.meta.url))).toBe(false);
  expect(readdirSync(new URL('../dist-showcase/portfolio/images/',import.meta.url)).sort()).toEqual([...new Set(catalog.photos.flatMap(p=>[p.src,p.thumbnail]).map(p=>p.split('/').at(-1)))].sort());
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.addInitScript(()=>{window.__directoryPrompts=0;window.showDirectoryPicker=()=>{window.__directoryPrompts++;throw Error('Public visitors must not need directory access');};});
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');await expect(page.locator('.public-hero')).toBeVisible();await expect(page.locator('.public-photo')).toHaveCount(2);
  await readyImages(page);const cards=await page.locator('.public-photo').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().x));expect(cards[1]).toBeGreaterThan(cards[0]);await page.screenshot({path:info.outputPath('public-home-desktop.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'作品',exact:true}).click();await expect(page).toHaveURL(/#\/photos$/);
  await page.getByRole('searchbox').fill('山间');await expect(page.locator('.public-photo')).toHaveCount(1);await page.getByRole('searchbox').fill('不存在的标签');await expect(page.getByText('没有匹配的作品')).toBeVisible();await page.getByRole('searchbox').fill('');
  await page.screenshot({path:info.outputPath('public-gallery-desktop.png'),fullPage:true,animations:'disabled'});await page.locator('.public-photo').first().click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page).toHaveURL(/photo=frame-0001/);
  await page.keyboard.press('ArrowRight');await expect(page.getByRole('dialog').getByRole('heading',{name:'暮色之下',exact:true})).toBeVisible();await page.getByRole('button',{name:'照片信息',exact:true}).click();await page.getByRole('button',{name:'放大照片'}).click();await expect(page.locator('.public-lightbox-stage')).toHaveClass(/is-zoomed/);await page.getByRole('button',{name:'缩小至适合窗口'}).click();await page.screenshot({path:info.outputPath('public-lightbox-desktop.png')});
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.public-photo').first()).toBeFocused();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'影集',exact:true}).click();await page.locator('.public-collection').click();await expect(page.locator('.public-photo')).toHaveCount(2);await page.reload();await expect(page.getByRole('heading',{name:'山野来信',exact:true})).toBeVisible();
  await page.goto('/#/photos?photo=frame-0001');await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page).toHaveURL(/#\/photos$/);
  await page.goto('/#/photos?photo=missing');await expect(page.getByText('这张照片尚未发布或已移除。')).toBeVisible();await page.getByRole('button',{name:'继续浏览'}).click();
  expect(await page.evaluate(()=>window.__directoryPrompts)).toBe(0);expect(errors).toEqual([]);expect(requests.filter(r=>r.method!=='GET'||!r.url.startsWith('http://127.0.0.1:4176')||r.url.includes('/api/'))).toEqual([]);
});

test('mobile, English, light theme, reduced motion and keyboard focus work',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await expect(page.locator('.public-photo')).toHaveCount(2);await readyImages(page);await page.screenshot({path:info.outputPath('public-home-mobile.png'),fullPage:true,animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'播放封面轮播'})).toHaveCount(0);
  await page.locator('.public-photo').first().click();const d=page.getByRole('dialog');await expect(d).toBeVisible();await page.screenshot({path:info.outputPath('public-lightbox-mobile.png')});await page.getByRole('button',{name:'关闭照片'}).focus();await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('dialog'))).toBe(true);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'切换到英文'}).click();await page.getByRole('button',{name:'Switch to light theme'}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Collections',exact:true}).click();await page.reload();await expect(page.getByRole('heading',{name:'Collections',exact:true})).toBeVisible();await expect(page.locator('.public-site')).toHaveAttribute('data-theme','light');await page.screenshot({path:info.outputPath('public-collections-light-en-mobile.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('link',{name:'Creative tools',exact:true}).click();await expect(page.getByRole('heading',{name:'Lumina · Browser Local Library'})).toBeVisible();
});

test('loading, failure, empty catalog and broken images have recoverable states',async({page})=>{
  let release;const hold=new Promise(r=>release=r);let fail=true;
  await page.route('**/portfolio/manifest.json',async r=>{await hold;await r.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(catalog)});});
  await page.goto('/');await expect(page.getByText('正在展开光影…')).toBeVisible();release();await expect(page.getByRole('alert')).toContainText('暂时无法读取作品');fail=false;await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.locator('.public-photo')).toHaveCount(2);
  await page.unroute('**/portfolio/manifest.json');await page.route('**/portfolio/manifest.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({...catalog,photos:[],albums:[],featuredIds:[]})}));await page.reload();await expect(page.getByText('这里还没有发布照片。欢迎稍后再来。')).toBeVisible();await expect(page.getByRole('button',{name:'新建本地图库'})).toHaveCount(0);
  await page.unroute('**/portfolio/manifest.json');await page.route('**/portfolio/images/**',r=>r.fulfill({status:404,body:''}));await page.goto('/#/photos');await page.reload();await expect(page.locator('.public-gallery .public-image-error')).toHaveCount(2);await page.locator('.public-photo').first().click();await page.getByRole('button',{name:'照片信息',exact:true}).click();await page.unroute('**/portfolio/images/**');await page.getByRole('button',{name:'重新加载图片'}).click();await expect.poll(()=>page.locator('.public-lightbox-stage img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
});

test('service worker never stores public photographs or the mutable manifest',async({browser})=>{
  const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage();
  try{await page.goto('http://127.0.0.1:4176/');await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await expect(page.locator('.public-photo')).toHaveCount(2);const paths=await page.evaluate(async()=>{const urls=[];for(const k of await caches.keys())for(const r of await(await caches.open(k)).keys())urls.push(new URL(r.url).pathname);return urls;});expect(paths.some(p=>p.startsWith('/portfolio/'))).toBe(false);}finally{await context.close();}
});
