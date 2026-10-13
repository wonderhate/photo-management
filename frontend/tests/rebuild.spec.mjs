import {test,expect} from '@playwright/test';

// Synthetic landscapes and metadata only; no user's library is read by these tests.
const photos=Array.from({length:7},(_,i)=>({id:'frame-'+i,file_name:'FRAME_0'+i+'.jpg',capture_group_id:'capture-'+i,file_format:'JPG',file_size:400000,width:i===1?600:i===2?1800:1200,height:i===1?900:i===2?500:800,date_taken:'2026-10-01T18:30:00',camera_model:'TEST CAMERA',camera_make:'TEST',lens_model:'50mm F1.8',focal_length:50,f_number:2.8,exposure_time:'1/125',iso:400,thumbnail_path:'synthetic',thumbnail_url:'/api/photos/frame-'+i+'/thumbnail',preview_url:'/api/photos/frame-'+i+'/preview',favorite:false,rating:null,color_label:null,tags:[],gps_latitude:null,gps_longitude:null,raw_exif:{Model:'TEST CAMERA'},files:[{id:'frame-'+i,file_name:'FRAME_0'+i+'.jpg',file_format:'JPG',is_raw:false,file_path:'synthetic'}]}));
const albums=Array.from({length:5},(_,i)=>({id:'collection-'+i,name:['山的回声','暮色之间','沿海散步','雪境','城市片刻'][i],type:'normal',count:7,keywords:[],cover_id:photos[i].id}));
async function synthetic(page,{theme='dark',width=1440,reducedMotion='no-preference',lang='zh'}={}){
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
    const responses={'/settings':{count_mode:'capture',scan_paths:[]},'/filter-options':{camera_model:['TEST CAMERA'],tags:[]},'/library/scan':{job:null},'/jobs':[],'/ai/status':{status:'unavailable',indexed:0},'/photos/ids':{ids:photos.map(p=>p.id)},'/photos':{photos:photos.slice(0,5),total:7},'/albums':albums};
    if(!(key in responses))errors.push('Unexpected API '+key);
    return route.fulfill({json:responses[key]??{}});
  });
  return{errors,edits};
}
test.describe('URL language preferences',()=>{
  test('URL language reaches the library without locking later preferences',async({page})=>{
    const {errors}=await synthetic(page,{width:390,theme:'light'});
    await page.goto('/?page=home&lang=en');
    await expect(page.locator('html')).toHaveAttribute('lang','en');
    await expect(page.locator('.menu-toggle')).toBeVisible();
    await expect(page.locator('.archive-hero h1')).toBeVisible();
    await page.getByRole('button',{name:'Open Library',exact:true}).click();
    await expect(page.locator('.gallery-heading h1')).toContainText('All Photos');
    expect(new URL(page.url()).searchParams.has('lang')).toBe(false);
    expect(await page.evaluate(()=>localStorage.getItem('lang'))).toBe('en');
    await page.evaluate(()=>localStorage.setItem('lang','zh'));
    await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','zh');
    expect(errors).toEqual([]);
  });
});
for(const [theme,width,lang] of [['light',1440,'zh'],['dark',390,'en']])test(`photo color rings stay distinct and editable ${theme} ${width}`,async({page},info)=>{
  const {errors,edits}=await synthetic(page,{theme,width,lang});
  await page.goto('/?page=photos');await page.locator('.photo-image').first().click();
  await page.getByRole('button',{name:lang==='en'?'Photo information':'照片信息',exact:true}).click();
  const picker=page.locator('.photo-detail>aside .color-dots');
  await expect(picker).toBeVisible();
  const labels=lang==='en'?['Red','Yellow','Green','Blue']:['红色','黄色','绿色','蓝色'];
  const colors=[];
  for(const label of labels){
    const button=picker.getByRole('button',{name:label,exact:true});
    await expect(button).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await expect(button).toHaveAttribute('aria-pressed','false');
    const ring=button.locator('circle').first();
    await expect(ring).toHaveCSS('fill','none');
    colors.push(await ring.evaluate(element=>getComputedStyle(element).stroke));
  }
  expect(new Set(colors).size).toBe(4);
  const blue=picker.getByRole('button',{name:labels[3],exact:true});
  await blue.click();await expect(blue).toHaveAttribute('aria-pressed','true');
  expect(edits.at(-1)).toEqual({color_label:'blue'});
  await picker.screenshot({path:info.outputPath('color-rings.png')});
  await blue.click();await expect(blue).toHaveAttribute('aria-pressed','false');
  expect(edits.at(-1)).toEqual({color_label:'none'});
  await page.keyboard.press('Escape');
  await page.locator('.select-box').first().click();
  await page.getByRole('button',{name:lang==='en'?'Batch Edit':'批量编辑',exact:true}).click();
  const batch=page.locator('.batch-edit-content .color-dots');
  await batch.getByRole('button',{name:labels[1],exact:true}).click();
  await expect(batch.getByRole('button',{name:labels[1],exact:true})).toHaveAttribute('aria-pressed','true');
  await batch.screenshot({path:info.outputPath('batch-color-rings.png')});
  expect(errors).toEqual([]);
});
for(const theme of ['dark','light'])for(const width of [1440,390])test(`rebuilt home and viewer ${theme} ${width}`,async({page},info)=>{
  const {errors,edits}=await synthetic(page,{theme,width});
  await page.goto('/');await expect(page.locator('.collection-tile')).toHaveCount(5);
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
  await page.reload();await expect(page.locator('.photo-image').first()).toBeVisible();
  await page.goBack();await expect(page.locator('.archive-hero h1')).toBeVisible();
  await page.getByRole('button',{name:'进入照片库',exact:true}).click();
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
  await expect(page.locator('.photo-detail')).toHaveClass(/exhibit-normal/);
  await expect(page.locator('.exhibit-controls')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Fullscreen',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Play slideshow',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Next photo',exact:true}).click();
  await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_01.jpg');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});
test('reduced motion, touch swipe and narrow navigation remain usable',async({page})=>{
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
  await expect(page.getByLabel('展映模式',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('摄影氛围',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'全屏',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  await expect(page.locator('.aperture-intro')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'打开导航',exact:true}).click();
  await expect(page.locator('.sidebar nav').getByRole('button',{name:'人物',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('.sidebar')).toBeHidden();
  expect(errors).toEqual([]);
});

test('switching to a narrow viewport stops desktop exhibitions and preserves the photo',async({page})=>{
  const {errors}=await synthetic(page);
  await page.clock.install();
  await page.goto('/?page=photos');await page.locator('.photo-image').first().click();
  await page.getByLabel('摄影氛围',{exact:true}).check();
  await page.getByRole('button',{name:'跳过开场',exact:true}).click();
  await page.getByLabel('展映模式',{exact:true}).selectOption('snow');
  await page.getByRole('button',{name:'播放展映',exact:true}).click();
  await page.setViewportSize({width:390,height:1000});
  await expect(page.locator('.photo-detail')).toHaveClass('photo-detail exhibit-normal');
  await expect(page.locator('.exhibit-controls')).toHaveCount(0);
  await expect(page.locator('.aperture-intro,.viewfinder,.snow-layer')).toHaveCount(0);
  await page.clock.fastForward(6000);
  await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_00.jpg');
  await page.setViewportSize({width:1440,height:1000});
  await expect(page.getByLabel('展映模式',{exact:true})).toHaveValue('normal');
  await expect(page.getByLabel('摄影氛围',{exact:true})).not.toBeChecked();
  await expect(page.getByRole('button',{name:'播放展映',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('button',{name:'全屏',exact:true})).toBeVisible();
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
  await expect(page.locator('.viewer-filmstrip')).toHaveCount(0);
  await expect(page.locator('.film-stage')).toHaveAttribute('data-motion','paused');
  await page.getByRole('button',{name:'播放展映',exact:true}).click();
  await expect(page.locator('.film-stage')).toHaveAttribute('data-motion','playing');
  await page.getByRole('button',{name:'暂停展映',exact:true}).click();
  await expect(page.locator('.film-stage')).toHaveAttribute('data-motion','paused');
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

for(const theme of ['light','dark'])test(`film reel preserves ratios, moves continuously and reveals edge controls ${theme}`,async({page},info)=>{
  const {errors}=await synthetic(page,{theme,width:1440});
  await page.goto('/?page=photos');await page.locator('.photo-image').first().click();
  await page.getByLabel('展映模式',{exact:true}).selectOption('rail');
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.classList.contains('modal'))).toBe(true);
  await expect(page.locator('.film-frame')).toHaveCount(7);
  await expect.poll(()=>page.locator('.film-frame img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
  await expect(page.locator('.viewer-filmstrip,.detail-image>img')).toHaveCount(0);
  const geometry=await page.locator('.film-frame img').evaluateAll(images=>images.map(img=>{const rect=img.getBoundingClientRect();return {width:rect.width,height:rect.height,left:rect.left,right:rect.right,ratio:img.naturalWidth/img.naturalHeight}}));
  for(let i=0;i<geometry.length;i++){
    expect(geometry[i].width/geometry[i].height).toBeCloseTo(geometry[i].ratio,2);
    expect(geometry[i].height).toBeCloseTo(geometry[0].height,1);
    if(i)expect(geometry[i].left-geometry[i-1].right).toBeCloseTo(0,1);
  }
  const modal=await page.locator('.photo-viewer .modal').boundingBox();
  expect(modal.x).toBeCloseTo(0,1);expect(modal.y).toBeCloseTo(0,1);
  expect(modal.width).toBe(1440);expect(modal.height).toBe(1000);
  await page.mouse.move(720,500);
  await expect(page.locator('.viewer-toolbar')).toHaveCSS('opacity','0');
  await expect(page.locator('.exhibit-controls')).toHaveCSS('opacity','0');
  await expect(page.locator('.photo-viewer .modal>header')).toHaveCSS('opacity','0');
  await page.screenshot({path:info.outputPath('film-reel.png')});
  await page.mouse.move(720,20);await expect(page.locator('.viewer-toolbar')).toHaveCSS('opacity','1');
  await page.getByRole('button',{name:'播放展映',exact:true}).click();
  await expect.poll(()=>page.locator('.film-track').evaluate(el=>el.getAnimations()[0]?.playState)).toBe('running');
  const x1=await page.locator('.film-track').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41);
  await expect.poll(()=>page.locator('.film-track').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41)).toBeLessThan(x1-3);
  await page.mouse.move(720,20);await page.getByRole('button',{name:'暂停展映',exact:true}).click();
  await expect.poll(()=>page.locator('.film-track').evaluate(el=>el.getAnimations()[0]?.playState)).toBe('paused');
  await page.mouse.move(720,500);await expect(page.locator('.viewer-toolbar')).toHaveCSS('opacity','0');
  await page.keyboard.press('Tab');await expect(page.locator('.viewer-toolbar')).toHaveCSS('opacity','1');
  await page.mouse.move(720,980);await expect(page.locator('.exhibit-controls')).toHaveCSS('opacity','1');
  await page.getByLabel('列车速度',{exact:true}).fill('100');
  expect(await page.locator('.film-track').evaluate(el=>el.getAnimations()[0]?.playbackRate)).toBeCloseTo(100/75,3);
  await page.mouse.move(720,20);await page.getByRole('button',{name:'播放展映',exact:true}).click();
  await page.locator('.film-track').evaluate(el=>el.getAnimations()[0].finish());
  await expect(page.locator('.film-stage')).toHaveAttribute('data-photo-id','frame-1');
  await page.mouse.move(720,20);await page.getByRole('button',{name:'暂停展映',exact:true}).click();
  await page.mouse.move(10,500);await expect(page.locator('.viewer-prev')).toHaveCSS('opacity','1');
  await page.getByRole('button',{name:'上一张',exact:true}).click();await expect(page.locator('.film-stage')).toHaveAttribute('data-photo-id','frame-0');
  await page.keyboard.press('ArrowLeft');await expect(page.locator('.film-stage')).toHaveAttribute('data-photo-id','frame-6');
  await page.mouse.move(720,980);await page.getByLabel('展映模式',{exact:true}).selectOption('normal');
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
  await expect(page.locator('.film-stage')).toHaveCount(0);await expect(page.locator('.viewer-filmstrip')).toBeVisible();
  await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_06.jpg');
  await page.keyboard.press('Escape');expect(errors).toEqual([]);
});

test('reduced motion film reel stays still and can close fullscreen',async({page})=>{
  const {errors}=await synthetic(page,{width:1440,reducedMotion:'reduce',lang:'en'});
  await page.goto('/?page=photos');await page.locator('.photo-image').first().click();
  await page.getByLabel('Presentation',{exact:true}).selectOption('rail');
  await expect(page.locator('.film-stage')).toHaveAttribute('data-motion','paused');
  await page.mouse.move(720,20);await page.getByRole('button',{name:'Play slideshow',exact:true}).click();
  await expect(page.locator('.film-stage')).toHaveAttribute('data-motion','paused');
  expect(await page.locator('.film-track').evaluate(el=>el.getAnimations().length)).toBe(0);
  await page.keyboard.press('ArrowRight');await expect(page.locator('.film-stage')).toHaveAttribute('data-photo-id','frame-1');
  await page.keyboard.press('Escape');await expect(page.locator('.photo-viewer')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
  expect(errors).toEqual([]);
});

for(const [width,height] of [[1920,540],[900,1200]])test(`aurora covers the viewer through its full movement ${width} ${height}`,async({page},info)=>{
  const {errors}=await synthetic(page,{width});await page.setViewportSize({width,height});
  await page.goto('/?page=photos');await page.locator('.photo-image').first().click();
  await page.getByLabel('展映模式',{exact:true}).selectOption('aurora');
  const stage=page.locator('.detail-image');
  await expect.poll(()=>stage.evaluate(element=>getComputedStyle(element,'::after').animationName)).toBe('aurora-breathe');
  for(const time of [0,2250,4500,6750,8999]){
    const covered=await stage.evaluate((element,time)=>{
      const animation=element.getAnimations({subtree:true}).find(item=>item.animationName==='aurora-breathe');
      if(!animation)throw new Error('Aurora animation missing');
      animation.pause();animation.currentTime=time;
      const style=getComputedStyle(element,'::after'),[ox,oy]=style.transformOrigin.split(' ').map(parseFloat);
      const left=parseFloat(style.left),top=parseFloat(style.top),w=parseFloat(style.width),h=parseFloat(style.height);
      const inverse=new DOMMatrix(style.transform).inverse();
      return [[0,0],[element.clientWidth,0],[0,element.clientHeight],[element.clientWidth,element.clientHeight]].map(([x,y])=>{
        const point=inverse.transformPoint(new DOMPoint(x-left-ox,y-top-oy));
        return point.x+ox>=0&&point.x+ox<=w&&point.y+oy>=0&&point.y+oy<=h;
      });
    },time);
    expect(covered,`Viewer corners covered at ${time}ms`).toEqual([true,true,true,true]);
    if(time===4500)await page.screenshot({path:info.outputPath('aurora-mid-movement.png')});
  }
  await page.keyboard.press('Escape');expect(errors).toEqual([]);
});
