import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const release=JSON.parse(readFileSync(new URL('../src/browser/windows-release.json',import.meta.url),'utf8'));

test('Windows page is independent, responsive, bilingual and links to both release downloads',async({page,context},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.goto('/windows.html');
  await expect(page.getByRole('heading',{name:'光影集， 在自己的电脑上。'})).toBeVisible();
  await expect(page.getByText(release.developer.intro,{exact:true})).toBeVisible();
  await expect(page.getByText(release.developer.qq,{exact:true})).toBeVisible();
  await expect(page.locator('.download-developer-name')).toHaveText('Wonder');
  await expect(page.locator('.download-developer-background')).toHaveText('计算机专业');
  expect(await page.locator('.download-developer-background').evaluate(e=>e.getBoundingClientRect().bottom<=document.querySelector('.download-contact').getBoundingClientRect().top)).toBe(true);
  expect(await page.locator('.download-bottom-grid').evaluate(e=>!!(e.compareDocumentPosition(document.getElementById('packages'))&Node.DOCUMENT_POSITION_PRECEDING))).toBe(true);
  expect(await page.locator('.download-developer-name').evaluate(e=>e.getBoundingClientRect().bottom<=document.querySelector('.download-contact').getBoundingClientRect().top)).toBe(true);
  await expect(page.locator('.browser-start')).toHaveCount(0);
  await expect(page.locator('.download-packages .download-version')).toContainText('v'+(release.displayVersion||release.version));
  for(const file of release.files)await expect(page.locator('.download-filename').filter({hasText:file.name})).toBeVisible();
  await page.setViewportSize({width:1440,height:1100});
  await page.screenshot({path:info.outputPath('windows-desktop-dark.png'),fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:1042,height:815});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('windows-comment-width.png'),fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:1440,height:1100});
  await page.getByRole('button',{name:'切换到浅色主题'}).click();
  await page.screenshot({path:info.outputPath('windows-desktop-light.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'切换到英文'}).click();
  await expect(page.getByRole('heading',{name:'Windows installer',exact:true})).toBeVisible();
  await expect(page.locator('.download-back')).toHaveAttribute('href','https://photomanagement.online/en/');
  await expect(page.locator('.download-back')).toHaveAttribute('target','_blank');
  await expect(page.locator('.download-back')).toContainText('(new tab)');
  await expect(page.locator('.download-footer a').last()).toHaveAttribute('href','/?local=1&lang=en#/');
  await page.setViewportSize({width:760,height:1000});
  await page.screenshot({path:info.outputPath('windows-tablet-english.png'),fullPage:true,animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();await expect(page.getByRole('heading',{name:'Windows installer',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Switch to Chinese'}).click();
  await page.getByRole('button',{name:'切换到深色主题'}).click();
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.screenshot({path:info.outputPath('windows-mobile-dark.png'),fullPage:true,animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'复制 QQ 号码'}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(release.developer.qq);
  for(const file of release.files){
    const link=page.locator(`#packages a.download-button[download="${file.name}"]`),url=release.baseUrl+file.name;
    await expect(link).toHaveAttribute('href',url);
    expect(new URL(url).origin).toBe('https://ai.photomanagement.online');
    expect(new URL(url).pathname).toBe(`/downloads/${release.displayVersion}/${file.name}`);
    const fallback=page.locator(`a.download-fallback[download="${file.name}"]`),fallbackUrl=release.fallbackBaseUrl+file.name;
    await expect(fallback).toHaveAttribute('href',fallbackUrl);
    expect(new URL(fallbackUrl).hostname).toBe('github.com');
    expect(new URL(fallbackUrl).pathname).toBe(`/wonderhate/photo-management/releases/download/v${release.version}/${file.name}`);
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    // Only exercise browser download handling with synthetic bytes; no release binaries run in tests.
    await page.route(url,route=>route.fulfill({body:'synthetic download fixture',contentType:'application/octet-stream',headers:{'Content-Disposition':`attachment; filename="${file.name}"`}}));
    const pending=page.waitForEvent('download');await link.click();const download=await pending;
    expect(download.suggestedFilename()).toBe(file.name);expect(await download.failure()).toBeNull();
    await page.route(fallbackUrl,route=>route.fulfill({body:'synthetic fallback fixture',contentType:'application/octet-stream',headers:{'Content-Disposition':`attachment; filename="${file.name}"`}}));
    const backupPending=page.waitForEvent('download');await fallback.click();const backup=await backupPending;
    expect(backup.suggestedFilename()).toBe(file.name);expect(await backup.failure()).toBeNull();
  }
  expect(await page.evaluate(async()=>{const urls=[];for(const name of await caches.keys())for(const key of await(await caches.open(name)).keys())urls.push(key.url);return urls.filter(u=>u.includes('/downloads/'));})).toEqual([]);
  expect(errors).toEqual([]);
});

test('workspace navigation opens the download page in a new tab and preserves the local library',async({page,context},info)=>{
  await context.addInitScript(()=>{
    FileSystemHandle.prototype.queryPermission=async()=> 'granted';
    FileSystemHandle.prototype.requestPermission=async()=> 'granted';
    window.showDirectoryPicker=async()=> (await navigator.storage.getDirectory()).getDirectoryHandle('download-test-library',{create:true});
    localStorage.setItem('onboarded','1');
  });
  await page.goto('/');await page.getByRole('button',{name:'新建本地图库',exact:true}).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.getByRole('button',{name:'更多功能',exact:true}).click();
  const link=page.locator('.workspace-subnav .windows-download-link');
  await expect(link).toBeInViewport();await expect(link).toHaveAttribute('href','/windows.html?local=1');await expect(link).toHaveAttribute('target','_blank');
  await expect(page.locator('.workspace-subnav .workspace-portfolio-link')).toHaveCount(0);
  const box=await link.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  await link.focus();await expect(link).toBeFocused();await expect(link).toHaveAccessibleName('Windows 版下载（新窗口）');await expect(link).toContainText('Windows 下载');
  await page.screenshot({path:info.outputPath('windows-workspace-entry.png'),animations:'disabled'});
  const manifest=()=>page.evaluate(async()=>{
    const folder=await(await navigator.storage.getDirectory()).getDirectoryHandle('download-test-library');
    return (await(await folder.getFileHandle('library.json')).getFile()).text();
  });
  const before=await manifest();
  const popup=context.waitForEvent('page');await link.click();
  const downloadPage=await popup;await downloadPage.waitForLoadState();
  await expect(downloadPage.getByRole('heading',{name:'Windows 安装版',exact:true})).toBeVisible();
  await expect(page.locator('.app-shell')).toBeVisible();
  expect(new URL(downloadPage.url()).pathname).toBe('/windows.html');
  await downloadPage.reload();await expect(downloadPage.getByText(release.developer.qq,{exact:true})).toBeVisible();
  expect(await manifest()).toBe(before);
});
