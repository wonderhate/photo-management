import {exerciseDepthUI} from './fixtures/vision-depth-ui.mjs';
import {exerciseVisionUI} from './fixtures/vision-ui.mjs';
import {exerciseLutFolds} from './fixtures/lut-fold-ui.mjs';
import {exerciseLutBandWorker} from './fixtures/lut-band-worker.mjs';
import {installLutPerformanceProbe,exerciseLutPerformance} from './fixtures/lut-performance-ui.mjs';
import {exerciseLutManagement,exerciseLargeLutTree} from './fixtures/lut-management-ui.mjs';
import {exerciseLutConvenience} from './fixtures/lut-convenience-ui.mjs';
import {exerciseLutCopy} from './fixtures/lut-copy-ui.mjs';
import {exerciseLutFolders} from './fixtures/lut-folders-ui.mjs';
import {exerciseLutBrowse} from './fixtures/lut-browse-ui.mjs';
import {exerciseOverlayUI} from './fixtures/overlay-ui.mjs';
import {exerciseLutUI} from './fixtures/lut-ui.mjs';
import {invertCube} from './fixtures/lut-ui.mjs';
import {exerciseLutWorker} from './fixtures/lut-worker.mjs';
import {exerciseLutErrors} from './fixtures/lut-errors.mjs';
import {exerciseTextUI} from './fixtures/text-ui.mjs';
import {exerciseTextWorker} from './fixtures/text-worker.mjs';
import {test,expect} from './fixtures/native-runtime.mjs';
import {exerciseSplitChildUI} from './fixtures/split-child-ui.mjs';
import {exerciseSplitUI,holdSplitWorker,cancelSplitUI} from './fixtures/split-ui.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';

async function fixture(page,request,width=1440,lang='zh',prefix='AF33'){
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');const name=`${prefix}-ui-${width}-${lang}.png`,path=join(health.data_dir,name);
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image,ImageDraw;import sys;im=Image.new('RGB',(640,480),(40,90,130));d=ImageDraw.Draw(im);[d.rectangle((x,y,x+39,y+39),fill=(x%256,y%256,(x+y)%256)) for x in range(0,640,40) for y in range(0,480,40)];im.save(sys.argv[1])",path]);
  await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/tools/darkroom');await page.locator('.editor-toolbar input[type=file]').setInputFiles(path);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',640);
  return {name,path,hash:createHash('sha256').update(readFileSync(path)).digest('hex')};
}

test('LUT refresh waits for a pending usage write before replacing its recent snapshot',async({page,request})=>{
  const f=await fixture(page,request,390,'en','lut-refresh-race');
  const panel=page.locator('.lut-panel'),names=['Race-A.cube','Race-B.cube'];
  await panel.locator(':scope>summary').click();await panel.getByRole('searchbox').fill('Race-');
  await panel.locator('input[type=file]').first().setInputFiles(names.map(name=>({name,mimeType:'application/octet-stream',buffer:Buffer.from(invertCube(name))})));
  await expect(panel.locator('.lut-import-report')).toContainText('Added 2');
  const choice=name=>panel.getByRole('button',{name:'Apply LUT '+name,exact:true});
  await choice(names[0]).click();await panel.getByRole('button',{name:'Refresh styles',exact:true}).click();await expect(panel.locator('[data-lut-group=recent]')).toContainText('1');
  let pending=false,earlyRead=false;
  await page.route('**/api/editor/luts/*/used',async route=>{pending=true;await new Promise(resolve=>setTimeout(resolve,400));const response=await route.fetch();pending=false;await route.fulfill({response});});
  await page.route('**/api/editor/luts',route=>{if(route.request().method()==='GET'&&pending)earlyRead=true;return route.continue();});
  await choice(names[1]).click();await expect.poll(()=>pending).toBe(true);
  await panel.getByRole('button',{name:'Refresh styles',exact:true}).click();
  await expect(panel.locator('[data-lut-group=recent]')).toContainText('2');expect(earlyRead).toBe(false);
  expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`LUT folded groups persist and arrows skip hidden cells ${width} ${lang}`,async({page,request},info)=>{
 test.setTimeout(90000);const f=await fixture(page,request,width,lang,'AF36-folds');await exerciseLutFolds(page,info,lang);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
test('LUT full-resolution band workers keep export pixels and recover failed bands',async({page,request})=>{
 test.setTimeout(120000);await fixture(page,request);const module='/assets/'+readdirSync('frontend/dist/assets').find(f=>/^edit-worker-.*\.js$/.test(f));await exerciseLutBandWorker(page,module);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`LUT parallel thumbnails close cleanly and rapid switching keeps graded pixels ${width} ${lang}`,async({page,request},info)=>{
 test.setTimeout(90000);await installLutPerformanceProbe(page);const f=await fixture(page,request,width,lang,'AF36-performance');await exerciseLutPerformance(page,info,lang);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`LUT management batch menu groups bulk hide restore ${width} ${lang}`,async({page,request},info)=>{
 test.setTimeout(90000);const f=await fixture(page,request,width,lang,'AF36-management');await exerciseLutManagement(page,info,lang);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
test('LUT expanded directory tree keeps a global DOM budget and every folder reachable',async({page,request})=>{test.setTimeout(90000);const f=await fixture(page,request,1440,'zh','AF36-tree');await exerciseLargeLutTree(page);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`LUT convenience batch drop all-fold source download and thumbnail retry ${width} ${lang}`,async({page,request},info)=>{
 test.setTimeout(90000);const f=await fixture(page,request,width,lang,'AF36-convenience');await exerciseLutConvenience(page,info,lang);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`LUT copied folders batch groups context duplicate outcomes ${width} ${lang}`,async({page,request},info)=>{
 test.setTimeout(90000);const f=await fixture(page,request,width,lang,'AF36-copy');await exerciseLutCopy(page,info,lang);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`external LUT directories batch ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(90000);const f=await fixture(page,request,width,lang,'AF36-directories'),root=join(dirname(dirname(f.path)),'LUT-linked-'+width+'-'+Date.now()),dir=join(root,'Cinema');mkdirSync(dir,{recursive:true});
  const {invertCube}=await import('./fixtures/lut-ui.mjs');const original='# Input: S-Log3\n'+invertCube('Directory');writeFileSync(join(dir,'Directory.cube'),original);await page.route('**/api/dialog/lut-directory',route=>route.fulfill({json:{paths:[root]}}));
  await exerciseLutFolders(page,info,lang,async()=>{writeFileSync(join(root,'New.cube'),invertCube('New'));});expect(readFileSync(join(dir,'Directory.cube'),'utf8')).toBe(original);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`LUT browsing batch log hints preferences keyboard history and temporary comparison ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(90000);const f=await fixture(page,request,width,lang,'AF36-browse');await exerciseLutBrowse(page,info,lang,'/tools/darkroom');expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`LUT batch invalid imports explain errors and recover ${width} ${lang}`,async({page,request})=>{
  const f=await fixture(page,request,width,lang,'AF36-errors');await exerciseLutErrors(page,lang);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`LUT batch import favorites strength undo and reopen ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(90000);const f=await fixture(page,request,width,lang,'AF36');await exerciseLutUI(page,info,lang,'/tools/darkroom');expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
test('LUT batch native worker grades before layers and preserves split snapshots',async({page,request})=>{
  test.setTimeout(90000);await fixture(page,request);const module='/assets/'+readdirSync('frontend/dist/assets').find(f=>/^editor-adapter-.*\.js$/.test(f)),document=JSON.parse(readFileSync('frontend/tests/fixtures/layer-stack-contract.json','utf8'));await exerciseLutWorker(page,module,document);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`split UI preserves gestures, crop, saved groups and downloads ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(60000);const f=await fixture(page,request,width,lang),result=await exerciseSplitUI(page,info,lang),text=(zh,en)=>lang==='en'?en:zh;
  const edit=(await(await request.get('/api/editor/edits?search='+f.name)).json()).edits[0],groups=await(await request.get('/api/editor/splits?document_id='+edit.id)).json();expect(edit.recipe.crop).toEqual({x:0,y:0,width:.8,height:1});expect(groups.total).toBe(1);expect(groups.items[0].plan).toMatchObject({width:result.width,height:result.height,count:3});const bytes=readFileSync(result.path);expect(bytes.equals(await(await request.get(groups.items[0].panels[0].preview_url)).body())).toBe(true);
  await page.reload();await page.locator('.edit-records').getByRole('button',{name:new RegExp('^'+f.name)}).click();await page.getByRole('button',{name:text('无缝分图','Seamless split'),exact:true}).click();const dialog=page.getByRole('dialog',{name:text('无缝分图','Seamless split')});await expect(dialog.getByRole('button',{name:'4:5',exact:true})).toHaveAttribute('aria-pressed','true');await dialog.locator('.split-groups button').first().click();await expect(dialog.locator('.split-saved img')).toHaveCount(3);await expect(dialog.locator('.split-saved img').first()).toHaveJSProperty('naturalHeight',result.height);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
test('split UI cancellation rebuilds the worker without discarding the edit',async({page,request})=>{
  test.setTimeout(60000);await holdSplitWorker(page);const f=await fixture(page,request);await cancelSplitUI(page);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
test('split UI retries an uncertain saved response with the same group identity',async({page,request})=>{
  test.setTimeout(60000);const f=await fixture(page,request),requests=[];
  await page.route('**/api/editor/splits',async route=>{if(route.request().method()!=='POST')return route.continue();requests.push(route.request().postDataBuffer().toString());if(requests.length===1){const response=await route.fetch();expect(response.status()).toBe(201);return route.abort('failed');}return route.continue();});
  await page.getByRole('button',{name:'无缝分图',exact:true}).click();const dialog=page.getByRole('dialog',{name:'无缝分图'});await expect(dialog.locator('[data-split-handle=se]')).toBeEnabled();await dialog.getByRole('button',{name:'保存整组分图',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await dialog.getByRole('button',{name:'保存整组分图',exact:true}).click();await expect(dialog.getByRole('button',{name:'已保存整组',exact:true})).toBeDisabled();
  expect(requests).toHaveLength(2);expect(requests[0].match(/"request_id":"([^"]+)"/)[1]).toBe(requests[1].match(/"request_id":"([^"]+)"/)[1]);const edit=(await(await request.get('/api/editor/edits?search='+f.name)).json()).edits[0];expect((await(await request.get('/api/editor/splits?document_id='+edit.id)).json()).total).toBe(1);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`split directory UI preserves defaults, cancellation, collisions and uncertain responses ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(60000);const f=await fixture(page,request,width,lang),text=(zh,en)=>lang==='en'?en:zh,folder=join(dirname(f.path),'chosen-'+width);mkdirSync(folder);const preserved=join(folder,f.name.replace('.png','_split_01.png'));writeFileSync(preserved,readFileSync(f.path));
  let picker=0;await page.route('**/api/dialog/directory',route=>route.fulfill({json:{paths:++picker===1?[]:[folder]}}));
  await page.getByRole('button',{name:text('无缝分图','Seamless split'),exact:true}).click();const dialog=page.getByRole('dialog',{name:text('无缝分图','Seamless split')});await dialog.getByRole('button',{name:text('保存整组分图','Save split group'),exact:true}).click();await expect(dialog.getByRole('button',{name:text('已保存整组','Group saved'),exact:true})).toBeDisabled();
  const panel=dialog.locator('.split-export');await panel.getByRole('button',{name:text('选择分图目录','Choose split directory'),exact:true}).click();await expect(panel.locator('.split-output-folder>span')).toHaveText(text('默认导出目录','Default export directory'));
  await panel.getByRole('button',{name:text('导出整组到目录','Export group to directory'),exact:true}).click();await expect(panel.locator('.split-export-result')).toBeVisible();const initial=await panel.locator('.split-export-result span').innerText();expect(readdirSync(initial).filter(n=>n.endsWith('.png'))).toHaveLength(2);
  await panel.getByRole('button',{name:text('选择分图目录','Choose split directory'),exact:true}).click();await expect(panel.locator('.split-output-folder>span')).toHaveText(folder);await panel.getByRole('checkbox',{name:text('为整组创建子目录','Create a subfolder for the group')}).uncheck();
  const calls=[];await page.route('**/api/editor/splits/*/export',async route=>{calls.push(route.request().postDataJSON());if(calls.length===1){expect((await route.fetch()).ok()).toBe(true);return route.abort('failed');}return route.continue();});
  await panel.getByRole('button',{name:text('导出整组到目录','Export group to directory'),exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();await panel.getByRole('button',{name:text('重试整组导出','Retry group export'),exact:true}).click();await expect(panel.locator('.split-export-result')).toBeVisible();expect(calls).toHaveLength(2);expect(calls[0].request_id).toBe(calls[1].request_id);
  const edit=(await(await request.get('/api/editor/edits?search='+f.name)).json()).edits[0],group=(await(await request.get('/api/editor/splits?document_id='+edit.id)).json()).items[0];
  for(let i=0;i<2;i++){const bytes=readFileSync(join(folder,f.name.replace('.png',`_split_1_${String(i+1).padStart(2,'0')}.png`)));expect(bytes.equals(await(await request.get(group.panels[i].preview_url)).body())).toBe(true);}
  expect(readdirSync(folder)).toHaveLength(3);expect(createHash('sha256').update(readFileSync(preserved)).digest('hex')).toBe(f.hash);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
  await panel.screenshot({path:info.outputPath('split-directory.png')});if(lang==='en')expect(await panel.innerText()).not.toMatch(/[\u3400-\u9fff]/);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`split child UI preserves dirty edits, neutral pixels and source navigation ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(90000);const f=await fixture(page,request,width,lang);let requests=[];
  await page.route('**/api/editor/splits/*/panels/*/edit',async route=>{requests.push(route.request().postDataJSON().request_id);if(requests.length===1){await route.fetch();await route.abort();}else await route.continue();});
  const child=await exerciseSplitChildUI(page,info,lang,'/tools/darkroom');expect(requests).toHaveLength(2);expect(requests[1]).toBe(requests[0]);
  const rows=(await(await request.get('/api/editor/edits')).json()).edits,record=rows.find(r=>r.id===requests[0]);expect(record.source_name).toBe(child.name);expect(record.recipe.exposure).toBe(.3);expect(record.revision).toBe(2);expect(record.derived_from.document_revision).toBe(1);
  expect(rows.filter(r=>r.id===requests[0])).toHaveLength(1);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`text layers batch persists styles and touch/undo without changing originals ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(120000);const f=await fixture(page,request,width,lang),result=await exerciseTextUI(page,info,lang,'/tools/darkroom');
  const rows=(await(await request.get('/api/editor/edits')).json()).edits,record=rows.find(r=>r.source_name===result.name);expect(record.recipe.version).toBe(4);expect(record.recipe.layer_stack.layers).toHaveLength(1);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
test('text layers batch real worker retains seamless glyphs and neutral child pixels on native storage',async({page,request})=>{
  test.setTimeout(90000);await fixture(page,request);const module='/assets/'+readdirSync('frontend/dist/assets').find(f=>/^editor-adapter-.*\.js$/.test(f)),document=JSON.parse(readFileSync('frontend/tests/fixtures/text-layer-contract.json','utf8'));await exerciseTextWorker(page,module,document);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`overlay layers batch mixed order, alpha, undo and reopening ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(90000);const f=await fixture(page,request,width,lang),result=await exerciseOverlayUI(page,info,lang,'/tools/darkroom'),rows=(await(await request.get('/api/editor/edits')).json()).edits,r=rows.find(r=>r.source_name===result.name);expect(r.recipe.version).toBe(4);expect(r.recipe.layer_stack.layers.map(l=>l.kind)).toEqual(['overlay','text']);expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
test('overlay layers batch worker order coverage and split pixels persist on native storage',async({page,request})=>{
  test.setTimeout(90000);await fixture(page,request);const module='/assets/'+readdirSync('frontend/dist/assets').find(f=>/^editor-adapter-.*\.js$/.test(f)),document=JSON.parse(readFileSync('frontend/tests/fixtures/text-layer-contract.json','utf8')),overlay=JSON.parse(readFileSync('frontend/tests/fixtures/layer-stack-contract.json','utf8')).layers[0];await exerciseTextWorker(page,module,document,overlay);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`vision sticker eight handles, hidden assets and reopen ${width} ${lang}`,async({page,request},info)=>{
 test.setTimeout(90000);const f=await fixture(page,request,width,lang,'Vision');await exerciseVisionUI(page,info,lang,'/tools/darkroom');expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});

test('real local depth UI imports weights cancels and reopens the mask',async({page,request},info)=>{
 test.skip(!process.env.PHOTO_TEST_VISION_MODELS,'Explicit public model fixtures required');test.setTimeout(150000);const f=await fixture(page,request,1440,'zh','Depth');await exerciseDepthUI(page,info,'native','/tools/darkroom');expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.hash);
});
