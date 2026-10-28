import {expect} from '@playwright/test';

export async function exerciseLocationGuidance(page,{lang,photo,readLocation,screenshot}){
  const t=(zh,en)=>lang==='zh'?zh:en,guide=page.locator('.map-task-guide');
  await expect(guide).toHaveAttribute('data-state','coordinates');
  await expect(page.locator('.map-view-switch button[aria-pressed]')).toHaveCount(2);
  await expect(page.locator('.map-connection')).toHaveCount(0);
  await expect(guide).toContainText(t('只填写国家或城市不会在地图上产生标记','A country or city name alone does not create a map marker'));
  expect(await guide.evaluate(node=>node.getBoundingClientRect().top<document.querySelector('.photo-globe').getBoundingClientRect().top)).toBe(true);
  await guide.getByRole('button',{name:t('查看无坐标照片 · 补位置','View photos without coordinates · add a location'),exact:true}).click();
  await page.locator(`.photo-card[data-photo-id="${photo.id}"] .photo-image`).dblclick();
  const viewer=page.locator('.photo-viewer');await viewer.getByRole('button',{name:t('照片信息','Photo information'),exact:true}).click();
  const editor=viewer.locator('.photo-location'),lat=editor.getByLabel(t('纬度','Latitude'),{exact:true}),lon=editor.getByLabel(t('经度','Longitude'),{exact:true}),save=editor.getByRole('button',{name:t('保存地点','Save location'),exact:true});
  await expect(lat).toBeVisible();await expect(editor).toContainText('WGS84');
  await editor.getByLabel(t('城市','City'),{exact:true}).fill('Hangzhou');await save.click();
  await expect.poll(async()=>(await readLocation()).effective.city).toBe('Hangzhou');
  const revision=(await readLocation()).record.revision;expect((await readLocation()).effective.latitude).toBeNull();
  await lat.fill('91');await lon.fill('120');await lat.blur();
  await expect(lat).toHaveAttribute('aria-invalid','true');await save.click();
  expect((await readLocation()).record.revision).toBe(revision);
  await lat.fill('0');await lon.fill('');await save.click();
  await expect(editor.getByRole('alert')).toContainText(t('纬度和经度需要一起填写','Enter both latitude and longitude'));
  expect((await readLocation()).record.revision).toBe(revision);
  await lon.fill('0');await lon.press('Enter');
  await expect.poll(async()=>{const result=await readLocation();return [result.effective.latitude,result.effective.longitude];}).toEqual([0,0]);
  await expect(editor.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(screenshot)await page.screenshot({path:screenshot,fullPage:true});
  await page.keyboard.press('Escape');
}
