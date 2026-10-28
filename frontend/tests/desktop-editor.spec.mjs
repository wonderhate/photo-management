import {test,expect} from './fixtures/native-runtime.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const neutral={version:1,exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX:false,flipY:false,crop:{x:0,y:0,width:1,height:1},sharpen:0,denoise:0,match:0,preserveLuminance:true};
async function preferences(page,width=1440,lang='zh'){
  await page.setViewportSize({width,height:1000});
  await page.addInitScript(lang=>{localStorage.setItem('onboarded','1');localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);
}
async function fixture(request,name){
  const health=await(await request.get('/api/health')).json();
  expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const source=join(health.data_dir,name);
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image,ImageDraw; import sys; im=Image.new('RGB',(1200,800),'#81989d'); d=ImageDraw.Draw(im); d.polygon([(0,700),(320,200),(650,600),(950,300),(1200,700)],fill='#2c484a'); d.ellipse((780,100,920,240),fill='#eccca4'); d.text((20,20),sys.argv[1],fill='white'); im.save(sys.argv[1])",source]);
  const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();
  await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  return {source,photo:(await(await request.get('/api/photos?search='+encodeURIComponent(name))).json()).photos.find(p=>p.file_name===name)};
}
async function settled(page){
  await expect(page.locator('.edit-image img')).toBeVisible();
  await expect(page.locator('.edit-image img')).toHaveJSProperty('complete',true);
  await expect(page.getByText('正在处理，请稍候…',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Processing, please wait…',{exact:true})).toHaveCount(0);
}

test('native new source profile and legacy crop replay retain their saved pixel orientation',async({page,request},info)=>{
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const folder=join(health.data_dir,'source-profile-fixtures');execFileSync(process.env.PHOTO_TEST_PYTHON||'python',[join(import.meta.dirname,'fixtures/make-metadata-jpegs.py'),folder]);const source=join(folder,'orientation-xmp.jpg'),before=hash(source);
  const old=await request.post('/api/editor/edits',{multipart:{payload:JSON.stringify({source_name:'legacy-xmp.jpg',source_hash:before,recipe:{...neutral,crop:{x:0,y:0,width:.5,height:1}}}),file:{name:'legacy-xmp.jpg',mimeType:'image/jpeg',buffer:readFileSync(source)}}});expect(old.status()).toBe(201);const legacy=await old.json();
  await preferences(page);await page.goto('/tools/edit');await page.locator('.editor-toolbar input[type=file]').setInputFiles(source);await settled(page);await expect(page.locator('.edit-stage-top')).toContainText('480 × 640');
  await page.locator('.edit-controls summary').filter({hasText:'构图'}).click();await page.getByRole('slider',{name:'Crop width',exact:true}).fill('50');await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',240);
  await page.getByRole('button',{name:/^保存编辑/}).click();await expect.poll(async()=>(await(await request.get('/api/editor/edits')).json()).edits.find(e=>e.source_name==='orientation-xmp.jpg')?.decode_profile).toEqual({version:2,extra_orientation:6});
  await page.goto('/tools/edit');await page.locator('.edit-records button').filter({hasText:'orientation-xmp.jpg'}).click();await settled(page);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',240);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalHeight',640);
  const rotated=await page.locator('.edit-image img').evaluate(img=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return [...x.getImageData(20,20,1,1).data];});expect(rotated[2]).toBeGreaterThan(180);expect(rotated[0]).toBeLessThan(80);
  await page.goto('/tools/edit');await page.locator('.edit-records button').filter({hasText:'legacy-xmp.jpg'}).click();await settled(page);await expect(page.locator('.edit-stage-top')).toContainText('640 × 480');await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',320);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalHeight',480);
  await page.locator('.edit-controls details').last().getByRole('combobox').selectOption('png');await page.getByRole('spinbutton',{name:'导出最长边',exact:true}).fill('0');const download=page.waitForEvent('download');await page.getByRole('button',{name:'另存并下载',exact:true}).click();await(await download).saveAs(info.outputPath('legacy-crop.png'));const png=readFileSync(info.outputPath('legacy-crop.png'));expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual([320,480]);
  await page.getByRole('button',{name:'保存编辑',exact:true}).click();await expect.poll(async()=>(await(await request.get('/api/editor/edits/'+legacy.id)).json()).revision).toBe(2);const restored=await(await request.get('/api/editor/edits/'+legacy.id)).json();expect(restored.decode_profile).toEqual({version:1,extra_orientation:1});expect(restored.recipe.crop.width).toBe(.5);expect(hash(source)).toBe(before);
});

test('darkroom remembers export choices separately from recipes and validates draft dimensions',async({page,request})=>{
  await preferences(page,390,'en');const {source,photo}=await fixture(request,'darkroom-preferences.png'),before=hash(source);
  await page.goto('/tools/edit?photo='+photo.id);await settled(page);
  await page.getByRole('button',{name:/^Save edits/}).click();await expect(page.getByText('Edits saved. Original unchanged.',{exact:true})).toBeVisible();
  const edit=(await(await request.get('/api/editor/edits')).json()).edits.find(e=>e.photo_id===photo.id),controls=page.locator('.edit-controls details').last();
  await controls.getByRole('combobox').selectOption('jpg');await controls.getByRole('slider').fill('81');await controls.getByRole('combobox').selectOption('png');
  const edge=page.getByRole('spinbutton',{name:'Export long edge',exact:true});await edge.fill('16001');
  await page.getByRole('button',{name:'Save & download',exact:true}).click();await expect(page.getByText('Enter an integer from 0 to 16000; 0 means original dimensions.',{exact:true})).toBeVisible();
  await edge.fill('777');
  await expect.poll(async()=>(await(await request.get('/api/workspace')).json()).tool_preferences.darkroom).toEqual({format:'png',edge:777,quality:81});
  await page.reload();await settled(page);await expect(controls.getByRole('combobox')).toHaveValue('png');await expect(edge).toHaveValue('777');await controls.getByRole('combobox').selectOption('jpg');await expect(controls.getByRole('slider')).toHaveValue('81');
  expect((await(await request.get('/api/editor/edits/'+edit.id)).json())).toEqual(edit);expect(hash(source)).toBe(before);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`desktop darkroom persists, exports and frames a separate copy ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await preferences(page,width,lang);const en=lang==='en';const {source,photo}=await fixture(request,`darkroom-${width}.png`),before=hash(source);
  const total=(await(await request.get('/api/photos')).json()).total;
  await page.goto('/tools/edit?photo='+photo.id);await settled(page);
  expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
  await expect(page.locator('.image-analysis')).toBeVisible();
  const exposure=page.getByRole('slider',{name:en?'Exposure EV':'曝光 EV',exact:true});await exposure.fill('1.2');
  await page.getByRole('button',{name:en?/^Save edits/:/^保存编辑/}).click();
  await expect(page.getByText(en?'Edits saved. Original unchanged.':'编辑参数已保存，原图保持不变。',{exact:true})).toBeVisible();
  const edit=(await(await request.get('/api/editor/edits')).json()).edits.find(e=>e.photo_id===photo.id);
  expect(edit.recipe.exposure).toBe(1.2);
  await page.getByRole('combobox',{name:en?'Preview zoom':'预览缩放'}).selectOption('2');
  await expect.poll(async()=>(await(await request.get('/api/workspace/documents/'+edit.id+'/view')).json()).zoom).toBe(2);
  await page.goto('/tools/darkroom');await page.locator('.edit-records button').filter({hasText:photo.file_name}).click();await settled(page);
  await expect(page.getByRole('combobox',{name:en?'Preview zoom':'预览缩放'})).toHaveValue('2');
  await expect(exposure).toHaveValue('1.2');
  await page.locator('.edit-controls details').last().getByRole('combobox').selectOption('png');
  await page.getByRole('spinbutton',{name:en?'Export long edge':'导出最长边',exact:true}).fill('500');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:en?'Save & download':'另存并下载',exact:true}).click();
  const file=await download;expect(file.suggestedFilename()).toMatch(/-edited\.png$/);await file.saveAs(info.outputPath('edited.png'));
  await expect(page.getByRole('button',{name:en?'Send to watercolor':'送入水彩',exact:true})).toBeDisabled();
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath('desktop-darkroom.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:en?'Send to watermark':'送入水印',exact:true}).click();
  await expect(page).toHaveURL(/\/watermark\/workshop\?draft=/);
  await expect(page.locator('.watermark-caption')).toContainText(en?'Edited copy snapshot':'编辑副本快照');
  await expect.poll(()=>page.locator('.render-stage img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  const draftId=new URL(page.url()).searchParams.get('draft'),draft=await(await request.get('/api/watermark/drafts/'+draftId)).json();
  expect(draft.asset_variant_id).toBeTruthy();expect(draft.photo_id).toBeNull();
  await page.getByRole('button',{name:en?'Mark Ready to Export':'标记为待导出',exact:true}).click();
  await expect.poll(async()=>(await(await request.get('/api/watermark/drafts/'+draftId)).json()).status).toBe('ready');
  expect((await(await request.get('/api/photos')).json()).total).toBe(total);
  expect(hash(source)).toBe(before);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(en)expect(await page.locator('.watermark-layout').innerText()).not.toMatch(/[\u3400-\u9fff]/u);
  await page.goto('/tools/darkroom');const card=page.locator('.edit-variants article').filter({hasText:photo.file_name.replace(/\.[^.]+$/,'')});
  await expect(card).toHaveCount(1);await expect(card.locator('img')).toHaveJSProperty('naturalWidth',500);
  expect(errors).toEqual([]);
});

test('desktop RAW decoding retains 16-bit working pixels',async({page},info)=>{
  test.setTimeout(120000);const source=join(import.meta.dirname,'../../.test-artifacts/raw-fixtures/sample.DNG');
  test.skip(!existsSync(source),'Run the documented RAW fixture setup first.');const before=hash(source);await preferences(page);
  await page.goto('/tools/raw');await expect(page.getByRole('heading',{name:'光影暗房',exact:true})).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles(source);await settled(page);
  await expect(page.locator('.edit-stage-top')).toContainText('16-bit');
  const response=await page.request.get('/raw-1.6.0/libraw.wasm');expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('application/wasm');
  expect(hash(source)).toBe(before);await page.screenshot({path:info.outputPath('desktop-raw.png'),animations:'disabled'});
});

test('desktop source cancellation and stale edit conflicts preserve newer work',async({page,request})=>{
  await preferences(page,1440,'en');const {source,photo}=await fixture(request,'editor-conflict.png'),before=hash(source);
  let release;const pending=new Promise(resolve=>{release=resolve});
  await page.route('**/api/photos/'+photo.id+'/original',async route=>{await pending;await route.fulfill({body:readFileSync(source),contentType:'image/png'}).catch(()=>{});});
  const reading=page.waitForRequest('**/api/photos/'+photo.id+'/original');
  await page.goto('/tools/darkroom?photo='+photo.id);
  await reading;
  await page.getByRole('button',{name:'Cancel processing',exact:true}).click();release();
  await expect(page.locator('.edit-image img')).toHaveCount(0);
  await page.locator('input[type=file]').first().setInputFiles(source);await settled(page);
  await page.getByRole('button',{name:/^Save edits/}).click();
  await expect(page.getByText('Edits saved. Original unchanged.',{exact:true})).toBeVisible();
  let edit=(await(await request.get('/api/editor/edits')).json()).edits.find(e=>e.source_name==='editor-conflict.png');
  const changed=await request.put('/api/editor/edits/'+edit.id,{data:{revision:edit.revision,source_hash:edit.source_hash,recipe:{...edit.recipe,exposure:-1}}});expect(changed.ok()).toBe(true);
  await page.getByRole('slider',{name:'Exposure EV',exact:true}).fill('2');
  await page.getByRole('button',{name:/^Save edits/}).click();
  await expect(page.getByRole('alert')).toHaveText('This edit changed in another window. Reopen it to continue.');
  edit=await(await request.get('/api/editor/edits/'+edit.id)).json();expect(edit.recipe.exposure).toBe(-1);expect(edit.revision).toBe(2);
  page.on('dialog',dialog=>dialog.accept());await page.goto('/tools/darkroom');
  await page.locator('.edit-records button').filter({hasText:'editor-conflict.png'}).click();await settled(page);
  await expect(page.getByRole('slider',{name:'Exposure EV',exact:true})).toHaveValue('-1');expect(hash(source)).toBe(before);
});


test('library view preferences migrate once, survive reload and ignore late initial reads',async({page,request})=>{
  await preferences(page,1440,'en');
  const state=await(await request.get('/api/workspace')).json();
  const base={layout:'justified',grid:230,gap:14,radius:6,dense:false,sort:'date_taken',direction:'desc'};
  try{
    await request.patch('/api/workspace/preferences',{data:{library_id:state.library_id,values:{layout:'waterfall',grid:180}}});
    let release;const gate=new Promise(resolve=>release=resolve);let held=false;
    await page.route('**/api/workspace',async route=>{const response=await route.fetch();held=true;await gate;await route.fulfill({response});});
    await page.goto('/?page=photos');await expect.poll(()=>held).toBe(true);
    const slider=page.getByRole('slider',{name:'Grid Size',exact:true});
    await slider.fill('300');release();
    await expect(slider).toHaveValue('300');
    await expect.poll(async()=>(await(await request.get('/api/workspace')).json()).preferences.grid).toBe(300);
    await page.getByRole('button',{name:'Grid Display Settings',exact:true}).click();
    await expect(page.getByRole('combobox',{name:'Gallery layout'})).toHaveValue('waterfall');
    await page.unroute('**/api/workspace');await page.goto('/');
    await expect(page.locator('.home-page')).toBeVisible();
    await page.goto('/?page=photos');await expect(slider).toHaveValue('300');
    expect(await page.evaluate(()=>({lang:localStorage.getItem('lang'),theme:localStorage.getItem('theme')}))).toEqual({lang:'en',theme:'light'});
  }finally{await request.patch('/api/workspace/preferences',{data:{library_id:state.library_id,values:{...base,...state.preferences}}});}
});
