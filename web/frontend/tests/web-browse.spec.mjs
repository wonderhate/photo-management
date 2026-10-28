import {browserApiModule} from './fixtures/browser-api-module.mjs';
import {test,expect} from '@playwright/test';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const assets=fileURLToPath(new URL('../dist-web/assets/',import.meta.url));
const apiModule=browserApiModule(assets);
const libraryPrompt='导入照片前，选择本地图库';

test.beforeEach(async({context})=>{
  // OPFS is isolated to this test context. No fixture directory is made until
  // a test explicitly creates a photograph or the user chooses a library.
  await context.addInitScript(async()=>{
    if(location.origin!=='http://127.0.0.1:4185')return;
    const root=await navigator.storage.getDirectory();
    window.__browseFixture={root,pickers:0,permissions:0,cancel:false};
    FileSystemHandle.prototype.queryPermission=async()=> 'granted';
    FileSystemHandle.prototype.requestPermission=async()=>{window.__browseFixture.permissions++;return 'granted';};
    window.showDirectoryPicker=async({mode})=>{
      const fixture=window.__browseFixture;fixture.pickers++;
      if(fixture.cancel)throw new DOMException('Synthetic folder selection cancelled','AbortError');
      return fixture.root.getDirectoryHandle(mode==='readwrite'?'browse-library':'browse-originals',{create:true});
    };
  });
});

async function call(page,path,method='GET',body){
  return page.evaluate(async({module,path,method,body})=>(await import(module)).browserAPI(path,method,body),{module:apiModule,path,method,body});
}
async function start(page){
  await page.goto('/');await page.waitForFunction(()=>!!window.__browseFixture);
  await expect(page.getByRole('button',{name:'跳过，先浏览',exact:true})).toBeEnabled();
}
async function skip(page){await start(page);await page.getByRole('button',{name:'跳过，先浏览',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();}
async function navigate(page,name){
  await page.locator('.workspace-subnav').getByRole('button',{name,exact:true}).click();
}
function importButton(page){return page.locator('.topbar-actions').getByRole('button',{name:'导入照片',exact:true});}
async function rootEntries(page){return page.evaluate(async()=>{const names=[];for await(const entry of window.__browseFixture.root.values())names.push(entry.name);return names.sort();});}
async function manifestText(page){return page.evaluate(async()=>{const data=await window.__browseFixture.root.getDirectoryHandle('browse-library');return (await(await data.getFileHandle('library.json')).getFile()).text();});}
async function originalHash(page){return page.evaluate(async()=>{const folder=await window.__browseFixture.root.getDirectoryHandle('browse-originals'),file=await(await folder.getFileHandle('first-frame.png')).getFile();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].join(',');});}
async function photograph(page){
  return page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=320;
    const brush=canvas.getContext('2d');brush.fillStyle='#356b87';brush.fillRect(0,0,480,320);brush.fillStyle='#efcc85';brush.fillRect(70,55,210,145);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const originals=await window.__browseFixture.root.getDirectoryHandle('browse-originals',{create:true});
    const stream=await(await originals.getFileHandle('first-frame.png',{create:true})).createWritable();await stream.write(blob);await stream.close();
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
}

test('skipping allows empty-library browsing without directory permission, writes or onboarding',async({page})=>{
  const requests=[],errors=[];
  page.on('request',request=>requests.push({url:request.url(),method:request.method()}));page.on('pageerror',error=>errors.push(error.message));
  await skip(page);
  await expect(page.getByRole('heading',{name:'欢迎来到光影集',exact:true})).toHaveCount(0);
  await expect(page.locator('.workspace-subnav')).toBeVisible();
  await expect(page.getByRole('navigation',{name:'工作区导航',exact:true})).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'打开导航',exact:true})).toHaveCount(0);
  await expect(page.locator('.showcase-hero')).toBeVisible();
  await navigate(page,'创作工具');await expect(page.locator('.tools-page')).toBeVisible();
  let fileChoosers=0;page.on('filechooser',()=>fileChoosers++);
  await page.locator('.studio-tool').filter({has:page.getByRole('heading',{name:'光影暗房',exact:true})}).click();
  await expect(page.locator('.editor-page')).toBeVisible();await page.getByRole('button',{name:'打开照片 / RAW',exact:true}).click();
  const toolPrompt=page.getByRole('dialog',{name:'选择本地图库',exact:true});await expect(toolPrompt).toBeVisible();
  expect(fileChoosers).toBe(0);await page.keyboard.press('Escape');await expect(toolPrompt).toHaveCount(0);
  await navigate(page,'照片');await expect(page.getByRole('heading',{name:/^所有照片/})).toBeVisible();
  // The integrated App owns its own material: these are one third of the
  // original 240 x 160px panel-light radii, independent of the public-site CSS.
  expect(await page.locator('.topbar').evaluate(node=>getComputedStyle(node).backgroundImage)).toMatch(/radial-gradient\((?:ellipse )?80px 53\.3333px\b/);
  await expect(page.locator('.photo-card')).toHaveCount(0);
  expect(await call(page,'/photos/by-ids','POST',{ids:[]})).toEqual({photos:[]});
  for(const [name,content] of [['影集','.albums-page'],['统计','.analysis-page .charts-grid'],['摄影报告','.report-hero'],['设置','.settings-page']]){
    await navigate(page,name);await expect(page.locator(content)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(()=>window.__browseFixture.pickers)).toBe(0);
  }
  // Calling a mutating local API directly must also request a real library,
  // without changing the in-memory browse model or creating a directory.
  await expect(call(page,'/albums','POST',{name:'must-not-save-in-preview',photo_ids:[]})).rejects.toThrow(/请先打开本地图库/);
  const savePrompt=page.getByRole('dialog',{name:'选择本地图库',exact:true});await expect(savePrompt).toBeVisible();
  await savePrompt.getByRole('button',{name:'继续浏览',exact:true}).click();await expect(savePrompt).toHaveCount(0);
  expect(await call(page,'/albums')).toEqual([]);
  expect(await rootEntries(page)).toEqual([]);
  expect(await page.evaluate(()=>({pickers:window.__browseFixture.pickers,permissions:window.__browseFixture.permissions}))).toEqual({pickers:0,permissions:0});
  expect(requests.filter(request=>request.method!=='GET'||request.url.includes('/api/')||request.url.startsWith('http')&&!request.url.startsWith('http://127.0.0.1:4185'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('import requests can be dismissed and repeated, and a cancelled folder picker keeps the choice open',async({page})=>{
  await skip(page);const trigger=importButton(page);
  await trigger.click();let prompt=page.getByRole('dialog',{name:libraryPrompt,exact:true});await expect(prompt).toBeVisible();
  await prompt.getByRole('button',{name:'继续浏览',exact:true}).click();await expect(prompt).toHaveCount(0);await expect(trigger).toBeFocused();
  await trigger.click();prompt=page.getByRole('dialog',{name:libraryPrompt,exact:true});
  await page.evaluate(()=>window.__browseFixture.cancel=true);
  await prompt.getByRole('button',{name:'新建本地图库',exact:true}).click();
  await expect(prompt.getByRole('alert')).toContainText('未选择文件夹');await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('button',{name:'从上一份元数据恢复（保留损坏文件）'})).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(prompt).toHaveCount(0);await expect(trigger).toBeFocused();
  expect(await rootEntries(page)).toEqual([]);
  await trigger.click();await expect(page.getByRole('dialog',{name:libraryPrompt,exact:true})).toBeVisible();
});

test('choosing a new library resumes file import, persists it and preserves the synthetic original',async({page})=>{
  await skip(page);const bytes=await photograph(page),before=await originalHash(page);
  await importButton(page).click();await page.getByRole('dialog',{name:libraryPrompt}).getByRole('button',{name:'新建本地图库',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'导入你的照片',exact:true});await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading',{name:'欢迎来到光影集',exact:true})).toHaveCount(0);
  await dialog.locator('input[type=file]').setInputFiles({name:'first-frame.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
  await expect(dialog).toContainText('已选择 1 张照片');await dialog.getByRole('button',{name:'开始导入',exact:true}).click();
  await expect.poll(async()=>{const jobs=await call(page,'/jobs');return jobs[0]?.status;},{timeout:20000}).toBe('completed');
  expect((await call(page,'/photos')).total).toBe(1);
  const stored=JSON.parse(await manifestText(page));expect(stored.photos).toHaveLength(1);expect(stored.photos[0].managed_path).toMatch(/^photos\//);
  expect(await originalHash(page)).toBe(before);
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();await expect(page.locator('.browser-start')).toHaveCount(0);
  expect((await call(page,'/photos')).total).toBe(1);expect(await originalHash(page)).toBe(before);
});

test('opening an existing library after skipping resumes import and keeps its saved records',async({page})=>{
  await start(page);await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const onboarding=page.getByRole('dialog',{name:'欢迎来到光影集',exact:true});if(await onboarding.isVisible())await onboarding.getByRole('button',{name:'开始使用',exact:true}).click();
  await call(page,'/albums','POST',{name:'合成既有影集',photo_ids:[]});const before=await manifestText(page);
  await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('photocollection-browser-handles');request.onsuccess=resolve;request.onerror=reject;}));
  await page.reload();await page.getByRole('button',{name:'跳过，先浏览',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  await importButton(page).click();await page.getByRole('dialog',{name:libraryPrompt}).getByRole('button',{name:'打开本地图库或备份',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'导入你的照片',exact:true})).toBeVisible();
  expect((await call(page,'/albums'))[0].name).toBe('合成既有影集');expect(await manifestText(page)).toBe(before);
});

test('English skip and library prompt fit narrow screens and preserve keyboard focus',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await start(page);
  await page.locator('.browser-start-card select').selectOption('en');
  const skipButton=page.getByRole('button',{name:'Skip for now',exact:true});await skipButton.focus();await page.keyboard.press('Enter');
  await expect(page.locator('.app-shell')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const trigger=page.locator('.topbar-actions').getByRole('button',{name:'Import Photos',exact:true});await trigger.focus();await page.keyboard.press('Enter');
  const prompt=page.getByRole('dialog',{name:'Choose a library before importing',exact:true});await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('button',{name:'New local library',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const controls=prompt.locator('button');await controls.last().focus();await page.keyboard.press('Tab');await expect(controls.first()).toBeFocused();
  await page.keyboard.press('Escape');await expect(prompt).toHaveCount(0);await expect(trigger).toBeFocused();
  expect(await rootEntries(page)).toEqual([]);
});
