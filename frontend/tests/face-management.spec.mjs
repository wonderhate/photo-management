import {test,expect} from './fixtures/native-runtime.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`person cover split merge and persisted undo preserve album snapshots ${width} ${lang}`,async({page,request},info)=>{
  const text=(zh,en)=>lang==='en'?en:zh,health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const python=process.env.PHOTO_TEST_PYTHON||'python',names=[0,1,2].map(i=>`AF28-${width}-${i}.jpg`),paths=names.map(name=>join(health.data_dir,name));
  execFileSync(python,['-c',"from PIL import Image;import sys;[Image.new('RGB',(320+i*10,240),(int(sys.argv[1])%200,i*60,40)).save(p) for i,p in enumerate(sys.argv[2:])]",String(width),...paths]);
  const hashes=()=>paths.map(p=>createHash('sha256').update(readFileSync(p)).digest('hex')),before=hashes();
  const job=await(await request.post('/api/photos/import',{data:{paths}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  const photos=await Promise.all(names.map(async name=>(await(await request.get('/api/photos?search='+name)).json()).photos[0]));
  const people=await Promise.all(['A','B'].map(async n=>{return (await request.post('/api/faces/persons',{data:{name:`AF28-${n}-${width}`}})).json()}));const [a,b]=people,newName=`AF28-separated-${width}`;
  execFileSync(python,['-c',"import sqlite3,sys,json;db=sqlite3.connect(sys.argv[1]);db.execute('PRAGMA foreign_keys=ON');[db.execute('INSERT INTO detected_faces(id,photo_id,person_id,face_index,encoding,location,confirmed) VALUES(?,?,?,?,?,?,?)',('AF28-face-'+sys.argv[2]+'-'+str(i),p,sys.argv[3] if i<2 else sys.argv[4],0,b'',json.dumps(dict(left=.1,top=.1,right=.9,bottom=.9)),1)) for i,p in enumerate(sys.argv[5:])];db.commit();db.close()",join(health.data_dir,'library.db'),String(width),a.id,b.id,...photos.map(p=>p.id)]);
  const albums=await Promise.all(people.map(async p=>{return (await request.post('/api/albums',{data:{name:p.name+' snapshot',person_id:p.id}})).json()}));
  const getPeople=async()=>(await(await request.get('/api/faces/persons')).json()),history=async()=>(await(await request.get('/api/faces/history')).json()).items;
  const openedAlbums=[];let modelCalls=0,albumWrites=0;page.on('request',r=>{const u=new URL(r.url());if(u.pathname==='/api/photos/ids'){const q=u.searchParams;openedAlbums.push(q.has('scope')?JSON.parse(q.get('scope')).base.album_id:q.get('album_id'))}if(/\/api\/faces\/(models|analyze)$/.test(new URL(r.url()).pathname))modelCalls++;if(r.method()==='PATCH'&&new URL(r.url()).pathname==='/api/albums/'+albums[0].id)albumWrites++});
  await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark')},lang);await page.setViewportSize({width,height:1200});await page.emulateMedia({reducedMotion:'reduce'});
  const card=name=>page.locator('.face-card').filter({has:page.getByRole('heading',{name,exact:true})}),review=()=>page.locator('.face-review-actions');
  try{
    await page.goto('/faces');await expect(card(a.name).locator('img.person-cover')).toHaveJSProperty('naturalWidth',160);await card(a.name).getByRole('button',{name:text('查看照片','View Photos'),exact:true}).click();await expect(review()).toHaveCount(2);
    await review().nth(1).getByRole('button',{name:text('设为人物封面','Set as person cover'),exact:true}).click();await expect.poll(async()=>(await getPeople()).find(p=>p.id===a.id).manual_cover).toBe(true);
    await review().first().getByRole('checkbox').check();await page.getByRole('textbox',{name:text('拆分后的人物名称','New person name'),exact:true}).fill(newName);await page.getByRole('button',{name:text('拆分为新人物','Split into new person'),exact:true}).click();await expect(card(newName)).toBeVisible();
    await page.getByRole('button',{name:text('整理记录与撤销','History and undo'),exact:true}).click();const historyBox=page.getByRole('region',{name:text('人物整理记录','Person edit history')});
    await historyBox.getByRole('button',{name:text('撤销','Undo'),exact:true}).first().click();await expect(card(newName)).toHaveCount(0);await expect(review()).toHaveCount(2);
    await review().first().getByRole('checkbox').check();await page.getByRole('button',{name:text('移出错分','Unlink selected faces'),exact:true}).click();await expect(review()).toHaveCount(1);
    await historyBox.getByRole('button',{name:text('撤销','Undo'),exact:true}).first().click();await expect(review()).toHaveCount(2);
    await page.getByRole('button',{name:text('合并人物','Merge people'),exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('combobox',{name:text('保留人物','Keep person'),exact:true}).selectOption(b.id);await dialog.getByRole('checkbox',{name:new RegExp(a.name)}).check();
    await dialog.getByRole('button',{name:text('检查合并','Review merge'),exact:true}).click();await expect(dialog.getByRole('button',{name:text('确认合并','Confirm merge'),exact:true})).toBeEnabled();
    // A real concurrent edit invalidates the displayed merge preview.
    expect((await request.patch('/api/faces/persons/'+a.id,{data:{name:a.name+' renamed'}})).ok()).toBe(true);await dialog.getByRole('button',{name:text('确认合并','Confirm merge'),exact:true}).click();await expect(dialog.getByRole('alert')).toContainText(text('人物分组已改变','Person groups changed'));
    await expect(dialog.getByRole('checkbox',{name:new RegExp(a.name)})).toBeChecked();await dialog.getByRole('button',{name:text('刷新分组','Refresh groups'),exact:true}).click();await dialog.getByRole('button',{name:text('检查合并','Review merge'),exact:true}).click();await expect(dialog.locator('.person-merge-preview')).toContainText('renamed');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('person-merge.png'),fullPage:true});
    await dialog.getByRole('button',{name:text('确认合并','Confirm merge'),exact:true}).click();await expect(dialog).toHaveCount(0);await expect(card(a.name+' renamed')).toHaveCount(0);
    await card(b.name).getByRole('button',{name:text('打开人物影集','Open Person Album'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:albums[0].name,exact:true}).click();await expect.poll(()=>openedAlbums.includes(albums[0].id)).toBe(true);await expect(page.locator('.photo-card')).toHaveCount(2);expect(albumWrites).toBe(0);
    expect((await(await request.get('/api/albums/'+albums[0].id)).json()).person_id).toBe(a.id);expect((await(await request.get('/api/albums/'+albums[0].id)).json()).count).toBe(2);
    // Reload the page before undo to verify this is persisted history.
    await page.goto('/faces');await page.getByRole('button',{name:text('整理记录与撤销','History and undo'),exact:true}).click();await page.getByRole('region',{name:text('人物整理记录','Person edit history')}).getByRole('button',{name:text('撤销','Undo'),exact:true}).first().click();await expect(card(a.name+' renamed')).toBeVisible();
    expect((await history()).filter(h=>h.kind==='merge'&&h.undone).length).toBeGreaterThan(0);expect(modelCalls).toBe(0);expect(hashes()).toEqual(before);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('person-management.png'),fullPage:true});
  }finally{
    await page.goto('/?page=home').catch(()=>{});for(const album of albums)await request.delete('/api/albums/'+album.id);for(const person of await getPeople())if(person.name.startsWith('AF28-')&&person.name.includes(String(width)))await request.delete('/api/faces/persons/'+person.id);for(const p of photos)await request.delete('/api/photos/'+p.id+'?scope=file');expect(hashes()).toEqual(before);
  }
});
