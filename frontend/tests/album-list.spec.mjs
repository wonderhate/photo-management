import {navigateWorkspace} from './fixtures/workspace-navigation.mjs';
import {test,expect} from './fixtures/native-runtime.mjs';
import {exerciseAlbumList} from './fixtures/album-list.mjs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`album search, list sorting, custom movement and rename persist ${width} ${lang}`,async({page,request},info)=>{
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');const workspace=await(await request.get('/api/workspace')).json(),prefix='AlbumCase-'+width,source=join(health.data_dir,prefix+'.jpg');
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;Image.new('RGB',(60,40),'#659a82').save(sys.argv[1],comment=sys.argv[1].encode())",source]);const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash();const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');const photo=(await(await request.get('/api/photos?search='+prefix)).json()).photos[0],albums=[];
  for(const [name,photo_ids] of [[prefix+' Trip 10',[photo.id]],[prefix+' Trip 2',[]],[prefix+' Hidden',[photo.id]]])albums.push(await(await request.post('/api/albums',{data:{name,photo_ids}})).json());
  const all=async()=>(await(await request.get('/api/albums')).json()),saved=async()=>(await(await request.get('/api/workspace')).json()).album_preferences;
  try{await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1200});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?page=albums');await exerciseAlbumList(page,{lang,prefix,albums,all,saved,screenshot:info.outputPath('album-list.png')});expect(hash()).toBe(before);}
  finally{await page.goto('/?page=home');for(const a of await all())if(a.name.startsWith(prefix))await request.delete('/api/albums/'+a.id);await request.delete('/api/photos/'+photo.id+'?scope=file');await request.patch('/api/workspace/albums',{data:{library_id:workspace.library_id,values:{sort:'custom',direction:'asc',order:[],...workspace.album_preferences}}});expect(hash()).toBe(before);}
});

test('early album choices survive late preference reads and a failed save recovers from the journal',async({page,request})=>{
  const workspace=await(await request.get('/api/workspace')).json();await request.patch('/api/workspace/albums',{data:{library_id:workspace.library_id,values:{sort:'count',direction:'desc',order:[]}}});
  let release;const gate=new Promise(resolve=>{release=resolve;});await page.route('**/api/workspace',async route=>{const response=await route.fetch();await gate;await route.fulfill({response});});
  let reject=true;await page.route('**/api/workspace/albums',async route=>{if(reject){reject=false;return route.fulfill({status:503,json:{detail:'Synthetic preference write failure'}});}await route.continue();});
  try{await page.addInitScript(()=>{localStorage.setItem('onboarded','1');localStorage.setItem('lang','en');});await page.goto('/?page=albums');const sort=page.getByRole('combobox',{name:'Album list sort',exact:true});await sort.selectOption('name');release();await expect(sort).toHaveValue('name');await expect(page.locator('.album-list-toolbar [role=alert]')).toContainText('Synthetic preference write failure');expect((await(await request.get('/api/workspace')).json()).album_preferences.sort).toBe('count');await page.reload();await expect(sort).toHaveValue('name');await expect.poll(async()=>(await(await request.get('/api/workspace')).json()).album_preferences.sort).toBe('name');await expect(page.locator('.album-list-toolbar [role=alert]')).toHaveCount(0);}
  finally{release();await page.unrouteAll({behavior:'wait'});await page.goto('/?page=home');await request.patch('/api/workspace/albums',{data:{library_id:workspace.library_id,values:{sort:'custom',direction:'asc',order:[],...workspace.album_preferences}}});}
});

test('an older album save cannot overwrite a choice made after leaving and returning',async({page,request})=>{
  const workspace=await(await request.get('/api/workspace')).json();let release,entered=false;const gate=new Promise(resolve=>{release=resolve;});let first=true;
  await page.route('**/api/workspace/albums',async route=>{if(first){first=false;entered=true;await gate;}await route.continue();});
  try{await page.addInitScript(()=>{localStorage.setItem('onboarded','1');localStorage.setItem('lang','en');});await page.goto('/?page=albums');const sort=page.getByRole('combobox',{name:'Album list sort',exact:true});await sort.selectOption('name');await expect.poll(()=>entered).toBe(true);
    await navigateWorkspace(page,'Photos');await navigateWorkspace(page,'Albums');await sort.selectOption('created_at');await page.waitForTimeout(600);release();await expect(sort).toHaveValue('created_at');await expect.poll(async()=>(await(await request.get('/api/workspace')).json()).album_preferences.sort).toBe('created_at');await page.waitForTimeout(100);expect((await(await request.get('/api/workspace')).json()).album_preferences.sort).toBe('created_at');}
  finally{release();await page.unrouteAll({behavior:'wait'});await page.goto('/?page=home');await request.patch('/api/workspace/albums',{data:{library_id:workspace.library_id,values:{sort:'custom',direction:'asc',order:[],...workspace.album_preferences}}});}
});
