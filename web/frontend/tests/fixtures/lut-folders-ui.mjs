import {expect} from '@playwright/test';
import {imageDigest} from './text-ui.mjs';
export async function exerciseLutFolders(page,info,lang,addFile){
 const t=(zh,en)=>lang==='en'?en:zh,panel=page.locator('.lut-panel'),photo=page.locator('.edit-image img'),original=await imageDigest(photo),sourceName=await photo.getAttribute('alt');
 await panel.locator(':scope > summary').click();
 const link=panel.getByRole('button',{name:t('关联样式目录','Link LUT directory'),exact:true});
 await panel.getByRole('button',{name:t('扫描关联目录','Scan linked directories'),exact:true}).click();await expect(link).toBeEnabled();
 const known=await panel.locator('.lut-folders article').evaluateAll(rows=>rows.map(row=>row.dataset.folder));
 await link.click();await expect(link).toBeEnabled();
 const added=(await panel.locator('.lut-folders article').evaluateAll(rows=>rows.map(row=>row.dataset.folder))).filter(id=>!known.includes(id));expect(added).toHaveLength(1);
 const folder=panel.locator(`.lut-folders article[data-folder="${added[0]}"]`);await expect(folder.getByText(/可用|Available/)).toBeVisible();
 const rootToggle=folder.locator('.lut-tree-node').first().getByRole('button',{name:/展开或收起目录|Expand or collapse folder/}).first();if(await rootToggle.getAttribute('aria-expanded')!=='true')await rootToggle.click();
 const cinema=folder.getByRole('button',{name:t('展开或收起目录 Cinema','Expand or collapse folder Cinema'),exact:true});await expect(cinema).toBeVisible();await cinema.locator('..').getByRole('button',{name:/查看|View/}).click();
 const choice=panel.getByRole('button',{name:t('应用 LUT Directory.cube','Apply LUT Directory.cube'),exact:true});await expect(choice).toBeVisible();await expect(choice).toContainText('Log');await expect(choice.locator('img')).toBeVisible();
 await panel.getByRole('checkbox',{name:t('隐藏 Log 样式','Hide Log styles')}).check();await expect(choice).toHaveCount(0);await panel.getByRole('checkbox',{name:t('隐藏 Log 样式','Hide Log styles')}).uncheck();await choice.click();await expect.poll(()=>imageDigest(photo)).not.toBe(original);const graded=await imageDigest(photo);
 const reveal=panel.getByRole('button',{name:t('定位关联源文件','Reveal linked source'),exact:true});
 if(new URL(page.url()).port==='4174'){const calls=[];await page.route('**/api/editor/luts/*/reveal',route=>{calls.push(route.request().method());return route.fulfill({json:{ok:true}});});await reveal.click();await expect.poll(()=>calls.length).toBe(1);expect(calls).toEqual(['POST']);}else await expect(reveal).toHaveCount(0);
 await panel.getByRole('button',{name:t('显示全部来源','Show all sources'),exact:true}).click();await addFile();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(panel.getByRole('button',{name:t('应用 LUT New.cube','Apply LUT New.cube'),exact:true})).toBeVisible();
 const save=page.getByRole('button',{name:new RegExp('^'+t('保存编辑','Save edits'))});await save.click();await expect(save).toBeEnabled();await page.goto(await page.evaluate(()=>document.documentElement.dataset.runtime==='browser')?'/#/tools/edit':'/tools/darkroom');await expect(page).not.toHaveURL(/[?&]photo=/);await expect(page.locator('.edit-records')).toBeVisible();await page.reload();await page.locator('.edit-records>div>button').filter({hasText:sourceName}).first().click();await expect.poll(()=>imageDigest(photo)).toBe(graded);await panel.locator(':scope > summary').click();await expect(cinema).toBeVisible();await panel.screenshot({path:info.outputPath('lut-directories.png')});if(lang==='en')expect(await panel.innerText()).not.toMatch(/[\u3400-\u9fff]/);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await folder.getByRole('button',{name:t('断开关联','Unlink'),exact:true}).click();await expect(folder).toHaveCount(0);expect(await imageDigest(photo)).toBe(graded);await expect(choice).toBeVisible();await expect(choice).toContainText('Log');
}
