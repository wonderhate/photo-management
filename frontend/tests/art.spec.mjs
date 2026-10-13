import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

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
  await page.route('**/api/art/settings',r=>r.fulfill({json:{configured:true,key_source:'environment',can_save_key:true,image_model:'gpt-image-2',title_model:'gpt-4.1-mini',exports_dir:health.exports_dir}}));
  await page.route('**/api/art/titles',r=>{titles++;return r.fulfill({status:202,json:completed('watercolor-title',{suggestions:[{title:'A Quiet Journey',evidence:'Visible hills; location unverified'}]})})});
  await page.route('**/api/art/generate',r=>{generates++;expect(r.request().postDataJSON().title_confirmed).toBe(true);return r.fulfill({status:202,json:completed('watercolor',{artwork_id:fixture})})});
  await page.goto('/watercolor?photo='+photo.id);
  const en=lang==='en';
  await expect(page.getByRole('heading',{name:en?'Watercolor':'水彩转绘',exact:true})).toBeVisible();
  const generate=page.getByRole('button',{name:en?'Generate Watercolor Poster':'生成水彩海报',exact:true});
  await expect(generate).toBeDisabled();
  await page.getByText(en?'Suggest titles from the photo':'从画面建议标题',{exact:true}).click();
  await page.getByRole('button',{name:en?'Suggest Titles':'建议标题',exact:true}).click();
  await page.locator('.art-suggestion').click();
  await expect(generate).toBeDisabled();
  await page.getByLabel(en?'Use this title':'使用这个标题',{exact:true}).check();
  await generate.click();
  await expect(page.locator('.art-canvas>img')).toBeVisible();
  await expect(page.getByLabel(en?'Poster Title':'海报标题',{exact:true})).toHaveValue('A Quiet Journey');
  await page.getByLabel(en?'Poster Title':'海报标题',{exact:true}).fill('Quiet Water');
  await expect(page.getByRole('button',{name:en?'Save Layout':'保存排版',exact:true})).toBeDisabled();
  await page.getByLabel(en?'Use this title':'使用这个标题',{exact:true}).check();
  await page.getByLabel(en?'Layout':'留白版式',{exact:true}).selectOption('reference');
  await expect(page.locator('.art-canvas>img')).toHaveAttribute('src',/^blob:/);
  await page.getByRole('button',{name:en?'Save Layout':'保存排版',exact:true}).click();
  await expect(page.getByRole('button',{name:'PNG',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'PNG',exact:true}).click();
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
  expect(errors).toEqual([]);
});
