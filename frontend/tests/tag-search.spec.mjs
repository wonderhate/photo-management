import {test,expect} from './fixtures/native-runtime.mjs';
import {tagRows,exerciseTagSearch,exerciseLateTagReply} from './fixtures/tag-search.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`native ten thousand tag search stays bounded, scoped and paged ${width} ${lang}`,async({page,request},info)=>{
  test.setTimeout(90000);const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');const prefix='tags-ui-'+lang+'-',rows=tagRows(prefix),source=join(health.data_dir,prefix+'original.jpg');execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;Image.new('RGB',(120,80),'#769b88').save(sys.argv[1],comment=sys.argv[1].encode())",source]);const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash();
  const fixture=join(health.data_dir,prefix+'rows.json');writeFileSync(fixture,JSON.stringify(rows));execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',[
    'import json,sys,hashlib;from pathlib import Path',
    'from backend.app.models import Session,Photo,CaptureGroup,PhotoTag,Tag',
    'rows=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"));source=Path(sys.argv[2])',
    'with Session() as s:',
    ' for p in rows:s.add(CaptureGroup(id=p["id"],preferred_photo_id=p["id"]))',
    ' s.flush()',
    ' for row in rows:',
    '  p=dict(row);p.pop("tags");p.pop("tag_origins");path=source if row==rows[0] else source.parent/p["file_name"];s.add(Photo(**p,file_path=str(path),file_stem=p["id"],source_directory=str(path.parent),file_hash=hashlib.sha256(source.read_bytes() if row==rows[0] else p["id"].encode()).hexdigest(),file_size=0,capture_group_id=p["id"],preview_error="Synthetic missing preview"))',
    ' s.flush()',
    ' for p in rows:',
    '  for name in p["tags"]:s.add(Tag(id=hashlib.sha256(name.encode()).hexdigest(),name=name))',
    ' s.flush()',
    ' for p in rows:',
    '  for name in p["tags"]:s.add(PhotoTag(photo_id=p["id"],tag_id=hashlib.sha256(name.encode()).hexdigest(),origin=p["tag_origins"].get(name,"user")))',
    ' s.commit()'
  ].join('\n'),fixture,source],{env:{...process.env,PHOTO_DATA_DIR:health.data_dir,PHOTO_AUTOLOAD_AI:'0'}});
  const album=await(await request.post('/api/albums',{data:{name:prefix+'Collection',photo_ids:rows.map(p=>p.id)}})).json(),payloads=[],options=[];page.on('response',async r=>{const u=new URL(r.url());if(u.pathname==='/api/tags'){const b=await r.json().catch(()=>null);if(b)payloads.push(b);}if(u.pathname==='/api/filter-options')options.push(u.searchParams.get('include_tags'));});
  try{await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1200});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?page=photos&album_id='+album.id);await exerciseTagSearch(page,{lang,prefix,screenshot:info.outputPath('tag-search.png')});await exerciseLateTagReply(page,{lang,prefix});expect(payloads.length).toBeGreaterThan(1);expect(payloads.every(p=>p.values.length<=7)).toBe(true);expect(options.every(v=>v==='false')).toBe(true);expect(hash()).toBe(before);}
  finally{await page.goto('/?page=home').catch(()=>{});await request.delete('/api/albums/'+album.id);for(const row of rows)await request.delete('/api/photos/'+row.id+'?scope=file');expect(hash()).toBe(before);}
});
