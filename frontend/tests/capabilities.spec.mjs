import {test,expect} from './fixtures/native-runtime.mjs';

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`read-only capability panel and local setup actions ${width} ${lang}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.addInitScript(lang=>{localStorage.setItem('onboarded','1');localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);
  const forbidden=[],errors=[];let checks=0;page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/workspace/capabilities'))checks++;if(r.method()==='POST'&&/\/api\/(?:ai\/load|faces\/(?:models|analyze)|art\/(?:generate|titles|batch))/.test(r.url()))forbidden.push(r.url());});
  await page.goto('/?page=settings');const panel=page.locator('.capability-panel');await expect(panel).toBeVisible();expect(checks).toBe(0);
  await panel.locator('summary').click();await expect(panel.locator('[data-capability]')).toHaveCount(11);
  await expect(panel.locator('[data-capability=raw]')).toHaveAttribute('data-state','degraded');await expect(panel.locator('[data-capability=raw]')).toHaveAttribute('data-runnable','true');
  await panel.getByRole('button',{name:lang==='en'?'Refresh status':'刷新状态',exact:true}).click();await expect.poll(()=>checks).toBe(2);
  expect(forbidden).toEqual([]);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(lang==='en')expect(await panel.innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await panel.screenshot({path:info.outputPath('capabilities.png')});
  const setup=panel.getByRole('button',{name:lang==='en'?'Local model settings':'本地模型设置',exact:true});if(await setup.count()){await setup.click();await expect(page.locator('#local-model-settings')).toBeInViewport();}
  expect(forbidden).toEqual([]);
});

test('malformed capability response is contained and an explicit refresh recovers',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('onboarded','1'));const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/workspace/capabilities',route=>route.fulfill({json:{version:999}}));await page.goto('/?page=settings');
  const panel=page.locator('.capability-panel');await panel.locator('summary').click();await expect(panel.getByRole('alert')).toBeVisible();await expect(page.locator('.workspace-subnav')).toBeVisible();
  await page.unroute('**/api/workspace/capabilities');await panel.getByRole('button',{name:'刷新状态',exact:true}).click();await expect(panel.locator('[data-capability]')).toHaveCount(11);expect(errors).toEqual([]);
});
