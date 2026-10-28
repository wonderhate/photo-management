import {expect} from '@playwright/test';

export async function exerciseTextSearch(page,{lang='zh',rows,screenshot}){
  const text=(zh,en)=>lang==='en'?en:zh,mode=page.getByRole('combobox',{name:text('搜索方式','Search mode'),exact:true}),input=page.getByRole('textbox',{name:text('搜索照片','Search photos'),exact:true});
  const names=ids=>ids.map(id=>rows.find(p=>p.id===id).file_name).sort();
  const visible=()=>page.locator('.photo-caption>span').allTextContents();
  async function search(kind,value,ids){await mode.selectOption(kind);await input.fill(value);await input.press('Enter');await expect.poll(async()=>(await visible()).sort()).toEqual(names(ids));}
  await expect.poll(async()=>(await visible()).sort()).toEqual(names(['a','b','c','d']));
  for(const [value,ids] of [['SUNRISE',['a']],['海边',['a']],['open',['b']],['50%_',['a']],['人工山景',['c']],['beach',[]],['已拒绝',[]],['海岸',[]],['海',['a','d']]])await search('text',value,ids);
  await search('filename','DSC',['a']);await search('filename','SUNRISE',[]);await search('text','SUNRISE',['a']);
  if(screenshot)await page.screenshot({path:screenshot,fullPage:true});
  expect(await page.locator('.photo-search-controls').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await input.fill('');await expect.poll(async()=>(await visible()).sort()).toEqual(names(['a','b','c','d']));
  await page.locator('.workspace-subnav').getByRole('button',{name:text('影集','Albums'),exact:true}).click();await page.getByRole('button',{name:text('新建条件集合','New rule collection'),exact:true}).click();
  const dialog=page.getByRole('dialog',{name:text('新建条件集合','New rule collection'),exact:true}),leaf=dialog.locator('.query-leaf').first();
  await dialog.getByRole('textbox',{name:text('影集名称','Album Name'),exact:true}).fill('Text Search '+lang);
  for(const [field,value,count] of [['ai_caption','海边',3],['description','海边',1],['detected_text','open',1]]){
    await leaf.getByRole('combobox',{name:text('照片字段','Photo field'),exact:true}).selectOption(field);await leaf.getByRole('combobox',{name:text('条件','Condition'),exact:true}).selectOption('icontains');await leaf.getByRole('textbox',{name:text('条件值','Condition value'),exact:true}).fill(value);await expect(dialog.getByRole('status')).toHaveText(text('匹配 '+count+' 次拍摄',count+' matching captures'));
  }
  if(lang==='en')expect(await dialog.innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await dialog.getByRole('button',{name:text('保存条件集合','Save rule collection'),exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.locator('.album-card').filter({hasText:'Text Search '+lang}).getByRole('button').first().click();await expect.poll(async()=>(await visible()).sort()).toEqual(names(['b']));
}
