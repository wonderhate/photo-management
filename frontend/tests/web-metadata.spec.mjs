import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cacheRows} from './fixtures/display-cache.mjs';
import {exerciseXmpRating} from './fixtures/xmp-rating.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url)),python=process.env.PHOTO_TEST_PYTHON||repo+'.venv/Scripts/python.exe';
const fixture=repo+'.test-artifacts/metadata-fixtures/';
execFileSync(python,[repo+'frontend/tests/fixtures/make-metadata-jpegs.py',fixture]);
const apiModule='/assets/'+readdirSync(new URL('../dist-web/assets/',import.meta.url)).find(f=>/^api-.*\.js$/.test(f));
const editorWorker='/assets/'+readdirSync(new URL('../dist-web/assets/',import.meta.url)).find(f=>/^edit-worker-.*\.js$/.test(f));
const toolModule='/assets/'+readdirSync(new URL('../dist-web/assets/',import.meta.url)).find(f=>/^tool-preference-store-.*\.js$/.test(f));
const payload=(name,source)=>({name,mimeType:'image/jpeg',buffer:readFileSync(fixture+source)});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const neutral={version:1,exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX:false,flipY:false,crop:{x:0,y:0,width:1,height:1},sharpen:0,denoise:0,match:0,preserveLuminance:true};
const xml=(attributes,body='')=>`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" ${attributes}>${body}</rdf:Description></rdf:RDF></x:xmpmeta>`;
const side=(name,text)=>({name,mimeType:'application/rdf+xml',buffer:Buffer.isBuffer(text)?text:Buffer.from(text)});

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    FileSystemHandle.prototype.queryPermission=async()=> 'granted';FileSystemHandle.prototype.requestPermission=async()=> 'granted';
    localStorage.setItem('onboarded','1');
    window.__ready=(async()=>{const root=await navigator.storage.getDirectory(),data=await root.getDirectoryHandle('metadata-library',{create:true}),originals=await root.getDirectoryHandle('metadata-originals',{create:true});window.__synthetic={root,data,originals};})();
    window.showDirectoryPicker=async({mode})=>{await window.__ready;return mode==='readwrite'?window.__synthetic.data:window.__synthetic.originals;};
  });
  await page.goto('/');await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
});
const call=(page,path,method='GET',body)=>page.evaluate(async({apiModule,path,method,body})=>(await import(apiModule)).browserAPI(path,method,body),{apiModule,path,method,body});
async function settled(page,job){await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');return call(page,'/jobs/'+job.id);}
async function selected(page,items){
  await page.locator('.topbar-actions').getByRole('button',{name:'导入照片',exact:true}).click();await page.getByLabel('导入照片文件',{exact:true}).setInputFiles(items);
  const before=new Set((await call(page,'/jobs?summary=true')).map(j=>j.id));await page.getByRole('button',{name:'开始导入',exact:true}).click();
  let job;await expect.poll(async()=>{job=(await call(page,'/jobs?summary=true')).find(j=>j.kind==='import'&&!before.has(j.id));return job?.id;}).toBeTruthy();return settled(page,job);
}
const saved=page=>page.evaluate(async module=>{const {libraryId}=await(await import(module)).createToolPreferenceStore('viewer');const read=async()=>JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());return navigator.locks.request('photocollection:'+libraryId,read);},toolModule);

async function imageFile(page,path,root='data'){
  return page.evaluate(async({path,root})=>{
    let d=root==='public'?window.__publicFolder:window.__synthetic.data;const parts=path.replace(/^\//,'').split('/');for(const p of parts.slice(0,-1))d=await d.getDirectoryHandle(p);const f=await(await d.getFileHandle(parts.at(-1))).getFile(),b=await createImageBitmap(f);
    try{const c=new OffscreenCanvas(b.width,b.height),x=c.getContext('2d');x.drawImage(b,0,0);return {width:b.width,height:b.height,corner:[...x.getImageData(20,20,1,1).data],text:new TextDecoder().decode(await f.arrayBuffer())};}finally{b.close();}
  },{path,root});
}
const bareFrame={fields:[],show_brand_logo:false,info_bar_ratio:0,long_edge:0,format:'png'};

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser XMP rating refresh keeps manual clears ${width} ${lang}`,async({page},info)=>{
  const input=payload('Stars.jpg','blank.jpg');await place(page,[input,side('Stars.xmp',xml('xmp:Rating="5"'))]);await settled(page,await scan(page));const p=(await call(page,'/photos')).photos[0];expect(p.rating).toBe(5);expect(p.rating_source).toBe('xmp-sidecar');
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1300});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/?page=photos');await page.reload();
  await exerciseXmpRating(page,{lang,photo:p,writeRating:value=>place(page,[side('Stars.xmp',xml('xmp:Rating="'+value+'"'))]),getPhoto:()=>call(page,'/photos/'+p.id),screenshot:info.outputPath('xmp-rating.png')});
  const bytes=await page.evaluate(async()=>[...new Uint8Array(await(await(await window.__synthetic.originals.getFileHandle('Stars.jpg')).getFile()).arrayBuffer())]);expect(sha(Buffer.from(bytes))).toBe(sha(input.buffer));
  await settled(page,await scan(page));expect(await call(page,'/photos/'+p.id)).toMatchObject({rating:null,rating_source:'manual'});
});

test('XMP rating refresh respects intervening manual decisions and a reopened library session',async({page})=>{
  page.on('dialog',d=>d.accept());await place(page,[payload('Concurrent.jpg','blank.jpg'),side('Concurrent.xmp',xml('xmp:Rating="5"'))]);await settled(page,await scan(page));const p=(await call(page,'/photos')).photos[0];await holdXmpHash(page);
  await page.evaluate(async({module,id})=>{window.__ratingRefresh=(await import(module)).browserAPI('/photos/'+id+'/rating/refresh','POST').then(result=>({result}),error=>({error:error.message}));},{module:apiModule,id:p.id});await page.waitForFunction(()=>window.__xmpHashReady);
  await call(page,'/photos/'+p.id,'PATCH',{rating:null});await page.evaluate(()=>window.__releaseXmpHash());let done=await page.evaluate(()=>window.__ratingRefresh);expect(done.result).toMatchObject({status:'protected',photo:{rating:null,rating_source:'manual'}});
  await page.evaluate(()=>{window.__xmpHashReady=false;});await holdXmpHash(page);await page.evaluate(async({module,id})=>{window.__ratingRefresh=(await import(module)).browserAPI('/photos/'+id+'/rating/refresh','POST').then(result=>({result}),error=>({error:error.message}));},{module:apiModule,id:p.id});await page.waitForFunction(()=>window.__xmpHashReady);
  await page.goto('/#/?page=settings');await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.locator('.browser-start')).toBeVisible();await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();await page.evaluate(()=>window.__releaseXmpHash());done=await page.evaluate(()=>window.__ratingRefresh);expect(done.error).toBeTruthy();expect(await call(page,'/photos/'+p.id)).toMatchObject({rating:null,rating_source:'manual'});
});

test('format5 rating provenance migration preserves cleared stars and pins the original manifest',async({page})=>{
  page.on('dialog',d=>d.accept());await selected(page,[payload('Legacy.jpg','blank.jpg'),side('Legacy.xmp',xml('xmp:Rating="5"'))]);const p=(await call(page,'/photos')).photos[0];await call(page,'/photos/'+p.id,'PATCH',{rating:null});await page.goto('/#/?page=settings');await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.locator('.browser-start')).toBeVisible();
  const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=5;for(const p of m.photos){delete p.rating_source;delete p.flag;}const text=JSON.stringify(m,null,2),w=await h.createWritable();await w.write(text);await w.close();return text;});
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const failed=await page.evaluate(async({module,id})=>{const proto=FileSystemDirectoryHandle.prototype,original=proto.getFileHandle;proto.getFileHandle=function(name,...args){if(name.startsWith('library.before-ratings-v6-'))return Promise.reject(new DOMException('Synthetic rating backup failure','QuotaExceededError'));return original.call(this,name,...args);};try{await(await import(module)).browserAPI('/photos/'+id+'/rating/refresh','POST');return false;}catch{return true;}finally{proto.getFileHandle=original;}},{module:apiModule,id:p.id});expect(failed).toBe(true);expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(old);expect((await call(page,'/photos/'+p.id)).rating).toBe(null);
  const r=await call(page,'/photos/'+p.id+'/rating/refresh','POST');expect(r.status).toBe('protected');expect(r.photo.rating).toBe(null);
  const backups=await page.evaluate(async()=>{const out=[];for await(const f of window.__synthetic.data.values())if(f.name.startsWith('library.before-ratings-v6-'))out.push(await(await f.getFile()).text());return out;});expect(backups).toEqual([old]);expect((await saved(page)).version).toBe(24);
  await page.goto('/#/?page=settings');await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.locator('.browser-start')).toBeVisible();
  for(const change of [{version:5,rating_source:'manual',rating:null},{version:99,rating_source:'manual',rating:null},{version:6,rating_source:'untrusted',rating:2},{version:6,rating_source:'xmp-sidecar',rating:null}]){
    const text=await page.evaluate(async({old,change})=>{const m=JSON.parse(old);m.version=change.version;delete m.photos[0].flag;m.photos[0].rating_source=change.rating_source;m.photos[0].rating=change.rating;const text=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{old,change});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(text);
  }
});

test('managed XMP rating copies reject tampering and batch clears remain app decisions',async({page})=>{
  await selected(page,[payload('Copy.jpg','blank.jpg'),side('Copy.xmp',xml('xmp:Rating="5"'))]);const p=(await call(page,'/photos')).photos[0];expect((await call(page,'/photos/'+p.id+'/rating/refresh','POST')).status).toBe('updated');await call(page,'/photos/batch-edit','POST',{photo_ids:[p.id],clear_rating:true});expect((await call(page,'/photos/'+p.id+'/rating/refresh','POST')).photo).toMatchObject({rating:null,rating_source:'manual'});
  const ref=(await saved(page)).photos[0].metadata_sidecars[0];await page.evaluate(async({path,text})=>{let d=window.__synthetic.data;const parts=path.split('/');for(const p of parts.slice(0,-1))d=await d.getDirectoryHandle(p);const w=await(await d.getFileHandle(parts.at(-1))).createWritable();await w.write(text);await w.close();},{path:ref.managed_path,text:xml('xmp:Rating="4"')});await expect(call(page,'/photos/'+p.id+'/rating/refresh','POST')).rejects.toThrow('元数据侧文件记录无效。');expect((await call(page,'/photos/'+p.id)).rating).toBe(null);
});

test('new catalog source rules align standard, HD, watermark and sanitized public pixels',async({page})=>{
  const inputs=['xmp','exif'].map(kind=>payload('Catalog-'+kind+'.jpg','orientation-'+kind+'.jpg'));
  await selected(page,inputs);const photos=(await call(page,'/photos')).photos;
  for(const [i,kind] of ['xmp','exif'].entries()){
    const p=photos.find(p=>p.file_name===inputs[i].name);expect(p).toMatchObject({width:480,height:640,orientation:6,decode_profile:{version:2,extra_orientation:kind==='xmp'?6:1},file_hash:sha(inputs[i].buffer)});
    const native=JSON.parse(execFileSync(python,['-c',"from PIL import Image,ImageOps;import json,sys;im=Image.open(sys.argv[1]);print(json.dumps(list(ImageOps.exif_transpose(im).size)))",fixture+'orientation-'+kind+'.jpg'],{encoding:'utf8'}));expect([p.width,p.height]).toEqual(native);
    await page.goto('/#/?page=photos');await page.locator('.photo-card').filter({hasText:p.file_name}).locator('.photo-image').dblclick();await expect(page.locator('.detail-image>img')).toHaveJSProperty('naturalWidth',480);await expect(page.locator('.detail-image>img')).toHaveJSProperty('naturalHeight',640);
    const standardCorner=await page.locator('.detail-image>img').evaluate(img=>{const c=new OffscreenCanvas(img.naturalWidth,img.naturalHeight),x=c.getContext('2d');x.drawImage(img,0,0);return [...x.getImageData(20,20,1,1).data];});expect(standardCorner[2]).toBeGreaterThan(180);expect(standardCorner[0]).toBeLessThan(80);
    await page.getByRole('combobox',{name:'预览清晰度',exact:true}).selectOption('4096');await expect(page.locator('.detail-image')).toHaveAttribute('data-display-preview','ready');
    const corner=await page.locator('.detail-image>img').evaluate(img=>{const c=new OffscreenCanvas(img.naturalWidth,img.naturalHeight),x=c.getContext('2d');x.drawImage(img,0,0);return [...x.getImageData(20,20,1,1).data];});expect(corner[2]).toBeGreaterThan(180);expect(corner[0]).toBeLessThan(80);expect((await cacheRows(page)).some(r=>r.key.includes('browser-source-v2-'+(kind==='xmp'?6:1)+'-black'))).toBe(true);await page.keyboard.press('Escape');
    const exported=await call(page,'/watermark/export','POST',{photo_id:p.id,options:bareFrame}),image=await imageFile(page,exported.path);expect([image.width,image.height]).toEqual([480,640]);expect(image.corner[2]).toBeGreaterThan(180);expect(image.corner[0]).toBeLessThan(80);
    expect((await call(page,'/photos/'+p.id,'PATCH',{rating:4,decode_profile:{version:1,extra_orientation:1}})).decode_profile).toEqual(p.decode_profile);
  }
  await page.locator('.topbar-actions').getByRole('button',{name:'摄影空间',exact:true}).click();await page.getByRole('button',{name:'导出公开作品',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导出公开作品'});await expect(dialog.locator('.curation-choices button')).toHaveCount(2);for(let n=0;n<2;n++)await dialog.locator('.curation-choices button').nth(n).click();
  await page.evaluate(async()=>{window.__publicRoot=await window.__synthetic.root.getDirectoryHandle('profile-public',{create:true});window.showDirectoryPicker=async()=>window.__publicRoot;});await dialog.getByRole('button',{name:'选择目录并导出公开内容',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('公开内容已导出');
  const manifest=await page.evaluate(async()=>{for await(const dir of window.__publicRoot.values()){window.__publicFolder=dir;return JSON.parse(await(await(await(await dir.getDirectoryHandle('portfolio')).getFileHandle('manifest.json')).getFile()).text());}});expect(JSON.stringify(manifest)).not.toMatch(/decode_profile|file_hash|raw_exif|gps_|xmp-embedded/);
  for(const p of manifest.photos){const image=await imageFile(page,p.src,'public');expect([p.width,p.height,image.width,image.height]).toEqual([480,640,480,640]);expect(image.corner[2]).toBeGreaterThan(180);expect(image.corner[0]).toBeLessThan(80);expect(image.text).not.toContain('http://ns.adobe.com/xap/1.0/');}
  const managedHashes=await page.evaluate(async()=>{const data=window.__synthetic.data,m=JSON.parse(await(await(await data.getFileHandle('library.json')).getFile()).text()),out={};for(const p of m.photos){let dir=data;const parts=p.managed_path.split('/');for(const q of parts.slice(0,-1))dir=await dir.getDirectoryHandle(q);const f=await(await dir.getFileHandle(parts.at(-1))).getFile();out[p.file_name]=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');}return out;});expect(managedHashes).toEqual(Object.fromEntries(inputs.map(p=>[p.name,sha(p.buffer)])));
  expect(sha(readFileSync(fixture+'orientation-xmp.jpg'))).toBe(sha(inputs[0].buffer));expect(sha(readFileSync(fixture+'orientation-exif.jpg'))).toBe(sha(inputs[1].buffer));
});

test('version2 catalog and draft keep legacy pixels through import rescan and backed-up current-format writes',async({page})=>{
  page.on('dialog',d=>d.accept());const input=payload('Legacy-catalog.jpg','orientation-xmp.jpg');await selected(page,[input]);const p=(await call(page,'/photos')).photos[0];const draft=await call(page,'/watermark/drafts','POST',{photo_id:p.id,settings_json:bareFrame});
  await page.goto('/#/?page=settings');await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.locator('.browser-start')).toBeVisible();
  const old=await page.evaluate(async()=>{
    const data=window.__synthetic.data,h=await data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=2;const p=m.photos[0];delete p.rating_source;delete p.flag;delete p.decode_profile;p.width=640;p.height=480;p.orientation=1;delete m.drafts[0].source.decode_profile;
    let d=data;const parts=p.managed_path.split('/');for(const q of parts.slice(0,-1))d=await d.getDirectoryHandle(q);const b=await createImageBitmap(await(await d.getFileHandle(parts.at(-1))).getFile()),c=new OffscreenCanvas(b.width,b.height);c.getContext('2d').drawImage(b,0,0);b.close();
    for(const path of ['photos/'+p.id+'-preview.jpg','photos/'+p.id+'-thumb.jpg',m.drafts[0].preview_file]){let dir=data;const parts=path.split('/');for(const q of parts.slice(0,-1))dir=await dir.getDirectoryHandle(q);const w=await(await dir.getFileHandle(parts.at(-1))).createWritable();await w.write(await c.convertToBlob({type:path.endsWith('.webp')?'image/webp':'image/jpeg'}));await w.close();}
    const text=JSON.stringify(m),w=await h.createWritable();await w.write(text);await w.close();return text;
  });
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const first=await call(page,'/watermark/drafts/'+draft.id+'/export','POST');const image=await imageFile(page,first.path);expect([image.width,image.height]).toEqual([640,480]);expect(image.corner[0]).toBeGreaterThan(180);expect(image.corner[2]).toBeLessThan(80);
  const result=await selected(page,[input]);expect(result.skipped).toBe(1);const retained=await call(page,'/photos/'+p.id);expect(retained.decode_profile).toBeUndefined();expect([retained.width,retained.height,retained.orientation]).toEqual([640,480,1]);
  const second=await call(page,'/watermark/drafts/'+draft.id+'/export','POST');const again=await imageFile(page,second.path);expect([again.width,again.height,again.corner]).toEqual([image.width,image.height,image.corner]);expect((await call(page,'/watermark/drafts/'+draft.id)).source.decode_profile).toBeUndefined();
  await page.goto('/#/tools/edit?photo='+p.id);await expect(page.locator('.edit-stage-top')).toContainText('640 × 480');await page.getByRole('button',{name:'保存编辑',exact:true}).click();await expect.poll(async()=>(await saved(page)).edits?.[0]?.decode_profile).toEqual({version:1,extra_orientation:1});
  const m=await saved(page);expect(m.version).toBe(24);expect(m.photos[0].file_hash).toBe(sha(input.buffer));const backups=await page.evaluate(async()=>{const out=[];for await(const f of window.__synthetic.data.values())if(f.kind==='file'&&f.name.startsWith('library.before-source-v3-'))out.push(await(await f.getFile()).text());return out;});expect(backups).toEqual([old]);
});

test('unknown catalog and draft profiles and mislabeled old formats cannot overwrite a library',async({page})=>{
  page.on('dialog',d=>d.accept());await selected(page,[payload('Protected.jpg','orientation-xmp.jpg')]);const p=(await call(page,'/photos')).photos[0];await call(page,'/watermark/drafts','POST',{photo_id:p.id,settings_json:bareFrame});
  await page.goto('/#/?page=settings');await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.locator('.browser-start')).toBeVisible();const original=await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());
  for(const kind of ['photo','draft','old-format','future-format']){
    const bad=await page.evaluate(async({original,kind})=>{const m=JSON.parse(original);if(kind==='photo')m.photos[0].decode_profile.version=99;else if(kind==='draft')m.drafts[0].source.decode_profile.version=99;else m.version=kind==='old-format'?2:99;if(kind==='old-format')for(const p of m.photos){delete p.rating_source;delete p.flag;}const text=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{original,kind});
    await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toContainText(kind==='future-format'?'图库格式不受支持':'不支持此源文件解码版本');expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bad);
  }
});

test('RAW source profiles reject extra JPEG transforms before decoding instead of silently ignoring them',async({page})=>{
  const errors=await page.evaluate(async path=>{const worker=new Worker(path,{type:'module'});let id=0;try{const rows=[];for(const action of ['open','reference','display'])rows.push(await new Promise(resolve=>{worker.onmessage=({data})=>resolve(data.error);worker.postMessage({id:++id,action,file:new File(['synthetic'],'unsupported.DNG'),profile:{version:2,extra_orientation:6},orientation:6,edge:4096,background:'black'});}));return rows;}finally{worker.terminate();}},editorWorker);expect(errors).toEqual(Array(3).fill('Unsupported source decoding profile.'));
});

for(const kind of ['xmp','exif'])test(`new ${kind} editor source persists its orientation and exports the same crop after reopening`,async({page},info)=>{
  const source=fixture+'orientation-'+kind+'.jpg',before=sha(readFileSync(source));await page.goto('/#/tools/edit');
  await page.locator('.editor-toolbar input[type=file]').setInputFiles(source);await expect(page.locator('.edit-stage-top')).toContainText('480 × 640');
  await page.locator('.edit-controls summary').filter({hasText:'构图'}).click();await page.getByRole('slider',{name:'Crop width',exact:true}).fill('50');
  await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',240);await page.getByRole('button',{name:/^保存编辑/}).click();
  await expect.poll(async()=>(await saved(page)).edits?.length).toBe(1);const edit=(await saved(page)).edits[0];
  expect(edit.decode_profile).toEqual({version:2,extra_orientation:kind==='xmp'?6:1});expect(edit.source_hash).toBe(before);expect(edit.recipe.crop.width).toBe(.5);
  await page.goto('/#/tools/edit');await page.reload();await page.locator('.edit-records button').first().click();
  await expect(page.locator('.edit-stage-top')).toContainText('480 × 640');await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',240);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalHeight',640);
  const controls=page.locator('.edit-controls details').last();await controls.getByRole('combobox').selectOption('png');await page.getByRole('spinbutton',{name:'导出最长边',exact:true}).fill('0');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'另存并下载',exact:true}).click();const output=await download;await output.saveAs(info.outputPath('profile-crop.png'));const png=readFileSync(info.outputPath('profile-crop.png'));expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual([240,640]);
  expect((await saved(page)).edits[0].decode_profile).toEqual(edit.decode_profile);expect(sha(readFileSync(source))).toBe(before);
  await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.__profileBackup=await window.__synthetic.root.getDirectoryHandle('profile-backup',{create:true});window.showDirectoryPicker=async()=>window.__profileBackup;});await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）',exact:true}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();
  const backup=await page.evaluate(async()=>{for await(const dir of window.__profileBackup.values()){const m=JSON.parse(await(await(await dir.getFileHandle('library.json')).getFile()).text()),e=m.edits[0];let d=dir;const parts=e.source_path.split('/');for(const p of parts.slice(0,-1))d=await d.getDirectoryHandle(p);const file=await(await d.getFileHandle(parts.at(-1))).getFile();return {version:m.version,profile:e.decode_profile,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('')};}});expect(backup).toEqual({version:24,profile:edit.decode_profile,hash:before});
});

test('legacy manifest and crop replay stay unchanged across a backed-up v3 upgrade; future profiles refuse to open',async({page})=>{
  page.on('dialog',d=>d.accept());const bytes=readFileSync(fixture+'orientation-xmp.jpg'),before=sha(bytes);
  await page.goto('/#/?page=settings');await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.locator('.browser-start')).toBeVisible();
  const old=await page.evaluate(async({bytes,hash,recipe})=>{
    const data=window.__synthetic.data,source=await(await(await data.getDirectoryHandle('drafts',{create:true})).getDirectoryHandle('edits',{create:true})).getDirectoryHandle('legacy-profile',{create:true});
    const w=await(await source.getFileHandle('source.jpg',{create:true})).createWritable();await w.write(new Uint8Array(bytes));await w.close();
    const file=await data.getFileHandle('library.json'),manifest=JSON.parse(await(await file.getFile()).text());manifest.version=1;manifest.edits=[{id:'legacy-profile',photo_id:null,source_name:'legacy-xmp.jpg',source_path:'drafts/edits/legacy-profile/source.jpg',source_hash:hash,recipe,updated_at:'2026-10-13T12:00:00Z'}];const text=JSON.stringify(manifest),out=await file.createWritable();await out.write(text);await out.close();return text;
  },{bytes:[...bytes],hash:before,recipe:{...neutral,crop:{x:0,y:0,width:.5,height:1}}});
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();await page.goto('/#/tools/edit');await page.locator('.edit-records button').first().click();
  await expect(page.locator('.edit-stage-top')).toContainText('640 × 480');await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',320);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalHeight',480);
  await page.getByRole('button',{name:'保存编辑',exact:true}).click();await expect.poll(async()=>(await saved(page)).version).toBe(24);
  expect((await saved(page)).edits[0].decode_profile).toEqual({version:1,extra_orientation:1});
  const backups=await page.evaluate(async()=>{const rows=[];for await(const f of window.__synthetic.data.values())if(f.kind==='file'&&f.name.startsWith('library.before-source-v3-'))rows.push(await(await f.getFile()).text());return rows;});expect(backups).toEqual([old]);
  await page.goto('/#/?page=settings');await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.locator('.browser-start')).toBeVisible();
  const bad=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.edits[0].decode_profile.version=99;const text=JSON.stringify(m),w=await h.createWritable();await w.write(text);await w.close();return text;});
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toContainText('不支持此源文件解码版本');
  expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bad);
  expect(await page.evaluate(async()=>{const f=await(await(await(await(await window.__synthetic.data.getDirectoryHandle('drafts')).getDirectoryHandle('edits')).getDirectoryHandle('legacy-profile')).getFileHandle('source.jpg')).getFile();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');})).toBe(before);
});
async function place(page,items){await page.evaluate(async items=>{for(const item of items){const parts=item.name.split('/');let directory=window.__synthetic.originals;for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part,{create:true});const writer=await(await directory.getFileHandle(parts.at(-1),{create:true})).createWritable();await writer.write(new Uint8Array(item.bytes));await writer.close();}},items.map(item=>({name:item.name,bytes:[...item.buffer]})));}
async function scan(page){const picked=await call(page,'/dialog/directory','POST');return call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});}

test('shared real JPEG facts agree with native readers; sidecar copies survive backup and retain manual annotations',async({page})=>{
  const requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  const common=payload('山海.jpg','common.jpg'),plain=payload('Sidecar.jpg','blank.jpg'),before=sha(common.buffer);
  const broad=side('Sidecar.xmp',xml('exif:ISOSpeedRatings="800" xmp:Rating="5" xmp:Label="Red"','<dc:subject><rdf:Bag><rdf:li>external</rdf:li><rdf:li>旅途</rdf:li></rdf:Bag></dc:subject>'));
  const specific=side('Sidecar.jpg.xmp',xml('exif:ISOSpeedRatings="200" exif:DateTimeOriginal="2026-10-22T19:23:45+08:00" tiff:Orientation="6" tiff:ImageWidth="999"'));
  const conflict=side('山海.xmp',xml('exif:ISOSpeedRatings="999" tiff:Model="external camera"'));
  const expected=JSON.parse(execFileSync(python,['-c',`import json,sys;from pathlib import Path;from PIL import Image,ImageOps;from backend.app.services.metadata_service import extract;p=Path(sys.argv[1]);v=extract(p);im=Image.open(p);v['width'],v['height']=ImageOps.exif_transpose(im).size;im.close();print(json.dumps(v))`,fixture+'common.jpg'],{cwd:repo,env:{...process.env,PHOTO_DATA_DIR:repo+'.test-artifacts/metadata-probe',PHOTO_AUTOLOAD_AI:'0'},encoding:'utf8'}));
  const result=await selected(page,[common,plain,broad,specific,conflict]);expect(result).toMatchObject({total:2,success:2,failed:0,preview_failed:0});
  const photos=(await call(page,'/photos')).photos,first=photos.find(p=>p.file_name===common.name),second=photos.find(p=>p.file_name===plain.name);
  for(const [key,value] of Object.entries(expected))if(key!=='raw_exif')expect(first[key],key).toEqual(value);
  expect(first.raw_exif['ICC:ProfileDescription']).toBe(expected.raw_exif['ICC:ProfileDescription']);expect(first.exposure_time).toBe('0.8');
  expect((await call(page,'/stats')).summary.common_shutter).toBe('0.8');
  expect(first.raw_exif['xmp-sidecar:XMP-tiff:Model']).toBe('external camera');
  expect(second).toMatchObject({iso:200,width:640,height:480,orientation:1,date_taken:'2026-10-22T19:23:45',rating:5,rating_source:'xmp-sidecar',color_label:null,tags:[]});
  expect(JSON.parse(second.raw_exif['xmp-sidecar:XMP-dc:subject'])).toEqual(['external','旅途']);
  const manifest=await saved(page),copies=await page.evaluate(async()=>{const data=window.__synthetic.data;const manifest=JSON.parse(await(await(await data.getFileHandle('library.json')).getFile()).text());const rows=[];for(const p of manifest.photos)for(const ref of p.metadata_sidecars){const f=await(await(await data.getDirectoryHandle('photos')).getFileHandle(ref.managed_path.split('/').at(-1))).getFile();rows.push({name:ref.name,sha256:ref.sha256,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),photo_hash:ref.photo_hash});}return rows;});
  expect(copies).toHaveLength(3);for(const ref of copies){expect(ref.hash).toBe(ref.sha256);expect(ref.sha256).toBe(sha([broad,specific,conflict].find(f=>f.name===ref.name).buffer));}
  await call(page,'/photos/'+second.id,'PATCH',{rating:3,color_label:'blue',tags:['manual']});
  await page.getByRole('button',{name:'摄影空间',exact:true}).click();await page.getByRole('button',{name:'导出公开作品',exact:true}).click();const publish=page.getByRole('dialog',{name:'导出公开作品'});
  await expect(publish.locator('.curation-choices button')).toHaveCount(2);
  for(const button of await publish.locator('.curation-choices button').all())await button.click();
  await page.evaluate(async()=>{window.__publicRoot=await window.__synthetic.root.getDirectoryHandle('metadata-public',{create:true});window.showDirectoryPicker=async()=>window.__publicRoot;});
  await publish.getByRole('button',{name:'选择目录并导出公开内容'}).click();await expect(publish.getByRole('status')).toContainText('公开内容已导出：');
  const catalog=await page.evaluate(async()=>{for await(const folder of window.__publicRoot.values()){const dir=await folder.getDirectoryHandle('portfolio');return JSON.parse(await(await(await dir.getFileHandle('manifest.json')).getFile()).text());}});
  expect(catalog.photos).toHaveLength(2);expect(JSON.stringify(catalog)).not.toMatch(/metadata_sidecars|raw_exif|gps_|source_id|photo_hash|external camera|旅途/);
  await publish.getByRole('button',{name:'关闭',exact:true}).click();
  await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.__backup=await window.__synthetic.root.getDirectoryHandle('metadata-backups',{create:true});window.showDirectoryPicker=async()=>window.__backup;});
  await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）',exact:true}).click();await expect(page.getByText(/完整图库备份已保存：/)).toBeVisible();
  await page.evaluate(async()=>{for await(const entry of window.__backup.values())if(entry.kind==='directory')window.__backupLibrary=entry;});
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'打开本地图库或备份',exact:true})).toBeVisible();
  await page.evaluate(()=>window.showDirectoryPicker=async()=>window.__backupLibrary);await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const restored=await call(page,'/photos/'+second.id);expect(restored).toMatchObject({iso:200,rating:3,color_label:'blue',tags:['manual']});expect(restored.metadata_sidecars).toEqual(manifest.photos.find(p=>p.id===second.id).metadata_sidecars);
  const originalHash=await page.evaluate(async p=>{const data=window.__backupLibrary;const f=await(await(await data.getDirectoryHandle('photos')).getFileHandle(p.managed_path.split('/').at(-1))).getFile();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');},manifest.photos.find(p=>p.id===first.id));
  expect(originalHash).toBe(before);expect(sha(readFileSync(fixture+'common.jpg'))).toBe(before);
  expect(requests.filter(r=>r.method!=='GET'||(!r.url.startsWith('http://127.0.0.1:4175')&&!r.url.startsWith('blob:')))).toEqual([]);
});

test('embedded XMP, malformed sidecars, UTF16 and ambiguous picked names keep source geometry and photo counts',async({page})=>{
  const items=[payload('Embedded.jpg','embedded.jpg'),side('Embedded.xmp',xml('exif:ISOSpeedRatings="200"'))];
  const invalid=[Buffer.from('broken XML'),Buffer.from('<!DOCTYPE doc SYSTEM "https://must-not-load.invalid/remote"><doc/>'),Buffer.from('\ufeff<!DOCTYPE doc [<!ENTITY x "bad">]><doc>&x;</doc>','utf16le'),Buffer.alloc(1024*1024+1,120),Buffer.from('<doc>'.repeat(40)+'</doc>'.repeat(40)),Buffer.from('<doc>'+'<node/>'.repeat(4100)+'</doc>')];
  const generated=await page.evaluate(async()=>{const rows=[];for(let i=0;i<7;i++){const canvas=new OffscreenCanvas(12,8);const c=canvas.getContext('2d');c.fillStyle=`rgb(${i*25},100,150)`;c.fillRect(0,0,12,8);rows.push([...new Uint8Array(await(await canvas.convertToBlob({type:'image/png'})).arrayBuffer())]);}return rows;});
  for(let i=0;i<7;i++){items.push({name:'Case-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(generated[i])});items.push(side('Case-'+i+'.xmp',i<6?invalid[i]:Buffer.from('\ufeff'+xml('exif:ISOSpeedRatings="400"','<tiff:Model>Mixed<!-- comment --><![CDATA[ & raw]]></tiff:Model>'),'utf16le')));}
  items.push(payload('Same.jpg','blank.jpg'),payload('Same.jpg','blank-2.jpg'),side('Same.xmp',xml('exif:ISOSpeedRatings="321"')));
  const result=await selected(page,items);expect(result).toMatchObject({total:10,success:10,failed:0,preview_failed:0});
  const photos=(await call(page,'/photos')).photos;expect(photos.find(p=>p.file_name==='Embedded.jpg')).toMatchObject({iso:640,exposure_time:'0.3',orientation:6,width:480,height:640,rating:5,rating_source:'xmp-embedded',tags:[],decode_profile:{version:2,extra_orientation:6}});
  for(let i=0;i<6;i++)expect(photos.find(p=>p.file_name==='Case-'+i+'.png')).toMatchObject({iso:null,metadata_sidecars:[]});
  expect(photos.find(p=>p.file_name==='Case-6.png')).toMatchObject({iso:400,camera_model:'Mixed & raw'});
  const ambiguous=photos.filter(p=>p.file_name==='Same.jpg');expect(ambiguous).toHaveLength(2);for(const p of ambiguous)expect(p).toMatchObject({iso:null,metadata_sidecars:[]});
});

test('directory XMP matching stays in its folder and changed sidecars cannot publish stale values',async({page})=>{
  await place(page,[{...payload('a/Same.jpg','blank.jpg')},{...payload('b/Same.jpg','blank-2.jpg')},side('Same.xmp',xml('exif:ISOSpeedRatings="999"')),side('a/Same.xmp',xml('exif:ISOSpeedRatings="100"')),side('a/Same.jpg.XmP',xml('exif:ISOSpeedRatings="200"')),side('b/Same.xmp',xml('exif:ISOSpeedRatings="800"'))]);
  const result=await settled(page,await scan(page));expect(result).toMatchObject({total:2,success:2,failed:0});
  const photos=(await call(page,'/photos')).photos;expect(photos.find(p=>p.relative_path==='a/Same.jpg').iso).toBe(200);expect(photos.find(p=>p.relative_path==='b/Same.jpg').iso).toBe(800);
  for(const p of photos)for(const ref of p.metadata_sidecars){expect(ref.source_id).toBe(p.source_id);expect(ref.managed_path).toBeUndefined();expect(ref.relative_path.startsWith(p.relative_path.split('/')[0]+'/')).toBe(true);}
  const old=xml('exif:ISOSpeedRatings="400"'),changed=xml('exif:ISOSpeedRatings="900"');await place(page,[payload('Changing.jpg','common.jpg'),side('Changing.xmp',old)]);
  await holdXmpHash(page);const job=await scan(page);await page.waitForFunction(()=>window.__xmpHashReady);
  await place(page,[side('Changing.xmp',changed)]);await page.evaluate(()=>window.__releaseXmpHash());
  await settled(page,job);const fresh=(await call(page,'/photos')).photos.find(p=>p.file_name==='Changing.jpg');
  expect(fresh.metadata_sidecars).toEqual([]);expect(fresh.raw_exif['xmp-sidecar:XMP-exif:ISOSpeedRatings']).toBeUndefined();expect(fresh.iso).toBe(400);
});

async function holdXmpHash(page){await page.evaluate(()=>{const digest=crypto.subtle.digest.bind(crypto.subtle);let held=false;crypto.subtle.digest=async(algorithm,data)=>{const result=await digest(algorithm,data),bytes=new Uint8Array(data instanceof ArrayBuffer?data:data.buffer,data.byteOffset||0,data.byteLength);if(!held&&new TextDecoder().decode(bytes.slice(0,30)).includes('<x:xmpmeta')){held=true;window.__xmpHashReady=true;await new Promise(resolve=>window.__releaseXmpHash=resolve);window.__xmpHashReturned=true;}return result;};});}

test('closing a library while sidecar hashing is pending discards its late metadata',async({page})=>{
  await place(page,[payload('Late.jpg','blank.jpg'),side('Late.xmp',xml('exif:ISOSpeedRatings="400"'))]);await holdXmpHash(page);const job=await scan(page);await page.waitForFunction(()=>window.__xmpHashReady);
  await page.goto('/#/?page=settings');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();
  await page.evaluate(async()=>{window.__next=await window.__synthetic.root.getDirectoryHandle('metadata-next',{create:true});window.showDirectoryPicker=async()=>window.__next;});await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(()=>window.__releaseXmpHash());await page.waitForFunction(()=>window.__xmpHashReturned);await expect.poll(async()=>(await call(page,'/tasks/resources')).pending).toBe(0);expect((await call(page,'/photos')).photos).toEqual([]);expect((await call(page,'/jobs?summary=true'))).toEqual([]);
  await expect(call(page,'/jobs/'+job.id)).rejects.toThrow();
});

test('sidecars require a photo and damaged source bindings cannot silently open a library',async({page})=>{
  await page.locator('.topbar-actions').getByRole('button',{name:'导入照片',exact:true}).click();
  await page.getByLabel('导入照片文件',{exact:true}).setInputFiles([side('Only.xmp',xml('exif:ISOSpeedRatings="400"'))]);
  await page.getByRole('button',{name:'开始导入',exact:true}).click();await expect(page.getByText('请同时选择照片和对应的 XMP 文件。',{exact:true})).toBeVisible();expect(await call(page,'/jobs?summary=true')).toEqual([]);
  await page.getByRole('dialog',{name:'导入你的照片'}).getByRole('button',{name:'取消',exact:true}).click();
  await selected(page,[payload('Only.jpg','blank.jpg'),side('Only.xmp',xml('exif:ISOSpeedRatings="400"'))]);
  const snapshot=await saved(page);expect(snapshot.photos[0].metadata_sidecars).toHaveLength(1);
  snapshot.photos[0].metadata_sidecars[0].photo_hash='0'.repeat(64);const damaged=JSON.stringify(snapshot);
  await page.evaluate(async data=>{const writer=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await writer.write(data);await writer.close();},damaged);
  await page.reload();await expect(page.getByText('元数据侧文件记录无效。',{exact:true})).toBeVisible();
  expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(damaged);
});

test('XMP import counts remain readable in a narrow English light-theme dialog',async({page},info)=>{
  await page.evaluate(()=>{localStorage.setItem('lang','en');localStorage.setItem('theme','light');});await page.setViewportSize({width:390,height:844});await page.reload();await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('.topbar-actions').getByRole('button',{name:/^Import photos$/i}).click();
  await page.getByLabel('Import photo files',{exact:true}).setInputFiles([payload('Narrow.jpg','common.jpg'),side('Narrow.xmp',xml('exif:ISOSpeedRatings="400"'))]);
  await expect(page.getByText('Selected 1 photo and 1 XMP sidecar. Ready to import.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('dialog').screenshot({path:info.outputPath('xmp-import-narrow-en.png')});
});

test('metadata growth cannot publish a library larger than the readable manifest limit',async({page})=>{
  await page.evaluate(async()=>{const handle=await window.__synthetic.data.getFileHandle('library.json'),value=JSON.parse(await(await handle.getFile()).text());value.revision++;value._syntheticPadding='';const overhead=new Blob([JSON.stringify(value)]).size;value._syntheticPadding='x'.repeat(64*1024*1024-overhead-48);const writer=await handle.createWritable();await writer.write(JSON.stringify(value));await writer.close();});
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();
  const diskHash=()=>page.evaluate(async()=>{const file=await(await window.__synthetic.data.getFileHandle('library.json')).getFile();return {size:file.size,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('')};});
  const before=await diskHash();expect(before.size).toBe(64*1024*1024-48);
  await expect(call(page,'/albums','POST',{name:'must exceed the remaining 48 bytes',photo_ids:[]})).rejects.toThrow(/64/);
  expect(await call(page,'/albums')).toEqual([]);expect(await diskHash()).toEqual(before);
});
