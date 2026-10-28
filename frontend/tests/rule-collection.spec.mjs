import {test,expect} from './fixtures/native-runtime.mjs';
import {createRuleThroughUI} from './fixtures/rule-collection.mjs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`rule collections compose AND OR NOT and update live ${width} ${lang}`,async({page,request},info)=>{
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const prefix='Rule-'+width+'-',paths=[0,1,2].map(i=>join(health.data_dir,prefix+i+'.jpg'));
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;[(Image.new('RGB',(60,40),(30+i*50,100,140)).save(p,comment=p.encode())) for i,p in enumerate(sys.argv[1:])]",...paths]);
  const hashes=()=>paths.map(p=>createHash('sha256').update(readFileSync(p)).digest('hex')),before=hashes();
  const job=await(await request.post('/api/photos/import',{data:{paths}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  const photos=(await(await request.get('/api/photos?search='+prefix)).json()).photos.sort((a,b)=>a.file_name.localeCompare(b.file_name));expect(photos).toHaveLength(3);
  await request.patch('/api/photos/'+photos[1].id,{data:{rating:0}});await request.patch('/api/photos/'+photos[2].id,{data:{rating:4}});
  let album;
  try{
    await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1200});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?page=albums');
    const card=await createRuleThroughUI(page,{lang,prefix,name:'Rule collection '+width,screenshot:info.outputPath('rule-dialog.png')});
    album=(await(await request.get('/api/albums')).json()).find(a=>a.name==='Rule collection '+width);expect(album.type).toBe('rule');expect(album.count).toBe(2);
    await page.reload();await expect(card).toContainText(lang==='en'?'Rule collection':'条件集合');await card.getByRole('button',{name:lang==='en'?'Open Album ↗':'打开影集 ↗',exact:true}).click();
    await expect(page.locator('.photo-card')).toHaveCount(2);await expect(page.getByRole('combobox',{name:lang==='en'?'Photo Sort Order':'照片排序',exact:true}).locator('option[value="manual"]')).toHaveCount(0);
    const zero=page.locator('.photo-card').filter({hasText:photos[1].file_name});await zero.hover();const drawer=page.getByRole('complementary',{name:lang==='en'?'Hovered photo information':'悬停照片信息',exact:true});await expect(drawer).toBeVisible();await drawer.getByRole('button',{name:lang==='en'?'1 stars':'1 星',exact:true}).click();await expect(page.locator('.photo-card')).toHaveCount(1);
    await drawer.getByRole('button',{name:lang==='en'?'Close photo information':'关闭照片信息',exact:true}).click();await page.locator('.workspace-subnav').getByRole('button',{name:lang==='en'?'Albums':'影集',exact:true}).click();await expect(card).toContainText(lang==='en'?'1 captures':'1 次拍摄');
    await card.getByRole('button',{name:lang==='en'?'Edit rules':'编辑条件',exact:true}).click();const dialog=page.getByRole('dialog',{name:lang==='en'?'Edit rule collection':'编辑条件集合',exact:true});await dialog.getByRole('textbox',{name:lang==='en'?'Album Name':'影集名称',exact:true}).fill('Edited '+width);await dialog.getByRole('button',{name:lang==='en'?'Save rule collection':'保存条件集合',exact:true}).click();await expect(dialog).not.toBeVisible();expect((await(await request.get('/api/albums/'+album.id)).json()).name).toBe('Edited '+width);expect(hashes()).toEqual(before);
  }finally{if(album)await request.delete('/api/albums/'+album.id);for(const p of photos)await request.delete('/api/photos/'+p.id+'?scope=file');expect(hashes()).toEqual(before);}
});
