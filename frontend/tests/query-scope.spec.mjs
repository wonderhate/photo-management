import {test,expect} from './fixtures/native-runtime.mjs';
import {exerciseQueryScope,readScopeURL} from './fixtures/query-scope.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const contract=JSON.parse(readFileSync(new URL('./fixtures/facet-contract.json',import.meta.url),'utf8'));
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`query scope keeps normal, smart, rule and person albums through clear and history ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(60000);const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');const prefix='scope-ui-'+lang+'-',rows=contract.rows.map(p=>({...p,file_name:prefix+p.file_name})),ids=rows.map(p=>prefix+p.id),source=join(health.data_dir,prefix+'original.jpg');execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;Image.new('RGB',(120,80),(99+len(sys.argv[2]),110,180)).save(sys.argv[1],comment=sys.argv[1].encode())",source,lang]);const sha=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=sha();
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',[
    'import json,sys,hashlib;from pathlib import Path',
    'from backend.app.models import Session,Photo,CaptureGroup',
    'from backend.app.services.library_service import set_tags',
    'rows=json.loads(sys.argv[1]);prefix=sys.argv[2];source=Path(sys.argv[3])',
    'with Session() as s:',
    ' for row in rows:s.add(CaptureGroup(id=prefix+row["id"],preferred_photo_id=prefix+row["id"]))',
    ' s.flush()',
    ' for row in rows:',
    '  p=dict(row);names=p.pop("tags");p["id"]=prefix+p["id"];path=source if p["id"]==prefix+"a" else source.parent/(p["id"]+".jpg")',
    '  photo=Photo(**p,file_path=str(path),file_stem=p["id"],source_directory=str(path.parent),file_hash=hashlib.sha256(path.read_bytes() if path==source else p["id"].encode()).hexdigest(),file_size=0,capture_group_id=p["id"],preview_error="Synthetic missing preview");s.add(photo);s.flush();set_tags(s,photo,names)',
    ' s.commit()'
  ].join('\n'),JSON.stringify(rows),prefix,source],{env:{...process.env,PHOTO_DATA_DIR:health.data_dir,PHOTO_AUTOLOAD_AI:'0'}});
  const albums=[],make=async data=>{const r=await request.post('/api/albums',{data});expect(r.ok()).toBe(true);const a=await r.json();albums.push(a);return a;},normal=await make({name:prefix+'Normal',photo_ids:ids.slice(0,3)}),second=await make({name:prefix+'Smart',type:'smart',keywords:['synthetic'],photo_ids:ids.slice(1,3)}),rule=await make({name:prefix+'Rule',type:'rule',query:{version:1,root:{op:'and',children:[{op:'contains',field:'file_name',value:prefix},{op:'gte',field:'rating',value:4}]}}}),person=await make({name:prefix+'Person',photo_ids:ids.slice(1,3)});
  try{await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1400});await page.emulateMedia({reducedMotion:'reduce'});await page.route('**/api/faces/**',route=>{const key=new URL(route.request().url()).pathname;return route.fulfill({json:key.endsWith('/status')?{available:true,dependency:true,cached:true}:[{id:'fixture-person',name:'Scope Person',photo_count:2,pending:0,albums:[{id:person.id,name:person.name,linked:true}]}]});});await page.goto('/?page=albums');
    const text=(zh,en)=>lang==='en'?en:zh;await exerciseQueryScope(page,{lang,rows,normal,second,rule,openSecond:async()=>{await page.locator('.workspace-subnav').getByRole('button',{name:text('智能影集','Smart Albums'),exact:true}).click();await page.locator('.album-card').filter({hasText:second.name}).locator('.album-cover').click();},openPerson:async()=>{await page.locator('.workspace-subnav').getByRole('button',{name:text('人物','People'),exact:true}).click();await page.locator('.face-card').getByRole('button',{name:text('打开人物影集','Open Person Album'),exact:true}).click();},screenshot:info.outputPath('query-scope.png')});expect(sha()).toBe(before);
  }finally{
    // Stop gallery requests before removing synthetic records. A reset during one
    // idempotent cleanup must not leave missing-preview fixtures in later tests.
    await page.close();const cleanup=[];
    for(const url of [...albums.map(a=>'/api/albums/'+a.id),...ids.map(id=>'/api/photos/'+id+'?scope=file')]){
      try{const response=await request.delete(url,{maxRetries:2});expect(response.ok()||response.status()===404).toBe(true);}catch(error){cleanup.push(error);}
    }
    expect(sha()).toBe(before);if(cleanup.length)throw new AggregateError(cleanup,'Synthetic query-scope cleanup failed');
  }
});

test('a file-count chart opens the RAW file and removing it keeps its paired JPEG and both originals',async({page,request})=>{
  test.setTimeout(60000);page.on('dialog',d=>d.accept());const health=await(await request.get('/api/health')).json(),settings=await(await request.get('/api/settings')).json(),paths=['scope-chart.jpg','scope-chart.RAW'].map(p=>join(health.data_dir,p));expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;from pathlib import Path;import sys;Image.new('RGB',(16,16),'#139bca').save(sys.argv[1],comment=sys.argv[1].encode());Path(sys.argv[2]).write_bytes(b'synthetic RAW fixture only')",...paths]);const hashes=()=>paths.map(p=>createHash('sha256').update(readFileSync(p)).digest('hex')),before=hashes();
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',[
    'from backend.app.models import Session,Photo,CaptureGroup;from pathlib import Path;import sys,hashlib',
    'with Session() as s:',
    ' s.add(CaptureGroup(id="scope-chart",preferred_photo_id="scope-chart-jpg"));s.flush()',
    ' for i,path in enumerate(sys.argv[1:]):',
    '  p=Path(path);s.add(Photo(id="scope-chart-"+("raw" if i else "jpg"),file_path=str(p),file_name=p.name,file_stem="scope-chart",source_directory=str(p.parent),file_hash=hashlib.sha256(p.read_bytes()).hexdigest(),file_size=p.stat().st_size,file_format="RAW" if i else "JPG",is_raw=bool(i),capture_group_id="scope-chart",iso=31250 if i else 100,width=16,height=16,preview_error="Synthetic missing preview"))',
    ' s.commit()'
  ].join('\n'),...paths],{env:{...process.env,PHOTO_DATA_DIR:health.data_dir,PHOTO_AUTOLOAD_AI:'0'}});
  try{expect((await request.put('/api/settings',{data:{...settings,count_mode:'file'}})).ok()).toBe(true);await page.addInitScript(()=>{localStorage.setItem('lang','zh');localStorage.setItem('onboarded','1')});await page.goto('/?page=stats');await expect(page.getByText('按文件数量统计',{exact:false})).toBeVisible();await page.getByRole('button',{name:'原始数值',exact:true}).click();await page.locator('.chart-panel').filter({has:page.getByRole('heading',{name:'ISO 分布',exact:true})}).getByRole('button').filter({hasText:'31250'}).click();await expect(page.locator('.photo-caption>span')).toHaveText('scope-chart.RAW');expect(readScopeURL(page.url())).toMatchObject({mode:'file',origin:'stats'});expect(JSON.parse(readScopeURL(page.url()).base.query)).toEqual({version:1,root:{op:'eq',field:'iso',value:31250}});await expect(page.locator('.vg-total')).toContainText('个文件');await page.locator('.photo-card .select-box').click();await page.getByRole('button',{name:'移出图库',exact:true}).click();await expect(page.locator('.photo-card')).toHaveCount(0);expect((await request.get('/api/photos/scope-chart-jpg')).ok()).toBe(true);expect((await request.get('/api/photos/scope-chart-raw')).status()).toBe(404);expect(hashes()).toEqual(before);}
  finally{await page.goto('/?page=home').catch(()=>{});for(const id of ['scope-chart-raw','scope-chart-jpg'])await request.delete('/api/photos/'+id+'?scope=file');await request.put('/api/settings',{data:settings});expect(hashes()).toEqual(before);}
});
