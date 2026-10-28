import {expect} from '@playwright/test';
import {imageDigest} from './text-ui.mjs';
import {invertCube} from './lut-ui.mjs';
export async function exerciseLutErrors(page,lang='zh'){
  const t=(zh,en)=>lang==='en'?en:zh,panel=page.locator('.lut-panel'),image=page.locator('.edit-image img'),before=await imageDigest(image);await panel.locator('summary').click();const input=panel.locator('input[type=file]').first(),alert=page.locator('.editor-page [role=alert]');
  await input.setInputFiles({name:'Short.cube',mimeType:'application/octet-stream',buffer:Buffer.from('LUT_3D_SIZE 2\n0 0 0\n')});await expect(alert).toContainText(t('颜色行数与网格大小不符','color row count does not match'));expect(await imageDigest(image)).toBe(before);
  await input.setInputFiles({name:'Shaper.cube',mimeType:'application/octet-stream',buffer:Buffer.from('LUT_1D_SIZE 2\nLUT_3D_SIZE 2\n')});await expect(alert).toContainText(t('暂不支持 1D','1D, 2D and shaper-combined'));
  const name='Recovery-'+lang+'.cube';await input.setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(invertCube(name))});await panel.getByRole('searchbox').fill(name);await expect(panel.getByRole('button',{name:t('应用 LUT ','Apply LUT ')+name,exact:true})).toBeEnabled();await expect(alert).toHaveCount(0);expect(await imageDigest(image)).toBe(before);
}
