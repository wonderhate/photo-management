import {expect} from '@playwright/test';
async function pixels(locator){return locator.evaluate(async image=>{await image.decode();const c=new OffscreenCanvas(image.naturalWidth,image.naturalHeight),x=c.getContext('2d');x.drawImage(image,0,0);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',x.getImageData(0,0,c.width,c.height).data))].join(',');});}
export async function exerciseSplitChildUI(page,info,lang='zh',route='/#/tools/edit'){
  const text=(zh,en)=>lang==='en'?en:zh;
  const exposure=page.getByRole('slider',{name:text('曝光 EV','Exposure EV'),exact:true});await exposure.focus();for(let i=0;i<10;i++)await page.keyboard.press('ArrowRight');await expect(exposure).toHaveValue('1');
  const split=page.getByRole('button',{name:text('无缝分图','Seamless split'),exact:true});await split.click();
  const dialog=page.getByRole('dialog',{name:text('无缝分图','Seamless split')});await dialog.getByRole('button',{name:text('保存整组分图','Save split group'),exact:true}).click();await expect(dialog.getByRole('button',{name:text('已保存整组','Group saved'),exact:true})).toBeDisabled();
  const frozen=await pixels(dialog.locator('.split-saved img').first());await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  const contrast=page.getByRole('slider',{name:text('对比度','Contrast'),exact:true});await contrast.focus();for(let i=0;i<20;i++)await page.keyboard.press('ArrowRight');await expect(contrast).toHaveValue('20');
  await split.click();await dialog.locator('.split-groups .button-row button').first().click();
  await dialog.getByRole('button',{name:text('继续编辑分片','Edit panel')+' 1',exact:true}).click();
  await expect.poll(async()=>await dialog.count()===0||await dialog.getByRole('alert').isVisible()).toBe(true);
  if(await dialog.count()){await dialog.getByRole('button',{name:text('继续编辑分片','Edit panel')+' 1',exact:true}).click();}
  await expect(dialog).toHaveCount(0);await expect(exposure).toHaveValue('0');await expect(contrast).toHaveValue('0');
  const image=page.locator('.edit-image img');await expect.poll(()=>pixels(image)).toBe(frozen);
  const name=await image.getAttribute('alt'),nav=page.getByRole('navigation',{name:text('编辑来源与版本','Edit source and versions')});await expect(nav).toContainText(text('来源父版本','Parent source version')+' 1');
  await exposure.focus();for(let i=0;i<3;i++)await page.keyboard.press('ArrowRight');await expect(exposure).toHaveValue('0.3');
  await nav.getByRole('button',{name:text('返回父工程（当前版本）','Open parent (current version)'),exact:true}).click();await expect(exposure).toHaveValue('1');await expect(contrast).toHaveValue('20');
  await nav.getByRole('button',{name:text('返回分片编辑','Return to panel edit'),exact:true}).click();await expect(exposure).toHaveValue('0.3');await expect(nav).toContainText(text('当前编辑版本','Current edit version')+' 2');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(lang==='en')expect(await nav.innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await page.screenshot({path:info.outputPath('split-child-editor.png'),fullPage:true});
  await page.goto(route);await page.reload();await page.locator('.edit-records>div>button').filter({hasText:name}).first().click();await expect(exposure).toHaveValue('0.3');await expect(nav).toContainText(text('来源父版本','Parent source version')+' 1');
  return {name,frozen};
}
