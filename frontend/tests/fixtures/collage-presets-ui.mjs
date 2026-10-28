import {expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export async function exerciseCollagePresets(page,info,lang){
 const text=(zh,en)=>lang==='en'?en:zh,dialog=page.getByRole('dialog',{name:text('照片拼图','Photo collage'),exact:true}),button=(zh,en)=>dialog.getByRole('button',{name:text(zh,en),exact:true});
 const download=async control=>{const next=page.waitForEvent('download');await control.click();return readFileSync(await(await next).path());};
 const document=async()=>JSON.parse(await download(button('保存布局清单','Save layout document')));
 const bytes=await page.evaluate(async()=>{const files=[];for(let i=0;i<5;i++){const canvas=new OffscreenCanvas(320,200),ctx=canvas.getContext('2d');ctx.fillStyle=['#315d77','#b48857','#5a775c','#4f5577','#ad6644'][i];ctx.fillRect(0,0,320,200);files.push([...new Uint8Array(await(await canvas.convertToBlob()).arrayBuffer())]);}return files;});
 const files=bytes.map((b,i)=>({name:`Preset-${i}.png`,mimeType:'image/png',buffer:Buffer.from(b)})),hashes=files.map(f=>createHash('sha256').update(f.buffer).digest('hex'));
 const cards=dialog.locator('.collage-preset-card');await expect(cards).toHaveCount(6);await expect(dialog.locator('.collage-stage')).toHaveCount(0);
 await dialog.locator('[data-preset="travel"]').focus();await page.keyboard.press('Enter');await expect(dialog.locator('[data-preset="travel"]')).toHaveAttribute('aria-pressed','true');await expect(dialog.getByRole('status').filter({hasText:text('样式已选好','Style selected')})).toBeVisible();
 await dialog.locator('input[type=file]').nth(0).setInputFiles(files.slice(0,3));await expect(button('导出拼图 PNG','Export collage PNG')).toBeEnabled();await expect(dialog.locator('[data-preset="travel"]')).toHaveAttribute('aria-pressed','true');
 const initial=await document();expect([initial.width,initial.height]).toEqual([1920,2400]);expect(initial.sources.map(s=>s.sha256)).toEqual(hashes.slice(0,3));
 const signatures=new Set();let saved,output;
 for(const id of ['gallery','diptych','film','travel','editorial','grid']){
  await dialog.locator(`[data-preset="${id}"]`).click();await expect(dialog.locator(`[data-preset="${id}"]`)).toHaveAttribute('aria-pressed','true');await expect(dialog.locator('.collage-stage')).toHaveAttribute('aria-busy','false');saved=await document();expect(saved.sources).toEqual(initial.sources);expect(saved.cells).toEqual(initial.cells);
  output=await download(button('导出拼图 PNG','Export collage PNG'));expect(output.readUInt32BE(16)).toBe(saved.width);expect(output.readUInt32BE(20)).toBe(saved.height);signatures.add(createHash('sha256').update(output).digest('hex'));
  const background=await page.evaluate(async bytes=>{const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=new OffscreenCanvas(1,1),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();return Array.from(ctx.getImageData(0,0,1,1).data);},[...output]);expect(background).toEqual([...saved.background.slice(1).match(/../g).map(c=>parseInt(c,16)),255]);
 }
 expect(signatures.size).toBe(6);await button('撤销拼图','Undo collage').click();await expect(dialog.locator('[data-preset="editorial"]')).toHaveAttribute('aria-pressed','true');await button('重做拼图','Redo collage').click();await expect(dialog.locator('[data-preset="grid"]')).toHaveAttribute('aria-pressed','true');
 await dialog.locator('input[type=file]').nth(2).setInputFiles({name:'Preset-layout.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});await expect(button('选择清单中的原图','Choose document originals')).toBeVisible();await expect(cards.first()).toBeDisabled();await dialog.locator('input[type=file]').nth(0).setInputFiles(files.slice(0,3).reverse());await expect(button('导出拼图 PNG','Export collage PNG')).toBeEnabled();expect(await document()).toEqual(saved);expect(await download(button('导出拼图 PNG','Export collage PNG'))).toEqual(output);
 await dialog.evaluate(el=>el.scrollTop=0);await dialog.screenshot({path:info.outputPath(`collage-presets-${lang}.png`)});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);if(lang==='en')expect(await dialog.innerText()).not.toMatch(/[\u3400-\u9fff]/);
 await dialog.locator('input[type=file]').nth(0).setInputFiles(files.slice(3));await expect(dialog.locator('.collage-cells button')).toHaveCount(5);await expect(dialog.locator('[data-preset="grid"]')).toHaveAttribute('aria-pressed','true');
 await button('批量拼图','Batch collage').click();const batch=page.getByRole('dialog',{name:text('批量拼图','Batch collage'),exact:true});await expect(batch.locator('.batch-page')).toHaveCount(2);await batch.locator('[data-preset="film"]').click();const batchSaved=JSON.parse(await download(batch.getByRole('button',{name:text('保存批量清单','Save batch document'),exact:true})));expect(batchSaved.pages.map(p=>p.cells.length)).toEqual([4,1]);for(const p of batchSaved.pages)expect(p.background).toBe('#151515');expect(batchSaved.items.map(i=>i.source.sha256)).toEqual(hashes);expect(files.map(f=>createHash('sha256').update(f.buffer).digest('hex'))).toEqual(hashes);
}
