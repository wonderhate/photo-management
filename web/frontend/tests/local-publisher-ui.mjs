import {chromium,expect} from '@playwright/test';
import {createPublisher} from '../scripts/local-publisher.mjs';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const artifacts=fileURLToPath(new URL('../../.test-artifacts/publisher-ui/',import.meta.url));
await mkdir(artifacts,{recursive:true});const work=await mkdtemp(artifacts+'draft-');
let built=0;const owner=await createPublisher({port:0,work,build:async()=>{built++;return work+'/synthetic.zip';}});
const browser=await chromium.launch({channel:process.env.CI?undefined:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  const u=new URL(owner.url),auth={Authorization:'Bearer '+u.hash.slice(1)};
  for(const path of ['/about/','/en/lumina/','/sitemap.xml'])expect((await page.request.get(u.origin+path)).status()).toBe(200);
  async function saved(){await expect(page.getByText('草稿已保存在本机。',{exact:true})).toBeVisible();await expect(page.locator('#save')).toBeEnabled();}
  async function upload(button,files){const chooser=page.waitForEvent('filechooser');await button.click();await(await chooser).setFiles(files);await saved();}
  async function ownerState(){return(await(await page.request.get(u.origin+'/author/api/state',{headers:auth})).json()).catalog;}
  await page.goto(owner.url);await expect(page.getByRole('heading',{name:'更新你的视觉日记。'})).toBeVisible();
  const buffers=await page.evaluate(()=>['#154f39','#d5a240','#315fcb','#893eac'].map(color=>{const c=document.createElement('canvas');c.width=120;c.height=80;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,120,80);return c.toDataURL('image/png').split(',')[1];}));
  const files=buffers.map((data,i)=>({name:'synthetic-private-filename-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')}));
  const before=files.map(f=>createHash('sha256').update(f.buffer).digest('hex'));
  await page.getByLabel('网站名称',{exact:true}).fill('Wonder 的视觉日记');
  await upload(page.locator('#choose-files'),files.slice(0,2));await expect(page.locator('.photo')).toHaveCount(2);
  await expect(page.getByLabel('网站名称',{exact:true})).toHaveValue('Wonder 的视觉日记');
  await page.locator('.photo').first().getByLabel('标题',{exact:true}).fill('合成绿');await page.locator('.photo').last().getByLabel('标题',{exact:true}).fill('合成金');
  await page.locator('.photo').last().getByRole('button',{name:'上移',exact:true}).click();await expect(page.locator('.photo').first().getByLabel('标题',{exact:true})).toHaveValue('合成金');
  await page.locator('#save').click();await saved();await page.reload();await page.locator('#photo-details summary').click();await expect(page.locator('.photo').first().getByLabel('标题',{exact:true})).toHaveValue('合成金');

  const originalCovers=(await ownerState()).coverIds;
  await page.locator('#featured-editor .selection-card').last().getByRole('button',{name:'移除',exact:true}).click();
  await upload(page.getByRole('button',{name:'上传精选照片',exact:true}),[files[2]]);
  expect((await ownerState()).coverIds).toEqual(originalCovers);
  await page.locator('#photos .photo').nth(2).getByLabel('标题',{exact:true}).fill('合成蓝');
  await page.locator('#featured-editor .selection-card').last().getByRole('button',{name:'上移',exact:true}).click();

  await page.getByLabel('新影集名称',{exact:true}).fill('山野来信');await page.getByRole('button',{name:'新建影集',exact:true}).click();
  await upload(page.locator('.album-editor').getByRole('button',{name:'上传照片到此影集',exact:true}),[files[1],files[3]]);
  expect((await ownerState()).photos.length).toBe(4);
  await page.locator('.album-editor').getByLabel('影集名称',{exact:true}).fill('山野来信 · 更新');
  await page.locator('.album-editor').getByLabel('影集介绍',{exact:true}).fill('合成测试影集');
  await page.locator('.album-editor .selection-card').last().getByRole('button',{name:'上移',exact:true}).click();
  await page.locator('.album-editor').getByRole('combobox').selectOption({label:'合成绿'});await page.locator('.album-editor').getByRole('button',{name:'加入已上传照片',exact:true}).click();

  await page.getByLabel('新影集名称',{exact:true}).fill('城市夜色');await page.getByRole('button',{name:'新建影集',exact:true}).click();
  await page.locator('.album-editor').last().getByRole('combobox').selectOption({label:'合成蓝'});await page.locator('.album-editor').last().getByRole('button',{name:'加入已上传照片',exact:true}).click();
  await page.locator('.album-editor').last().locator(':scope > .row').getByRole('button',{name:'上移',exact:true}).click();
  await expect(page.locator('.album-editor').first().getByLabel('影集名称',{exact:true})).toHaveValue('城市夜色');
  await page.locator('.album-editor').first().getByRole('button',{name:'删除影集（保留照片）',exact:true}).click();
  await page.locator('.album-editor .selection-card').nth(1).getByRole('button',{name:'移除',exact:true}).click();
  await expect(page.locator('#photos .photo')).toHaveCount(4);
  await page.locator('.album-editor').getByRole('combobox').selectOption({label:'合成金'});await page.locator('.album-editor').getByRole('button',{name:'加入已上传照片',exact:true}).click();
  await page.locator('#cover-editor .selection-card').last().getByRole('button',{name:'移除',exact:true}).click();
  await upload(page.getByRole('button',{name:'上传轮播照片',exact:true}),[files[3]]);
  await page.locator('#save').click();await saved();
  await page.locator('nav').getByRole('button',{name:'影集',exact:true}).click();expect(page.url()).toBe(owner.url);
  await page.reload();const catalog=await ownerState();
  expect(catalog.photos.length).toBe(4);expect(catalog.coverIds.length).toBe(2);expect(catalog.featuredIds.length).toBe(2);expect(catalog.albums.length).toBe(1);
  expect(catalog.albums[0].title).toBe('山野来信 · 更新');expect(catalog.albums[0].description).toBe('合成测试影集');expect(catalog.albums[0].photoIds.length).toBe(3);
  const blue=catalog.photos.find(p=>p.title==='合成蓝');expect(catalog.featuredIds[0]).toBe(blue.id);expect(catalog.coverIds).not.toContain(blue.id);
  await expect(page.locator('.album-editor .selection-card')).toHaveCount(3);
  await page.screenshot({path:artifacts+'owner-desktop.png',fullPage:true});
  await page.locator('#build').click();await expect(page.getByText('本机预览和网站 ZIP 已就绪。',{exact:true})).toBeVisible();expect(built).toBe(1);
  await page.locator('#publish').click();await expect(page.getByRole('alert')).toContainText('请先在下方配置 EdgeOne Makers 发布 Token');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:artifacts+'owner-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

  let publicCatalog=catalog;
  await page.route('**/portfolio/manifest.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(publicCatalog)}));
  await page.route('**/portfolio/images/*',r=>{const path=new URL(r.request().url()).pathname;return publicCatalog.photos.some(p=>p.src===path||p.thumbnail===path)?r.fulfill({contentType:'image/jpeg',path:work+'/content'+path}):r.continue();});
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1440,height:1000});await page.goto(u.origin+'/');
  await expect(page.locator('.piece')).toHaveCount(2);await expect(page.locator('.piece').first()).toContainText('合成蓝');
  const cover=catalog.photos.find(p=>p.id===catalog.coverIds[0]);await expect(page.locator('.hero img')).toHaveAttribute('src',cover.src);
  await page.goto(u.origin+'/#/albums');await expect(page.locator('.public-collection')).toHaveCount(1);await expect(page.locator('.public-collection img')).toHaveAttribute('src',catalog.photos.find(p=>p.id===catalog.albums[0].photoIds[0]).thumbnail);await page.screenshot({path:artifacts+'public-curation-desktop.png',fullPage:true});
  await page.locator('.public-collection').click();await expect(page.getByRole('heading',{name:'山野来信 · 更新',exact:true})).toBeVisible();await expect(page.locator('.public-photo')).toHaveCount(3);
  await expect(page.locator('.public-photo').first()).not.toContainText('合成金');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:artifacts+'public-album-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  publicCatalog={...catalog,featuredIds:[]};await page.goto(u.origin+'/');await expect(page.locator('.piece')).toHaveCount(0);
  await page.goto(u.origin+'/#/photos');await expect(page.locator('.public-photo')).toHaveCount(4);
  expect(errors).toEqual([]);expect(files.map(f=>createHash('sha256').update(f.buffer).digest('hex'))).toEqual(before);
  expect(requests.filter(r=>!r.startsWith(u.origin)&&!r.startsWith('blob:'))).toEqual([]);
  console.log('Owner/public UI passed: separate cover and featured upload/order, album create/rename/upload/reorder/remove, existing-photo reuse, deduplication, save/reopen, section navigation/session, desktop/mobile public rendering, original hashes and no remote requests.');
}finally{await browser.close();await new Promise(r=>owner.server.close(r));}
