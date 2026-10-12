import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Uses only backend.verify_remote_server's synthetic, isolated library.
const base='http://127.0.0.1:8012',out=path.resolve('../verification/remote');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},userAgent:'PhotoCollectionRemote/2 Chrome',isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(String(error)));
try{
  await context.request.post(base+'/api/remote/connect',{data:{code:'12345678'}});
  await page.goto(base,{waitUntil:'networkidle'});
  await page.locator('.archive-hero h1').waitFor();
  await page.getByRole('button',{name:'进入照片库',exact:true}).click();
  await page.locator('.photo-card').first().waitFor();
  assert.equal(await page.locator('.mobile-nav button').count(),5);
  assert.equal(await page.locator('.sidebar').isVisible(),false);
  assert.equal(await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(r=>r.length)),0);
  const image=await context.request.get(new URL(await page.locator('.photo-image img').first().getAttribute('src'),base).href);
  assert.match(image.headers()['cache-control'],/no-store/);
  await page.screenshot({path:path.join(out,'gallery.png')});
  const urls=['/?page=albums','/?page=smart','/timeline','/faces','/?page=stats','/?page=reports','/watermark/gallery','/?page=settings'];
  for(const url of urls){
    await page.goto(base+url,{waitUntil:'networkidle'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Horizontal overflow at '+url);
  }
  await page.screenshot({path:path.join(out,'my.png')});
  for(const width of [360,430]){
    await page.setViewportSize({width,height:844});
    await page.goto(base+'/?page=photos',{waitUntil:'networkidle'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Gallery overflow at '+width);
  }
  await page.locator('.photo-image').first().click();
  await page.locator('.photo-detail').waitFor();
  await page.getByRole('button',{name:'照片信息',exact:true}).click();
  await page.getByRole('button',{name:'制作水印',exact:true}).click();
  await page.locator('.render-stage img').waitFor();
  await page.getByLabel('水印作品名称').fill('Chromium remote draft');
  await page.getByRole('button',{name:'保存到水印图库',exact:true}).click();
  await page.waitForURL(/draft=/);
  const draftId=new URL(page.url()).searchParams.get('draft');
  const saved=await context.request.get(base+'/api/watermark/drafts/'+draftId);
  assert.equal((await saved.json()).name,'Chromium remote draft');
  await page.screenshot({path:path.join(out,'editor.png')});
  await page.reload({waitUntil:'networkidle'});
  await page.locator('.render-stage img').waitFor();
  assert.equal(await page.getByLabel('水印作品名称').inputValue(),'Chromium remote draft');
  await page.locator('.mobile-nav').getByRole('button',{name:'照片',exact:true}).click();
  await page.locator('.photo-image').first().click();
  await page.locator('.photo-detail').waitFor();
  const favorite=page.locator('.viewer-toolbar').getByRole('button',{name:/^收藏 /});
  const pressed=await favorite.getAttribute('aria-pressed');
  await context.setOffline(true);
  await favorite.click();
  await page.locator('.toast').filter({hasText:'操作未保存'}).waitFor();
  assert.equal(await favorite.getAttribute('aria-pressed'),pressed);
  await context.setOffline(false);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('remote-index:')&&/data:image|blob:/.test(localStorage.getItem(k)))),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile gallery + 8 pages, 360/390/430 widths, server drafts/restoration, index-only storage, offline writes rejected. Screenshots: '+out);
}finally{await browser.close()}
