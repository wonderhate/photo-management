import {test,expect} from './fixtures/native-runtime.mjs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

test('native AI settings keep newer form input when a previous save finishes',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('onboarded','1');localStorage.setItem('lang','zh');});
  const initial={configured:false,key_error:false,can_save_key:true,key_source:'none',endpoint:'https://synthetic.invalid',image_model:'qwen-image-3.0',title_model:'qwen3-vl-plus',exports_dir:'synthetic-exports'},writes=[];
  let release,started=false;
  await page.route('**/api/art/settings',async route=>{
    if(route.request().method()!=='PUT')return route.fulfill({json:initial});
    const body=route.request().postDataJSON();writes.push(body);
    if(writes.length===1){started=true;await new Promise(resolve=>release=resolve);}
    return route.fulfill({json:{...initial,...body,configured:!!body.api_key}});
  });
  await page.goto('/watercolor');await page.getByRole('button',{name:'AI 服务设置',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'AI 服务设置'}),key=settings.getByLabel('API Key',{exact:true}),title=settings.getByLabel('标题建议模型',{exact:true}),model=settings.getByRole('combobox',{name:'图像模型',exact:true}),save=settings.getByRole('button',{name:'保存设置',exact:true});
  await save.click();await expect.poll(()=>started).toBe(true);
  await key.fill('synthetic-later-key');await title.fill('qwen-synthetic-newer');await model.selectOption('qwen-image-3.0-pro');release();
  await expect(save).toBeEnabled();await expect(key).toHaveValue('synthetic-later-key');await expect(title).toHaveValue('qwen-synthetic-newer');await expect(model).toHaveValue('qwen-image-3.0-pro');
  await save.click();await expect(settings.getByText('API Key 已配置',{exact:true})).toBeVisible();await expect(key).toHaveValue('');
  expect(writes).toHaveLength(2);expect(writes[0].api_key).toBeUndefined();expect(writes[1]).toMatchObject({api_key:'synthetic-later-key',title_model:'qwen-synthetic-newer',image_model:'qwen-image-3.0-pro'});
});

for(const [width,theme,lang] of [[1440,'light','zh'],[1440,'dark','en'],[390,'light','en']])test(`watercolor workflow ${width} ${theme} ${lang}`,async({page,request},info)=>{
  test.setTimeout(90000);
  page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setViewportSize({width,height:1000});
  await page.addInitScript(({theme,lang})=>{localStorage.setItem('theme',theme);localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1')},{theme,lang});
  const health=await(await request.get('/api/health')).json();
  expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const source=join(health.data_dir,`art-${width}-${theme}.jpg`);
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image, ImageDraw; import sys; im=Image.new('RGB',(1200,800),'#c5d8d0'); d=ImageDraw.Draw(im); d.polygon([(0,580),(320,220),(560,510),(850,290),(1200,580)],fill='#779189'); d.rectangle((0,580,1200,800),fill='#acc8cf'); d.text((20,20),sys.argv[1],fill='white'); im.save(sys.argv[1])",source]);
  const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();
  await expect.poll(async()=> (await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  const photo=(await(await request.get('/api/photos')).json()).photos.find(p=>p.file_name===`art-${width}-${theme}.jpg`);
  // Local synthetic scene fixture exercises actual persistence/layout/export. No cloud calls.
  const fixture=execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',[
    'import sys',
    'from backend.app.models import Session, Artwork, uid',
    'from backend.app.services.art_service import folder_for, poster, save_poster',
    'from backend.app.services.thumbnail_service import open_image',
    'from backend.app.art_schemas import ArtLayout',
    'from pathlib import Path',
    'scene=open_image(Path(sys.argv[2]))',
    'layout=ArtLayout(title="A Quiet Journey")',
    'image=poster(scene,scene.size,layout)',
    'item=Artwork(id=uid(),photo_id=sys.argv[1],source_json={"file_name":Path(sys.argv[2]).name,"width":scene.width,"height":scene.height},settings_json=layout.model_dump(),generation_json={"model":"test-fixture","seconds":0},width=image.width,height=image.height)',
    'folder=folder_for(item.id); folder.mkdir(parents=True); scene.save(folder/"scene.png"); save_poster(folder,image,1)',
    'session=Session(); session.add(item); session.commit(); print(item.id); session.close()',
  ].join('\n'),photo.id,source],{cwd:join(import.meta.dirname,'../..'),env:{...process.env,PHOTO_DATA_DIR:health.data_dir,PHOTO_AUTOLOAD_AI:'0'},encoding:'utf8'}).trim();
  let generates=0,titles=0;
  const completed=(kind,extra)=>({id:'mock-'+kind,kind,status:'completed',total:1,processed:1,success:1,failed:0,skipped:0,errors:[],results:[],current:'',photo_id:photo.id,...extra});
  let config={configured:true,key_source:'environment',can_save_key:true,image_model:'qwen-image-3.0',title_model:'qwen3-vl-plus',endpoint:'https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',exports_dir:health.exports_dir};
  await page.route('**/api/art/settings',r=>{if(r.request().method()==='PUT')config={...config,...r.request().postDataJSON()};return r.fulfill({json:config})});
  await page.route('**/api/art/jobs',r=>r.fulfill({json:[{id:'legacy-openai',kind:'watercolor',status:'failed',error:'Old OpenAI request failed with 429'}]}));
  await page.route('**/api/art/titles',r=>{titles++;expect(r.request().postDataJSON().language).toBe(lang);return r.fulfill({status:202,json:completed('watercolor-title',{suggestions:[{title:'A Quiet Journey',evidence:'Visible hills; location unverified'}]})})});
  await page.route('**/api/art/generate',r=>{generates++;expect(r.request().postDataJSON().title_confirmed).toBe(true);expect(r.request().postDataJSON().cloud_confirmed).toBe(true);return r.fulfill({status:202,json:completed('watercolor',{artwork_id:fixture})})});
  const history=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/art/jobs');
  await page.goto('/watercolor?photo='+photo.id);
  await (await history).finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const en=lang==='en';
  await expect(page.getByRole('heading',{name:en?'Watercolor':'水彩转绘',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.art-task')).toHaveCount(0);
  await page.getByRole('button',{name:en?'AI Service Settings':'AI 服务设置',exact:true}).click();
  const model=page.getByLabel(en?'Image Model':'图像模型',{exact:true});
  await expect(model).toHaveValue('qwen-image-3.0');
  if(en)expect(await page.getByRole('dialog').innerText()).not.toMatch(/[\u3400-\u9fff]/u);
  await model.selectOption('qwen-image-3.0-pro');
  await page.getByRole('button',{name:en?'Save Settings':'保存设置',exact:true}).click();
  await expect.poll(()=>config.image_model).toBe('qwen-image-3.0-pro');
  await page.locator('.modal header button').click();
  const generate=page.getByRole('button',{name:en?'Generate Watercolor Poster':'生成水彩海报',exact:true});
  await expect(generate).toBeDisabled();
  await page.getByText(en?'Suggest titles from the photo':'从画面建议标题',{exact:true}).click();
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:en?'Suggest Titles':'建议标题',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();expect(titles).toBe(0);expect(generates).toBe(0);
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('qwen3-vl-plus');await dialog.accept()});
  await page.getByRole('button',{name:en?'Suggest Titles':'建议标题',exact:true}).click();
  await page.locator('.art-suggestion').click();
  await expect(generate).toBeDisabled();
  await page.getByLabel(en?'Use this title':'使用这个标题',{exact:true}).check();
  page.once('dialog',dialog=>dialog.dismiss());await generate.click();
  await expect(page.getByRole('alert')).toBeVisible();expect(generates).toBe(0);
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('qwen-image-3.0-pro');await dialog.accept()});
  await generate.click();
  await expect(page.locator('.art-canvas>img')).toBeVisible();
  await expect(page.getByLabel(en?'Poster Title':'海报标题',{exact:true})).toHaveValue('A Quiet Journey');
  await page.getByLabel(en?'Poster Title':'海报标题',{exact:true}).fill('Quiet Water');
  await expect(page.getByRole('button',{name:en?'Save Layout':'保存排版',exact:true})).toBeDisabled();
  await page.locator('.art-heading h1').click();await page.keyboard.press('Control+s');expect((await(await request.get('/api/art/works/'+fixture)).json()).layout.title).toBe('A Quiet Journey');
  await page.getByRole('button',{name:en?'Edit actions':'编辑操作菜单',exact:true}).click();await expect(page.getByRole('menuitem',{name:en?'Save Layout':'保存排版',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(page.locator('.art-canvas')).toBeVisible();

  let discarded=0;
  const keepEdits=async dialog=>{discarded++;await dialog.dismiss()};
  page.on('dialog',keepEdits);
  await page.getByRole('button',{name:en?'Choose Photos':'选择照片',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('.art-picker-grid button').first().click();
  await page.getByRole('button',{name:en?'Use Selected Photos':'使用所选照片',exact:true}).click();
  expect(discarded).toBe(1);
  await page.locator('.modal header button').click();
  page.off('dialog',keepEdits);
  await expect(page.getByLabel(en?'Poster Title':'海报标题',{exact:true})).toHaveValue('Quiet Water');
  await page.getByLabel(en?'Use this title':'使用这个标题',{exact:true}).check();
  await page.getByLabel(en?'Layout':'留白版式',{exact:true}).selectOption('reference');
  await expect(page.locator('.art-canvas>img')).toHaveAttribute('src',/^blob:/);
  await page.locator('.art-heading h1').click();await page.keyboard.press('Control+s');
  await expect(page.getByRole('button',{name:'PNG',exact:true})).toBeEnabled();
  await page.locator('.art-heading h1').click();await page.keyboard.press('Control+e');
  await expect(page.locator('.art-export a')).toBeVisible();
  expect(generates).toBe(1);expect(titles).toBe(1);
  const saved=await(await request.get('/api/art/works/'+fixture)).json();
  expect(saved.layout.title).toBe('Quiet Water');expect(saved.layout.layout).toBe('reference');
  await expect.poll(()=>page.locator('.art-canvas>img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(en)expect(await page.locator('.art-page').innerText()).not.toMatch(/[\u3400-\u9fff]/u);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:info.outputPath('watercolor.png'),fullPage:true});
  await page.reload();
  await page.getByRole('button',{name:en?/Watercolor Works/:/水彩作品/}).click();
  await page.locator('.art-work-open').filter({hasText:'Quiet Water'}).first().click();
  await expect(page.getByLabel(en?'Poster Title':'海报标题',{exact:true})).toHaveValue('Quiet Water');
  await page.getByRole('button',{name:en?'Send to Watermark Studio':'送入水印工坊',exact:true}).click();
  await expect(page).toHaveURL(/\/watermark\/workshop\?draft=/);
  const draftId=new URL(page.url()).searchParams.get('draft');
  await expect(page.locator('.render-stage>img')).toBeVisible();
  await expect(page.locator('.watermark-caption')).toContainText(en?'Saved watercolor poster':'水彩海报快照');
  await page.getByRole('button',{name:en?'Ambient Light':'沉浸光感',exact:true}).click();
  await page.getByRole('button',{name:en?'Export Current Photo':'导出当前照片',exact:true}).click();
  await expect(page.locator('.download-result')).toBeVisible();
  const draft=await(await request.get('/api/watermark/drafts/'+draftId)).json();
  expect(draft.artwork_id).toBe(fixture);expect(draft.settings_json.template).toBe('ambient');
  await page.reload();
  await expect(page.locator('.render-stage>img')).toBeVisible();
  await expect(page.locator('.watermark-caption')).toContainText(en?'Saved watercolor poster':'水彩海报快照');
  expect(errors).toEqual([]);
});

for(const [width,theme,lang,withTitles] of [[1440,'light','zh',false],[1440,'dark','en',true],[390,'light','en',true]])test(`batch watercolor upload ${width} ${theme} ${lang}`,async({page,request},info)=>{
  test.setTimeout(60000);
  const en=lang==='en',errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.setViewportSize({width,height:1000});
  await page.addInitScript(({theme,lang})=>{localStorage.setItem('theme',theme);localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1')},{theme,lang});
  const health=await(await request.get('/api/health')).json();
  expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const paths=[0,1].map(index=>join(health.data_dir,`batch-ui-${width}-${theme}-${index}.jpg`));
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image; import sys; [Image.new('RGB',(320,240),(30+i*80,90,120)).save(p) for i,p in enumerate(sys.argv[1:])]",...paths]);
  await page.route('**/api/art/settings',r=>r.fulfill({json:{configured:true,key_source:'environment',can_save_key:true,image_model:'qwen-image-3.0',title_model:'qwen3-vl-plus',endpoint:'mock',exports_dir:health.exports_dir}}));
  await page.route('**/api/art/jobs',r=>r.fulfill({json:[{id:'old-failure',kind:'watercolor',status:'failed',error:'Old OpenAI request failed with 429'}]}));
  let batch;
  await page.route('**/api/art/batch',r=>{batch=r.request().postDataJSON();return r.fulfill({status:202,json:{id:'ui-batch',kind:'watercolor-batch',status:'queued',total:2,processed:0,success:0,failed:0,results:[]}})});
  await page.route('**/api/jobs/ui-batch',r=>r.fulfill({json:{id:'ui-batch',kind:'watercolor-batch',status:'completed',total:2,processed:2,success:2,failed:0,stage:withTitles?'titles':'images',title_processed:withTitles?2:0,title_total:withTitles?2:0,results:batch.photo_ids.map((photo_id,i)=>({photo_id,artwork_id:'ui-work-'+i,file_name:'batch-'+i+'.jpg',...(withTitles?{title:'Quiet Journey '+i,title_status:'completed'}:{title_status:'skipped'})}))}}));
  await page.route('**/api/art/works/ui-work-*/preview',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#acc8cf"/></svg>'}));
  await page.goto('/watercolor');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(paths);
  const titles=page.getByLabel(en?'Generate and apply an AI title to each completed image (optional)':'图片生成后逐张生成并应用 AI 标题（可选）',{exact:true});
  await expect(titles).toBeEnabled();
  await expect(titles).not.toBeChecked();
  if(!withTitles){
    await page.getByRole('button',{name:'选择照片',exact:true}).click();
    const picker=page.getByRole('dialog');
    await picker.getByRole('textbox',{name:'文件名',exact:true}).fill('batch-ui');
    await expect(picker.locator('.art-picker-grid button')).toHaveCount(2);
    await picker.locator('.art-picker-grid button').first().click();
    await expect(picker.locator('[aria-pressed=true]')).toHaveCount(1);
    await picker.locator('.art-picker-grid button').first().click();
    await picker.getByRole('button',{name:'使用所选照片',exact:true}).click();
  }
  if(withTitles)await titles.check();
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:en?'Generate 2 Watercolor Posters':'生成 2 张水彩海报',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();expect(batch).toBeUndefined();
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('2');await dialog.accept()});
  await page.getByRole('button',{name:en?'Generate 2 Watercolor Posters':'生成 2 张水彩海报',exact:true}).click();
  await expect(page.locator('.art-batch-results article')).toHaveCount(2);
  expect(batch.generate_titles).toBe(withTitles);expect(batch.cloud_confirmed).toBe(true);
  expect(batch.photo_ids).toHaveLength(2);
  expect(batch.language).toBe(lang);
  if(withTitles)await expect(page.locator('.art-batch-results')).toContainText('Quiet Journey 1');
  await expect(page.locator('.art-task')).toContainText(en?'Succeeded 2':'成功 2');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(en)expect(await page.locator('.art-page').innerText()).not.toMatch(/[\u3400-\u9fff]/u);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:info.outputPath('batch-watercolor.png'),fullPage:true});
  if(!withTitles){
    await page.route('**/api/art/batch',r=>r.fulfill({status:400,json:{detail:'New Qwen failure'}}));
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'生成 2 张水彩海报',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('New Qwen failure');
  }
  await page.reload();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.art-task')).toHaveCount(0);
  expect(errors).toEqual([]);
});
