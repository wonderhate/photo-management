import {test,expect} from './fixtures/native-runtime.mjs';

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`library selection previews, preserves the current library and recovers from a blocked restart ${width} ${lang}`,async({page,request},info)=>{
  const identity=(await(await request.get('/api/workspace')).json()).library_id,records=(await(await request.get('/api/photos')).json()).total,errors=[],mutations=[];
  await page.setViewportSize({width,height:1000});await page.addInitScript(lang=>{localStorage.setItem('onboarded','1');localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);page.on('pageerror',e=>errors.push(e.message));
  const current={path:'C:/Synthetic/First',name:'First',library_id:identity,photo_count:records,schema_version:3},target={path:'C:/Synthetic/Second',name:'Second',library_id:'synthetic-second',photo_count:12,schema_version:3};
  const status={current,recent:[current,target],pending:null,locked:false,migration_pending:false,managed_restart:true,switching:false,error:null};let attempts=0;
  await page.route('**/api/dialog/catalog',route=>route.fulfill({json:{paths:[target.path]}}));
  await page.route('**/api/workspace/catalogs**',route=>{
    const path=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(body)mutations.push({path,body});
    if(path==='inspect')return route.fulfill(body.path==='bad'?{status:400,json:{detail:'请选择包含 library.db 的光影集图库目录'}}:{json:target});
    if(path==='select')status.pending={...target,selection_id:'selected-target'};
    if(path==='cancel')status.pending=null;
    if(path==='activate')return ++attempts===1?route.fulfill({status:409,json:{detail:'请先等待或取消后台任务，再切换图库'}}):route.fulfill({json:{restarting:true}});
    return route.fulfill({json:status});
  });
  await page.goto('/?page=settings');const panel=page.locator('.catalog-settings');await panel.locator('summary').click();await expect(panel.getByText(current.path,{exact:true}).first()).toBeVisible();expect(mutations).toEqual([]);
  const input=panel.getByLabel(lang==='en'?'Target library directory':'目标图库目录',{exact:true});await input.fill('bad');await panel.getByRole('button',{name:lang==='en'?'Inspect existing library':'检查已有图库',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();
  await panel.getByRole('button',{name:lang==='en'?'Choose library directory':'选择图库目录',exact:true}).click();await expect(input).toHaveValue(target.path);
  await panel.getByRole('button',{name:lang==='en'?'Inspect existing library':'检查已有图库',exact:true}).click();await expect(panel.locator('.catalog-preview')).toContainText('12');
  await panel.getByRole('button',{name:lang==='en'?'Select this library':'选择此图库',exact:true}).click();await expect(panel.locator('.catalog-pending')).toContainText(target.path);expect((await(await request.get('/api/workspace')).json()).library_id).toBe(identity);
  await panel.getByRole('button',{name:lang==='en'?'Cancel library switch':'取消图库切换',exact:true}).click();await expect(panel.locator('.catalog-pending')).toHaveCount(0);
  await panel.locator('.catalog-recent>div').last().getByRole('button').click();await expect(panel.locator('.catalog-pending')).toBeVisible();
  const activate=panel.getByRole('button',{name:lang==='en'?'Switch and reopen':'切换并重新打开',exact:true});await activate.click();await expect(panel.getByRole('alert')).toContainText(lang==='en'?'background tasks':'后台任务');
  expect((await(await request.get('/api/photos')).json()).total).toBe(records);
  if(lang==='en')expect(await panel.innerText()).not.toMatch(/[\u3400-\u9fff]/u);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await panel.screenshot({path:info.outputPath('catalogs.png')});
  await activate.click();await expect(panel.getByRole('status')).toContainText(lang==='en'?'Switching libraries':'正在切换图库');await expect(input).toBeDisabled();expect(attempts).toBe(2);expect(errors).toEqual([]);
  expect(mutations.filter(item=>item.path==='select').every(item=>item.body.library_id===identity)).toBe(true);
});

test('a library fixed by startup settings disables selection and never opens the picker',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('onboarded','1'));let pickers=0;await page.route('**/api/dialog/catalog',route=>{pickers++;return route.fulfill({json:{paths:[]}});});
  await page.goto('/?page=settings');const panel=page.locator('.catalog-settings');await panel.locator('summary').click();await expect(panel.getByText('图库由启动配置指定，不能在此切换',{exact:true})).toBeVisible();await expect(panel.getByLabel('目标图库目录',{exact:true})).toBeDisabled();expect(pickers).toBe(0);
});

test('malformed library status is isolated from existing settings and explicit refresh recovers',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('onboarded','1'));const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/workspace/catalogs',route=>route.fulfill({json:{current:{}}}));await page.goto('/?page=settings');
  const panel=page.locator('.catalog-settings');await panel.locator('summary').click();await expect(panel.getByRole('alert')).toContainText('图库状态格式不匹配');
  await expect(page.getByRole('heading',{name:'照片库与存储',exact:true})).toBeVisible();await expect(page.getByLabel('照片库（数据库与缓存）',{exact:true})).toBeVisible();
  await page.unroute('**/api/workspace/catalogs');await panel.getByRole('button',{name:'刷新图库列表',exact:true}).click();await expect(panel.getByRole('alert')).toHaveCount(0);await expect(panel.getByText('图库由启动配置指定，不能在此切换',{exact:true})).toBeVisible();expect(errors).toEqual([]);
});
