import {test,expect} from './fixtures/native-runtime.mjs';
import {exerciseAlbumOverview} from './fixtures/album-overview.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`album overview covers, recent viewer, table and bulk removal ${width} ${lang}`,async({page,request},info)=>{
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');const prefix='Overview-'+width,workspace=await(await request.get('/api/workspace')).json();
  const paths=Array.from({length:5},(_,i)=>join(health.data_dir,prefix+'-'+i+'.jpg'));execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;[Image.new('RGB',(90,60),(30+i*35,140,110)).save(p,comment=p.encode()) for i,p in enumerate(sys.argv[1:])]",...paths]);const hashes=()=>paths.map(p=>createHash('sha256').update(readFileSync(p)).digest('hex')),before=hashes();
  const job=await(await request.post('/api/photos/import',{data:{paths}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');const photos=(await(await request.get('/api/photos?search='+prefix)).json()).photos,ids=photos.map(p=>p.id);
  const create=async(name,photo_ids)=>(await(await request.post('/api/albums',{data:{name,photo_ids}})).json()),auto=await create(prefix+' Delete Auto',ids),manual=await create(prefix+' Delete Manual',ids),keep=await create(prefix+' Keep',[]);
  await request.patch('/api/albums/'+manual.id,{data:{cover_photo_id:ids[0]}});await request.patch('/api/workspace/albums',{data:{library_id:workspace.library_id,values:{view:'cards'}}});const all=async()=>(await(await request.get('/api/albums')).json()),saved=async()=>(await(await request.get('/api/workspace')).json()).album_preferences;
  try{await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?page=albums');await exerciseAlbumOverview(page,{lang,prefix,auto,manual,keep,all,saved,screenshot:info.outputPath('album-overview.png')});expect(hashes()).toEqual(before);expect((await(await request.get('/api/photos?search='+prefix)).json()).total).toBe(5);}
  finally{await page.goto('/?page=home');for(const a of await all())if(a.name.startsWith(prefix))await request.delete('/api/albums/'+a.id);for(const id of ids)await request.delete('/api/photos/'+id+'?scope=file');await request.patch('/api/workspace/albums',{data:{library_id:workspace.library_id,values:{view:'cards',...workspace.album_preferences}}});expect(hashes()).toEqual(before);}
});
