import {navigateWorkspace} from './workspace-navigation.mjs';
import {expect} from '@playwright/test';

export async function createRuleThroughUI(page,{lang='zh',prefix,name,screenshot}){
  const en=lang==='en',text=(zh,enText)=>en?enText:zh;
  await navigateWorkspace(page,text('影集','Albums'));
  await page.getByRole('button',{name:text('新建条件集合','New rule collection'),exact:true}).click();
  const dialog=page.getByRole('dialog',{name:text('新建条件集合','New rule collection'),exact:true});
  await dialog.getByRole('textbox',{name:text('影集名称','Album Name'),exact:true}).fill(name);
  const root=dialog.locator('.query-group').first(),first=root.locator('.query-leaf').first();
  await first.getByRole('combobox',{name:text('照片字段','Photo field'),exact:true}).selectOption('file_name');
  await first.getByRole('combobox',{name:text('条件','Condition'),exact:true}).selectOption('contains');
  await first.getByRole('textbox',{name:text('条件值','Condition value'),exact:true}).fill(prefix);
  await root.locator(':scope > .query-add').getByRole('button',{name:text('添加分组','Add group'),exact:true}).click();
  const nested=root.locator(':scope > .query-child').nth(1).locator('.query-group').first(),missing=nested.locator('.query-leaf').first();
  await missing.getByRole('combobox',{name:text('照片字段','Photo field'),exact:true}).selectOption('rating');
  await missing.getByRole('combobox',{name:text('条件','Condition'),exact:true}).selectOption('is_null');
  await nested.locator(':scope > .query-add').getByRole('button',{name:text('添加条件','Add condition'),exact:true}).click();
  const zero=nested.locator('.query-leaf').last();await zero.getByRole('combobox',{name:text('条件','Condition'),exact:true}).selectOption('eq');
  await zero.getByRole('spinbutton',{name:text('条件值','Condition value'),exact:true}).fill('0');
  await zero.getByRole('combobox',{name:text('条件','Condition'),exact:true}).selectOption('in');
  const values=zero.getByRole('textbox',{name:text('条件值','Condition value'),exact:true});await values.fill('');await values.pressSequentially('0,4');await expect(values).toHaveValue('0,4');
  await expect(dialog.getByRole('status')).toHaveText(text('匹配 3 次拍摄','3 matching captures'));
  await zero.getByRole('combobox',{name:text('条件','Condition'),exact:true}).selectOption('eq');
  await expect(dialog.getByRole('status')).toHaveText(text('匹配 2 次拍摄','2 matching captures'));
  await nested.locator(':scope > .query-group-heading .query-not input').check();
  await expect(nested.locator(':scope > .query-group-heading .query-not input')).toBeFocused();
  await expect(dialog.getByRole('status')).toHaveText(text('匹配 1 次拍摄','1 matching captures'));
  await root.locator('.query-negative').first().locator(':scope > .query-group-heading .query-not input').uncheck();
  await expect(dialog.getByRole('status')).toHaveText(text('匹配 2 次拍摄','2 matching captures'));
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  if(en)expect(await dialog.innerText()).not.toMatch(/[\u3400-\u9fff]/);
  if(screenshot)await page.screenshot({path:screenshot,fullPage:true});
  await dialog.getByRole('button',{name:text('保存条件集合','Save rule collection'),exact:true}).click();await expect(dialog).not.toBeVisible();
  const card=page.locator('.album-card').filter({hasText:name});await expect(card).toContainText(text('条件集合','Rule collection'));return card;
}
