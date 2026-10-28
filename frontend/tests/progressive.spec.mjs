import {test,expect} from './fixtures/native-runtime.mjs';
import {synthetic,photos} from './fixtures/workspace.mjs';

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`progressive metadata refresh keeps viewport, selection and typing while previews appear ${width} ${lang}`,async({page},info)=>{
  const {errors}=await synthetic(page,{width,lang,theme:lang==='en'?'light':'dark'});let ready=false,grow=false,idReads=0;const batches=[];
  const listing=()=>Array.from({length:grow?81:80},(_,i)=>({...photos[i%photos.length],id:'frame-'+i,file_name:'progressive-'+i+'.jpg',capture_group_id:'progressive-'+i,thumbnail_path:!ready&&i===0?null:'synthetic',thumbnail_url:!ready&&i===0?'':'/api/photos/frame-'+i+'/thumbnail',preview_url:!ready&&i===0?'':'/api/photos/frame-'+i+'/preview',preview_status:!ready&&i===0?'pending':'ready'}));
  await page.route('**/api/photos/ids?*',route=>{idReads++;return route.fulfill({json:{ids:listing().map(p=>p.id)}});});
  await page.route('**/api/photos/by-ids',route=>{const ids=route.request().postDataJSON().ids;batches.push(ids.length);const all=listing();return route.fulfill({json:{photos:ids.map(id=>all.find(p=>p.id===id)).filter(Boolean)}});});
  await page.route('**/api/jobs**',route=>{
    const job={id:'progressive-root',kind:'import',status:'running',phase:ready?'previews':'processing',total:103,processed:100,success:100,skipped:0,failed:0,current:'',errors:[],results:[],preview_total:100,preview_processed:ready?32:0};
    return route.fulfill({json:new URL(route.request().url()).pathname==='/api/jobs'?[job]:job});
  });
  await page.goto('/?page=photos');await page.getByRole('button',{name:lang==='en'?'Grid Display Settings':'网格显示设置',exact:true}).click();await page.getByLabel(lang==='en'?'Gallery layout':'浏览布局',{exact:true}).selectOption('waterfall');await page.getByRole('button',{name:lang==='en'?'Grid Display Settings':'网格显示设置',exact:true}).click();
  const first=page.locator('.photo-card').filter({has:page.locator('.photo-image[aria-label$="progressive-0.jpg"]')});
  await expect(first.locator('.image-fallback')).toHaveAttribute('aria-busy','true');await first.locator('.select-box').click();await expect(first.locator('.select-box')).toHaveAttribute('aria-pressed','true');
  const scroller=page.locator('.waterfall-scroller');await scroller.evaluate(node=>{node.scrollTop=node.scrollHeight*.35;});await expect.poll(()=>page.locator('.waterfall-cell .vg-placeholder').count()).toBe(0);
  const search=page.locator('.gallery-tools .search input');await search.click();await search.fill('still typing');const beforeReads=idReads,scrollTop=await scroller.evaluate(node=>node.scrollTop);
  await page.evaluate(()=>window.__progressiveNode=document.querySelector('.waterfall-cell .photo-card'));ready=true;grow=true;
  await expect.poll(()=>idReads).toBeGreaterThan(beforeReads);await expect(page.locator('.gallery-heading h1 span')).toHaveText('81');
  await expect.poll(()=>page.evaluate(()=>window.__progressiveNode?.isConnected)).toBe(true);expect(await scroller.evaluate(node=>node.scrollTop)).toBe(scrollTop);await expect(search).toHaveValue('still typing');await expect(search).toBeFocused();
  await expect(page.locator('.job-summary')).toContainText('32 / 100');await expect(page.locator('.job-summary')).toContainText(lang==='en'?'Generating previews':'生成预览');
  await scroller.evaluate(node=>{node.scrollTop=0;});await expect(first.locator('.select-box')).toHaveAttribute('aria-pressed','true');await expect.poll(()=>first.locator('.photo-image img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await expect(first.locator('.image-fallback')).toHaveCount(0);await expect(first.locator('.photo-image img')).toHaveClass('loaded');expect(batches.every(size=>size<=200)).toBe(true);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('progressive-gallery.png'),animations:'disabled'});
});


for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`pending viewer refresh preserves a concurrent favorite ${width} ${lang}`,async({page})=>{
  const {errors}=await synthetic(page,{width,lang,theme:lang==='en'?'light':'dark'});let reads=0,finish;
  const pending={...photos[0],preview_status:'pending',preview_url:'',thumbnail_url:'',thumbnail_path:null};
  await page.route('**/api/photos/frame-0',route=>{
    if(route.request().method()==='PATCH')return route.fulfill({json:{...pending,favorite:true}});
    if(++reads===1)return route.fulfill({json:pending});
    return new Promise(resolve=>{finish=async()=>{await route.fulfill({json:{...photos[0],preview_status:'ready',favorite:false}});resolve();};});
  });
  await page.goto('/?page=photos');await page.locator('.photo-image').first().dblclick();const viewer=page.locator('.photo-viewer');await expect(viewer.getByRole('status')).toHaveText(lang==='en'?'Preview pending':'预览正在生成');await expect(viewer.locator('.detail-image')).toHaveAttribute('aria-busy','true');
  await expect.poll(()=>!!finish).toBe(true);const favorite=viewer.getByRole('button',{name:(lang==='en'?'Favorite ':'收藏 ')+photos[0].file_name,exact:true});await favorite.click();await expect(favorite).toHaveAttribute('aria-pressed','true');await finish();
  await expect.poll(()=>viewer.locator('.detail-image img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);await expect(favorite).toHaveAttribute('aria-pressed','true');await expect(viewer.getByRole('status')).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(viewer).toHaveCount(0);const finishedReads=reads;await page.waitForTimeout(1100);expect(reads).toBe(finishedReads);expect(errors).toEqual([]);
});

test('closing a pending viewer discards its delayed preview reply and stops polling',async({page})=>{
  const {errors}=await synthetic(page);let reads=0,finish;
  await page.route('**/api/photos/frame-0',route=>{
    if(++reads===1)return route.fulfill({json:{...photos[0],preview_status:'pending',preview_url:'',thumbnail_url:''}});
    return new Promise(resolve=>{finish=async()=>{await route.fulfill({json:{...photos[0],preview_status:'ready'}}).catch(()=>{});resolve();};});
  });
  await page.goto('/?page=photos');await page.locator('.photo-image').first().dblclick();await expect.poll(()=>!!finish).toBe(true);await page.keyboard.press('Escape');await page.locator('.photo-image').nth(1).dblclick();await expect(page.locator('.viewer-caption b')).toHaveText(photos[1].file_name);
  await finish();await page.waitForTimeout(1100);await expect(page.locator('.viewer-caption b')).toHaveText(photos[1].file_name);expect(reads).toBe(2);expect(errors).toEqual([]);
});
