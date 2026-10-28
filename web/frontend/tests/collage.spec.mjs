import {exerciseCollageOutput} from './fixtures/collage-output-ui.mjs';
import {exerciseCollageTen} from './fixtures/collage-ten-ui.mjs';
import {exerciseCollageProject} from './fixtures/collage-project-ui.mjs';
import {exerciseBlendWorker,exerciseBlendUI} from './fixtures/collage-blend-ui.mjs';
import {installBatchProbe,exerciseCollageBatch,exerciseBatchTransfer,exerciseBatchGallery} from './fixtures/collage-batch-ui.mjs';
import {exerciseCollageInteraction} from './fixtures/collage-interaction-ui.mjs';
import {test,expect} from './fixtures/native-runtime.mjs';
import {readdirSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {exerciseCollageUI,installCollageProbe,exerciseGalleryCollage} from './fixtures/collage-ui.mjs';
import {exerciseCollageWorker} from './fixtures/collage-worker.mjs';
// Saved projects and outputs belong to the isolated shared server; each case starts empty.
test.beforeEach(async({request})=>{
 const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
 for(const endpoint of ['/api/editor/collage-outputs','/api/editor/collages']){
  for(let page=0;page<100;page++){
   const {items}=await(await request.get(endpoint)).json();if(!items.length)break;
   for(const item of items)expect((await request.delete(endpoint+'/'+item.id+(endpoint.endsWith('/collages')?'?revision='+item.revision:''))).ok()).toBe(true);
   if(page===99)throw new Error('Synthetic collage fixture cleanup did not finish');
  }
 }
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`collage layout framing source recovery and cancellation ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(120000);await installCollageProbe(page);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');localStorage.setItem('onboarded','1');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageUI(page,info,lang);
});
test('collage worker renders 80 layouts exact pixels full sources RAW and atomic recovery',async({page},info)=>{
 test.setTimeout(120000);await page.goto('/tools');const files=readdirSync('frontend/dist/assets'),module='/assets/'+files.find(f=>/^collage-worker-.*\.js$/.test(f)),edit='/assets/'+files.find(f=>/^edit-worker-.*\.js$/.test(f));const result=await exerciseCollageWorker(page,module,edit);await info.attach('collage-pixels',{body:JSON.stringify(result),contentType:'application/json'});
});

test('collage gallery entry registers source identity and preserves original files',async({page,request})=>{
 const health=await(await request.get('/api/health')).json(),photos=[],sources=[];expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/');
 for(let i=0;i<2;i++){const name=`CollageGallery-${i}.png`,path=join(health.data_dir,name);execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;Image.new('RGB',(300,200),(30+int(sys.argv[2])*100,80,120)).save(sys.argv[1])",path,String(i)]);sources.push({path,hash:createHash('sha256').update(readFileSync(path)).digest('hex')});const job=await(await request.post('/api/photos/import',{data:{paths:[path]}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');photos.push((await(await request.get('/api/photos?search='+name)).json()).photos[0]);}
 await page.addInitScript(()=>{localStorage.setItem('lang','zh');localStorage.setItem('onboarded','1');});await page.goto('/?page=photos&search=CollageGallery');await exerciseGalleryCollage(page,photos);for(const source of sources)expect(createHash('sha256').update(readFileSync(source.path)).digest('hex')).toBe(source.hash);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`collage direct swap pinch snap canvas controls and JPEG ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');localStorage.setItem('onboarded','1');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageInteraction(page,info,lang);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`collage batch grouping edit swap recovery cancel and ZIP ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(120000);await installBatchProbe(page);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');localStorage.setItem('onboarded','1');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageBatch(page,info,lang);
});

test('collage batch transfer preserves visual order and stops inspection',async({page})=>{
 await installBatchProbe(page);await page.addInitScript(()=>{localStorage.setItem('lang','zh');localStorage.setItem('onboarded','1');});await page.goto('/tools');await page.locator('.studio-tool').filter({hasText:'照片拼图'}).click();await exerciseBatchTransfer(page);
});
test('collage batch gallery automatically handles thirteen originals without mutation',async({page,request})=>{
 const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/');const paths=Array.from({length:13},(_,i)=>join(health.data_dir,`BatchGallery-${String(i).padStart(2,'0')}.png`));execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;[Image.new('RGB',(80,60),(i*17,40,90)).save(p) for i,p in enumerate(sys.argv[1:])]",...paths]);const hashes=paths.map(p=>createHash('sha256').update(readFileSync(p)).digest('hex')),job=await(await request.post('/api/photos/import',{data:{paths}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status,{timeout:30000}).toBe('completed');const photos=(await(await request.get('/api/photos?search=BatchGallery')).json()).photos;expect(photos).toHaveLength(13);await page.addInitScript(()=>{localStorage.setItem('lang','zh');localStorage.setItem('onboarded','1');});await page.setViewportSize({width:1440,height:1400});await page.goto('/?page=photos&search=BatchGallery');await exerciseBatchGallery(page,photos);expect(paths.map(p=>createHash('sha256').update(readFileSync(p)).digest('hex'))).toEqual(hashes);
});

test('collage complementary blend pixels all layouts odd seams and full resolution',async({page},info)=>{test.setTimeout(120000);await page.goto('/tools');const module='/assets/'+readdirSync('frontend/dist/assets').find(f=>/^collage-worker-.*\.js$/.test(f));const result=await exerciseBlendWorker(page,module);await info.attach('blend-pixels',{body:JSON.stringify(result),contentType:'application/json'});});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`collage blend canvas reset legacy recovery ${width} ${lang}`,async({page},info)=>{test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');localStorage.setItem('onboarded','1');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseBlendUI(page,info,lang);});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`collage project save reopen revise copy delete ${width} ${lang}`,async({page},info)=>{test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');localStorage.setItem('onboarded','1');},lang);await page.setViewportSize({width,height:1100});await page.goto('/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageProject(page,info,lang);});

// Each case has its own defaults; persistence assertions reopen within that case.
test.beforeEach(async({request})=>{const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/');const library_id=(await(await request.get('/api/workspace')).json()).library_id;for(const [kind,values] of [['collage',{canvas:{width:2400,height:2400,gap:.008,padding:.02,radius:0,background:'#f7f3eb',edge_blend:0},format:'png',quality:95,showGuides:true}],['collageBatch',{size:4,order:'selection',remainder:'own',format:'png',quality:95}]])expect((await request.patch('/api/workspace/tools/'+kind,{data:{library_id,values}})).ok()).toBe(true);});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`collage ten-part defaults context menu project controls and WebP ${width} ${lang}`,async({page},info)=>{test.setTimeout(120000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');localStorage.setItem('onboarded','1');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageTen(page,info,lang);});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`collage immutable output library restore download and batch ${width} ${lang}`,async({page},info)=>{test.setTimeout(120000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');localStorage.setItem('onboarded','1');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageOutput(page,info,lang);});
