import {expect} from '@playwright/test';
import {imageDigest} from './text-ui.mjs';
import {invertCube} from './lut-ui.mjs';
export async function exerciseLutBrowse(page,info,lang='zh',route='/#/tools/edit'){
  async function beforePaint(keys,check){
    await page.evaluate(()=>{const raf=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window),queue=new Map();let id=2100000000;window.__lutBurst={raf,cancel,queue};window.requestAnimationFrame=callback=>{queue.set(++id,callback);return id;};window.cancelAnimationFrame=value=>queue.delete(value)||cancel(value);});
    try{for(const key of keys)await page.keyboard.press(key);await check();}finally{await page.evaluate(()=>{const state=window.__lutBurst;window.requestAnimationFrame=state.raf;window.cancelAnimationFrame=state.cancel;for(const callback of state.queue.values())state.raf(callback);delete window.__lutBurst;});}
  }
  const t=(zh,en)=>lang==='en'?en:zh,panel=page.locator('.lut-panel'),image=page.locator('.edit-image img'),sourceName=await image.getAttribute('alt');
  const original=await imageDigest(image),exposure=page.getByRole('slider',{name:/Exposure EV|曝光 EV/});await exposure.press('ArrowRight');await expect.poll(()=>imageDigest(image)).not.toBe(original);const adjusted=await imageDigest(image);
  await panel.locator('summary').click();const prefix=`Browse-${lang}-`,names=[prefix+'A.cube',prefix+'B-LogC.cube',prefix+'C.cube'];
  await panel.locator('input[type=file]').first().setInputFiles(names.map(name=>({name,mimeType:'application/octet-stream',buffer:Buffer.from(invertCube(name))})));
  const search=panel.getByRole('searchbox'),columns=panel.getByRole('combobox',{name:t('缩略图列数','Thumbnail columns')}),hide=panel.getByRole('checkbox',{name:t('隐藏 Log 样式','Hide Log styles')}),choice=i=>panel.getByRole('button',{name:t('应用 LUT ','Apply LUT ')+names[i],exact:true}),mark=i=>panel.getByRole('combobox',{name:t('LUT 输入类型 ','LUT input type ')+names[i],exact:true});
  await search.fill(prefix);await expect(panel.locator('.lut-choice')).toHaveCount(3);await columns.selectOption('3');await hide.check();await expect(choice(1)).toHaveCount(0);await hide.uncheck();await mark(1).selectOption('normal');await hide.check();await expect(choice(1)).toBeVisible();await hide.uncheck();await mark(1).selectOption('auto');
  await choice(0).click();const strength=panel.getByRole('slider',{name:t('LUT 强度','LUT strength')});await strength.press('End');await strength.press('ArrowLeft');await expect(strength).toHaveValue('0.99');await expect.poll(()=>imageDigest(image)).not.toBe(adjusted);
  const undo=page.getByRole('button',{name:t('撤销编辑','Undo edit'),exact:true}),redo=page.getByRole('button',{name:t('重做编辑','Redo edit'),exact:true});
  await choice(0).focus();await beforePaint(['ArrowRight','ArrowRight'],()=>expect(choice(2)).toHaveAttribute('aria-pressed','true'));await expect(undo).toBeEnabled();await undo.click();await expect(choice(0)).toHaveAttribute('aria-pressed','true');await redo.click();await expect(choice(2)).toHaveAttribute('aria-pressed','true');
  await choice(2).focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Escape');await expect(choice(2)).toHaveAttribute('aria-pressed','true');await expect(undo).toBeEnabled();
  await search.focus();await page.keyboard.press('ArrowLeft');await expect(choice(2)).toHaveAttribute('aria-pressed','true');
  const save=page.getByRole('button',{name:new RegExp('^'+t('保存编辑','Save edits'))});await save.click();await expect(save).toBeEnabled();await expect(save).not.toContainText('•');const graded=await imageDigest(image),compare=panel.getByRole('button',{name:t('按住对比 LUT','Hold to compare LUT')});
  await compare.focus();await page.keyboard.down('Space');await expect.poll(()=>imageDigest(image)).toBe(adjusted);await expect(save).toBeDisabled();await page.keyboard.up('Space');await expect.poll(()=>imageDigest(image)).toBe(graded);await expect(save).not.toContainText('•');
  await compare.scrollIntoViewIfNeeded();const box=await compare.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await expect.poll(()=>imageDigest(image)).toBe(adjusted);await page.mouse.move(3,3);await page.mouse.up();await expect.poll(()=>imageDigest(image)).toBe(graded);
  await compare.focus();await page.keyboard.down('Space');await expect.poll(()=>imageDigest(image)).toBe(adjusted);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect.poll(()=>imageDigest(image)).toBe(graded);await page.keyboard.up('Space');
  await panel.getByRole('button',{name:t('移除当前 LUT','Clear current LUT'),exact:true}).click();await choice(0).click();await expect(strength).toHaveValue('0.99');await save.click();await expect(save).toBeEnabled();
  await mark(1).selectOption('normal');await hide.check();await panel.getByRole('button',{name:t('收藏 LUT ','Favorite LUT ')+names[0],exact:true}).click();await panel.getByRole('combobox',{name:t('样式分组','Style group')}).selectOption('favorite');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await panel.screenshot({path:info.outputPath('lut-browse.png')});
  await page.goto(route);await page.reload();await page.locator('.edit-records>div>button').filter({hasText:sourceName}).first().click();await panel.locator('summary').click();await expect(columns).toHaveValue('3');await expect(hide).toBeChecked();await expect(panel.getByRole('combobox',{name:t('样式分组','Style group')})).toHaveValue('favorite');await panel.getByRole('combobox',{name:t('样式分组','Style group')}).selectOption('all');await search.fill(prefix);await expect(mark(1)).toHaveValue('normal');await expect(strength).toHaveValue('0.99');
  await panel.getByRole('button',{name:t('移除当前 LUT','Clear current LUT'),exact:true}).click();await choice(2).click();await expect(strength).toHaveValue('0.99');
  if(lang==='zh'){
    const paging=Array.from({length:44},(_,i)=>`Paging-${lang}-${String(i).padStart(2,'0')}.cube`);
    await panel.locator('input[type=file]').first().setInputFiles(paging.map(name=>({name,mimeType:'application/octet-stream',buffer:Buffer.from(invertCube(name))})));
    await search.fill('Paging-'+lang);await expect(panel.locator('.lut-choice')).toHaveCount(39);
    const cell=i=>panel.getByRole('button',{name:t('应用 LUT ','Apply LUT ')+paging[i],exact:true});
    await cell(38).focus();await beforePaint(['ArrowRight','ArrowDown'],()=>expect(cell(42)).toBeFocused());await expect(panel.locator('.lut-choice')).toHaveCount(5);
    await page.keyboard.press('ArrowUp');await expect(cell(39)).toBeFocused();await page.keyboard.press('ArrowUp');await expect(cell(36)).toBeFocused();await page.keyboard.press('Escape');
    await search.fill(prefix);await expect(choice(2)).toHaveAttribute('aria-pressed','true');await expect(undo).toBeEnabled();
  }
  // Save once more to leave the test page with no pending edit confirmation.
  await save.click();await expect(save).toBeEnabled();
}
