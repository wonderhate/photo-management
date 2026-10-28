import {expect} from '@playwright/test';
export async function exerciseXmpRating(page,{lang,photo,writeRating,getPhoto,screenshot}){
  const text=(zh,en)=>lang==='en'?en:zh;
  await page.getByRole('button',{name:text('查看 ','View ')+photo.file_name,exact:true}).dblclick();const viewer=page.locator('.photo-viewer'),source=viewer.locator('.photo-rating-source'),stars=viewer.locator('.rating-stars');await viewer.getByRole('button',{name:text('照片信息','Photo information'),exact:true}).click();await expect(source).toBeVisible();await expect(source).toContainText(text('XMP 侧文件','XMP sidecar'));await expect(stars.locator('.star-on')).toHaveCount(5);
  await writeRating(2);await source.getByRole('button',{name:text('刷新 XMP 评分','Refresh XMP rating'),exact:true}).click();await expect.poll(async()=>(await getPhoto()).rating).toBe(2);await expect(stars.locator('.star-on')).toHaveCount(2);
  await stars.getByRole('button',{name:text('2 星','2 stars'),exact:true}).click();await expect.poll(async()=>(await getPhoto()).rating_source).toBe('manual');await expect(stars.locator('.star-on')).toHaveCount(0);await expect(source).toContainText(text('应用手动评分','Rated in this app'));
  await writeRating(5);await source.getByRole('button',{name:text('刷新 XMP 评分','Refresh XMP rating'),exact:true}).click();await expect(page.getByText(text('保留人工或旧记录评分，未覆盖','Manual or legacy rating kept unchanged'),{exact:true})).toBeVisible();expect((await getPhoto()).rating).toBe(null);await expect(stars.locator('.star-on')).toHaveCount(0);
  if(lang==='en')expect(await source.innerText()).not.toMatch(/[\u3400-\u9fff]/);if(screenshot)await page.screenshot({path:screenshot,fullPage:true});await page.keyboard.press('Escape');
}
