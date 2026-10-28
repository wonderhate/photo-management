import {test,expect} from './fixtures/native-runtime.mjs';
import {exerciseFacets} from './fixtures/facets.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const contract=JSON.parse(readFileSync(new URL('./fixtures/facet-contract.json',import.meta.url),'utf8'));
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`scoped multi-select facets, exclusion, counts and custom bar ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(60000);const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');const prefix='facet-ui-'+lang+'-',ids=contract.rows.map(p=>prefix+p.id),source=join(health.data_dir,prefix+'original.jpg');execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;Image.new('RGB',(120,80),'#769a84').save(sys.argv[1],comment=sys.argv[1].encode())",source]);const sha=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=sha(),{library_id}=await(await request.get('/api/workspace')).json();await request.patch('/api/workspace/facets',{data:{library_id,values:{hidden:['camera_make','file_format','orientation','color_label','favorite','is_raw','focal_length','f_number','iso','exposure_seconds','date_taken','created_at','description','user_description','ai_caption','detected_text']}}});
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
  ].join('\n'),JSON.stringify(contract.rows),prefix,source],{env:{...process.env,PHOTO_DATA_DIR:health.data_dir,PHOTO_AUTOLOAD_AI:'0'}});
  const name='Facet scope '+lang,album=await(await request.post('/api/albums',{data:{name,photo_ids:ids}})).json(),reopen=async()=>{await page.goto('/?page=albums');await page.locator('.album-card').filter({hasText:name}).locator('.album-cover').click();};
  try{await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1300});await page.emulateMedia({reducedMotion:'reduce'});await reopen();await exerciseFacets(page,{lang,rows:contract.rows,reopen,saved:async()=>(await(await request.get('/api/workspace')).json()).facet_preferences,screenshot:info.outputPath('facets.png')});expect(sha()).toBe(before);}
  finally{await page.goto('/?page=home').catch(()=>{});await request.delete('/api/albums/'+album.id);for(const id of ids)await request.delete('/api/photos/'+id+'?scope=file');await request.patch('/api/workspace/facets',{data:{library_id,values:{hidden:[]}}});expect(sha()).toBe(before);}
});
