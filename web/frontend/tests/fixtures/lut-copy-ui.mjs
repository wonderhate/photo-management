import {expect} from '@playwright/test';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {invertCube} from './lut-ui.mjs';
import {imageDigest} from './text-ui.mjs';
export async function exerciseLutCopy(page,info,lang){
 const t=(zh,en)=>lang==='en'?en:zh,root=resolve('.test-artifacts/afterframe-upgrade','CopyPack-'+lang+'-'+randomUUID().slice(0,8)),files={
  'S-Log3/Portrait/Tone.cube':invertCube('Copied-'+basename(root)),
  'Regular/Input.cube':'# Input: V-Log\n'+invertCube('Input-'+basename(root)),
  'Regular/Plain.cube':invertCube('Plain-'+basename(root)),
  'Bad.cube':'LUT_3D_SIZE 2\n0 0 0',
  'License.txt':'Synthetic test fixtures only.'
 };const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 for(const [name,text] of Object.entries(files)){mkdirSync(resolve(root,name,'..'),{recursive:true});writeFileSync(join(root,name),text);}
 const panel=page.locator('.lut-panel'),photo=page.locator('.edit-image img'),sourceName=await photo.getAttribute('alt'),original=await imageDigest(photo);
 await panel.locator(':scope > summary').click();const input=panel.locator('input[type=file]').nth(1),report=panel.locator('.lut-import-report');await input.setInputFiles(root);await expect(report).toContainText(t('新增 3','Added 3'));await expect(report).toContainText(t('失败 1','Failed 1'));await expect(report).toContainText(t('非 CUBE 文件 1','Non-CUBE files 1'));
 const copied=panel.locator('.lut-copied-tree'),libraryRoot=copied.getByRole('button',{name:t('展开或收起目录 已复制样式','Expand or collapse folder Copied styles'),exact:true});if(await libraryRoot.getAttribute('aria-expanded')!=='true')await libraryRoot.click();
 const pack=copied.getByRole('button',{name:t('展开或收起目录 ','Expand or collapse folder ')+basename(root),exact:true});if(await pack.getAttribute('aria-expanded')!=='true')await pack.click();const group=copied.locator('[data-tree-path="'+basename(root)+'/S-Log3"]').getByRole('button',{name:t('展开或收起目录 S-Log3','Expand or collapse folder S-Log3'),exact:true});await group.locator('..').getByRole('button',{name:/查看|View/}).click();
 const choice=panel.getByRole('button',{name:t('应用 LUT Tone.cube','Apply LUT Tone.cube'),exact:true});await expect(choice).toBeVisible();await expect(choice).toContainText('Log');await expect(panel.getByRole('button',{name:t('应用 LUT Plain.cube','Apply LUT Plain.cube'),exact:true})).toHaveCount(0);
 await panel.getByRole('checkbox',{name:t('隐藏 Log 样式','Hide Log styles')}).check();await expect(choice).toHaveCount(0);await panel.getByRole('checkbox',{name:t('隐藏 Log 样式','Hide Log styles')}).uncheck();
 const favorite=panel.getByRole('button',{name:t('收藏 LUT Tone.cube','Favorite LUT Tone.cube'),exact:true});await favorite.click();await expect(favorite).toHaveAttribute('aria-pressed','true');await input.setInputFiles(root);await expect(report).toContainText(t('已存在 3','Existing 3'));await expect(favorite).toHaveAttribute('aria-pressed','true');
 await panel.getByRole('button',{name:t('移出 LUT Tone.cube','Remove LUT Tone.cube'),exact:true}).click();await expect(choice).toHaveCount(0);await input.setInputFiles(root);await expect(report).toContainText(t('已恢复 1','Restored 1'));await expect(report).toContainText(t('已存在 2','Existing 2'));await choice.click();await expect.poll(()=>imageDigest(photo)).not.toBe(original);const graded=await imageDigest(photo);
 const save=page.getByRole('button',{name:new RegExp('^'+t('保存编辑','Save edits'))});await save.click();await expect(save).toBeEnabled();await page.goto(new URL(page.url()).port==='4185'?'/#/tools/edit':'/tools/darkroom');await expect(page).not.toHaveURL(/[?&]photo=/);await expect(page.locator('.edit-records')).toBeVisible();await page.reload();await page.locator('.edit-records>div>button').filter({hasText:sourceName}).first().click();await expect.poll(()=>imageDigest(photo)).toBe(graded);await panel.locator(':scope > summary').click();await expect(pack).toHaveAttribute('aria-expanded','true');await expect(group).toBeVisible();await pack.locator('..').getByRole('button',{name:/查看|View/}).click();await expect(panel.getByRole('button',{name:t('应用 LUT Input.cube','Apply LUT Input.cube'),exact:true})).toContainText('Log');await expect(panel.getByRole('button',{name:t('应用 LUT Plain.cube','Apply LUT Plain.cube'),exact:true})).not.toContainText('Log');
 await choice.scrollIntoViewIfNeeded();await expect(choice.locator('img')).toBeVisible();await page.screenshot({path:info.outputPath('lut-copy.png'),fullPage:true});if(lang==='en')expect(await panel.innerText()).not.toMatch(/[\u3400-\u9fff]/);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 for(const [name,text] of Object.entries(files))expect(sha(readFileSync(join(root,name)))).toBe(sha(text));return basename(root);
}
