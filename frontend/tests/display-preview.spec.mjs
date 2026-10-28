import {test,expect} from './fixtures/native-runtime.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {cacheRows,damageCache} from './fixtures/display-cache.mjs';
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
async function fixture(request,name,raw=false,transparent=false){
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const source=join(health.data_dir,name);
  if(raw)copyFileSync(join(import.meta.dirname,'../../.test-artifacts/raw-fixtures/sample.DNG'),source);
  else if(transparent)execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image; import sys; Image.new('RGBA',(700,300),(100,180,60,0)).save(sys.argv[1])",source]);
  else execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image,ImageDraw; import sys; im=Image.new('RGB',(4800,900),'#809ca2'); d=ImageDraw.Draw(im); d.polygon([(0,900),(1000,200),(2100,800),(3200,100),(4800,900)],fill='#24464a'); d.text((10,10),sys.argv[1],fill='white'); im.save(sys.argv[1])",source]);
  const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  const photo=(await(await request.get('/api/photos?search='+encodeURIComponent(name))).json()).photos.find(p=>p.file_name===name);expect(photo).toBeTruthy();return {photo,source};
}
async function setup(page){
  await page.setViewportSize({width:1440,height:1100});await page.addInitScript(()=>{localStorage.setItem('onboarded','1');localStorage.setItem('lang','en');localStorage.setItem('theme','dark');});
}
async function open(page,name){await page.locator('.photo-card').filter({hasText:name}).locator('.photo-image').dblclick();await expect(page.locator('.photo-viewer')).toBeVisible();}
async function gallery(page,latestName){
  await page.goto('/?page=photos');await page.getByRole('combobox',{name:'Photo Sort Order'}).selectOption('created_at');
  await expect(page.locator('.photo-card').first()).toContainText(latestName);
}
const main=page=>page.locator('.detail-image>img');

for(const kind of ['xmp','exif'])test(`native ${kind} orientation stays correct from standard to HD preview and new edit input`,async({page,request})=>{
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const folder=join(health.data_dir,'orientation-fixtures');execFileSync(process.env.PHOTO_TEST_PYTHON||'python',[join(import.meta.dirname,'fixtures/make-metadata-jpegs.py'),folder]);
  const source=join(folder,'orientation-'+kind+'.jpg'),before=hash(source);
  const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  const photo=(await(await request.get('/api/photos?search=orientation-'+kind)).json()).photos[0];expect(photo).toMatchObject({width:480,height:640,orientation:6});
  await setup(page);await gallery(page,photo.file_name);await open(page,photo.file_name);
  async function check(){
    await expect(main(page)).toHaveJSProperty('naturalWidth',480);await expect(main(page)).toHaveJSProperty('naturalHeight',640);
    const corners=await main(page).evaluate(img=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [[40,40],[440,40],[40,600],[440,600]].map(([x,y])=>[...ctx.getImageData(x,y,1,1).data].slice(0,3));});
    expect(corners[0][2]).toBeGreaterThan(180);expect(corners[0][0]).toBeLessThan(80);expect(corners[1][0]).toBeGreaterThan(180);expect(corners[1][1]).toBeLessThan(80);
    expect(corners[2][0]).toBeGreaterThan(180);expect(corners[2][1]).toBeGreaterThan(160);expect(corners[3][1]).toBeGreaterThan(160);expect(corners[3][0]).toBeLessThan(80);
  }
  await check();await page.getByRole('combobox',{name:'Preview quality',exact:true}).selectOption('4096');await expect(page.locator('.detail-image')).toHaveAttribute('data-display-preview','ready');await check();expect(await cacheRows(page)).toHaveLength(1);
  if(kind==='xmp'){
    await page.keyboard.press('Escape');await page.goto('/tools/edit?photo='+photo.id);await expect(page.locator('.edit-image img')).toBeVisible();await expect(page.locator('.edit-stage-top')).toContainText('480 × 640');
  }
  expect(hash(source)).toBe(before);
});

test('native viewer remembers quality and pinned tools while zoom and proof start fresh',async({page,request})=>{
  const {source,photo}=await fixture(request,'display-preferences.png'),before=hash(source);await setup(page);await gallery(page,photo.file_name);await open(page,photo.file_name);
  const pin=page.getByRole('button',{name:'Pin view tools',exact:true}),quality=page.getByRole('combobox',{name:'Preview quality',exact:true}),stage=page.locator('.detail-image');
  await pin.click();await quality.selectOption('4096');await expect(main(page)).toHaveJSProperty('naturalWidth',4096);
  const zoom=page.getByRole('spinbutton',{name:'View zoom percent',exact:true});await zoom.fill('200');await zoom.press('Enter');await page.getByRole('button',{name:'White proof background',exact:true}).click();
  await expect.poll(async()=>(await(await request.get('/api/workspace')).json()).tool_preferences.viewer).toEqual({pinned:true,quality:4096});
  await page.keyboard.press('Escape');await page.reload();await open(page,photo.file_name);
  await expect(pin).toHaveAttribute('aria-pressed','true');await expect(quality).toHaveValue('4096');await expect(main(page)).toHaveJSProperty('naturalWidth',4096);
  await expect(stage).toHaveAttribute('data-zoom-mode','fit');await expect(page.getByRole('button',{name:'White proof background',exact:true})).toHaveAttribute('aria-pressed','false');
  expect(hash(source)).toBe(before);
});

test('high-resolution display reads only on demand, reuses the result and keeps originals unchanged',async({page,request},info)=>{
  test.setTimeout(90000);const {source,photo}=await fixture(request,'display-warm.png'),before=hash(source);await setup(page);
  const originals=[];page.on('request',r=>{if(r.url().endsWith('/original'))originals.push(r.url());});
  await gallery(page,photo.file_name);
  const card=page.locator('.photo-card').filter({hasText:photo.file_name});await card.scrollIntoViewIfNeeded();const beforeSelection=await card.boundingBox();
  await card.locator('.select-box').click();await expect(card).toHaveClass(/selected/);const afterSelection=await card.boundingBox();
  expect(Math.abs(afterSelection.y-beforeSelection.y)).toBeLessThanOrEqual(1);await card.locator('.select-box').click();
  await open(page,photo.file_name);await expect(main(page)).toHaveJSProperty('naturalWidth',2560);expect(originals).toEqual([]);
  await page.getByRole('combobox',{name:'Preview quality'}).selectOption('4096');
  await page.waitForTimeout(200);expect(originals).toEqual([]);await expect(main(page)).toHaveJSProperty('naturalWidth',4096,{timeout:30000});
  await expect(page.locator('.detail-image')).toHaveAttribute('data-display-preview','ready');expect(originals).toHaveLength(1);
  await page.screenshot({path:info.outputPath('high-resolution-viewer.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await open(page,photo.file_name);await expect(main(page)).toHaveJSProperty('naturalWidth',4096);expect(originals).toHaveLength(1);
  await page.getByRole('combobox',{name:'Preview quality'}).selectOption('0');await expect(main(page)).toHaveJSProperty('naturalWidth',2560);
  expect(hash(source)).toBe(before);
});

test('closing a pending display terminates its worker and the next photo can finish',async({page,request})=>{
  const first=await fixture(request,'display-cancel-a.png'),second=await fixture(request,'display-cancel-b.png');await setup(page);
  await page.addInitScript(()=>{
    window.__holdDisplay=true;window.__displayQueue=[];window.__displayTerminated=0;
    const send=Worker.prototype.postMessage,terminate=Worker.prototype.terminate;
    Worker.prototype.postMessage=function(...args){if(args[0]?.action==='display'&&window.__holdDisplay)window.__displayQueue.push(()=>send.apply(this,args));else send.apply(this,args);};
    Worker.prototype.terminate=function(){window.__displayTerminated++;return terminate.apply(this,arguments);};
  });
  await gallery(page,second.photo.file_name);await open(page,first.photo.file_name);await page.getByRole('combobox',{name:'Preview quality'}).selectOption('4096');
  await page.waitForFunction(()=>window.__displayQueue.length===1);await page.keyboard.press('Escape');
  await expect.poll(()=>page.evaluate(()=>window.__displayTerminated)).toBe(1);
  await page.evaluate(()=>{window.__holdDisplay=false;window.__displayQueue.shift()();});
  await open(page,second.photo.file_name);await expect(main(page)).toHaveJSProperty('naturalWidth',4096,{timeout:30000});
  await expect(page.locator('.viewer-caption b')).toHaveText(second.photo.file_name);await expect.poll(()=>page.evaluate(()=>window.__displayTerminated)).toBe(2);
});

test('a changed source keeps the last standard preview and does not retry on metadata updates',async({page,request})=>{
  const {source,photo}=await fixture(request,'display-changed.png');await setup(page);
  // Deliberately alter only this synthetic source after indexing; viewing must not write it again.
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image; import sys; Image.new('RGB',(4800,900),'#eeaf55').save(sys.argv[1])",source]);const changed=hash(source);let reads=0;
  page.on('request',r=>{if(r.url().endsWith('/original'))reads++;});
  await gallery(page,photo.file_name);await open(page,photo.file_name);await page.getByRole('combobox',{name:'Preview quality'}).selectOption('4096');
  await expect(page.locator('.detail-image')).toHaveAttribute('data-display-preview','error');await expect(main(page)).toHaveJSProperty('naturalWidth',2560);
  await expect(page.getByText(/High-resolution preview unavailable/)).toContainText('source photo changed');
  await page.locator('.photo-viewer').getByRole('button',{name:'Favorite '+photo.file_name}).click();
  await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(450);expect(reads).toBe(1);
  await page.getByRole('button',{name:'Retry local preview'}).click();await expect.poll(()=>reads).toBe(2);expect(hash(source)).toBe(changed);
});

test('on-demand RAW display uses the full 16-bit decoder and never upscales a small source',async({page,request})=>{
  test.skip(!existsSync(join(import.meta.dirname,'../../.test-artifacts/raw-fixtures/sample.DNG')),'Run RAW fixture setup first.');
  const {source,photo}=await fixture(request,'display-raw.DNG',true),before=hash(source);await setup(page);
  await page.addInitScript(()=>{const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){if(args[0]?.action==='display')this.addEventListener('message',({data})=>{if(data.id===args[0].id)window.__displayBits=data.result?.bits;},{once:true});return send.apply(this,args);};});
  await gallery(page,photo.file_name);await open(page,photo.file_name);await page.getByRole('combobox',{name:'Preview quality'}).selectOption('6144');
  await expect(page.locator('.detail-image')).toHaveAttribute('data-display-preview','ready',{timeout:30000});await expect.poll(()=>page.evaluate(()=>window.__displayBits)).toBe(16);
  await expect(main(page)).toHaveJSProperty('naturalWidth',256);expect(hash(source)).toBe(before);
});

test('desktop high-resolution PNG retains the standard preview white alpha background',async({page,request})=>{
  const {source,photo}=await fixture(request,'display-alpha.png',false,true),before=hash(source);await setup(page);await gallery(page,photo.file_name);await open(page,photo.file_name);
  await expect(main(page)).toHaveJSProperty('naturalWidth',700);
  const pixel=()=>main(page).evaluate(img=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.drawImage(img,0,0,1,1);return [...x.getImageData(0,0,1,1).data];});
  expect((await pixel()).slice(0,3).every(v=>v>245)).toBe(true);
  await page.getByRole('combobox',{name:'Preview quality'}).selectOption('4096');await expect(page.locator('.detail-image')).toHaveAttribute('data-display-preview','ready');
  await expect(main(page)).toHaveAttribute('src',/^blob:/);await expect(main(page)).toHaveJSProperty('complete',true);
  expect((await pixel()).slice(0,3).every(v=>v>245)).toBe(true);expect(hash(source)).toBe(before);
});

test('persistent display reuses decoded JPEG across reload, repairs corruption and verifies the current original',async({page,request})=>{
  test.setTimeout(90000);const {source,photo}=await fixture(request,'display-persistent.png'),before=hash(source);await setup(page);await page.addInitScript(()=>{window.__displayDecodes=0;const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){if(args[0]?.action==='display')window.__displayDecodes++;return send.apply(this,args);};});
  async function show(){await gallery(page,photo.file_name);await open(page,photo.file_name);await page.getByRole('combobox',{name:'Preview quality'}).selectOption('4096');}
  await show();await expect(main(page)).toHaveJSProperty('naturalWidth',4096);expect(await page.evaluate(()=>window.__displayDecodes)).toBe(1);expect(await cacheRows(page)).toHaveLength(1);
  await show();await expect(page.locator('.detail-image')).toHaveAttribute('data-display-preview','ready');await expect(main(page)).toHaveJSProperty('naturalWidth',4096);expect(await page.evaluate(()=>window.__displayDecodes)).toBe(0);
  await damageCache(page);await show();await expect(main(page)).toHaveJSProperty('naturalWidth',4096);expect(await page.evaluate(()=>window.__displayDecodes)).toBe(1);expect(await cacheRows(page)).toHaveLength(1);expect(hash(source)).toBe(before);
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image; import sys; Image.new('RGB',(4800,900),'#eeaf55').save(sys.argv[1])",source]);const changed=hash(source);await show();await expect(page.locator('.detail-image')).toHaveAttribute('data-display-preview','error');await expect(main(page)).toHaveJSProperty('naturalWidth',2560);expect(await page.evaluate(()=>window.__displayDecodes)).toBe(0);expect(hash(source)).toBe(changed);
});

for(const extension of ['tiff','heic'])test(`native ${extension} display uses isolated full pixels and its persistent cache`,async({page,request})=>{
  test.setTimeout(90000);const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');const source=join(health.data_dir,'native-display.'+extension);
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image; from pillow_heif import register_heif_opener; import sys; register_heif_opener(); im=Image.new('RGB',(4600,600),'#718883'); e=Image.Exif(); e[274]=6; im.save(sys.argv[1],format='HEIF' if sys.argv[1].endswith('heic') else 'TIFF',exif=e.tobytes())",source]);const before=hash(source),job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');await setup(page);let renders=0;page.on('request',r=>{if(/\/api\/display\/[^/]+\/render\?/.test(r.url()))renders++;});
  await gallery(page,'native-display.'+extension);await open(page,'native-display.'+extension);await page.getByRole('combobox',{name:'Preview quality'}).selectOption('4096');await expect(main(page)).toHaveJSProperty('naturalHeight',4096);await expect(main(page)).toHaveJSProperty('naturalWidth',534);expect(renders).toBe(1);
  await gallery(page,'native-display.'+extension);await open(page,'native-display.'+extension);await page.getByRole('combobox',{name:'Preview quality'}).selectOption('4096');await expect(main(page)).toHaveJSProperty('naturalHeight',4096);expect(renders).toBe(1);expect((await cacheRows(page))[0].key).toContain('pc-display-2-pillow-');expect(hash(source)).toBe(before);
});
