import {test,expect} from './fixtures/native-runtime.mjs';
import {synthetic,photos} from './fixtures/workspace.mjs';

test('comparison remembers linking across immediate navigation and reload without restoring pan or zoom',async({page})=>{
  const {errors}=await synthetic(page,{reducedMotion:'reduce'});await page.goto('/compare?ids=frame-0,frame-1');
  const sync=page.getByRole('button',{name:'同步视图',exact:true}),stages=page.locator('.compare-stage');await expect(stages).toHaveCount(2);
  await sync.click();await expect(sync).toHaveAttribute('aria-pressed','false');
  await page.locator('.workspace-subnav').getByRole('button',{name:'照片',exact:true}).click();
  await page.evaluate(()=>{history.pushState({},'','/compare?ids=frame-0,frame-1');dispatchEvent(new PopStateEvent('popstate'));});
  await expect(sync).toHaveAttribute('aria-pressed','false');
  await expect.poll(()=>stages.locator('img').evaluateAll(images=>images.length===2&&images.every(img=>img.complete&&img.naturalWidth>0&&parseFloat(img.style.width)>0))).toBe(true);
  const box=await stages.first().boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-400);await expect.poll(async()=>Number(await stages.first().getAttribute('data-zoom'))).toBeGreaterThan(1);
  await page.reload();await expect(sync).toHaveAttribute('aria-pressed','false');
  await expect(stages.first()).toHaveAttribute('data-zoom','1');await expect(stages.last()).toHaveAttribute('data-focus-x','0.5');expect(errors).toEqual([]);
});

for(const [width,lang,theme] of [[1440,'zh','dark'],[390,'en','light']])test(`multi-photo comparison links relative zoom and pan with optional independent views ${width} ${lang}`,async({page},info)=>{
  const {errors}=await synthetic(page,{width,lang,theme,reducedMotion:'reduce'});await page.goto('/compare?ids=frame-0,frame-1');
  const cards=page.locator('.compare-item'),first=cards.nth(0).locator('.compare-stage'),second=cards.nth(1).locator('.compare-stage'),sync=page.getByRole('button',{name:lang==='en'?'Sync views':'同步视图',exact:true});
  await expect(cards).toHaveCount(2);await expect.poll(()=>cards.locator('img').evaluateAll(images=>images.every(img=>img.naturalWidth>0&&parseFloat(img.style.width)>0))).toBe(true);
  for(const card of [cards.nth(0),cards.nth(1)]){const ratio=await card.locator('img').evaluate(img=>{const r=img.getBoundingClientRect();return Math.abs(r.width/r.height-img.naturalWidth/img.naturalHeight);});expect(ratio).toBeLessThan(.001);await expect(card.locator('.exif-grid')).toContainText('TEST CAMERA');}
  await expect(sync).toHaveAttribute('aria-pressed','true');const stage=await first.boundingBox(),x=stage.x+stage.width/2,y=stage.y+stage.height/2;await page.mouse.move(x,y);await page.mouse.wheel(0,-1000);await expect.poll(async()=>Number(await first.getAttribute('data-zoom'))).toBeGreaterThan(4);
  expect(await second.getAttribute('data-zoom')).toBe(await first.getAttribute('data-zoom'));const before=await first.locator('img').boundingBox();await page.mouse.down();await page.mouse.move(x+30,y+20,{steps:3});await page.mouse.up();const after=await first.locator('img').boundingBox();expect(Math.abs(after.x-before.x-30)).toBeLessThan(1);expect(Math.abs(after.y-before.y-20)).toBeLessThan(1);
  const centers=await cards.locator('.compare-stage').evaluateAll(nodes=>nodes.map(node=>{const a=node.getBoundingClientRect(),b=node.querySelector('img').getBoundingClientRect();return[(a.x+a.width/2-b.x)/b.width,(a.y+a.height/2-b.y)/b.height];}));expect(Math.abs(centers[0][0]-centers[1][0])).toBeLessThan(.001);expect(Math.abs(centers[0][1]-centers[1][1])).toBeLessThan(.001);
  await sync.click();await expect(sync).toHaveAttribute('aria-pressed','false');const unchanged=await second.getAttribute('data-zoom');await cards.first().getByRole('button',{name:'FRAME_00.jpg',exact:true}).click();await page.getByRole('button',{name:lang==='en'?'Zoom In':'放大',exact:true}).click();expect(await second.getAttribute('data-zoom')).toBe(unchanged);expect(Number(await first.getAttribute('data-zoom'))).toBeGreaterThan(Number(unchanged));
  await first.focus();const fx=Number(await first.getAttribute('data-focus-x'));await page.keyboard.press('ArrowRight');await expect.poll(async()=>Number(await first.getAttribute('data-focus-x'))).toBeGreaterThan(fx);await expect(first).toBeFocused();
  await sync.click();expect(await first.getAttribute('data-zoom')).toBe(await second.getAttribute('data-zoom'));expect(await first.getAttribute('data-focus-x')).toBe(await second.getAttribute('data-focus-x'));
  await page.getByRole('button',{name:lang==='en'?'Align centers':'居中对齐',exact:true}).click();await expect(first).toHaveAttribute('data-focus-x','0.5');await expect(second).toHaveAttribute('data-focus-y','0.5');
  await page.getByRole('button',{name:lang==='en'?'Fit views':'适应窗口',exact:true}).click();await expect(first).toHaveAttribute('data-zoom','1');await expect(second).toHaveAttribute('data-zoom','1');await page.screenshot({path:info.outputPath('compare-linked.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await cards.first().getByRole('button',{name:lang==='en'?'Remove':'移除',exact:true}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(/page=photos/);expect(errors).toEqual([]);
});

test('comparison preserves deep links, limits requests to four and ignores a stale response',async({page})=>{
  const {errors}=await synthetic(page);let release,requested;const blocked=new Promise(resolve=>release=resolve),started=new Promise(resolve=>requested=resolve);
  await page.route('**/api/compare?**',async route=>{const ids=new URL(route.request().url()).searchParams.get('ids').split(',');if(ids[0]==='frame-0'){requested();await blocked;}await route.fulfill({json:{photos:ids.map(id=>photos.find(photo=>photo.id===id)).filter(Boolean)}}).catch(()=>{});});
  await page.goto('/compare?ids=frame-0,frame-1');await started;
  await page.evaluate(()=>{history.pushState({},'','/compare?ids=frame-2,frame-3,frame-4,frame-5,frame-6');dispatchEvent(new PopStateEvent('popstate'));});
  const cards=page.locator('.compare-item');await expect(cards).toHaveCount(4);await expect(cards.first().locator('.compare-select')).toHaveText('FRAME_02.jpg');release();await expect(cards.first().locator('.compare-select')).toHaveText('FRAME_02.jpg');
  await cards.first().getByRole('button',{name:'移除',exact:true}).focus();await page.keyboard.press('Enter');await expect(cards).toHaveCount(3);await expect(cards.first().locator('.compare-select')).toHaveAttribute('aria-pressed','true');await cards.first().getByRole('button',{name:'移除',exact:true}).focus();await page.keyboard.press('Enter');await expect(cards).toHaveCount(2);await expect(page).toHaveURL(/\/compare\?ids=/);expect(errors).toEqual([]);
});
