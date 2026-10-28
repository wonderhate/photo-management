import {test,expect} from './fixtures/native-runtime.mjs';
import {synthetic} from './fixtures/workspace.mjs';

test('native recent export refreshes the process session for the same library',async({page,context})=>{
  const {errors}=await synthetic(page),requests=[];
  await page.route('**/api/workspace',route=>route.fulfill({headers:{'X-PhotoCollection-Library':'synthetic-library','X-PhotoCollection-Session':'current-session'},json:{library_id:'synthetic-library',preferences:{}}}));
  await context.route('**/api/exports/recent.png*',route=>{requests.push(new URL(route.request().url()).searchParams.get('pc_session'));return route.fulfill({contentType:'text/plain',body:'synthetic exported bytes'});});
  await page.addInitScript(()=>localStorage.setItem('recent-ops',JSON.stringify([{kind:'export',label:'Native recent export',time:Date.now(),payload:{libraryId:'synthetic-library',file:{url:'/api/exports/recent.png?pc_session=old-session',name:'recent.png'}}}])));
  await page.goto('/?page=photos');await page.getByRole('button',{name:'最近操作',exact:true}).click();const opened=context.waitForEvent('page');await page.locator('.recent-item').filter({hasText:'Native recent export'}).click();const popup=await opened;await expect(popup.locator('body')).toHaveText('synthetic exported bytes');expect(requests).toEqual(['current-session']);expect(errors).toEqual([]);
});

test('native recent exports reject a different library and an unverifiable old session',async({page,context})=>{
  const {errors}=await synthetic(page);let fileRequests=0,popups=0;
  context.on('page',()=>popups++);
  await page.route('**/api/workspace',route=>route.fulfill({headers:{'X-PhotoCollection-Library':'synthetic-library','X-PhotoCollection-Session':'current-session'},json:{library_id:'synthetic-library',preferences:{}}}));
  await context.route('**/api/exports/**',route=>{fileRequests++;return route.abort();});
  await page.addInitScript(()=>localStorage.setItem('recent-ops',JSON.stringify([
    {kind:'export',label:'Other library export',time:Date.now(),payload:{libraryId:'another-library',file:{url:'/api/exports/recent.png',name:'recent.png'}}},
    {kind:'export',label:'Unknown old export',time:Date.now(),payload:{urls:['/api/exports/recent.png?pc_session=unknown-session']}}
  ])));
  await page.goto('/?page=photos');
  for(const [label,error] of [['Other library export','此导出属于其他图库，请先打开对应图库。'],['Unknown old export','无法核验这条旧记录的图库身份，请从活动中心打开导出。']]){await page.getByRole('button',{name:'最近操作',exact:true}).click();await page.locator('.recent-item').filter({hasText:label}).click();await expect(page.getByText(error,{exact:true})).toBeVisible();}
  expect(fileRequests).toBe(0);expect(popups).toBe(0);expect(errors).toEqual([]);
});
