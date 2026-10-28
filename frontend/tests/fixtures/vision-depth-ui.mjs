import {expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {imageDigest} from './text-ui.mjs';

export async function exerciseDepthUI(page,info,runtime,route){
  const fixture=resolve(process.env.PHOTO_TEST_VISION_MODELS),inside=relative(resolve('.test-artifacts'),fixture);expect(isAbsolute(inside)||inside.startsWith('..')).toBe(false);
  const spec=JSON.parse(readFileSync('frontend/src/core/vision-models.json','utf8')).find(m=>m.runtime===runtime&&m.kind==='depth');
  await page.getByRole('button',{name:'添加文字',exact:true}).click();await page.getByRole('textbox',{name:'文字内容',exact:true}).fill('Depth test');
  const panel=page.locator('.vision-panel').filter({has:page.locator('summary').filter({hasText:'本地主体与深度'})});if(!await panel.evaluate(e=>e.open))await panel.locator('summary').first().click();
  const models=panel.locator('details');if(!await models.evaluate(e=>e.open))await models.locator('summary').click();await panel.getByLabel('已阅读并接受模型的 Apache-2.0 许可').check();
  const picker=page.waitForEvent('filechooser');await panel.locator('.vision-model').first().getByRole('button',{name:'导入模型文件',exact:true}).click();await(await picker).setFiles(spec.files.map(f=>join(fixture,runtime,spec.id,f.name)));
  await expect(panel.locator('.vision-model').first().getByText('模型文件已导入',{exact:true})).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'生成深度蒙版',exact:true}).click();await page.getByRole('button',{name:'取消本地推理',exact:true}).click();await expect(panel.getByText('已取消 · 0/1',{exact:true})).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'生成深度蒙版',exact:true}).click();await page.getByRole('button',{name:'将所选图层置于主体后方',exact:true}).click({timeout:60000});
  await expect(page.getByRole('spinbutton',{name:'遮挡深度阈值',exact:true})).toHaveValue('0.5');await page.getByRole('spinbutton',{name:'深度过渡羽化',exact:true}).fill('.08');await page.getByRole('spinbutton',{name:'深度过渡羽化',exact:true}).blur();
  await expect(page.locator('[data-text-layer]')).toHaveAttribute('aria-disabled','false');const before=await imageDigest(page.locator('.edit-image img')),name=await page.locator('.edit-image img').getAttribute('alt');
  await page.getByRole('button',{name:/^保存编辑/}).click();await expect(page.getByRole('button',{name:'保存编辑',exact:true})).toBeEnabled();await page.screenshot({path:info.outputPath('local-depth.png'),fullPage:true});
  await page.goto(route);await page.reload();await page.locator('.edit-records>div>button').filter({hasText:name}).first().click();await expect(page.getByRole('spinbutton',{name:'深度过渡羽化',exact:true})).toHaveValue('0.08');await expect.poll(()=>imageDigest(page.locator('.edit-image img'))).toBe(before);
}
