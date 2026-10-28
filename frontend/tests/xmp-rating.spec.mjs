import {test,expect} from './fixtures/native-runtime.mjs';
import {exerciseXmpRating} from './fixtures/xmp-rating.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const xml=value=>`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="${value}"/></rdf:RDF></x:xmpmeta>`;
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`XMP rating refresh keeps manual clears ${width} ${lang}`,async({page,request},info)=>{
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');const name='Rating-'+width+'.jpg',source=join(health.data_dir,name),side=source+'.xmp';execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;Image.new('RGB',(120,80),(50,150,110)).save(sys.argv[1],comment=sys.argv[1].encode())",source]);const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=hash();writeFileSync(side,xml(5));const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');const photo=(await(await request.get('/api/photos?search='+name)).json()).photos[0];
  try{await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1');localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1300});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?page=photos');await exerciseXmpRating(page,{lang,photo,writeRating:value=>writeFileSync(side,xml(value)),getPhoto:async()=>(await(await request.get('/api/photos/'+photo.id)).json()),screenshot:info.outputPath('xmp-rating.png')});expect(hash()).toBe(before);expect(readFileSync(side,'utf8')).toBe(xml(5));}
  finally{await request.delete('/api/photos/'+photo.id+'?scope=file');expect(hash()).toBe(before);}
});
