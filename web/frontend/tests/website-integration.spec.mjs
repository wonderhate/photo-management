import {test,expect} from '@playwright/test';
import {readdirSync,readFileSync} from 'node:fs';

test('the original portfolio opens the upgraded app and its download without losing the workspace',async({page,context})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.locator('.hero')).toBeVisible();
  await expect(page.locator('.public-site')).toHaveCount(1);
  await page.locator('.hero .btn-ghost').click();
  await expect(page).toHaveURL(/local=1/);
  await page.getByRole('button',{name:'跳过，先浏览',exact:true}).click();
  await expect(page.locator('.workspace-subnav')).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-material','liquid-glass');
  await page.locator('.topbar').hover({position:{x:24,y:24}});
  await expect(page.locator('.topbar')).toHaveAttribute('data-glass-lit','pointer');
  const radii=await page.locator('.topbar').evaluate(node=>getComputedStyle(node).backgroundImage);
  expect(radii).toMatch(/80px 53\.3333px at/);
  await expect(page.locator('.public-site')).toHaveCount(0);
  const popup=context.waitForEvent('page');
  await page.locator('.workspace-subnav .windows-download-link').click();
  const download=await popup;await download.waitForLoadState();
  await expect(download.locator('.download-package')).toHaveCount(3);
  expect(await download.locator('.download-header').evaluate(node=>getComputedStyle(node).backgroundImage)).toMatch(/140px 86\.6667px at/);
  await expect(page.locator('.app-shell')).toBeVisible();
  expect(errors).toEqual([]);
});

test('English portfolio entry retains delayed library choice in the upgraded app',async({page})=>{
  await page.addInitScript(()=>{window.__directoryPrompts=0;window.showDirectoryPicker=async()=>{window.__directoryPrompts++;throw new DOMException('Synthetic cancelled picker','AbortError');};});
  await page.goto('/en/');await page.locator('.hero .btn-ghost').click();
  await page.getByRole('button',{name:'Skip for now',exact:true}).click();
  await expect(page.locator('.workspace-subnav')).toBeVisible();
  const trigger=page.locator('.topbar-actions').getByRole('button',{name:'Import Photos',exact:true});
  await trigger.click();
  const prompt=page.getByRole('dialog',{name:'Choose a library before importing',exact:true});
  await expect(prompt).toBeVisible();
  expect(await page.evaluate(()=>window.__directoryPrompts)).toBe(0);
  await page.keyboard.press('Escape');await expect(prompt).toHaveCount(0);await expect(trigger).toBeFocused();
  const home=page.locator('.workspace-subnav a[href="/en/"]');
  await expect(home).toBeVisible();await home.click();
  await expect(page).toHaveURL(/\/en\/$/);await expect(page.locator('.public-site')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-material','liquid-glass');
});

test('the integrated static build serves private-media support and narrowly scoped WASM headers',async({request})=>{
  const worker=(await request.get('/sw.js')).text();
  expect(await worker).toContain("u.pathname.startsWith('/_pc-file/')");
  expect((await request.get('/local-file-worker.js')).status()).toBe(200);
  expect((await request.get('/maps/land-110m.json')).status()).toBe(200);
  const assets=readdirSync(new URL('../dist-showcase/assets/',import.meta.url));
  const vision=assets.find(name=>/^vision-worker-.*\.js$/.test(name));expect(vision).toBeTruthy();
  const response=await request.get('/assets/'+vision);
  expect(response.headers()['content-security-policy']).toContain("'wasm-unsafe-eval'");
  expect((await request.get('/')).headers()['content-security-policy']).not.toContain("'wasm-unsafe-eval'");
  expect((await request.get('/')).headers()['content-security-policy']).toContain("media-src 'self' blob:");
  const module=assets.find(name=>name.endsWith('.mjs'));expect(module).toBeTruthy();
  const hosting=JSON.parse(readFileSync(new URL('../dist-showcase/edgeone.json',import.meta.url),'utf8'));
  for(const name of assets.filter(name=>/\.(mjs|wasm)$/.test(name))){
    const type=hosting.headers.find(rule=>rule.source==='/assets/'+name)?.headers.find(header=>header.key==='Content-Type')?.value;
    expect(type).toContain(name.endsWith('.mjs')?'text/javascript':'application/wasm');
  }
  expect((await request.get('/assets/'+module)).headers()['content-type']).toContain('text/javascript');
});
