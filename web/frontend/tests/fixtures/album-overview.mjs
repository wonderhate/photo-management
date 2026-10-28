import {expect} from '@playwright/test';
export async function exerciseAlbumOverview(page,{lang,prefix,auto,manual,keep,all,saved,screenshot}){
  const text=(zh,en)=>lang==='en'?en:zh;
  const search=page.getByRole('textbox',{name:text('搜索影集名称','Search album names'),exact:true});await search.fill(prefix);
  const card=id=>page.locator(`[data-album-id="${id}"]`);
  await expect(card(auto.id).locator('.album-cover img')).toHaveCount(4);await expect(card(manual.id).locator('.album-cover img')).toHaveCount(1);
  if(screenshot)await page.screenshot({path:screenshot.replace('.png','-cards.png'),fullPage:true});
  await card(manual.id).getByRole('button',{name:text('恢复自动封面','Restore automatic cover'),exact:true}).click();await expect(card(manual.id).locator('.album-cover img')).toHaveCount(4);
  await card(auto.id).locator('.album-recent-button').click();const recent=page.getByRole('dialog',{name:text('最近加入','Recently added')+' · '+auto.name,exact:true});await expect(recent.locator('.photo-image')).toHaveCount(5);await recent.locator('.photo-image').first().dblclick();await expect(page.locator('.photo-viewer')).toBeVisible();await expect(recent).toHaveCount(0);await page.keyboard.press('Escape');await expect(page.locator('.photo-viewer')).toHaveCount(0);
  await page.getByRole('button',{name:text('表格','Table'),exact:true}).click();await expect(page.locator('.album-table tbody tr')).toHaveCount(3);await expect.poll(async()=>(await saved())?.view).toBe('table');await page.reload();await expect(page.locator('.album-table')).toBeVisible();await search.fill(prefix);await expect(page.locator('.album-table tbody tr')).toHaveCount(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(lang==='en')expect(await page.locator('.albums-page').innerText()).not.toMatch(/[\u3400-\u9fff]/);
  if(screenshot)await page.screenshot({path:screenshot,fullPage:true});
  await search.fill(prefix+' Delete');await page.getByRole('button',{name:text('选择本页影集','Select albums on this page'),exact:true}).click();await expect(page.getByText(text('已选 2 个影集','2 albums selected'),{exact:true})).toBeVisible();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:text('删除所选影集','Delete selected albums'),exact:true}).click();await expect.poll(async()=>(await all()).filter(a=>[auto.id,manual.id].includes(a.id))).toEqual([]);expect((await all()).some(a=>a.id===keep.id)).toBe(true);await search.fill(prefix);await expect(page.locator('.album-table tbody tr')).toHaveCount(1);
}
