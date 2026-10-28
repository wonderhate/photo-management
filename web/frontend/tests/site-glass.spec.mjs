import {test,expect} from '@playwright/test';

async function material(locator){
  await expect(locator).toBeVisible();
  expect(await locator.evaluate(node=>getComputedStyle(node).backdropFilter)).toContain('blur(24px)');
}

test('public navigation and photograph information share glass and clear pointer light',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/');
  const header=page.locator('.hdr');await material(header);
  const box=await header.boundingBox();await page.mouse.move(box.x+30,box.y+30);
  await expect(header).toHaveAttribute('data-site-glass-lit','');
  expect(await header.evaluate(node=>node.style.getPropertyValue('--site-light-x'))).toBe('30px');
  const radii=(await header.evaluate(node=>getComputedStyle(node).backgroundImage)).match(/radial-gradient\((?:ellipse )?([\d.]+)px ([\d.]+)px at/);
  expect(radii).not.toBeNull();
  expect(Number(radii[1])).toBeCloseTo(420/3,2);
  expect(Number(radii[2])).toBeCloseTo(260/3,2);
  await page.mouse.move(2,200);await expect(page.locator('[data-site-glass-lit]')).toHaveCount(0);
  await page.goto('/#/photos');await page.locator('.public-photo').first().click();
  await page.getByRole('button',{name:'照片信息',exact:true}).click();
  await material(page.locator('.public-photo-info'));
  expect(await page.locator('.public-lightbox-stage img').evaluate(node=>getComputedStyle(node).filter)).toBe('none');
  await page.keyboard.press('Escape');await expect(page.locator('.public-photo').first()).toBeFocused();
  expect(errors).toEqual([]);
});

for(const [name,path,surface] of [
  ['about','/about/','.notes-contact'],
  ['project','/en/lumina/','.notes-grid article'],
  ['download','/windows.html','.download-package']
])test(`${name} uses the shared material in both themes and fits mobile screens`,async({page},info)=>{
  for(const theme of ['dark','light']){
    await page.addInitScript(value=>localStorage.setItem('theme',value),theme);
    await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(path);await material(page.locator(surface).first());
    const desktop=page.locator(surface).first();
    await desktop.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`${name}-${theme}-desktop.png`),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:info.outputPath(`${name}-${theme}-mobile.png`),fullPage:true,animations:'disabled'});
    expect(await desktop.evaluate(node=>getComputedStyle(node).color)).toBe(theme==='light'?'rgb(36, 53, 64)':'rgb(237, 243, 244)');
  }
});

test('reduced motion and higher contrast turn off pointer effects at runtime',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/windows.html');
  const header=page.locator('.download-header'),box=await header.boundingBox();
  await page.mouse.move(box.x+30,box.y+30);await expect(page.locator('[data-site-glass-lit]')).toHaveCount(0);
  expect(await page.locator('.download-button').first().evaluate(node=>getComputedStyle(node).transitionDuration)).toBe('0s');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.mouse.move(box.x+40,box.y+30);
  await expect(header).toHaveAttribute('data-site-glass-lit','');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('[data-site-glass-lit]')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'no-preference',contrast:'more'});
  expect(await header.evaluate(node=>getComputedStyle(node).backdropFilter)).toBe('none');
  await page.mouse.move(box.x+50,box.y+30);await expect(page.locator('[data-site-glass-lit]')).toHaveCount(0);
});

test('the offline shell includes the glass assets without caching photographs',async({browser})=>{
  const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage();
  try{
    await page.goto('http://127.0.0.1:4186/');await page.evaluate(()=>navigator.serviceWorker.ready);
    const paths=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys())for(const request of await(await caches.open(name)).keys())result.push(new URL(request.url).pathname);return result;});
    expect(paths).toContain('/site-glass.css');expect(paths).toContain('/site-glass.js');
    expect(paths.some(path=>path.startsWith('/portfolio/'))).toBe(false);
  }finally{await context.close();}
});
