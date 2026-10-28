import {test,expect} from './fixtures/native-runtime.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const contract=JSON.parse(readFileSync(new URL('./fixtures/photo-order.json',import.meta.url),'utf8'));
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`real rating sort stays stable, persists and preserves the original ${width} ${lang}`,async({page,request},info)=>{
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const state=await(await request.get('/api/workspace')).json(),prefix='order-'+width+'-',ids=contract.rows.map(r=>prefix+r.id),source=join(health.data_dir,'order-source-'+width+'.jpg');
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;Image.new('RGB',(32,24),'#769a84').save(sys.argv[1],comment=sys.argv[1].encode())",source]);const digest=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=digest();
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',[
    'import json,sys,hashlib;from pathlib import Path',
    'from backend.app.models import Session,Photo,CaptureGroup',
    'rows=json.loads(sys.argv[1]);prefix=sys.argv[2];source=Path(sys.argv[3])',
    'with Session() as s:',
    ' for row in rows:s.add(CaptureGroup(id=prefix+row["id"],preferred_photo_id=prefix+row["id"]))',
    ' s.flush()',
    ' for i,row in enumerate(rows):',
    '  token=prefix+row["id"];path=source if i==0 else source.parent/(token+".jpg")',
    '  s.add(Photo(id=token,file_path=str(path),file_name="Ordering-"+row["id"]+".jpg",file_stem=token,source_directory=str(path.parent),file_hash=hashlib.sha256(path.read_bytes() if i==0 else token.encode()).hexdigest(),file_format="JPG",file_size=0,capture_group_id=token,date_taken=row["date_taken"],created_at=row["created_at"],rating=row["rating"]))',
    ' s.commit()'
  ].join('\n'),JSON.stringify(contract.rows),prefix,source],{env:{...process.env,PHOTO_DATA_DIR:health.data_dir,PHOTO_AUTOLOAD_AI:'0'}});
  const defaults={layout:'justified',grid:230,gap:14,radius:6,dense:false,sort:'date_taken',direction:'desc'};
  try{
    await request.patch('/api/workspace/preferences',{data:{library_id:state.library_id,values:{layout:'grid',grid:150,dense:true,sort:'date_taken',direction:'desc'}}});
    await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1600});
    await page.route('**/api/photos/ids**',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({response,json:{ids:body.ids.filter(id=>ids.includes(id))}});});
    await page.goto('/?page=photos');const sort=page.getByRole('combobox',{name:lang==='en'?'Photo Sort Order':'照片排序',exact:true});await sort.selectOption('rating');await expect(sort).toHaveValue('rating');
    const expected=contract.expected['rating:desc'].map(id=>'Ordering-'+id+'.jpg');await expect(page.locator('.photo-caption>span')).toHaveText(expected);
    const selected=page.locator('.photo-card').filter({hasText:'Ordering-z.jpg'});await selected.locator('.select-box').click();
    await page.getByRole('button',{name:lang==='en'?'Toggle Sort Direction':'切换升降序',exact:true}).click();await expect(page.locator('.photo-caption>span')).toHaveText(contract.expected['rating:asc'].map(id=>'Ordering-'+id+'.jpg'));
    await expect(selected.locator('.select-box')).toHaveAttribute('aria-pressed','true');
    await expect.poll(async()=>(await(await request.get('/api/workspace')).json()).preferences).toMatchObject({sort:'rating',direction:'asc'});await page.reload();await expect(sort).toHaveValue('rating');await expect(page.locator('.photo-caption>span')).toHaveText(contract.expected['rating:asc'].map(id=>'Ordering-'+id+'.jpg'));
    await selected.locator('.select-box').click();await selected.hover();const drawer=page.getByRole('complementary',{name:lang==='en'?'Hovered photo information':'悬停照片信息',exact:true});await expect(drawer).toBeVisible();
    const one=drawer.getByRole('button',{name:lang==='en'?'1 stars':'1 星',exact:true});await one.click();await expect(page.locator('.photo-caption>span')).toHaveText(['b','g','h','z','e','a','d','c','f'].map(id=>'Ordering-'+id+'.jpg'));await expect(selected.locator('.select-box')).toHaveAttribute('aria-pressed','true');
    await one.click();await expect(page.locator('.photo-caption>span')).toHaveText(['b','g','h','e','a','d','c','f','z'].map(id=>'Ordering-'+id+'.jpg'));expect((await(await request.get('/api/photos/'+prefix+'z')).json()).rating).toBeNull();
    await page.screenshot({path:info.outputPath('rating-order.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(digest()).toBe(before);
  }finally{
    await request.patch('/api/workspace/preferences',{data:{library_id:state.library_id,values:{...defaults,...state.preferences}}});
    for(const id of ids)await request.delete('/api/photos/'+id+'?scope=file');
    expect(digest()).toBe(before);
  }
});
