import {expect} from '@playwright/test';
import {imageDigest} from './text-ui.mjs';

export async function exerciseVisionUI(page,info,lang='zh',route='/#/tools/edit'){
  const t=(zh,en)=>lang==='en'?en:zh,image=page.locator('.edit-image img'),name=await image.getAttribute('alt');
  const panel=page.locator('.vision-panel').filter({has:page.locator('summary').filter({hasText:t('本地贴纸库','Local sticker library')})});
  if(!await panel.evaluate(e=>e.open))await panel.locator('summary').click();
  const include=panel.getByRole('button',{name:t('包含隐藏素材','Include hidden assets'),exact:true});if(await include.getAttribute('aria-pressed')==='true')await include.click();
  const stickerName='Synthetic-sticker-'+lang;const encoded=await page.evaluate(async lang=>{const c=new OffscreenCanvas(96,64),x=c.getContext('2d');x.fillStyle=lang==='en'?'#e6b34d':'#e6b34c';x.beginPath();x.ellipse(48,32,30,22,0,0,Math.PI*2);x.fill();return btoa(String.fromCharCode(...new Uint8Array(await(await c.convertToBlob({type:'image/png'})).arrayBuffer())));},lang);
  await panel.locator('input[type=file]').setInputFiles({name:stickerName+'.png',mimeType:'image/png',buffer:Buffer.from(encoded,'base64')});
  const asset=panel.locator('.vision-stickers article').filter({has:page.getByRole('button',{name:t('添加贴纸：','Add sticker: ')+stickerName,exact:true})});
  const hit=page.locator('[data-layer]'),sx=panel.getByLabel(t('横向缩放','Horizontal scale'),{exact:true}),sy=panel.getByLabel(t('纵向缩放','Vertical scale'),{exact:true}),undo=page.getByRole('button',{name:t('撤销编辑','Undo edit'),exact:true}),redo=page.getByRole('button',{name:t('重做编辑','Redo edit'),exact:true});
  await expect(hit).toHaveCount(1);await expect(hit).toHaveAttribute('aria-disabled','false');await expect(page.locator('[data-layer-handle]')).toHaveCount(8);
  await panel.getByLabel(t('图层对齐吸附','Snap layers to alignment guides')).uncheck();
  for(const h of ['nw','n','ne','e','se','s','sw','w']){
    await page.locator('.text-canvas').evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));
    const handle=await page.locator(`[data-layer-handle=${h}]`).boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+(h.includes('w')?-14:14),handle.y+handle.height/2+(h.includes('n')?-12:12),{steps:3});await page.mouse.up();
    await expect(h==='n'||h==='s'?sy:sx).not.toHaveValue('1');await undo.click();await expect(sx).toHaveValue('1');await expect(sy).toHaveValue('1');await expect(hit).toHaveAttribute('aria-disabled','false');
  }
  await sx.fill('1.35');await sx.blur();await expect(sx).toHaveValue('1.35');await undo.click();await expect(sx).toHaveValue('1');await redo.click();await expect(sx).toHaveValue('1.35');
  await expect(hit).toHaveAttribute('aria-disabled','false');const rendered=await imageDigest(image);await asset.getByRole('button',{name:t('隐藏素材','Hide asset'),exact:true}).click();await expect(asset).toHaveCount(0);await expect.poll(()=>imageDigest(image)).toBe(rendered);
  await panel.getByRole('button',{name:t('包含隐藏素材','Include hidden assets'),exact:true}).click();await expect(asset).toHaveCount(1);await asset.getByRole('button',{name:t('导出透明PNG','Export transparent PNG'),exact:true}).click();await expect(panel.getByText(new RegExp(t('下载贴纸','Download sticker')))).toBeVisible();
  await page.getByRole('button',{name:new RegExp('^'+t('保存编辑','Save edits'))}).click();await expect(page.getByRole('button',{name:t('保存编辑','Save edits'),exact:true})).toBeEnabled();await page.screenshot({path:info.outputPath('sticker-editor.png'),fullPage:true});
  await page.goto(route);await page.reload();await page.locator('.edit-records>div>button').filter({hasText:name}).first().click();
  await expect(sx).toHaveValue('1.35');await expect(panel.getByLabel(t('图层对齐吸附','Snap layers to alignment guides'))).not.toBeChecked();await expect(panel.getByRole('button',{name:t('包含隐藏素材','Include hidden assets'),exact:true})).toHaveAttribute('aria-pressed','true');await expect.poll(()=>imageDigest(image)).toBe(rendered);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  return {name,rendered};
}
