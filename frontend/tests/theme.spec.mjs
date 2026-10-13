import {test,expect} from '@playwright/test';

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// Render the production UI with synthetic API data; never connect to a photo library.
for(const theme of ['light','dark'])for(const width of [1440,390]){
  test(`${theme} cards and controls at ${width}px`,async({page},testInfo)=>{
    const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text())});
    await page.setViewportSize({width,height:1000});
    await page.addInitScript(theme=>{localStorage.setItem('theme',theme);localStorage.setItem('onboarded','1')},theme);
    const responses={
      '/settings':{count_mode:'capture',scan_paths:[]},'/filter-options':{},
      '/library/scan':{job:null},'/jobs':[],
      '/ai/status':{status:'unavailable',indexed:0},'/photos/ids':{ids:[]},
      '/albums':[{id:'test-album',name:'测试影集',type:'normal',count:3,keywords:[],cover_id:null}],
      '/faces/status':{available:true,dependency:true,cached:true},
      '/faces/persons':[{id:'test-person',name:'PersonWithAVeryLongName'.repeat(5),photo_count:3,pending:2}],
    };
    await page.route('**/api/**',async route=>{
      const key=new URL(route.request().url()).pathname.slice(4);
      if(!(key in responses))errors.push(`Unexpected API request: ${key}`);
      await route.fulfill({json:responses[key]??{}});
    });
    async function checkCard(selector){
      const card=page.locator(selector).first();await expect(card).toBeVisible();
      const result=await card.evaluate(card=>{
        const rgb=color=>color.match(/[\d.]+/g).slice(0,3).map(Number);
        const luminance=color=>rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const background=luminance(getComputedStyle(card).backgroundColor);
        const contrast=[...card.querySelectorAll('h3,p')].map(el=>{const text=luminance(getComputedStyle(el).color);return(Math.max(text,background)+.05)/(Math.min(text,background)+.05)});
        const bounds=card.getBoundingClientRect();
        const controlsFit=[...card.querySelectorAll('button')].every(el=>{const rect=el.getBoundingClientRect();return rect.left>=bounds.left&&rect.right<=bounds.right+.5&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom+.5});
        return{contrast,controlsFit,overflow:card.scrollWidth>card.clientWidth};
      });
      for(const ratio of result.contrast)expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(result.controlsFit).toBe(true);expect(result.overflow).toBe(false);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:testInfo.outputPath(`${selector.slice(1)}.png`),fullPage:true});
    }
    const response=await page.goto('/?page=albums');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    await checkCard('.album-card');
    if(width===390){await page.getByRole('button',{name:'打开导航',exact:true}).click();await expect(page.locator('.sidebar nav .nav-child')).toBeVisible();await page.keyboard.press('Escape')}
    await page.goto('/faces');await checkCard('.face-card');
    await expect(page.locator('.face-card button')).toHaveCount(5);
    expect(await page.locator('.face-card').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(14);
    // These comma-separated light selectors used to contain literal "L" prefixes.
    await page.goto('/?page=photos');
    const foreground=await page.evaluate(()=>getComputedStyle(document.documentElement).color);
    await expect(page.getByRole('combobox',{name:'照片排序'})).toHaveCSS('color',foreground);
    await page.getByRole('button',{name:'网格显示设置',exact:true}).click();
    const panel=await page.locator('.display-panel').evaluate(el=>getComputedStyle(el).getPropertyValue('--panel').trim());
    expect(await page.locator('.display-panel').evaluate(el=>{const probe=document.createElement('div');probe.style.background='var(--panel)';el.append(probe);const expected=getComputedStyle(probe).backgroundColor;probe.remove();return getComputedStyle(el).backgroundColor===expected})).toBe(true);
    await page.getByRole('button',{name:'最近操作',exact:true}).click();
    expect(await page.locator('.recent-panel').evaluate((el,panel)=>getComputedStyle(el).getPropertyValue('--panel').trim()===panel,panel)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('confirmed person can create and open a named album',async({page})=>{
  const person={id:'test-person',name:'家人',photo_count:81,pending:82};
  const albums=[],submitted=[],errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{localStorage.setItem('onboarded','1')});
  const responses={
    '/settings':{count_mode:'capture',scan_paths:[]},'/filter-options':{},
    '/library/scan':{job:null},'/jobs':[],
    '/ai/status':{status:'unavailable',indexed:0},'/photos/ids':{ids:[],total:0},
    '/faces/status':{available:true,dependency:true,cached:true},
  };
  await page.route('**/api/**',async route=>{
    const request=route.request(),key=new URL(request.url()).pathname.slice(4);
    if(key==='/faces/persons')return route.fulfill({json:[person,{id:'empty',name:'空人物',photo_count:0,pending:0}]});
    if(key==='/faces/persons/test-person/confirm'){person.pending=0;return route.fulfill({json:{ok:true}})}
    if(key==='/albums'&&request.method()==='POST'){
      submitted.push(request.postDataJSON());
      if(submitted.length===1)return route.fulfill({status:409,json:{detail:'测试创建失败，请重试'}});
      const album={id:'person-album',name:submitted.at(-1).name,type:'normal',count:81,keywords:[],cover_id:null};
      albums.push(album);person.albums=[{id:album.id,name:album.name,linked:true}];return route.fulfill({json:album});
    }
    if(key==='/albums')return route.fulfill({json:albums});
    if(key==='/albums/person-album')return route.fulfill({json:albums[0]});
    if(!(key in responses))errors.push(`Unexpected API request: ${key}`);
    return route.fulfill({json:responses[key]??{}});
  });
  await page.goto('/faces');
  const card=page.locator('.face-card').filter({has:page.getByRole('heading',{name:'家人',exact:true})});
  const create=card.getByRole('button',{name:'新建人物影集',exact:true});
  await expect(create).toBeDisabled();
  await expect(page.locator('.face-card').filter({hasText:'空人物'}).getByRole('button',{name:'新建人物影集'})).toBeDisabled();
  await card.getByRole('button',{name:'确认分组',exact:true}).click();
  await expect(create).toBeEnabled();
  await page.reload();await expect(create).toBeEnabled();
  page.once('dialog',async dialog=>{expect(dialog.defaultValue()).toBe('家人');await dialog.dismiss()});
  await create.click();expect(submitted).toHaveLength(0);
  page.once('dialog',dialog=>dialog.accept('  '));
  await create.click();await expect(page.getByRole('status')).toContainText('请填写影集名称');
  expect(submitted).toHaveLength(0);
  page.once('dialog',dialog=>dialog.accept('家人影集'));
  await create.click();await expect(page.getByRole('status')).toContainText('测试创建失败');
  await expect(create).toBeEnabled();await expect(page).toHaveURL(/\/faces$/);
  page.once('dialog',dialog=>dialog.accept(' 家人影集 '));
  await create.click();await expect(page).toHaveURL(/page=photos/);
  expect(submitted).toEqual([{name:'家人影集',person_id:'test-person'},{name:'家人影集',person_id:'test-person'}]);
  await expect(page.getByRole('status')).toContainText('家人影集');
  await page.locator('.sidebar nav').getByRole('button',{name:'影集',exact:true}).click();
  await expect(page.locator('.album-card h3')).toHaveText('家人影集');
  await expect(page.locator('.album-card p')).toContainText('81 次拍摄');
  await page.goto('/faces');await expect(create).toHaveCount(0);
  const open=card.getByRole('button',{name:'打开人物影集',exact:true});
  await expect(open).toBeEnabled();await page.reload();await expect(open).toBeEnabled();
  await open.click();await expect(page).toHaveURL(/page=photos/);
  expect(submitted).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('mobile English person card opens existing albums without recreating them',async({page})=>{
  await page.setViewportSize({width:390,height:1000});
  await page.addInitScript(()=>{localStorage.setItem('lang','en');localStorage.setItem('onboarded','1')});
  const albums=[{id:'portrait-1',name:'Portrait One',type:'normal',count:2,keywords:[],cover_id:null},{id:'portrait-2',name:'Portrait Two',type:'normal',count:2,keywords:[],cover_id:null}],errors=[];
  let creates=0;const opened=[],linked=[];
  await page.route('**/api/**',async route=>{
    const key=new URL(route.request().url()).pathname.slice(4);
    if(key==='/albums'&&route.request().method()==='POST')creates++;
    if(key==='/photos/ids')opened.push(new URL(route.request().url()).searchParams.get('album_id'));
    if(key==='/albums/portrait-2'&&route.request().method()==='PATCH'){linked.push(route.request().postDataJSON());return route.fulfill({json:albums[1]})}
    const values={'/settings':{count_mode:'capture',scan_paths:[]},'/filter-options':{},'/library/scan':{job:null},'/jobs':[],'/ai/status':{status:'unavailable',indexed:0},'/photos/ids':{ids:[]},'/faces/status':{available:true,dependency:true,cached:true},'/faces/persons':[{id:'person',name:'Mira',photo_count:2,pending:0,albums:albums.map(({id,name})=>({id,name}))}],'/albums':albums,'/albums/portrait-2':albums[1]};
    if(!(key in values))errors.push(key);
    await route.fulfill({json:values[key]??{}});
  });
  await page.goto('/faces');
  await expect(page.getByRole('button',{name:'Create Person Album',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Open Person Album',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Choose Person Album'})).toBeVisible();
  await page.getByRole('button',{name:'Portrait Two',exact:true}).click();
  await expect(page).toHaveURL(/page=photos/);
  await expect.poll(()=>opened.at(-1)).toBe('portrait-2');
  await expect(page.locator('.gallery-heading h1')).toContainText('Album Photos');
  expect(creates).toBe(0);expect(linked).toEqual([{person_id:'person'}]);expect(errors).toEqual([]);
});

test('real person album association persists across refresh and deletion',async({page,request},info)=>{
  const health=await(await request.get('/api/health')).json();
  expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const source=join(health.data_dir,'person-album-regression.jpg'),python=process.env.PHOTO_TEST_PYTHON||'python';
  execFileSync(python,['-c',"from PIL import Image; import sys; Image.new('RGB',(322,242),(17,89,143)).save(sys.argv[1])",source]);
  const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();
  await expect.poll(async()=> (await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  const photo=(await(await request.get('/api/photos')).json()).photos.find(p=>p.file_name==='person-album-regression.jpg');
  const person=await(await request.post('/api/faces/persons',{data:{name:'人物打开回归'}})).json();
  execFileSync(python,['-c',"import sqlite3,sys,uuid; db=sqlite3.connect(sys.argv[1]); db.execute('PRAGMA foreign_keys=ON'); db.execute('INSERT INTO detected_faces (id,photo_id,person_id,face_index,encoding,location,confirmed) VALUES (?,?,?,?,?,?,?)',(str(uuid.uuid4()),sys.argv[2],sys.argv[3],0,b'', '{}',1)); db.commit(); db.close()",join(health.data_dir,'library.db'),photo.id,person.id]);
  const album=await(await request.post('/api/albums',{data:{name:'已有自定义人物影集',photo_ids:[photo.id]}})).json();
  await page.addInitScript(()=>{localStorage.setItem('lang','zh');localStorage.setItem('theme','light');localStorage.setItem('onboarded','1')});
  await page.goto('/faces');
  const card=page.locator('.face-card').filter({has:page.getByRole('heading',{name:'人物打开回归',exact:true})});
  await expect(card.getByRole('button',{name:'新建人物影集',exact:true})).toHaveCount(0);
  await card.screenshot({path:info.outputPath('open-person-album.png')});
  await card.getByRole('button',{name:'打开人物影集',exact:true}).click();
  await expect(page).toHaveURL(/page=photos/);
  await expect(page.locator('.photo-image').first()).toBeVisible();
  expect((await(await request.get('/api/albums/'+album.id)).json()).person_id).toBe(person.id);
  await request.patch('/api/faces/persons/'+person.id,{data:{name:'改名后的人物'}});
  await page.goto('/faces');await page.reload();
  const renamed=page.locator('.face-card').filter({has:page.getByRole('heading',{name:'改名后的人物',exact:true})});
  await expect(renamed.getByRole('button',{name:'打开人物影集',exact:true})).toBeEnabled();
  await request.delete('/api/albums/'+album.id);await page.reload();
  await expect(renamed.getByRole('button',{name:'新建人物影集',exact:true})).toBeEnabled();
  await expect(renamed.getByRole('button',{name:'打开人物影集',exact:true})).toHaveCount(0);
});

test('storage directories can be selected, saved for restart and cancelled',async({page},testInfo)=>{
  const current={data_dir:'C:/Photo Library',models_dir:'C:/Models/'+'cached-model-'.repeat(20),exports_dir:'C:/Exports',scan_paths:['C:/Photos']};
  let state={current,pending:null,locked_fields:['models_dir'],error:null};
  const submitted=[],errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{localStorage.setItem('onboarded','1')});
  const responses={
    '/settings':{...current,focal_bands:[24,35,60,100,200],count_mode:'capture',preview_preference:'jpeg',thumbnail_quality:85,export_format:'jpg',export_quality:95,export_long_edge:4096},
    '/filter-options':{},'/plugins':[], '/library/scan':{job:null},'/jobs':[],
    '/ai/status':{status:'unavailable',indexed:0},'/photos/ids':{ids:[],total:0},
    '/dialog/directory':{paths:['D:/New Photo Library']},
  };
  await page.route('**/api/**',async route=>{
    const request=route.request(),key=new URL(request.url()).pathname.slice(4);
    if(key==='/library/paths'){
      if(request.method()==='PUT'){
        submitted.push(request.postDataJSON());
        if(submitted.length===1)return route.fulfill({status:400,json:{detail:'目录不可写'}});
        state={...state,pending:submitted.at(-1)};
      }
      if(request.method()==='DELETE')state={...state,pending:null};
      return route.fulfill({json:state});
    }
    if(!(key in responses))errors.push(`Unexpected API request: ${key}`);
    return route.fulfill({json:responses[key]??{}});
  });
  await page.goto('/?page=settings');
  const card=page.locator('.settings-card').filter({has:page.getByRole('heading',{name:'照片库与存储',exact:true})});
  await expect(card.getByLabel('照片库（数据库与缓存）',{exact:true})).toHaveValue(current.data_dir);
  await expect(card.getByLabel('AI 模型缓存目录',{exact:true})).toBeDisabled();
  await card.getByRole('button',{name:'选择照片库（数据库与缓存）',exact:true}).click();
  await expect(card.getByLabel('照片库（数据库与缓存）',{exact:true})).toHaveValue('D:/New Photo Library');
  await card.getByLabel('水印导出目录',{exact:true}).fill('D:/New Exports');
  await card.getByLabel('自动扫描照片目录',{exact:true}).fill(' D:/Photos A \n\n D:/Photos B ');
  await card.getByRole('button',{name:'保存目录设置',exact:true}).click();
  await expect(page.locator('.toast')).toContainText('目录不可写');
  await expect(card.getByRole('status')).toHaveCount(0);
  await card.getByRole('button',{name:'保存目录设置',exact:true}).click();
  await expect(card.getByRole('status')).toContainText('重启程序后生效');
  expect(submitted.at(-1)).toEqual({...current,data_dir:'D:/New Photo Library',exports_dir:'D:/New Exports',scan_paths:['D:/Photos A','D:/Photos B']});
  await expect(card).toContainText('当前使用：C:/Photo Library');
  await page.reload();
  await expect(card.getByLabel('水印导出目录',{exact:true})).toHaveValue('D:/New Exports');
  await expect(card.getByRole('status')).toContainText('重启程序后生效');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1200});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await card.screenshot({path:testInfo.outputPath(`storage-${width}.png`)});
  }
  await card.getByRole('button',{name:'取消待生效修改',exact:true}).click();
  await expect(card.getByLabel('照片库（数据库与缓存）',{exact:true})).toHaveValue(current.data_dir);
  await expect(card.getByLabel('自动扫描照片目录',{exact:true})).toHaveValue('C:/Photos');
  await expect(card.getByRole('status')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('all pages and watermark workflow under production CSP',async({page,request},testInfo)=>{
  test.setTimeout(90000);
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text())});
  page.on('response',response=>{if(response.status()>=500)errors.push(`${response.status()} ${response.url()}`)});
  const health=await(await request.get('/api/health')).json();
  expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const source=join(health.data_dir,'security-browser-source.jpg');
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image; from PIL.TiffImagePlugin import IFDRational; import sys; exif=Image.Exif(); exif[272]='Test Camera'; exif[36867]='2026:09:29 18:24:00'; exif[37386]=IFDRational(50); exif[33437]=IFDRational(28,10); exif[33434]=IFDRational(1,125); exif[34855]=400; exif[42036]='Test Lens'; Image.new('RGB',(640,480),'orange').save(sys.argv[1],exif=exif)",source]);
  const digest=()=>createHash('sha256').update(readFileSync(source)).digest('hex');
  const before=digest();
  const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();
  await expect.poll(async()=> (await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  const photo=(await(await request.get('/api/photos')).json()).photos.find(photo=>photo.file_name==='security-browser-source.jpg');
  await page.addInitScript(()=>{localStorage.setItem('onboarded','1');localStorage.setItem('theme','light')});
  async function checkLightSurfaces(name){
    await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll('*')].filter(el=>{
      if(!(el instanceof HTMLElement))return false;
      // Accent actions and photographic overlays deliberately use dark colors in light mode.
      if(el.matches('.primary,.format-badge,.score,.select-box,.favorite,.scrim,.photo-badges *'))return false;
      const rect=el.getBoundingClientRect();
      if(rect.width<40||rect.height<20||getComputedStyle(el).visibility==='hidden')return false;
      const rgba=getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if(!rgba||rgba[3]===0||rgba[3]<.5)return false;
      const luminance=rgba.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      return luminance<.45;
    }).map(el=>({element:el.tagName,class:el.className,background:getComputedStyle(el).backgroundColor}))),{message:`Dark UI surfaces in ${name}`,timeout:2000}).toEqual([]);
    const unreadableTitles=await page.locator('h1,h2,h3').evaluateAll(titles=>{
      const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      return titles.filter(el=>el.getClientRects().length).map(el=>{
        let surface=el;
        while(surface.parentElement&&getComputedStyle(surface).backgroundColor==='rgba(0, 0, 0, 0)')surface=surface.parentElement;
        const text=luminance(getComputedStyle(el).color),background=luminance(getComputedStyle(surface).backgroundColor);
        return{text:el.textContent,contrast:(Math.max(text,background)+.05)/(Math.min(text,background)+.05)};
      }).filter(title=>title.contrast<4.5);
    });
    expect(unreadableTitles,`Unreadable titles in ${name}`).toEqual([]);
  }
  for(const path of ['/?page=photos','/?page=albums','/?page=smart','/timeline','/faces','/?page=stats','/?page=reports','/watermark/gallery','/?page=settings','/compare?ids='+photo.id]){
    const response=await page.goto(path);
    expect(response.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('.sidebar-note p')).toHaveText('收集光，收藏爱');
    await checkLightSurfaces(path);
    if(path==='/?page=stats'){
      await page.locator('.recharts-bar-rectangle').first().hover();
      await expect(page.locator('.recharts-default-tooltip').first()).toBeVisible();
      await checkLightSurfaces('chart tooltip');
    }
    if(path==='/?page=settings'){
      const plugins=await(await request.get('/api/plugins')).json();
      if(plugins.length){
        await page.locator('.plugin-row button').first().click();
        await expect(page.locator('.plugin-output')).toBeVisible();
        await checkLightSurfaces('plugin output');
      }else await expect(page.getByText('暂无插件。把脚本放进照片库的 plugins 文件夹后刷新本页。',{exact:true})).toBeVisible();
    }
    if(['/timeline','/?page=reports','/?page=settings'].includes(path))await page.screenshot({path:testInfo.outputPath(`light-${path.includes('settings')?'settings':path.includes('reports')?'reports':'timeline'}.png`),fullPage:true});
  }
  await page.goto('/?page=photos');
  await page.locator('.photo-image').first().click();
  await expect(page.locator('.detail-image')).toBeVisible();
  await checkLightSurfaces('photo detail');
  await page.screenshot({path:testInfo.outputPath('light-detail.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'导入照片',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await checkLightSurfaces('import dialog');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.locator('.shortcuts-list')).toBeVisible();
  await checkLightSurfaces('keyboard shortcuts');
  await page.keyboard.press('Escape');
  await page.goto('/watermark/workshop?photo='+photo.id);
  const preview=page.getByAltText('水印实时预览');
  await expect(preview).toBeVisible();
  await expect.poll(()=>preview.evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
  await checkLightSurfaces('watermark editor');
  await page.screenshot({path:testInfo.outputPath('light-watermark.png'),fullPage:true});
  await page.getByRole('button',{name:'保存到水印图库',exact:true}).click();
  await expect(page).toHaveURL(/draft=/);
  const draftURL=page.url();
  await page.reload();
  await expect(preview).toBeVisible();
  await page.getByRole('button',{name:'标记为待导出',exact:true}).click();
  await page.getByRole('button',{name:'导出当前照片',exact:true}).click();
  await expect(page.locator('.download-result')).toBeVisible();
  await checkLightSurfaces('watermark export');
  const draftId=new URL(draftURL).searchParams.get('draft');
  expect((await(await request.get('/api/watermark/drafts/'+draftId)).json()).status).toBe('exported');
  await page.goto('/watermark/gallery');
  await expect(page.locator('.draft-card').filter({has:page.getByRole('heading',{name:photo.file_name.replace(/\.[^.]+$/,'')})})).toBeVisible();
  await checkLightSurfaces('watermark gallery');
  await page.screenshot({path:testInfo.outputPath('light-drafts.png'),fullPage:true});
  expect(digest()).toBe(before);
  expect(errors).toEqual([]);
});
