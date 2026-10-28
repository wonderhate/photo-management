import {test,expect} from './fixtures/native-runtime.mjs';
import {exerciseTextSearch} from './fixtures/text-search.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const contract=JSON.parse(readFileSync(new URL('./fixtures/text-search-contract.json',import.meta.url),'utf8'));
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`native text modes, rule fields and local index preserve originals ${width} ${lang}`,async({page,request},info)=>{
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');const prefix='text-ui-'+lang+'-',ids=contract.rows.map(p=>prefix+p.id),source=join(health.data_dir,prefix+'original.jpg');
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;Image.new('RGB',(120,80),'#769a84').save(sys.argv[1],comment=sys.argv[1].encode())",source]);const sha=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=sha();
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
    '  photo=Photo(**p,file_path=str(path),file_stem=p["id"],source_directory=str(path.parent),file_hash=hashlib.sha256(path.read_bytes() if path==source else p["id"].encode()).hexdigest(),file_format="JPG",file_size=0,capture_group_id=p["id"],preview_error="Synthetic missing preview");s.add(photo);s.flush();set_tags(s,photo,names)',
    ' s.commit()'
  ].join('\n'),JSON.stringify(contract.rows),prefix,source],{env:{...process.env,PHOTO_DATA_DIR:health.data_dir,PHOTO_AUTOLOAD_AI:'0'}});
  try{
    await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1300});await page.emulateMedia({reducedMotion:'reduce'});
    await page.route('**/api/photos/ids**',async route=>{const r=await route.fetch(),body=await r.json();await route.fulfill({response:r,json:{ids:body.ids.filter(id=>ids.includes(id))}});});
    await page.goto('/?page=photos');await exerciseTextSearch(page,{lang,rows:contract.rows,screenshot:info.outputPath('text-search.png')});
    await page.goto('/?page=settings');const card=page.locator('.text-index-settings');await expect(card).toBeVisible();await expect.poll(async()=>(await(await request.get('/api/search/index')).json()).pending).toBe(0);await card.getByRole('button',{name:lang==='en'?'Build / repair text index':'建立 / 修复文字索引',exact:true}).click();
    await expect.poll(async()=>{const jobs=await(await request.get('/api/jobs?summary=true')).json();return jobs.find(j=>j.kind==='text-index')?.status;}).toBe('completed');const jobs=await(await request.get('/api/jobs?summary=true')).json();expect(jobs.find(j=>j.kind==='text-index')).toMatchObject({billable:false,resource:'io'});await expect(card.getByRole('button',{name:lang==='en'?'Build / repair text index':'建立 / 修复文字索引',exact:true})).toBeEnabled();expect(sha()).toBe(before);if(lang==='en')expect(await card.innerText()).not.toMatch(/[\u3400-\u9fff]/);await card.screenshot({path:info.outputPath('text-index.png')});
  }finally{
    await page.goto('/?page=home').catch(()=>{});for(const id of ids)await request.delete('/api/photos/'+id+'?scope=file');for(const a of await(await request.get('/api/albums')).json())if(a.name==='Text Search '+lang)await request.delete('/api/albums/'+a.id);expect(sha()).toBe(before);
  }
});

test('unavailable visual search preserves a literal query and late parsing cannot replace a newer search',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('onboarded','1')});await page.goto('/?page=photos');const mode=page.getByRole('combobox',{name:'搜索方式',exact:true}),input=page.getByRole('textbox',{name:'搜索照片',exact:true});await mode.selectOption('text');await input.fill('Retain Literal');await input.press('Enter');await expect(page.locator('.filter-chips')).toContainText('Retain Literal');
  await mode.selectOption('semantic');await input.fill('海边画面');await input.press('Enter');await expect(page.getByText('画面内容“海边画面”需要本地 AI。请在设置加载模型；原查询已保留。',{exact:true})).toBeVisible();await expect(page.locator('.filter-chips')).toContainText('Retain Literal');
  let release,started;const pending=new Promise(r=>started=r),held=new Promise(r=>release=r);await page.route('**/api/search/parse?**',async route=>{started();await held;await route.fulfill({json:{filters:{camera_model:'Late camera'},interpreted:['Late camera'],remaining_query:''}});});await mode.selectOption('natural');await input.fill('解析等待');await input.press('Enter');await pending;await mode.selectOption('text');await input.fill('Newest Literal');await input.press('Enter');release();await expect(page.locator('.filter-chips')).toContainText('Newest Literal');await expect(page.locator('.filter-chips')).not.toContainText('Late camera');
});
