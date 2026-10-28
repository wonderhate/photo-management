import {test,expect} from './fixtures/native-runtime.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`optional import faces stays local and unavailable models do not block photos ${width} ${lang}`,async({page,request},info)=>{
  const text=(zh,en)=>lang==='en'?en:zh,health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const paths=[0,1].map(i=>join(health.data_dir,`AF31-${width}-${i}.jpg`));execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;[Image.new('RGB',(340+i*8,250),(int(sys.argv[1])%200,35+i*50,71)).save(p) for i,p in enumerate(sys.argv[2:])]",String(width),...paths]);
  const hashes=()=>paths.map(p=>createHash('sha256').update(readFileSync(p)).digest('hex')),before=hashes();let inference=0;
  page.on('request',r=>{if(/\/api\/faces\/(models|analyze)$/.test(new URL(r.url()).pathname))inference++;});
  await request.put('/api/faces/import-policy',{data:{enabled:false}});
  await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark')},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});
  const card=()=>page.getByRole('region',{name:text('导入后人物分析','Face analysis after import'),exact:true}),toggle=()=>card().getByRole('checkbox'),policy=async()=>(await(await request.get('/api/faces/import-policy')).json());
  async function imported(path){const job=await(await request.post('/api/photos/import',{data:{paths:[path]}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');return(await(await request.get('/api/jobs/'+job.id)).json());}
  try{
    await page.goto('/?page=settings');await expect(toggle()).toBeEnabled();await expect(toggle()).not.toBeChecked();await expect(card().getByRole('status')).toContainText(text('模型未就绪','models are not ready'));
    await toggle().focus();await page.keyboard.press('Space');await expect(toggle()).toBeChecked();await expect.poll(async()=>(await policy()).enabled).toBe(true);await page.reload();await expect(toggle()).toBeChecked();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(lang==='en')expect(await card().innerText()).not.toMatch(/[\u3400-\u9fff]/);await card().scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('import-face-settings.png'),fullPage:true});
    const root=await imported(paths[0]);expect(root.auto_face_analysis).toEqual({status:'models_unavailable',new_count:1});expect(root.success).toBe(1);expect((await request.get('/api/photos?search='+paths[0].split(/[\\/]/).pop())).ok()).toBe(true);
    await page.getByRole('button',{name:text('活动中心','Activity center'),exact:true}).click();const modal=page.getByRole('dialog');await modal.locator(`.activity-list [data-task-id="${root.id}"]`).click();await expect(modal.getByRole('region',{name:text('任务详情','Task details'),exact:true}).getByRole('status')).toContainText(text('照片已导入','Photos were imported'));await page.screenshot({path:info.outputPath('import-face-task.png'),fullPage:true});
    await page.keyboard.press('Escape');const repeated=await imported(paths[0]);expect(repeated.auto_face_analysis).toEqual({status:'no_new_photos',new_count:0});
    await toggle().click();await expect.poll(async()=>(await policy()).enabled).toBe(false);await page.reload();await expect(toggle()).not.toBeChecked();const manual=await imported(paths[1]);expect(manual.auto_face_analysis).toBeUndefined();expect(inference).toBe(0);expect(hashes()).toEqual(before);
  }finally{await request.put('/api/faces/import-policy',{data:{enabled:false}});}
});

test('failed import face preference keeps the saved decision and permits an explicit retry',async({page,request})=>{
  await request.put('/api/faces/import-policy',{data:{enabled:false}});await page.addInitScript(()=>{localStorage.setItem('lang','en');localStorage.setItem('onboarded','1')});
  try{
    await page.goto('/?page=settings');const card=page.getByRole('region',{name:'Face analysis after import',exact:true}),toggle=card.getByRole('checkbox');await expect(toggle).toBeEnabled();
    await page.route('**/api/faces/import-policy',async route=>route.fulfill({status:503,json:{detail:'请求失败'}}),{times:1});
    await toggle.click();await expect(card.getByRole('alert')).toBeVisible();await expect(toggle).not.toBeChecked();expect((await(await request.get('/api/faces/import-policy')).json()).enabled).toBe(false);
    await toggle.click();await expect(toggle).toBeChecked();await expect(card.getByRole('alert')).toHaveCount(0);await page.reload();await expect(page.getByRole('checkbox',{name:'Automatically analyze new photos after import',exact:true})).toBeChecked();
  }finally{await request.put('/api/faces/import-policy',{data:{enabled:false}});}
});
