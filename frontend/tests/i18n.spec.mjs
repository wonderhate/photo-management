import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

test('English interface covers pages, dialogs and live language changes',async({page,request},testInfo)=>{
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('response',response=>{if(response.status()>=500)errors.push(`${response.status()} ${response.url()}`)});
  const health=await(await request.get('/api/health')).json();
  expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const source=join(health.data_dir,'用户的照片.jpg');
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image; from PIL.TiffImagePlugin import IFDRational; import sys; exif=Image.Exif(); exif[272]='Test Camera'; exif[36867]='2026:09:29 18:24:00'; exif[37386]=IFDRational(50); exif[33437]=IFDRational(28,10); exif[33434]=IFDRational(1,125); exif[34855]=400; exif[42036]='Test Lens'; Image.new('RGB',(640,480),'cornflowerblue').save(sys.argv[1],exif=exif)",source]);
  const digest=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=digest();
  const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();
  await expect.poll(async()=> (await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  const photo=(await(await request.get('/api/photos')).json()).photos.find(p=>p.file_name==='用户的照片.jpg');
  await request.patch('/api/photos/'+photo.id,{data:{tags:['用户自定义标签']}});
  const person={id:'language-person',name:'用户自定义人物',photo_count:1,pending:1};
  await page.route('**/api/faces/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let json;
    if(path==='/api/faces/status')json={available:true,dependency:true,cached:true};
    else if(path==='/api/faces/persons')json=[person];
    else if(path.endsWith('/confirm')){person.pending=0;json={updated:1}}
    else if(path.endsWith('/photos'))json={photos:[photo],total:1};
    else if(path==='/api/faces/review')json={faces:[{id:'language-face',person_id:person.id,confirmed:!person.pending,thumbnail_url:photo.thumbnail_url}],total:1};
    else json={};
    await route.fulfill({json});
  });
  const content=['用户的照片','用户自定义标签','用户自定义人物','用户自定义作品','用户自定义影集'];
  await page.addInitScript(()=>{localStorage.setItem('lang','en');localStorage.setItem('theme','light');localStorage.setItem('onboarded','1')});
  await page.setViewportSize({width:1440,height:1000});
  async function checkEnglish(name){
    await expect(page.locator('html')).toHaveAttribute('lang','en');
    const remaining=await page.evaluate(content=>{
      const values=[document.title,...document.body.innerText.split('\n')];
      for(const el of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]')){
        for(const attr of ['title','aria-label','placeholder','alt'])if(el.hasAttribute(attr))values.push(el.getAttribute(attr));
      }
      return values.map(value=>content.reduce((text,original)=>text.replaceAll(original,''),value)).filter(value=>/[\u3400-\u9fff]/u.test(value));
    },content);
    expect(remaining,`Chinese UI text in ${name}`).toEqual([]);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth?[]:[{scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth},...[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+.001).slice(0,8).map(el=>({element:el.tagName,class:el.className,width:Math.round(el.getBoundingClientRect().width),right:el.getBoundingClientRect().right,text:el.textContent.slice(0,70)}))]);
    expect(overflow,`Horizontal overflow in ${name}`).toEqual([]);
  }
  for(const path of ['/?page=home','/?page=photos','/?page=albums','/?page=smart','/timeline','/faces','/?page=stats','/?page=reports','/watermark/gallery','/?page=settings','/compare?ids='+photo.id]){
    await page.goto(path);await page.waitForLoadState('networkidle');await checkEnglish(path);
  }
  await page.goto('/timeline');
  await page.locator('.timeline-year>button').first().click();
  await page.locator('.timeline-month>button').first().click();
  await expect(page.locator('.timeline-month>button')).toContainText('September');
  await checkEnglish('expanded timeline');
  await page.goto('/faces');
  await page.getByRole('button',{name:'View Photos',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review Face Groups'})).toBeVisible();
  await checkEnglish('face review');
  await page.getByRole('button',{name:'Confirm Group',exact:true}).click();
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Person Album Name');expect(dialog.defaultValue()).toBe(person.name);await dialog.dismiss()});
  await page.getByRole('button',{name:'Create Person Album',exact:true}).click();
  await page.goto('/?page=albums');
  await page.getByRole('button',{name:'New Album',exact:true}).click();
  await checkEnglish('album dialog');
  await page.getByLabel('Album Name',{exact:true}).fill('用户自定义影集');
  await page.getByRole('button',{name:'Add Photos Manually',exact:true}).click();
  await checkEnglish('manual photo selection');
  await page.getByRole('dialog',{name:'Choose More Library Photos'}).getByRole('button',{name:'View 用户的照片.jpg',exact:true}).click();
  await page.getByRole('button',{name:/^Done · Selected/}).click();
  await page.getByRole('button',{name:/^Save Album ·/}).click();
  await expect(page.locator('.album-card h3')).toContainText(['用户自定义影集']);
  await checkEnglish('saved user album');
  await page.goto('/?page=smart');
  await page.getByRole('button',{name:'New Smart Album',exact:true}).click();
  await checkEnglish('smart album dialog');
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.goto('/?page=settings');
  const language=page.locator('.settings-card').filter({has:page.getByRole('heading',{name:/^(Language|界面语言)$/})}).locator('select');
  const scans=page.getByRole('textbox',{name:'Automatic Scan Folders',exact:true});
  await scans.fill('C:/unsaved-scan-folder');
  await language.selectOption('zh');
  await expect(page.getByRole('heading',{name:'照片库与存储',exact:true})).toBeVisible();
  await language.selectOption('en');
  await expect(scans).toHaveValue('C:/unsaved-scan-folder');
  await checkEnglish('live language change');
  await page.locator('.plugin-row button').first().click();
  await expect(page.locator('.plugin-output')).toBeVisible();
  await checkEnglish('plugin output');
  await page.goto('/?page=photos');
  await page.getByRole('button',{name:'Import Photos',exact:true}).click();
  await checkEnglish('import dialog');await page.keyboard.press('Escape');
  await page.keyboard.press('?');await checkEnglish('shortcuts dialog');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'View 用户的照片.jpg',exact:true}).click();
  await expect(page.locator('.detail-image')).toBeVisible();
  await checkEnglish('photo detail');await page.keyboard.press('Escape');
  await page.locator('.select-box').first().click();
  await page.getByRole('button',{name:'Batch Edit',exact:true}).click();
  await checkEnglish('batch edit dialog');await page.keyboard.press('Escape');
  await page.goto('/watermark/workshop?photo='+photo.id);
  await expect(page.getByAltText('Live watermark preview')).toBeVisible();
  const slider=page.locator('input[type=range]').first();await slider.focus();await slider.press('ArrowRight');
  const changedValue=await slider.inputValue();
  await page.locator('.sidebar nav').getByRole('button',{name:'Albums',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Unsaved Watermark'})).toBeVisible();
  await checkEnglish('unsaved watermark dialog');
  await page.getByRole('button',{name:'Continue Editing',exact:true}).click();
  await expect(slider).toHaveValue(changedValue);
  await page.getByRole('textbox',{name:'Watermark Work Name'}).fill('用户自定义作品');
  await page.getByRole('button',{name:'Save to Watermark Gallery',exact:true}).click();
  await expect(page.locator('.draft-editor-bar [role=status]')).toHaveText('Saved');
  const draftId=new URL(page.url()).searchParams.get('draft');
  await page.getByRole('button',{name:'Mark Ready to Export',exact:true}).click();
  await checkEnglish('saved watermark');
  await page.screenshot({path:testInfo.outputPath('english-watermark.png'),fullPage:true});
  await page.getByRole('button',{name:'Export Current Photo',exact:true}).click();
  await expect(page.locator('.download-result')).toBeVisible();await checkEnglish('exported watermark');
  expect((await(await request.get('/api/watermark/drafts/'+draftId)).json()).name).toBe('用户自定义作品');
  await page.goto('/watermark/gallery');
  const work=page.locator('.draft-card').filter({has:page.getByRole('heading',{name:'用户自定义作品',exact:true})});
  await expect(work).toBeVisible();await work.getByRole('button',{name:'Export',exact:true}).click();
  await checkEnglish('watermark export dialog');
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:390,height:1000});
  for(const path of ['/faces','/?page=settings','/?page=reports','/watermark/gallery','/watermark/workshop?draft='+draftId]){
    await page.goto(path);await page.waitForLoadState('networkidle');await checkEnglish('mobile '+path);
  }
  await page.screenshot({path:testInfo.outputPath('english-mobile.png'),fullPage:true});
  expect(digest()).toBe(before);expect(errors).toEqual([]);
});
