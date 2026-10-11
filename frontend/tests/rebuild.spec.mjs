import {test,expect} from '@playwright/test';

// Synthetic landscapes and metadata only; no user's library is read by these tests.
const photos=Array.from({length:7},(_,i)=>({id:'frame-'+i,file_name:'FRAME_0'+i+'.jpg',capture_group_id:'capture-'+i,file_format:'JPG',file_size:400000,width:i===1?600:i===2?1800:1200,height:i===1?900:i===2?500:800,date_taken:'2026-10-01T18:30:00',camera_model:'TEST CAMERA',camera_make:'TEST',lens_model:'50mm F1.8',focal_length:50,f_number:2.8,exposure_time:'1/125',iso:400,thumbnail_path:'synthetic',thumbnail_url:'/api/photos/frame-'+i+'/thumbnail',preview_url:'/api/photos/frame-'+i+'/preview',favorite:false,rating:null,color_label:null,tags:[],gps_latitude:null,gps_longitude:null,raw_exif:{Model:'TEST CAMERA'},files:[{id:'frame-'+i,file_name:'FRAME_0'+i+'.jpg',file_format:'JPG',is_raw:false,file_path:'synthetic'}]}));
const albums=Array.from({length:5},(_,i)=>({id:'collection-'+i,name:['山的回声','暮色之间','沿海散步','雪境','城市片刻'][i],type:'normal',count:7,keywords:[],cover_id:photos[i].id}));
async function synthetic(page,{theme='dark',width=1440,reducedMotion='no-preference',lang='zh',remote=false}={}){
  await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion});
  await page.addInitScript(({theme,lang})=>{localStorage.setItem('theme',theme);localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1')},{theme,lang});
  const errors=[],edits=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text())});
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),key=url.pathname.slice(4);
    if(/\/(thumbnail|preview)$/.test(key)){
      const index=Number(key.match(/frame-(\d)/)?.[1]||0),colors=[['#344a67','#d8a983'],['#283d32','#92aa9a'],['#534358','#eeb79b'],['#536a7d','#b4c6d4'],['#323d54','#b9a3b6']][index%5];
      return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${photos[index]?.width||1200}" height="${photos[index]?.height||800}" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="1200" height="800" fill="url(#s)"/><circle cx="820" cy="250" r="55" fill="#f1d7ad"/><path d="M0 600L200 320 450 590 710 200 1000 610 1200 400V800H0" fill="#141e2b" opacity=".65"/><path d="M0 710L300 490 580 710 850 430 1200 710V800H0" fill="#0d1620"/><path d="M0 780Q400 690 1200 775V800H0" fill="#bfa680" opacity=".3"/></svg>`});
    }
    if(key==='/photos/by-ids')return route.fulfill({json:{photos:req.postDataJSON().ids.map(id=>photos.find(p=>p.id===id)).filter(Boolean)}});
    if(/^\/photos\/frame-\d+$/.test(key)){
      const photo=photos.find(p=>key.endsWith(p.id));
      if(req.method()==='PATCH'){const change=req.postDataJSON();edits.push(change);return route.fulfill({json:{...photo,...change}})}
      return route.fulfill({json:photo});
    }
    if(key==='/compare')return route.fulfill({json:{photos:photos.filter(p=>url.searchParams.get('ids').includes(p.id))}});
    if(key.startsWith('/albums/'))return route.fulfill({json:albums.find(a=>key.endsWith(a.id))});
    const responses={'/remote/session':{remote},'/settings':{count_mode:'capture',scan_paths:[]},'/filter-options':{camera_model:['TEST CAMERA'],tags:[]},'/library/scan':{job:null},'/jobs':[],'/ai/status':{status:'unavailable',indexed:0},'/photos/ids':{ids:photos.map(p=>p.id)},'/photos':{photos:photos.slice(0,5),total:7},'/albums':albums};
    if(!(key in responses))errors.push('Unexpected API '+key);
    return route.fulfill({json:responses[key]??{}});
  });
  return{errors,edits};
}
for(const theme of ['dark','light'])for(const width of [1440,390])test(`rebuilt home and viewer ${theme} ${width}`,async({page},info)=>{
  const {errors,edits}=await synthetic(page,{theme,width});
  await page.goto('/?page=home');await expect(page.locator('.collection-tile')).toHaveCount(5);
  await expect(page.locator('.archive-hero h1')).toBeVisible();
  await expect(page.locator('.hero-primary')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('.hero-primary')).toHaveCSS('color','rgb(17, 17, 17)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('home.png')});
  await page.locator('.home-collections').scrollIntoViewIfNeeded();
  await expect(page.locator('.home-collections')).toHaveCSS('opacity','1');
  await page.screenshot({path:info.outputPath('collections.png')});
  await page.getByRole('button',{name:'打开导航',exact:true}).click();
  await expect(page.locator('.menu-close')).toBeFocused();
  await page.locator('.sidebar nav').getByRole('button',{name:'照片',exact:true}).click();
  await expect(page).toHaveURL(/page=photos/);await expect(page.locator('.photo-image').first()).toBeVisible();
  await page.getByRole('button',{name:'筛选',exact:true}).click();
  await page.getByLabel('相机',{exact:true}).selectOption('TEST CAMERA');
  await expect(page.locator('.filter-chips')).toContainText('TEST CAMERA');
  await page.getByRole('button',{name:'筛选',exact:true}).click();
  await page.getByRole('button',{name:'网格显示设置',exact:true}).click();
  await page.getByLabel('浏览布局',{exact:true}).selectOption('grid');
  await expect(page.locator('.justified-gallery')).toHaveCount(0);
  await page.getByLabel('浏览布局',{exact:true}).selectOption('justified');
  await page.getByRole('button',{name:'网格显示设置',exact:true}).click();
  await expect(page.locator('.photo-image img').first()).toHaveCSS('opacity','1');
  await page.screenshot({path:info.outputPath('gallery.png'),fullPage:true});
  await page.locator('.photo-image').first().click();await expect(page.locator('.photo-viewer')).toBeVisible();
  await page.getByRole('button',{name:'下一张',exact:true}).click();
  await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_01.jpg');
  const image=page.locator('.detail-image>img');
  expect(await image.evaluate(img=>getComputedStyle(img).objectFit)).toBe('contain');
  await page.keyboard.press('ArrowRight');await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_02.jpg');
  await page.getByRole('button',{name:'照片信息',exact:true}).click();
  await expect(page.locator('.photo-detail>aside')).toBeVisible();
  await page.getByPlaceholder('人像，旅行，日落').fill('测试，风景');
  await page.getByRole('button',{name:'保存标签',exact:true}).click();
  expect(edits.at(-1)).toEqual({tags:['测试','风景']});
  await page.getByRole('button',{name:'照片信息',exact:true}).click();
  await page.screenshot({path:info.outputPath('viewer.png')});
  await page.keyboard.press('Escape');await expect(page.locator('.photo-viewer')).toHaveCount(0);
  await page.locator('.select-box').nth(0).click();await page.locator('.select-box').nth(1).click();
  await page.getByRole('button',{name:'对比',exact:true}).click();await expect(page.locator('.compare-item')).toHaveCount(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('English home and photo controls remain available on mobile',async({page})=>{
  const {errors}=await synthetic(page,{width:390,lang:'en'});
  await page.goto('/?page=home');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page).toHaveTitle('Lumina · Local Photo Library');
  await expect(page.locator('.archive-hero h1')).toContainText('The light you see');
  await page.getByRole('button',{name:'Open Library',exact:true}).click();
  await expect(page.locator('.gallery-heading h1')).toContainText('All Photos');
  await page.locator('.photo-image').first().click();
  await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_00.jpg');
  await page.getByRole('button',{name:'Next photo',exact:true}).click();
  await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_01.jpg');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});
test('reduced motion, touch swipe and remote navigation remain usable',async({page})=>{
  const {errors}=await synthetic(page,{width:390,reducedMotion:'reduce',remote:true});
  await page.goto('/?page=home');await expect(page.locator('.collection-tile')).toHaveCount(5);
  expect(await page.locator('.home-collections').evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
  await page.getByRole('button',{name:'进入照片库',exact:true}).click();
  await page.locator('.photo-image').first().waitFor();
  await page.locator('.photo-image').first().click();
  await page.locator('.detail-image').evaluate(el=>{
    el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[new Touch({identifier:1,target:el,clientX:280,clientY:200})]}));
    el.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[new Touch({identifier:1,target:el,clientX:120,clientY:205})]}));
  });
  await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_01.jpg');
  await page.getByLabel('展映模式',{exact:true}).selectOption('snow');
  await page.getByLabel('摄影氛围',{exact:true}).check();
  expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  await expect(page.locator('.aperture-intro')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'打开导航',exact:true}).click();
  await expect(page.locator('.sidebar nav').getByRole('button',{name:'人物',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('.sidebar')).toBeHidden();
  expect(errors).toEqual([]);
});
test('optional exhibitions can pause, skip and return to standard photo viewing',async({page},info)=>{
  const {errors}=await synthetic(page);
  await page.goto('/?page=home');
  await page.locator('.hero-photo-credit button').click();
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 7');
  await page.getByLabel('摄影氛围',{exact:true}).check();
  await expect(page.locator('.aperture-intro')).toBeVisible();
  await page.getByRole('button',{name:'跳过开场',exact:true}).click();
  await expect(page.locator('.aperture-intro')).toHaveCount(0);
  await page.getByLabel('展映模式',{exact:true}).selectOption('torch');
  await page.getByRole('button',{name:'开启手电筒',exact:true}).click();
  await expect(page.locator('.detail-image')).toHaveClass(/torch-on/);
  await page.getByRole('button',{name:'关闭手电筒',exact:true}).click();
  await page.getByLabel('展映模式',{exact:true}).selectOption('rail');
  await expect(page.locator('.viewer-filmstrip')).toHaveCSS('animation-play-state','paused');
  await page.getByRole('button',{name:'播放展映',exact:true}).click();
  await expect(page.locator('.viewer-filmstrip')).toHaveCSS('animation-play-state','running');
  await page.getByRole('button',{name:'暂停展映',exact:true}).click();
  await expect(page.locator('.viewer-filmstrip')).toHaveCSS('animation-play-state','paused');
  await page.getByLabel('展映模式',{exact:true}).selectOption('snow');
  await expect(page.locator('.snow-layer')).toBeVisible();
  await page.getByLabel('展映模式',{exact:true}).selectOption('aurora');
  await page.screenshot({path:info.outputPath('exhibition.png')});
  await page.getByLabel('展映模式',{exact:true}).selectOption('normal');
  await page.getByLabel('摄影氛围',{exact:true}).uncheck();
  await expect(page.locator('.viewfinder')).toBeHidden();
  await page.keyboard.press('Escape');await expect(page.locator('.photo-viewer')).toHaveCount(0);
  expect(errors).toEqual([]);
});
