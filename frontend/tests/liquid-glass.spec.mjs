import {test,expect} from './fixtures/native-runtime.mjs';
import {synthetic} from './fixtures/workspace.mjs';

// UI-only checks use synthetic landscapes or a canvas-created PNG. No personal
// library, source photo, model download, or cloud generation is involved.
async function expectGlass(surface){
  await expect(surface).toBeVisible();
  await expect.poll(()=>surface.evaluate(element=>{
    const style=getComputedStyle(element);
    return style.backdropFilter||style.webkitBackdropFilter||'none';
  })).toMatch(/blur\(/);
  await expect(surface).toHaveCSS('opacity','1');
}

async function expectSolid(surface){
  await expect(surface).toBeVisible();
  await expect.poll(()=>surface.evaluate(element=>{
    const style=getComputedStyle(element),canvas=document.createElement('canvas');
    canvas.width=canvas.height=1;
    const context=canvas.getContext('2d');context.fillStyle=style.backgroundColor;context.fillRect(0,0,1,1);
    return {filter:style.backdropFilter||style.webkitBackdropFilter||'none',alpha:context.getImageData(0,0,1,1).data[3]};
  })).toEqual({filter:'none',alpha:255});
}

async function readyGallery(page,options){
  const fixture=await synthetic(page,options);
  await page.goto('/?page=photos');
  await expect(page.locator('html')).toHaveAttribute('data-material','liquid-glass');
  await expect(page.locator('.photo-card').first()).toBeVisible();
  return fixture;
}

for(const theme of ['light','dark'])test(`liquid glass ${theme} covers navigation, information and dialogs`,async({page},info)=>{
  const {errors}=await readyGallery(page,{theme});
  await expectGlass(page.locator('.workspace-subnav'));
  await expectGlass(page.locator('.topbar'));
  const originalImage=page.locator('.photo-image img.loaded').first();
  await expect(originalImage).toBeVisible();
  // The existing progressive preview fades from its loading blur after load.
  await expect(originalImage).toHaveCSS('filter','none');
  expect(await originalImage.evaluate(image=>{
    const style=getComputedStyle(image);
    return {filter:style.filter,backdrop:style.backdropFilter||style.webkitBackdropFilter||'none'};
  })).toEqual({filter:'none',backdrop:'none'});

  const opener=page.getByRole('button',{name:'显示照片信息',exact:true});
  await opener.focus();await page.keyboard.press('Enter');
  const inspector=page.locator('.photo-inspector');
  await expectGlass(inspector);
  await expect(inspector.locator('.inspector-file-name')).toHaveText('FRAME_00.jpg');
  await page.screenshot({path:info.outputPath(`glass-inspector-${theme}.png`)});
  await inspector.getByRole('button',{name:'关闭照片信息',exact:true}).click();

  await page.getByRole('button',{name:'导入照片',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'导入你的照片',exact:true});
  await expectGlass(modal);
  await modal.getByRole('button',{name:'关闭',exact:true}).click();

  await page.locator('.photo-card .photo-image').first().dblclick();
  await expect(page.locator('.photo-viewer')).toBeVisible();
  await expectGlass(page.locator('.viewer-toolbar'));
  await page.locator('.viewer-toolbar').getByRole('button',{name:'照片信息',exact:true}).click();
  await expectGlass(page.locator('.photo-detail>aside'));
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('liquid glass light follows the pointer on the nearest control and surface',async({page})=>{
  const {errors}=await readyGallery(page,{theme:'dark'});
  const nav=page.locator('.workspace-subnav'),button=nav.getByRole('button',{name:'照片',exact:true});
  await button.hover({position:{x:8,y:8}});
  await expect(button).toHaveAttribute('data-glass-lit','pointer');
  await expect(nav).toHaveAttribute('data-glass-lit','pointer');
  const point=()=>button.evaluate(element=>['--glass-pointer-x','--glass-pointer-y'].map(name=>parseFloat(element.style.getPropertyValue(name))));
  await expect.poll(async()=>(await point()).every(Number.isFinite)).toBe(true);
  const first=await point(),bounds=await button.boundingBox();
  await button.hover({position:{x:bounds.width-8,y:bounds.height-8}});
  await expect.poll(async()=>(await point())[0]).toBeGreaterThan(first[0]);
  expect(await page.locator('[data-glass-lit="pointer"]').count()).toBeLessThanOrEqual(2);
  await page.mouse.down();await expect(button).toHaveAttribute('data-glass-pressed','true');
  await page.mouse.up();await expect(button).not.toHaveAttribute('data-glass-pressed','true');
  await page.mouse.move(-10,-10);
  await expect(page.locator('[data-glass-lit="pointer"]')).toHaveCount(0);
  expect(await button.evaluate(element=>element.style.getPropertyValue('--glass-pointer-x'))).toBe('');
  expect(errors).toEqual([]);
});

test('liquid glass preferences stop pointer motion while keyboard focus stays visible',async({page})=>{
  const {errors}=await readyGallery(page,{theme:'light'});
  const nav=page.locator('.workspace-subnav'),button=nav.getByRole('button',{name:'照片',exact:true});
  await button.hover();await expect(button).toHaveAttribute('data-glass-lit','pointer');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('[data-glass-lit="pointer"]')).toHaveCount(0);
  expect(await button.evaluate(element=>element.style.getPropertyValue('--glass-pointer-x'))).toBe('');
  await page.mouse.move(-10,-10);await button.hover();
  await expect(page.locator('[data-glass-lit="pointer"]')).toHaveCount(0);
  await page.keyboard.press('Tab');await button.focus();
  await expect(button).toHaveAttribute('data-glass-lit','focus');
  await expect(nav).toHaveAttribute('data-glass-lit','focus');
  expect(await button.evaluate(element=>{
    const style=getComputedStyle(element);
    return style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>=2;
  })).toBe(true);
  await page.mouse.move(8,8);await button.blur();
  await expect(page.locator('[data-glass-lit="focus"]')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await button.hover();await expect(button).toHaveAttribute('data-glass-lit','pointer');
  expect(errors).toEqual([]);
});

test('liquid glass contrast and transparency preferences use solid readable surfaces',async({page})=>{
  const {errors}=await readyGallery(page,{theme:'light'}),nav=page.locator('.workspace-subnav');
  await expectGlass(nav);
  await page.emulateMedia({contrast:'more'});
  await expectSolid(nav);
  await nav.getByRole('button',{name:'照片',exact:true}).hover();
  await expect(page.locator('[data-glass-lit="pointer"]')).toHaveCount(0);
  await page.emulateMedia({contrast:'no-preference'});
  const session=await page.context().newCDPSession(page);
  try{
    await session.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
    expect(await page.evaluate(()=>matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true);
    await expectSolid(nav);
    await page.getByRole('button',{name:'显示照片信息',exact:true}).click();
    await expectSolid(page.locator('.photo-inspector'));
    await nav.getByRole('button',{name:'照片',exact:true}).hover();
    await expect(page.locator('[data-glass-lit="pointer"]')).toHaveCount(0);
  }finally{
    await session.send('Emulation.setEmulatedMedia',{features:[]});await session.detach();
  }
  expect(errors).toEqual([]);
});

test('liquid glass narrow English keeps information, keyboard and dialog controls in bounds',async({page},info)=>{
  const {errors}=await readyGallery(page,{theme:'light',lang:'en',width:390});
  const nav=page.locator('.workspace-subnav');await expectGlass(nav);
  await page.keyboard.press('Tab');
  await nav.getByRole('button',{name:'Photos',exact:true}).focus();
  await expect(nav).toHaveAttribute('data-glass-lit','focus');
  await page.getByRole('button',{name:'Show photo information',exact:true}).click();
  const inspector=page.locator('.photo-inspector');await expectGlass(inspector);
  const [navBounds,infoBounds]=await Promise.all([nav.boundingBox(),inspector.boundingBox()]);
  expect(infoBounds.y).toBeGreaterThanOrEqual(navBounds.y+navBounds.height-.5);
  expect(infoBounds.x).toBeGreaterThanOrEqual(0);
  expect(infoBounds.x+infoBounds.width).toBeLessThanOrEqual(390.5);
  await expect(inspector.getByRole('button',{name:'Close photo information',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('glass-information-390-en.png')});
  await inspector.getByRole('button',{name:'Close photo information',exact:true}).click();
  await page.getByRole('button',{name:'Import Photos',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Import Your Photos',exact:true});await expectGlass(modal);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(modal.getByRole('button',{name:'Close',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('liquid glass reaches real settings and darkroom controls without filtering the photo',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.setViewportSize({width:1440,height:1000});
  await page.addInitScript(()=>{localStorage.setItem('theme','dark');localStorage.setItem('lang','zh');localStorage.setItem('onboarded','1');});
  await page.goto('/?page=settings');
  await expect(page.locator('html')).toHaveAttribute('data-material','liquid-glass');
  await expectGlass(page.locator('.settings-card').first());
  await page.goto('/tools/edit');
  const image=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;
    const context=canvas.getContext('2d');context.fillStyle='#607c81';context.fillRect(0,0,240,160);
    context.fillStyle='#e8cba0';context.fillRect(120,0,120,160);return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('.editor-toolbar input[type=file]').setInputFiles({name:'liquid-glass-synthetic.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  const preview=page.locator('.edit-image img');
  await expect(preview).toBeVisible();await expect(preview).toHaveJSProperty('complete',true);
  await expectGlass(page.locator('.edit-controls'));
  expect(await preview.evaluate(element=>{
    const style=getComputedStyle(element);return {filter:style.filter,backdrop:style.backdropFilter||style.webkitBackdropFilter||'none'};
  })).toEqual({filter:'none',backdrop:'none'});
  await page.screenshot({path:info.outputPath('glass-darkroom.png')});
  expect(errors).toEqual([]);
});
