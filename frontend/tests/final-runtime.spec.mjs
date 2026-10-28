import {test,expect} from './fixtures/native-runtime.mjs';

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
