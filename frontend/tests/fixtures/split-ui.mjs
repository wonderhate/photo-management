import {expect} from '@playwright/test';

export async function exerciseSplitUI(page,info,lang='zh'){
  const text=(zh,en)=>lang==='en'?en:zh;
  const composition=page.locator('.composition-panel');await composition.locator('summary').click();const ordinary=composition.getByRole('slider',{name:'Crop width',exact:true});await ordinary.focus();for(let i=0;i<20;i++)await page.keyboard.press('ArrowLeft');await expect(ordinary).toHaveValue('80');
  await page.getByRole('button',{name:text('无缝分图','Seamless split'),exact:true}).click();
  const dialog=page.getByRole('dialog',{name:text('无缝分图','Seamless split')}),body=dialog.locator('[data-split-body]'),handle=dialog.locator('[data-split-handle=se]'),undo=dialog.getByRole('button',{name:text('撤销分图调整','Undo split'),exact:true}),redo=dialog.getByRole('button',{name:text('重做分图调整','Redo split'),exact:true});
  await expect(dialog.locator('[data-split-handle]')).toHaveCount(4);await expect(handle).toBeEnabled();
  await expect(dialog.getByRole('button',{name:'3:4',exact:true})).toHaveAttribute('aria-pressed','true');
  const original=await body.getAttribute('width');await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-42,box.y+box.height/2-35,{steps:8});await page.mouse.up();
  await expect.poll(()=>body.getAttribute('width')).not.toBe(original);const resized=await body.getAttribute('width');await undo.click();await expect(body).toHaveAttribute('width',original);await expect(undo).toBeDisabled();await redo.click();await expect(body).toHaveAttribute('width',resized);
  await handle.scrollIntoViewIfNeeded();const b=await handle.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2-20,b.y+b.height/2-15,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();await expect(dialog).toBeVisible();await expect(body).toHaveAttribute('width',resized);
  if(page.viewportSize().width<500){const touch=await page.context().newCDPSession(page),box=await handle.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-20,y:y-20,id:1}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(()=>body.getAttribute('width')).not.toBe(resized);await undo.click();await expect(body).toHaveAttribute('width',resized);await touch.detach();}
  await dialog.getByRole('button',{name:'1:1',exact:true}).click();await dialog.getByRole('combobox',{name:text('分图张数','Panel count'),exact:true}).selectOption('10');await expect(dialog.locator('.split-strip li')).toHaveCount(10);
  await dialog.getByRole('spinbutton',{name:text('比例宽','Aspect width'),exact:true}).fill('');await dialog.getByRole('button',{name:text('应用自定义比例','Apply custom aspect'),exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('spinbutton',{name:text('比例宽','Aspect width'),exact:true}).fill('2.35');await dialog.getByRole('spinbutton',{name:text('比例高','Aspect height'),exact:true}).fill('1');await dialog.getByRole('button',{name:text('应用自定义比例','Apply custom aspect'),exact:true}).click();await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('combobox',{name:text('分图张数','Panel count'),exact:true}).selectOption('auto');await expect(dialog.locator('.split-strip li')).toHaveCount(2);
  await dialog.getByRole('button',{name:'4:5',exact:true}).click();await dialog.getByRole('combobox',{name:text('分图张数','Panel count'),exact:true}).selectOption('3');
  await handle.scrollIntoViewIfNeeded();const beforeKey=Number(await body.getAttribute('width'));await handle.focus();await page.keyboard.press('ArrowLeft');await expect.poll(async()=>Number(await body.getAttribute('width'))).toBeLessThan(beforeKey);await expect(undo).toBeEnabled();
  await expect(dialog.locator('.split-preview-status')).toHaveText(text('拖动选区可调整构图','Drag the frame to adjust composition'));
  const expected=await body.evaluate(rect=>({width:Math.round(Number(rect.getAttribute('width'))),height:Math.round(Number(rect.getAttribute('height')))}));
  expect(expected.width/expected.height).toBeCloseTo(2.4,1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(lang==='en')expect(await dialog.innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await dialog.locator('.split-canvas').screenshot({path:info.outputPath('split-canvas.png')});
  await dialog.screenshot({path:info.outputPath('split-dialog.png')});
  await dialog.getByRole('button',{name:text('保存整组分图','Save split group'),exact:true}).click();await expect(dialog.getByRole('button',{name:text('已保存整组','Group saved'),exact:true})).toBeDisabled();await expect(dialog.locator('.split-saved article')).toHaveCount(3);
  await expect(dialog.locator('.split-saved img').first()).toHaveJSProperty('naturalHeight',expected.height);
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:text('下载分片','Download panel')+' 1',exact:true}).click();const path=info.outputPath('split-panel.png');await(await download).saveAs(path);
  await dialog.getByRole('button',{name:text('关闭','Close'),exact:true}).click();await expect(ordinary).toHaveValue('80');return {...expected,path};
}

export async function holdSplitWorker(page){
  await page.addInitScript(()=>{const Original=window.Worker;window.Worker=class extends Original{postMessage(message,...args){if(window.__holdSplit&&message?.action==='split'){window.__splitHeld=true;return;}return super.postMessage(message,...args);}};});
}
export async function cancelSplitUI(page){
  await page.getByRole('button',{name:'无缝分图',exact:true}).click();const dialog=page.getByRole('dialog',{name:'无缝分图'});await expect(dialog.locator('[data-split-handle=se]')).toBeEnabled();
  await page.evaluate(()=>window.__holdSplit=true);await dialog.getByRole('button',{name:'保存整组分图',exact:true}).click();await page.waitForFunction(()=>window.__splitHeld);
  await dialog.getByRole('button',{name:'取消生成并返回暗房',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'保存编辑',exact:true})).toBeEnabled();
  await page.evaluate(()=>window.__holdSplit=false);await page.getByRole('slider',{name:'曝光 EV',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('slider',{name:'曝光 EV',exact:true})).toHaveValue('0.1');
  await page.getByRole('button',{name:'无缝分图',exact:true}).click();await expect(dialog.locator('[data-split-handle=se]')).toBeEnabled();await dialog.getByRole('button',{name:'保存整组分图',exact:true}).click();await expect(dialog.getByRole('button',{name:'已保存整组',exact:true})).toBeDisabled();
}
