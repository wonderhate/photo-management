import {browserApiModule} from './fixtures/browser-api-module.mjs';
import {test,expect} from '@playwright/test';
import {exerciseLocationGuidance} from './fixtures/location-guidance.mjs';
import {installOfflineEarthProbe,exerciseOfflineEarth} from './fixtures/offline-earth-map.mjs';
import {installRegionalTiles,exerciseRegionalSatellite,syntheticArcGISKey,syntheticMapTilerKey} from './fixtures/regional-satellite.mjs';
import {installSatelliteSDK,exerciseSatelliteMap,syntheticMapKey,assertMapPhotoFan} from './fixtures/satellite-map.mjs';
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRuleThroughUI} from './fixtures/rule-collection.mjs';
import {exerciseAlbumList} from './fixtures/album-list.mjs';
import {exerciseAlbumOverview} from './fixtures/album-overview.mjs';
import {exercisePhotoFlags} from './fixtures/photo-flags.mjs';
import {exercisePhotoAnnotations} from './fixtures/photo-annotations.mjs';
import {exerciseTextSearch} from './fixtures/text-search.mjs';
import {exerciseFacets} from './fixtures/facets.mjs';
import {exerciseQueryScope} from './fixtures/query-scope.mjs';
import {tagRows,exerciseTagSearch} from './fixtures/tag-search.mjs';
const assets=fileURLToPath(new URL('../dist-web/assets/',import.meta.url));
const apiModule=browserApiModule(assets);
const mediaModule='/assets/'+readdirSync(assets).find(f=>/^photo-media-.*\.js$/.test(f));
const toolModule='/assets/'+readdirSync(assets).find(f=>/^tool-preference-store-.*\.js$/.test(f));
const albumModule='/assets/'+readdirSync(assets).find(f=>/^album-preference-store-.*\.js$/.test(f));

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser ten thousand tags use a scoped worker index and bounded suggestions ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(60000);page.on('dialog',d=>d.accept());const base=await imported(page),prefix='TagUI-'+lang+'-',rows=tagRows(prefix),hash=()=>page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(',')),before=await hash();await closeForOrdering(page);await seedOrdering(page,base,rows);const album=await call(page,'/albums','POST',{name:prefix+'Scope',photo_ids:rows.map(p=>p.id)});
  await page.addInitScript(()=>{const NativeWorker=window.Worker;window.__tagTraffic=[];window.Worker=class extends NativeWorker{postMessage(data,...args){if(String(this.__url||'').includes('tag-worker'))window.__tagTraffic.push({action:data.action,rows:data.rows?.length,safe:!data.rows||data.rows.every(p=>Object.keys(p).every(k=>['id','tags','tag_origins'].includes(k))),size:data.options?.size});return super.postMessage(data,...args);}constructor(url,options){super(url,options);this.__url=String(url);}};});
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1200});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/?page=photos&album_id='+album.id);await page.reload();await exerciseTagSearch(page,{lang,prefix,screenshot:info.outputPath('tag-search.png')});const traffic=await page.evaluate(()=>window.__tagTraffic);expect(traffic.filter(r=>r.action==='build')).toHaveLength(1);expect(traffic.filter(r=>r.action==='query').length).toBeGreaterThan(3);expect(traffic.every(r=>r.action!=='build'||r.rows===100)).toBe(true);expect(traffic.every(r=>r.safe)).toBe(true);expect((await call(page,'/filter-options?include_tags=false')).tags).toBeUndefined();expect(await hash()).toBe(before);
});

test('tag search survives asynchronous worker loading, runtime errors and old-worker errors',async({page})=>{
  const p=await imported(page);await call(page,'/photos/'+p.id,'PATCH',{tags:['Current tag']});await page.evaluate(()=>{const Native=window.Worker;window.__tagTerminated=[];window.__tagSerial=0;window.__tagMode='load';window.Worker=class extends Native{constructor(url,options){const tag=String(url).includes('tag-worker');super(tag&&window.__tagMode==='load'?new URL('/synthetic-missing-tag-worker.mjs',location.href):url,options);this.__tag=tag;this.__id=++window.__tagSerial;if(tag)window.__latestTag=this;}postMessage(data,...args){if(this.__tag&&data.action==='query'&&window.__tagMode==='runtime'){this.dispatchEvent(new ErrorEvent('error',{message:'Synthetic worker runtime failure'}));return;}return super.postMessage(data,...args);}terminate(){if(this.__tag)window.__tagTerminated.push(this.__id);return super.terminate();}};});
  for(const mode of ['load','runtime']){
    await page.evaluate(mode=>window.__tagMode=mode,mode);await call(page,'/photos/'+p.id,'PATCH',{favorite:mode==='load'});expect((await call(page,'/tags?q=current')).values).toEqual([{value:'Current tag',count:1,user_count:1}]);await page.evaluate(()=>{window.__oldTag=window.__latestTag;window.__tagMode='';});await call(page,'/photos/'+p.id,'PATCH',{favorite:mode!=='load'});expect((await call(page,'/tags?q=current')).values[0].value).toBe('Current tag');
    expect(await page.evaluate(()=>{const active=window.__latestTag;window.__oldTag.onerror(new ErrorEvent('error',{message:'Late old error'}));return window.__tagTerminated.includes(active.__id);})).toBe(false);expect((await call(page,'/tags?q=current')).values).toHaveLength(1);
  }
});

test('tag index rebuilds on edits, cancels closed sessions and falls back if workers are blocked',async({page})=>{
  page.on('dialog',d=>d.accept());const p=await imported(page);await call(page,'/photos/'+p.id,'PATCH',{tags:['Old tag','Literal %_']});expect((await call(page,'/tags?q=old')).values[0].value).toBe('Old tag');await call(page,'/photos/'+p.id,'PATCH',{tags:['New tag']});expect((await call(page,'/tags?q=old')).values).toEqual([]);expect((await call(page,'/tags?q=NEW')).values[0].value).toBe('New tag');
  await page.evaluate(async module=>{const Native=window.Worker;window.Worker=class extends Native{postMessage(data,...args){if(data.action==='query'&&window.__holdTags){window.__releaseTag=()=>super.postMessage(data,...args);return;}return super.postMessage(data,...args);}};window.__holdTags=true;},apiModule);
  // Force a fresh worker so the held postMessage belongs to this test's wrapper.
  await call(page,'/photos/'+p.id,'PATCH',{favorite:true});await page.evaluate(async module=>{window.__pendingTag=(async()=>{try{await(await import(module)).browserAPI('/tags?q=new');window.__oldTagResult='resolved';}catch(e){window.__oldTagResult=e.name;}})();},apiModule);await page.waitForFunction(()=>typeof window.__releaseTag==='function');await closeForOrdering(page);await expect.poll(()=>page.evaluate(()=>window.__oldTagResult)).toBe('AbortError');await page.evaluate(()=>{window.__releaseTag();window.__holdTags=false;window.Worker=class{constructor(){throw new Error('Synthetic blocked worker');}};});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/tags?q=new')).values).toEqual([{value:'New tag',count:1,user_count:1}]);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser query scope survives refinement, reload and history ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(60000);page.on('dialog',d=>d.accept());const base=await imported(page),contract=JSON.parse(readFileSync(new URL('./fixtures/facet-contract.json',import.meta.url),'utf8')),rows=contract.rows;
  const hash=()=>page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(',')),before=await hash();await closeForOrdering(page);await seedOrdering(page,base,rows.map(p=>({...p,tag_origins:Object.fromEntries(p.tags.map(name=>[name,'user'])),rejected_ai_tags:[]})));
  const normal=await call(page,'/albums','POST',{name:'Scope Normal '+lang,photo_ids:['a','b','c']}),second=await call(page,'/albums','POST',{name:'Scope Snapshot '+lang,photo_ids:['b','c']}),rule=await call(page,'/albums','POST',{name:'Scope Rule '+lang,type:'rule',query:{version:1,root:{op:'gte',field:'rating',value:4}}});
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1400});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/?page=albums');await page.reload();
  await exerciseQueryScope(page,{lang,rows,normal,second,rule,openSecond:async()=>{await navigate(page,lang==='en'?'Albums':'影集');await page.locator('.album-card').filter({hasText:second.name}).locator('.album-cover').click();},screenshot:info.outputPath('query-scope.png')});expect(await hash()).toBe(before);
});

test('browser scope rejects wrong libraries and deleted collections and retains fixed counts',async({page})=>{
  const p=await imported(page),libraryId=await page.evaluate(async module=>(await(await import(module)).createToolPreferenceStore('viewer')).libraryId,toolModule),album=await call(page,'/albums','POST',{name:'Scoped metadata',photo_ids:[p.id]}),scope={version:1,library_id:libraryId,mode:'capture',base:{album_id:album.id}};
  await call(page,'/photos/'+p.id,'PATCH',{favorite:true,tags:['Scope Tag']});const params='?scope='+encodeURIComponent(JSON.stringify(scope));expect((await call(page,'/photos/ids'+params+'&favorite=false')).ids).toEqual([]);expect((await call(page,'/filter-options'+params)).tags).toEqual(['Scope Tag']);expect((await call(page,'/stats'+params)).summary.total).toBe(1);expect((await call(page,'/facets/camera_model'+params)).total).toBe(1);
  for(const invalid of ['',JSON.stringify({...scope,library_id:'other-library'}),JSON.stringify({...scope,base:{album_id:'missing-album'}}),JSON.stringify({...scope,base:{scope:'{}'}})])await expect(call(page,'/photos/ids?scope='+encodeURIComponent(invalid))).rejects.toThrow();
  for(const q of ['person_id=unsupported-person','semantic=beach'])await expect(call(page,'/photos/ids?'+q)).rejects.toThrow();await call(page,'/albums/'+album.id,'DELETE');await expect(call(page,'/photos/ids'+params)).rejects.toThrow();
  await page.goto('/#/?page=photos&scope=');await expect(page.locator('.photo-card')).toHaveCount(0);await expect(page.getByRole('region',{name:'当前检索范围',exact:true})).toContainText('检索范围无效');await page.getByRole('button',{name:'返回全部照片',exact:true}).click();await expect(page.locator('.photo-card')).toHaveCount(1);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser scoped facets, exclusion, option counts and saved bar ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(60000);page.on('dialog',d=>d.accept());const base=await imported(page),contract=JSON.parse(readFileSync(new URL('./fixtures/facet-contract.json',import.meta.url),'utf8')),hash=()=>page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(',')),before=await hash();await closeForOrdering(page);await seedOrdering(page,base,contract.rows.map(p=>({...p,tag_origins:Object.fromEntries(p.tags.map(name=>[name,'user'])),rejected_ai_tags:[]})));
  for(const c of contract.cases)expect((await call(page,'/photos/ids?facets='+encodeURIComponent(JSON.stringify(c.state)))).ids.slice().sort(),c.name).toEqual(c.ids);
  const name='Facet scope '+lang;await call(page,'/albums','POST',{name,photo_ids:contract.rows.map(p=>p.id)});await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1300});await page.emulateMedia({reducedMotion:'reduce'});
  const reopen=async()=>{await page.goto('/#/?page=albums');await page.reload();await page.locator('.album-card').filter({hasText:name}).locator('.album-cover').click();},saved=()=>page.evaluate(async module=>{const {libraryId}=await(await import(module)).createToolPreferenceStore('viewer');return navigator.locks.request('photocollection:'+libraryId,async()=>JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text()).facet_preferences);},toolModule);
  await reopen();await exerciseFacets(page,{lang,rows:contract.rows,reopen,saved,screenshot:info.outputPath('facets.png')});expect(await hash()).toBe(before);
});

test('format9 facet upgrade pins exact bytes, blocks failed backups and rejects stale same-library writers',async({page})=>{
  page.on('dialog',d=>d.accept());await imported(page);await closeForOrdering(page);const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=9;delete m.facet_preferences;const text=JSON.stringify(m,null,2),w=await h.createWritable();await w.write(text);await w.close();return text;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const module='/assets/'+readdirSync(assets).find(f=>/^facet-preference-store-.*\.js$/.test(f));
  const failed=await page.evaluate(async module=>{const proto=FileSystemDirectoryHandle.prototype,original=proto.getFileHandle;proto.getFileHandle=function(name,...args){if(name.startsWith('library.before-facets-v10-'))return Promise.reject(new DOMException('Synthetic facet backup failure','QuotaExceededError'));return original.call(this,name,...args);};try{const store=await(await import(module)).createFacetPreferenceStore();await store.save({hidden:['tag']});return false;}catch{return true;}finally{proto.getFileHandle=original;}},module);expect(failed).toBe(true);expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(old);
  await page.evaluate(async module=>{window.__oldFacetStore=await(await import(module)).createFacetPreferenceStore();await window.__oldFacetStore.save({hidden:['tag']});},module);const state=await page.evaluate(async()=>{const backups=[];for await(const f of window.__synthetic.data.values())if(f.name.startsWith('library.before-facets-v10-'))backups.push(await(await f.getFile()).text());return {backups,m:JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())};});expect(state.backups).toEqual([old]);expect(state.m.version).toBe(24);await closeForOrdering(page);await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();expect(await page.evaluate(async()=>{try{await window.__oldFacetStore.save({hidden:[]});return '';}catch(e){return e.message;}})).toContain('Library changed');await closeForOrdering(page);
  for(const kind of ['future','old-prefs','bad-prefs','old-shape']){
    const bytes=await page.evaluate(async({m,kind})=>{m=structuredClone(m);if(kind==='future')m.version=99;else if(kind==='old-prefs')m.version=9;else if(kind==='bad-prefs')m.facet_preferences={hidden:['tag','tag']};else{m.version=9;delete m.facet_preferences;m.albums=[{id:'bad-shape-rule',name:'Bad shape',type:'rule',photo_ids:[],query:{version:1,root:{op:'eq',field:'orientation',value:'landscape'}}}];}const text=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{m:state.m,kind});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bytes);
  }
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser text modes and rule fields use current descriptions ${width} ${lang}`,async({page},info)=>{
  page.on('dialog',d=>d.accept());const base=await imported(page),contract=JSON.parse(readFileSync(new URL('./fixtures/text-search-contract.json',import.meta.url),'utf8')),hash=()=>page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(',')),before=await hash();
  await closeForOrdering(page);await seedOrdering(page,base,contract.rows.map(p=>({...p,tag_origins:Object.fromEntries(p.tags.map(name=>[name,'user'])),rejected_ai_tags:[]})));
  for(const c of contract.cases){const result=await call(page,'/photos/ids?query='+encodeURIComponent(JSON.stringify({version:1,root:c.root})));expect(result.ids.slice().sort(),c.name).toEqual(c.ids);}
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1300});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/?page=photos');await page.reload();await exerciseTextSearch(page,{lang,rows:contract.rows,screenshot:info.outputPath('text-search.png')});expect(await hash()).toBe(before);
  const mode=page.getByRole('combobox',{name:lang==='en'?'Search mode':'搜索方式',exact:true});await expect(mode.locator('option[value="semantic"]')).toBeDisabled();await expect(mode.locator('option[value="natural"]')).toBeDisabled();
});

test('format8 text rules require an exact backup and reject future or mislabeled operators',async({page})=>{
  page.on('dialog',d=>d.accept());const photo=await imported(page);await closeForOrdering(page);
  const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=8;const text=JSON.stringify(m,null,2),w=await h.createWritable();await w.write(text);await w.close();return text;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const rule={name:'Text version9',type:'rule',query:{version:1,root:{op:'icontains',field:'description',value:'旧记录'}}};
  const failed=await page.evaluate(async({module,rule})=>{const proto=FileSystemDirectoryHandle.prototype,original=proto.getFileHandle;proto.getFileHandle=function(name,...args){if(name.startsWith('library.before-text-v9-'))return Promise.reject(new DOMException('Synthetic text backup failure','QuotaExceededError'));return original.call(this,name,...args);};try{await(await import(module)).browserAPI('/albums','POST',rule);return false;}catch{return true;}finally{proto.getFileHandle=original;}},{module:apiModule,rule});expect(failed).toBe(true);expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(old);
  await call(page,'/albums','POST',rule);const current=await page.evaluate(async()=>{const backups=[];for await(const f of window.__synthetic.data.values())if(f.name.startsWith('library.before-text-v9-'))backups.push(await(await f.getFile()).text());return {backups,m:JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())};});expect(current.backups).toEqual([old]);expect(current.m.version).toBe(24);expect((await call(page,'/photos/'+photo.id)).user_description).toBe(null);await closeForOrdering(page);
  for(const kind of ['future','old-field','old-op']){
    const bytes=await page.evaluate(async({m,kind})=>{m=structuredClone(m);m.version=kind==='future'?99:8;if(kind==='old-field')m.albums[0].query.root={op:'contains',field:'detected_text',value:'OCR'};if(kind==='old-op')m.albums[0].query.root={op:'icontains',field:'file_name',value:'jpg'};const text=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{m:current.m,kind});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bytes);
  }
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser culling flags stay independent and Shift follows the scope ${width} ${lang}`,async({page},info)=>{
  await imported(page);await page.evaluate(async()=>{for(let i=0;i<2;i++){const c=document.createElement('canvas');c.width=90;c.height=60;const ctx=c.getContext('2d');ctx.fillStyle=`rgb(${70+i*50},150,110)`;ctx.fillRect(0,0,90,60);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg'));const h=await window.__synthetic.originals.getFileHandle('Culling-'+i+'.jpg',{create:true}),w=await h.createWritable();await w.write(blob);await w.close();}});
  const pick=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:pick.paths});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');const photos=(await call(page,'/photos?sort=file_name&direction=asc')).photos;expect(photos).toHaveLength(3);await call(page,'/photos/'+photos[0].id,'PATCH',{rating:0,favorite:true,color_label:'blue',tags:['manual']});
  const hashes=()=>page.evaluate(async()=>{const rows=[];for await(const f of window.__synthetic.originals.values())rows.push([f.name,[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await f.getFile()).arrayBuffer()))].join(',')]);return rows.sort();}),before=await hashes();
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1400});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/?page=photos');await page.reload();const text=(zh,en)=>lang==='en'?en:zh;await page.getByRole('combobox',{name:text('照片排序','Photo Sort Order'),exact:true}).selectOption('file_name');await page.getByRole('button',{name:text('切换升降序','Toggle Sort Direction'),exact:true}).click();await expect.poll(()=>page.evaluate(async()=>{const m=JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());return [m.view_preferences?.sort,m.view_preferences?.direction];})).toEqual(['file_name','asc']);
  await exercisePhotoFlags(page,{lang,photos,getPhoto:id=>call(page,'/photos/'+id),failNext:()=>page.evaluate(()=>{const proto=FileSystemFileHandle.prototype,original=proto.createWritable;let failed=false;proto.createWritable=function(...args){if(!failed&&this.name==='library.json'){failed=true;return Promise.reject(new DOMException('Synthetic flag save failure','QuotaExceededError'));}return original.apply(this,args);};}),error:text('可用存储空间不足','Storage is full'),screenshot:info.outputPath('photo-flags.png')});expect(await hashes()).toEqual(before);
});

test('format6 flag migration keeps neutral legacy records and refuses failed backups and mislabeled rules',async({page})=>{
  page.on('dialog',d=>d.accept());const p=await imported(page);await closeForOrdering(page);
  const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=6;for(const p of m.photos)delete p.flag;const text=JSON.stringify(m,null,2),w=await h.createWritable();await w.write(text);await w.close();return text;});
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/photos/'+p.id)).flag).toBe('unmarked');
  const failed=await page.evaluate(async({module,id})=>{const proto=FileSystemDirectoryHandle.prototype,original=proto.getFileHandle;proto.getFileHandle=function(name,...args){if(name.startsWith('library.before-flags-v7-'))return Promise.reject(new DOMException('Synthetic flag backup failure','QuotaExceededError'));return original.call(this,name,...args);};try{await(await import(module)).browserAPI('/photos/'+id,'PATCH',{flag:'picked'});return false;}catch{return true;}finally{proto.getFileHandle=original;}},{module:apiModule,id:p.id});expect(failed).toBe(true);expect((await call(page,'/photos/'+p.id)).flag).toBe('unmarked');expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(old);
  await call(page,'/photos/'+p.id,'PATCH',{flag:'picked'});const state=await page.evaluate(async()=>{const backups=[];for await(const f of window.__synthetic.data.values())if(f.name.startsWith('library.before-flags-v7-'))backups.push(await(await f.getFile()).text());return {backups,m:JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())};});expect(state.backups).toEqual([old]);expect(state.m.version).toBe(24);expect(state.m.photos[0].flag).toBe('picked');
  await closeForOrdering(page);
  for(const kind of ['old-format','future-format','invalid','null','old-rule']){
    const bytes=await page.evaluate(async({manifest,kind})=>{const m=structuredClone(manifest);if(kind==='old-format')m.version=6;else if(kind==='future-format')m.version=99;else if(kind==='invalid')m.photos[0].flag='delete';else if(kind==='null')m.photos[0].flag=null;else{m.version=6;delete m.photos[0].flag;m.albums=[{id:'legacy-flag-rule',name:'Invalid legacy rule',type:'rule',photo_ids:[],query:{version:1,root:{op:'eq',field:'flag',value:'picked'}}}];}const text=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{manifest:state.m,kind});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bytes);
  }
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser album overview covers, recent viewer, table and bulk removal ${width} ${lang}`,async({page},info)=>{
  await imported(page);await page.evaluate(async()=>{
    for(let i=0;i<4;i++){const c=document.createElement('canvas');c.width=90;c.height=60;const ctx=c.getContext('2d');ctx.fillStyle=`rgb(${50+i*30},120,180)`;ctx.fillRect(0,0,90,60);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg'));const h=await window.__synthetic.originals.getFileHandle(`overview-${i}.jpg`,{create:true}),w=await h.createWritable();await w.write(blob);await w.close();}
  });
  const pick=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:pick.paths});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');const ids=(await call(page,'/photos')).photos.map(p=>p.id);expect(ids).toHaveLength(5);
  const hashes=()=>page.evaluate(async()=>{const result=[];for await(const f of window.__synthetic.originals.values())result.push([f.name,[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await f.getFile()).arrayBuffer()))].join(',')]);return result.sort();}),before=await hashes(),prefix='Overview-'+width;
  const auto=await call(page,'/albums','POST',{name:prefix+' Delete Auto',photo_ids:ids}),manual=await call(page,'/albums','POST',{name:prefix+' Delete Manual',photo_ids:ids}),keep=await call(page,'/albums','POST',{name:prefix+' Keep'});await call(page,'/albums/'+manual.id,'PATCH',{cover_photo_id:ids[0]});
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/?page=albums');await page.reload();
  await exerciseAlbumOverview(page,{lang,prefix,auto,manual,keep,all:()=>call(page,'/albums'),saved:()=>page.evaluate(async()=>JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text()).album_preferences),screenshot:info.outputPath('album-overview.png')});expect((await call(page,'/photos')).total).toBe(5);expect(await hashes()).toEqual(before);
});

test('browser overview migration pins legacy bytes, protects covers and rejects unsupported join metadata',async({page})=>{
  page.on('dialog',d=>d.accept());const p=await imported(page),a=await call(page,'/albums','POST',{name:'Legacy cover',photo_ids:[p.id]});await closeForOrdering(page);
  const old=await page.evaluate(async({a,p})=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=4;for(const p of m.photos){delete p.rating_source;delete p.flag;}for(const item of m.albums){delete item.member_added_at;delete item.cover_mode;item.cover_id=p.id;}const text=JSON.stringify(m,null,2),w=await h.createWritable();await w.write(text);await w.close();return text;},{a,p});
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();let row=await call(page,'/albums/'+a.id);expect(row).toMatchObject({cover_mode:'manual',cover_ids:[p.id],last_added_at:null});
  const failed=await page.evaluate(async({module,id})=>{const proto=FileSystemDirectoryHandle.prototype,original=proto.getFileHandle;proto.getFileHandle=function(name,...args){if(name.startsWith('library.before-overview-v5-'))return Promise.reject(new DOMException('Synthetic backup failure','QuotaExceededError'));return original.call(this,name,...args);};try{await(await import(module)).browserAPI('/albums/'+id,'PATCH',{name:'Must not save'});return false;}catch{return true;}finally{proto.getFileHandle=original;}},{module:apiModule,id:a.id});expect(failed).toBe(true);expect((await call(page,'/albums/'+a.id)).name).toBe('Legacy cover');expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(old);
  await call(page,'/albums/'+a.id+'/photos','PUT',{photo_ids:[p.id]});row=await call(page,'/albums/'+a.id);expect(row.last_added_at).toBe(null);expect(row.cover_mode).toBe('manual');
  const state=await page.evaluate(async()=>{const files=[];for await(const f of window.__synthetic.data.values())if(f.name.startsWith('library.before-overview-v5-'))files.push(await(await f.getFile()).text());return {files,m:JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())};});expect(state.files).toEqual([old]);expect(state.m.version).toBe(24);expect(state.m.albums[0].member_added_at).toEqual({[p.id]:null});
  await closeForOrdering(page);
  for(const kind of ['old-format','future-format','calendar','foreign-member','bad-mode']){
    const bytes=await page.evaluate(async({manifest,kind,id})=>{const m=structuredClone(manifest);if(kind==='old-format')m.version=4;else if(kind==='future-format')m.version=99;else if(kind==='calendar')m.albums[0].member_added_at[id]='2026-02-30T12:00:00Z';else if(kind==='foreign-member')m.albums[0].member_added_at.missing='2026-01-01T00:00:00Z';else m.albums[0].cover_mode='surprise';const text=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{manifest:state.m,kind,id:p.id});
    await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bytes);
  }
});

test('browser overview queries read metadata only and relation edits preserve join history and originals',async({page})=>{
  const p=await imported(page),a=await call(page,'/albums','POST',{name:'History',photo_ids:[p.id]}),first=(await call(page,'/albums/'+a.id+'/recent')).photos[0].album_added_at;expect(first).toBeTruthy();
  await call(page,'/albums/'+a.id+'/photos','PUT',{photo_ids:[p.id]});await call(page,'/albums/'+a.id+'/order','PUT',{photo_ids:[p.id]});expect((await call(page,'/albums/'+a.id+'/recent')).photos[0].album_added_at).toBe(first);
  await navigate(page,'设置');const reads=await page.evaluate(async({module,id})=>{const proto=FileSystemFileHandle.prototype,original=proto.getFile;let reads=0;proto.getFile=function(...args){reads++;return original.apply(this,args);};try{const api=(await import(module)).browserAPI;await api('/albums');await api('/albums/'+id+'/recent?page_size=1');return reads;}finally{proto.getFile=original;}},{module:apiModule,id:a.id});expect(reads).toBe(0);
  await expect(call(page,'/albums/batch-delete','POST',{ids:[a.id,'missing']})).rejects.toThrow();expect((await call(page,'/albums')).length).toBe(1);
  await call(page,'/albums/'+a.id,'PATCH',{cover_photo_id:p.id});await call(page,'/photos/'+p.id,'DELETE');expect(await call(page,'/albums/'+a.id)).toMatchObject({count:0,cover_mode:'manual',cover_missing:true,cover_ids:[]});expect(await page.evaluate(async()=>JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text()).albums[0].member_added_at)).toEqual({[p.id]:first});expect(await page.evaluate(async()=>(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).size)).toBeGreaterThan(0);
});

test.beforeEach(async({context})=>{
  await context.addInitScript(()=>{
    if(window!==top||location.origin!=='http://127.0.0.1:4185')return;
    window.__syntheticReady=(async()=>{
    localStorage.setItem('onboarded','1');
    FileSystemHandle.prototype.queryPermission=async()=>localStorage.getItem('deny-library')?'denied':'granted';
    FileSystemHandle.prototype.requestPermission=async()=>localStorage.getItem('deny-library')?'denied':'granted';
    const root=await navigator.storage.getDirectory();
    const data=await root.getDirectoryHandle('synthetic-library',{create:true}),originals=await root.getDirectoryHandle('synthetic-originals',{create:true});
    window.__synthetic={root,data,originals};
    try{await originals.getFileHandle('synthetic.jpg');}catch{const c=document.createElement('canvas');c.width=640;c.height=400;const ctx=c.getContext('2d');ctx.fillStyle='#367b89';ctx.fillRect(0,0,640,400);ctx.fillStyle='#f4d68c';ctx.fillRect(80,80,260,160);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.95));for(const name of ['synthetic.jpg','duplicate.jpg']){const h=await originals.getFileHandle(name,{create:true}),w=await h.createWritable();await w.write(blob);await w.close();}}
    })();
    window.showDirectoryPicker=async({mode})=>{await window.__syntheticReady;return mode==='readwrite'?window.__synthetic.data:window.__synthetic.originals;};
  });
});

async function navigate(page,name){const button=page.locator('.workspace-subnav').getByRole('button',{name,exact:true});if(!await button.isVisible())await page.locator('.workspace-more-trigger').click();await button.click();}
async function open(page){await page.goto('/');await page.waitForFunction(()=>!!window.__synthetic);await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();}
async function call(page,path,method='GET',body){return page.evaluate(async({module,path,method,body})=>(await import(module)).browserAPI(path,method,body),{module:apiModule,path,method,body});}
async function imported(page){await open(page);const pick=await call(page,'/dialog/directory','POST');const job=await call(page,'/photos/import','POST',{paths:pick.paths,recursive:true});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status,{timeout:20000}).toBe('completed');const result=await call(page,'/photos');expect(result.total).toBe(1);return result.photos[0];}

async function closeForOrdering(page){await navigate(page,'设置');await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.locator('.browser-start')).toBeVisible();}
async function seedOrdering(page,base,rows){
  await page.evaluate(async({base,rows})=>{
    const data=window.__synthetic.data,h=await data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());
    m.photos=rows.map(row=>({...base,...row,rating_source:'manual',capture_group_id:row.id,preview_status:'failed',thumbnail_path:null,files:[{...base.files[0],id:row.id,file_name:row.file_name,preview_available:false}]}));m.revision++;m.view_preferences={sort:'date_taken',direction:'desc',layout:'grid',grid:150,dense:true};
    const w=await h.createWritable();await w.write(JSON.stringify(m));await w.close();window.showDirectoryPicker=async()=>data;
  },{base,rows});
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
}

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser album list sorting, search and rename persist ${width} ${lang}`,async({page},info)=>{
  const photo=await imported(page),prefix='AlbumCase-'+width,albums=[];const before=await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(','));
  for(const [name,photo_ids] of [[prefix+' Trip 10',[photo.id]],[prefix+' Trip 2',[]],[prefix+' Hidden',[photo.id]]])albums.push(await call(page,'/albums','POST',{name,photo_ids}));
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1200});await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await expect(page.locator('.app-shell')).toBeVisible();
  const all=()=>call(page,'/albums'),saved=()=>page.evaluate(async module=>{const {libraryId}=await(await import(module)).createAlbumPreferenceStore();return navigator.locks.request('photocollection:'+libraryId,async()=>{const m=JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());if(m.id!==libraryId)throw new Error('Library changed while checking the saved album preferences.');return m.album_preferences||{};});},albumModule);
  await exerciseAlbumList(page,{lang,prefix,albums,all,saved,screenshot:info.outputPath('album-list.png')});expect(await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(','))).toBe(before);
});

test('browser album preferences stay isolated across A-B-A and an old same-library store cannot save',async({page})=>{
  page.on('dialog',d=>d.accept());const photo=await imported(page),a=await call(page,'/albums','POST',{name:'Album A',photo_ids:[photo.id]});
  const identity=await page.evaluate(async({module,id})=>{const store=await(await import(module)).createAlbumPreferenceStore();window.__oldAlbumStore=store;await store.save({sort:'count',direction:'desc',order:[id]});return store.libraryId;},{module:albumModule,id:a.id});
  await navigate(page,'影集');await expect(page.getByRole('combobox',{name:'影集列表排序',exact:true})).toHaveValue('count');await closeForOrdering(page);await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('album-library-b',{create:true});});await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const b=await page.evaluate(async module=>{let error='';try{await window.__oldAlbumStore.save({sort:'name'});}catch(e){error=e.message;}const store=await(await import(module)).createAlbumPreferenceStore();await store.save({sort:'name',direction:'asc'});return {error,id:store.libraryId,old:store.value};},albumModule);expect(b.id).not.toBe(identity);expect(b.error).toContain('Library changed');expect(b.old).toEqual({});
  await closeForOrdering(page);await page.evaluate(()=>{window.showDirectoryPicker=async()=>window.__synthetic.data;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const restored=await page.evaluate(async module=>{let error='';try{await window.__oldAlbumStore.save({direction:'asc'});}catch(e){error=e.message;}const store=await(await import(module)).createAlbumPreferenceStore();return {id:store.libraryId,value:store.value,error};},albumModule);expect(restored).toEqual({id:identity,value:{sort:'count',direction:'desc',order:[a.id]},error:'Library changed. Reopen the current library.'});
  await closeForOrdering(page);const bad=await page.evaluate(async()=>{const file=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await file.getFile()).text());m.album_preferences={sort:'../../private'};const text=JSON.stringify(m),w=await file.createWritable();await w.write(text);await w.close();return text;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bad);
});

test('browser album save errors preserve the journal and retry after reopening',async({page})=>{
  await imported(page);await navigate(page,'影集');await page.evaluate(()=>{window.__failAlbumSave=true;const create=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=function(...args){if(window.__failAlbumSave&&this.name==='library.json')throw new DOMException('Synthetic album save failure','QuotaExceededError');return create.apply(this,args);};});
  const sort=page.getByRole('combobox',{name:'影集列表排序',exact:true});await sort.selectOption('name');await expect(page.locator('.album-list-toolbar [role=alert]')).toContainText('可用存储空间不足');await page.reload();await navigate(page,'影集');await expect(sort).toHaveValue('name');await expect.poll(()=>page.evaluate(async()=>JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text()).album_preferences?.sort)).toBe('name');await expect(page.locator('.album-list-toolbar [role=alert]')).toHaveCount(0);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser rule collections save nested conditions and update live ${width} ${lang}`,async({page},info)=>{
  page.on('dialog',d=>d.accept());const base=await imported(page),prefix='Browser-rule-'+width+'-';
  const before=await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(','));
  await closeForOrdering(page);await seedOrdering(page,base,[null,0,4].map((rating,i)=>({id:'rule-photo-'+i,file_name:prefix+i+'.jpg',rating,date_taken:'2026-01-01T00:00:00'})));
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1200});await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await expect(page.locator('.app-shell')).toBeVisible();
  const card=await createRuleThroughUI(page,{lang,prefix,name:'Browser rules '+width,screenshot:info.outputPath('rule-dialog.png')});const albums=await call(page,'/albums'),a=albums.find(a=>a.name==='Browser rules '+width);expect(a.type).toBe('rule');expect(a.count).toBe(2);
  await page.reload();await expect(card).toBeVisible();await card.getByRole('button',{name:lang==='en'?'Open Album ↗':'打开影集 ↗',exact:true}).click();await expect(page.locator('.photo-card')).toHaveCount(2);
  const zero=page.locator('.photo-card').filter({hasText:prefix+'1.jpg'});await zero.hover();const drawer=page.getByRole('complementary',{name:lang==='en'?'Hovered photo information':'悬停照片信息',exact:true});await expect(drawer).toBeVisible();await drawer.getByRole('button',{name:lang==='en'?'1 stars':'1 星',exact:true}).click();await expect(page.locator('.photo-card')).toHaveCount(1);expect((await call(page,'/albums/'+a.id)).count).toBe(1);
  const saved=await page.evaluate(async()=>JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text()));expect(saved.version).toBe(24);expect(saved.albums[0].photo_ids).toEqual([]);expect(saved.albums[0].query).toEqual(a.query);
  expect(await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(','))).toBe(before);
});

test('browser rule queries match the shared SQL contract and remain library scoped',async({page})=>{
  page.on('dialog',d=>d.accept());const base=await imported(page),fixture=JSON.parse(readFileSync(new URL('./fixtures/photo-query.json',import.meta.url),'utf8'));
  await closeForOrdering(page);await seedOrdering(page,base,fixture.rows);
  for(const item of fixture.cases){const query={version:1,root:item.root},preview=await call(page,'/albums/rules/preview','POST',{query});expect(preview.total,item.name).toBe(item.ids.length);expect(preview.candidates.map(p=>p.id).sort(),item.name).toEqual(item.ids);expect((await call(page,'/photos/ids?'+new URLSearchParams({query:JSON.stringify(query)}))).ids.sort(),item.name).toEqual(item.ids);}
  const colors={version:1,root:{op:'is_null',field:'color_label'}};expect((await call(page,'/albums/rules/preview','POST',{query:colors})).total).toBe(6);
  await call(page,'/photos/a','PATCH',{color_label:'red'});expect((await call(page,'/albums/rules/preview','POST',{query:colors})).total).toBe(5);
  expect((await call(page,'/photos/a','PATCH',{color_label:'none'})).color_label).toBeNull();
  await call(page,'/photos/batch-edit','POST',{photo_ids:['b'],color_label:'blue'});expect((await call(page,'/albums/rules/preview','POST',{query:colors})).total).toBe(5);
  await call(page,'/photos/batch-edit','POST',{photo_ids:['b'],color_label:'none'});expect((await call(page,'/albums/rules/preview','POST',{query:colors})).total).toBe(6);
  const a=await call(page,'/albums','POST',{name:'Live rules','type':'rule',query:{version:1,root:{op:'eq',field:'rating',value:0}}});
  expect((await call(page,'/photos?album_id='+a.id+'&camera=SONY')).total).toBe(1);
  expect((await call(page,'/stats?album_id='+a.id)).summary.total).toBe(1);
  const before=await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());
  const failure=await page.evaluate(async({module,id})=>{const api=(await import(module)).browserAPI;const errors=[];for(const [path,method,body] of [['/albums/'+id,'PATCH',{query:{version:2,root:{op:'is_null',field:'rating'}}}],['/albums/'+id+'/photos','PUT',{photo_ids:['a']}],['/albums/'+id+'/order','PUT',{photo_ids:['a']}]]){try{await api(path,method,body);errors.push('accepted');}catch(e){errors.push(e.message);}}return errors;},{module:apiModule,id:a.id});expect(failure.every(s=>s!=='accepted')).toBe(true);
  expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(before);
  await closeForOrdering(page);await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('rule-library-b',{create:true});});await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();expect(await call(page,'/albums')).toEqual([]);
  await closeForOrdering(page);await page.evaluate(()=>{window.showDirectoryPicker=async()=>window.__synthetic.data;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/albums/'+a.id)).count).toBe(1);
});

test('browser format3 upgrade pins exact bytes, preserves semantic albums and refuses future rule formats',async({page})=>{
  page.on('dialog',d=>d.accept());const base=await imported(page);await call(page,'/albums','POST',{name:'Semantic snapshot',photo_ids:[base.id]});await closeForOrdering(page);
  const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=3;for(const p of m.photos){delete p.rating_source;delete p.flag;}delete m.albums[0].cover_mode;delete m.albums[0].member_added_at;m.albums[0].type='smart';m.albums[0].keywords=['sea'];m.albums[0].ai_model='synthetic-local-model';const text=JSON.stringify(m,null,1),w=await h.createWritable();await w.write(text);await w.close();return text;});
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const a=await call(page,'/albums','POST',{name:'Unrated','type':'rule',query:{version:1,root:{op:'is_null',field:'rating'}}});await call(page,'/photos/'+base.id,'PATCH',{rating:0});
  const state=await page.evaluate(async()=>{const files=[];for await(const f of window.__synthetic.data.values())if(f.name.startsWith('library.before-rules-v4-'))files.push(await(await f.getFile()).text());return {files,m:JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())};});
  expect(state.files).toEqual([old]);expect(state.m.version).toBe(24);expect(state.m.albums[0]).toMatchObject({type:'smart',keywords:['sea'],photo_ids:[base.id],query:null});expect((await call(page,'/albums/'+a.id)).count).toBe(0);
  await closeForOrdering(page);
  for(const kind of ['old-format','future-format','future-query']){
    const text=await page.evaluate(async({manifest,kind})=>{const m=structuredClone(manifest);if(kind==='future-query')m.albums[1].query.version=2;else m.version=kind==='old-format'?3:99;const text=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{manifest:state.m,kind});
    await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(text);
  }
});

test('public portfolio exports live rule membership only among checked photos and keeps rules private',async({page})=>{
  const p=await imported(page);await call(page,'/photos/'+p.id,'PATCH',{rating:5});const query={version:1,root:{op:'eq',field:'rating',value:5}};await call(page,'/albums','POST',{type:'rule',name:'Public rules',query});
  const hash=await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(','));
  await page.reload();await page.getByRole('button',{name:'导出公开作品',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导出公开作品',exact:true});await dialog.locator('.curation-choices button').first().click();await expect(dialog.locator('.publish-album')).toHaveText('Public rules · 1');await dialog.locator('.publish-album input').check();
  await page.evaluate(async()=>{window.__rulePublic=await window.__synthetic.root.getDirectoryHandle('rule-public',{create:true});window.showDirectoryPicker=async()=>window.__rulePublic;});await dialog.getByRole('button',{name:'选择目录并导出公开内容',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('公开内容已导出');
  const catalog=await page.evaluate(async()=>{for await(const folder of window.__rulePublic.values()){const portfolio=await folder.getDirectoryHandle('portfolio');return JSON.parse(await(await(await portfolio.getFileHandle('manifest.json')).getFile()).text());}});expect(catalog.albums).toHaveLength(1);expect(catalog.albums[0].photoIds).toEqual([catalog.photos[0].id]);expect(JSON.stringify(catalog)).not.toMatch(/query|rating|file_hash|source_id|synthetic\.jpg|raw_exif|gps_/);
  expect(await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(','))).toBe(hash);
});

test('rating order and direction persist independently across library A-B-A',async({page})=>{
  page.on('dialog',d=>d.accept());await page.setViewportSize({width:1440,height:1600});let base=await imported(page);
  const contract=JSON.parse(readFileSync(new URL('./fixtures/photo-order.json',import.meta.url),'utf8'));
  const rows=contract.rows.map(p=>({...p,file_name:'Ordering-'+p.id+'.jpg'}));
  await closeForOrdering(page);await seedOrdering(page,base,rows);await navigate(page,'照片');const sort=page.getByRole('combobox',{name:'照片排序',exact:true});await sort.selectOption('rating');
  await expect(page.locator('.photo-caption>span')).toHaveText(contract.expected['rating:desc'].map(id=>'Ordering-'+id+'.jpg'));
  const selected=page.locator('.photo-card').filter({hasText:'Ordering-z.jpg'});await selected.locator('.select-box').click();
  await page.getByRole('button',{name:'切换升降序',exact:true}).click();await expect(page.locator('.photo-caption>span')).toHaveText(contract.expected['rating:asc'].map(id=>'Ordering-'+id+'.jpg'));
  await expect(selected.locator('.select-box')).toHaveAttribute('aria-pressed','true');
  await closeForOrdering(page);await page.evaluate(async()=>{window.__orderLibraryA=window.__synthetic.data;window.__synthetic.data=await window.__synthetic.root.getDirectoryHandle('ordering-library-b',{create:true});window.showDirectoryPicker=async({mode})=>mode==='readwrite'?window.__synthetic.data:window.__synthetic.originals;});
  await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();const chosen=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:chosen.paths});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');base=(await call(page,'/photos')).photos[0];
  await closeForOrdering(page);await seedOrdering(page,base,rows);await navigate(page,'照片');await sort.selectOption('file_name');await page.reload();await expect(sort).toHaveValue('file_name');
  await closeForOrdering(page);await page.evaluate(async()=>{window.__synthetic.data=await(await navigator.storage.getDirectory()).getDirectoryHandle('synthetic-library');window.showDirectoryPicker=async()=>window.__synthetic.data;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();await navigate(page,'照片');await expect(sort).toHaveValue('rating');await expect(page.locator('.photo-caption>span')).toHaveText(contract.expected['rating:asc'].map(id=>'Ordering-'+id+'.jpg'));
  await expect(page.locator('.photo-card.selected')).toHaveCount(0);await selected.hover();const drawer=page.getByRole('complementary',{name:'悬停照片信息',exact:true});await expect(drawer).toBeVisible();await drawer.getByRole('button',{name:'1 星',exact:true}).click();await expect(page.locator('.photo-caption>span')).toHaveText(['b','g','h','z','e','a','d','c','f'].map(id=>'Ordering-'+id+'.jpg'));
  await drawer.getByRole('button',{name:'1 星',exact:true}).click();await expect(page.locator('.photo-caption>span')).toHaveText(['b','g','h','e','a','d','c','f','z'].map(id=>'Ordering-'+id+'.jpg'));expect((await call(page,'/photos/z')).rating).toBeNull();
  await drawer.getByRole('button',{name:'关闭照片信息',exact:true}).click();await closeForOrdering(page);await page.evaluate(async()=>{window.__synthetic.data=await(await navigator.storage.getDirectory()).getDirectoryHandle('ordering-library-b');window.showDirectoryPicker=async()=>window.__synthetic.data;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();await navigate(page,'照片');await expect(sort).toHaveValue('file_name');expect((await call(page,'/photos/z')).rating).toBe(5);
});

test('browser tied pages keep all IDs and deep pages do not read source or thumbnail files',async({page})=>{
  page.on('dialog',d=>d.accept());const base=await imported(page),rows=Array.from({length:1027},(_,i)=>({id:'sort-'+String(1026-i).padStart(4,'0'),file_name:'Same.jpg',rating:[null,0,1,2,3,4,5][(1026-i)%7],date_taken:'2026-01-01T12:00:00',created_at:'2026-02-01T12:00:00'}));
  await closeForOrdering(page);await seedOrdering(page,base,rows);
  await page.evaluate(()=>{window.__orderFileReads=0;const read=FileSystemFileHandle.prototype.getFile;FileSystemFileHandle.prototype.getFile=function(...args){if(this.name==='synthetic.jpg'||/-(thumb|preview)\.jpg$/.test(this.name))window.__orderFileReads++;return read.apply(this,args);};});
  for(const direction of ['asc','desc']){
    const ids=(await call(page,'/photos/ids?sort=rating&direction='+direction)).ids,pages=[];
    for(let p=1;p<=15;p++){const result=await call(page,`/photos?sort=rating&direction=${direction}&page_size=73&page=${p}`);expect(result.total).toBe(1027);pages.push(...result.photos.map(p=>p.id));}
    const buckets=direction==='asc'?[0,1,2,3,4,5,null]:[5,4,3,2,1,0,null],expected=buckets.flatMap(r=>rows.filter(p=>p.rating===r).map(p=>p.id).sort());expect(ids).toEqual(expected);expect(pages).toEqual(ids);expect(new Set(pages).size).toBe(1027);
    const selected=ids.slice(100,130).reverse();expect((await call(page,'/photos/by-ids','POST',{ids:selected})).photos.map(p=>p.id)).toEqual(selected);
  }
  expect(await page.evaluate(()=>window.__orderFileReads)).toBe(0);
  const rule=await call(page,'/albums','POST',{name:'Live missing or zero',type:'rule',query:{version:1,root:{op:'or',children:[{op:'is_null',field:'rating'},{op:'eq',field:'rating',value:0}]}}}),expected=rows.filter(p=>p.rating===null||p.rating===0).map(p=>p.id).sort();
  const ids=(await call(page,'/photos/ids?album_id='+rule.id+'&sort=file_name&direction=asc')).ids,pages=[];for(let p=1;p<=Math.ceil(expected.length/23);p++){const result=await call(page,`/photos?album_id=${rule.id}&sort=file_name&direction=asc&page_size=23&page=${p}`);expect(result.total).toBe(expected.length);pages.push(...result.photos.map(p=>p.id));}expect(ids).toEqual(expected);expect(pages).toEqual(expected);expect(new Set(pages).size).toBe(expected.length);expect(await page.evaluate(()=>window.__orderFileReads)).toBe(0);
  const order=rows.slice(0,6).map(p=>p.id).reverse(),album=await call(page,'/albums','POST',{name:'Manual order',photo_ids:order});await call(page,'/photos/ids?sort=rating');expect((await call(page,`/photos/ids?album_id=${album.id}&sort=manual&direction=desc`)).ids).toEqual(order);
});

test('tool preferences survive closing and reopening, stay library-scoped and reject the old same-library session',async({page})=>{
  page.on('dialog',dialog=>dialog.accept());const photo=await imported(page);await navigate(page,'照片');await page.locator('.photo-image').first().dblclick();
  await page.getByRole('button',{name:'固定查看工具',exact:true}).click();await page.getByRole('combobox',{name:'预览清晰度',exact:true}).selectOption('4096');
  const initial=await page.evaluate(async module=>{window.__oldToolStore=await(await import(module)).createToolPreferenceStore('viewer');return window.__oldToolStore.libraryId;},toolModule);
  await page.keyboard.press('Escape');await navigate(page,'设置');await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.locator('.browser-start')).toBeVisible();
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const stale=await page.evaluate(async module=>{const store=await(await import(module)).createToolPreferenceStore('viewer');let error='';try{await window.__oldToolStore.save({quality:6144,pinned:false});}catch(e){error=e.message;}return {id:store.libraryId,values:store.value,error};},toolModule);
  expect(stale).toEqual({id:initial,values:{quality:4096,pinned:true},error:'Library changed. Reopen the current library.'});
  await navigate(page,'照片');await page.locator('.photo-image').first().dblclick();await expect(page.getByRole('button',{name:'固定查看工具',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('combobox',{name:'预览清晰度',exact:true})).toHaveValue('4096');
  await page.keyboard.press('Escape');await navigate(page,'设置');await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.locator('.browser-start')).toBeVisible();
  await page.evaluate(async()=>{window.__libraryA=window.__synthetic.data;const second=await window.__synthetic.root.getDirectoryHandle('second-library',{create:true});window.showDirectoryPicker=async()=>second;});
  await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const second=await page.evaluate(async module=>{const store=await(await import(module)).createToolPreferenceStore('viewer');await store.save({quality:6144});return {id:store.libraryId,value:store.value};},toolModule);expect(second.id).not.toBe(initial);expect(second.value).toEqual({});
  await navigate(page,'设置');await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.locator('.browser-start')).toBeVisible();await page.evaluate(()=>{window.showDirectoryPicker=async()=>window.__libraryA;});
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  expect(await page.evaluate(async module=>(await(await import(module)).createToolPreferenceStore('viewer')).value,toolModule)).toEqual({quality:4096,pinned:true});expect((await call(page,'/photos/'+photo.id)).file_hash).toBe(photo.file_hash);
});

test('browser darkroom restores output settings without changing an edit record or the source',async({page})=>{
  const photo=await imported(page);await page.goto('/#/tools/edit?photo='+photo.id);await expect(page.locator('.edit-image img')).toHaveJSProperty('complete',true);
  await page.getByRole('button',{name:/^保存编辑/}).click();await expect(page.getByText('编辑参数已保存，原图保持不变。',{exact:true})).toBeVisible();
  const controls=page.locator('.edit-controls details').last(),edge=page.getByRole('spinbutton',{name:'导出最长边',exact:true});await controls.getByRole('slider').fill('78');await controls.getByRole('combobox').selectOption('png');await edge.fill('555');
  const before=await page.evaluate(async()=>{const library=JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());return {edits:library.edits,photos:library.photos};});
  await expect.poll(()=>page.evaluate(async module=>(await(await import(module)).createToolPreferenceStore('darkroom')).value,toolModule)).toEqual({format:'png',edge:555,quality:78});
  await page.reload();await expect(page.locator('.edit-image img')).toHaveJSProperty('complete',true);await expect(controls.getByRole('combobox')).toHaveValue('png');await expect(edge).toHaveValue('555');await controls.getByRole('combobox').selectOption('jpg');await expect(controls.getByRole('slider')).toHaveValue('78');
  const after=await page.evaluate(async()=>{const library=JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());return {edits:library.edits,photos:library.photos};});expect(after).toEqual(before);
});

test('all four gallery layouts keep local photos, selection and the saved layout preference',async({page})=>{
  await imported(page);await navigate(page,'照片');
  await page.locator('.select-box').first().click();await page.getByRole('button',{name:'网格显示设置',exact:true}).click();
  for(const mode of ['grid','tiles','waterfall','justified']){
    await page.getByLabel('浏览布局',{exact:true}).selectOption(mode);await expect(page.locator('.photo-image')).toHaveCount(1);
    await expect(page.locator('.select-box')).toHaveAttribute('aria-pressed','true');
  }
  await page.getByLabel('浏览布局',{exact:true}).selectOption('waterfall');await page.reload();await expect(page.locator('.waterfall-gallery .photo-image')).toHaveCount(1);
});

test('browser shortcut recorder rejects conflicts and preserves Escape and Tab navigation',async({page})=>{
  await open(page);await navigate(page,'设置');
  const previous=page.getByLabel('详情 · 上一张',{exact:true});await previous.focus();await previous.press('f');
  await expect(page.getByText('快捷键已用于：收藏 / 取消收藏',{exact:true})).toBeVisible();
  await previous.press('q');await expect(previous).toHaveValue('Q');await previous.press('Escape');await expect(previous).toHaveValue('Q');
  await previous.press('Tab');await expect(page.getByLabel('详情 · 下一张',{exact:true})).toBeFocused();
  await page.reload();await navigate(page,'设置');await expect(page.getByLabel('详情 · 上一张',{exact:true})).toHaveValue('Q');
});

test('activity summaries use local job records and the full details remain available',async({page})=>{
  await imported(page);const summaries=await call(page,'/jobs?summary=true');expect(summaries).toHaveLength(1);expect(summaries[0].status).toBe('completed');expect(summaries[0].results).toBeUndefined();
  await page.getByRole('button',{name:'活动中心',exact:true}).click();const center=page.getByRole('dialog',{name:'活动中心',exact:true});
  await center.locator('.activity-list button').first().click();await expect(center.locator('.activity-detail h3')).toContainText('照片导入');await expect(center.locator('.activity-detail h3')).toContainText('已完成');
  expect((await call(page,'/jobs/'+summaries[0].id)).results).toEqual([]);await center.getByRole('button',{name:'关闭',exact:true}).click();
});

test('photo metadata reads stay lazy and leased thumbnails survive cache eviction',async({page})=>{
  const p=await imported(page);await navigate(page,'设置');
  await page.evaluate(async module=>{(await import(module)).clearPhotoMedia();},mediaModule);
  for(let i=0;i<30;i++)await call(page,'/photos/by-ids','POST',{ids:[p.id]});
  expect(await page.evaluate(async module=>(await import(module)).photoMediaPool.snapshot().entries,mediaModule)).toBe(0);
  await navigate(page,'照片');const image=page.locator('.photo-image img').first();
  await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);const firstURL=await image.getAttribute('src');expect(firstURL).toMatch(/^blob:/);
  await image.evaluate(img=>{window.__retainedImage=img;const spacer=document.createElement('div');spacer.id='resource-test-spacer';spacer.style.height='2500px';document.body.append(spacer);window.scrollTo(0,document.documentElement.scrollHeight);});
  await expect.poll(()=>image.getAttribute('src')).toBe(null);
  await page.evaluate(async({module,id})=>{
    const pool=(await import(module)).photoMediaPool,photos=await window.__synthetic.data.getDirectoryHandle('photos'),base=await(await photos.getFileHandle(id+'-thumb.jpg')).getFile();
    for(let group=0;group<35;group++)await Promise.all(Array.from({length:8},async(_,i)=>{const name='cache-'+(group*8+i)+'-thumb.jpg',handle=await photos.getFileHandle(name,{create:true}),writer=await handle.createWritable();await writer.write(base);await writer.close();}));
    const library=JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());
    for(let i=0;i<280;i++){const lease=pool.acquire('pc-local-media:'+library.id+'/photos/cache-'+i+'-thumb.jpg',20);await lease.ready;lease.release();}
  },{module:mediaModule,id:p.id});
  expect(await page.evaluate(async module=>(await import(module)).photoMediaPool.snapshot().entries,mediaModule)).toBeLessThanOrEqual(256);
  await page.evaluate(()=>{document.getElementById('resource-test-spacer').remove();window.scrollTo(0,0);});
  await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);expect(await image.getAttribute('src')).not.toBe(firstURL);
  expect(await image.evaluate(img=>img===window.__retainedImage)).toBe(true);
  await page.evaluate(async module=>{
    const pool=(await import(module)).photoMediaPool,library=JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());
    for(let i=0;i<280;i++){const lease=pool.acquire('pc-local-media:'+library.id+'/photos/cache-'+i+'-thumb.jpg',20);await lease.ready;lease.release();}
  },mediaModule);
  expect(await image.evaluate(async img=>(await(await fetch(img.src)).blob()).size)).toBeGreaterThan(0);await expect(page.locator('.image-fallback')).toHaveCount(0);
});

test('a missing derived thumbnail shows the existing fallback and leaves the original unchanged',async({page})=>{
  const p=await imported(page);await navigate(page,'设置');
  const before=await page.evaluate(async id=>{
    const file=await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).join(',');
    await(await window.__synthetic.data.getDirectoryHandle('photos')).removeEntry(id+'-thumb.jpg');return digest;
  },p.id);
  await navigate(page,'照片');await expect(page.locator('.image-fallback')).toBeVisible();
  expect(await page.evaluate(async()=>{const file=await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).join(',');})).toBe(before);
});

test('browser viewer warms only adjacent previews after a delay and releases their leases',async({page})=>{
  await imported(page);
  const job=await page.evaluate(async module=>{
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;const files=[];
    for(let i=0;i<2;i++){canvas.getContext('2d').fillStyle=['#68596b','#d7c491'][i];canvas.getContext('2d').fillRect(0,0,80,60);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));files.push(new File([blob],'neighbor-'+i+'.jpg',{type:'image/jpeg'}));}
    return (await import(module)).importSelectedFiles(files);
  },apiModule);
  await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');
  const ids=(await call(page,'/photos/ids?sort=date_taken&direction=desc')).ids,middle=await call(page,'/photos/'+ids[1]);
  await navigate(page,'设置');await page.evaluate(async module=>(await import(module)).clearPhotoMedia(),mediaModule);await navigate(page,'照片');
  await expect.poll(()=>page.locator('.photo-image img').evaluateAll(images=>images.length===3&&images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
  await page.getByRole('button',{name:'查看 '+middle.file_name,exact:true}).dblclick();await expect.poll(()=>page.locator('.detail-image>img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await page.waitForTimeout(160);expect(await page.evaluate(async module=>(await import(module)).photoMediaPool.snapshot().entries,mediaModule)).toBe(4);
  await expect.poll(()=>page.evaluate(async module=>(await import(module)).photoMediaPool.snapshot().entries,mediaModule)).toBe(6);
  await page.keyboard.press('Escape');await navigate(page,'设置');await expect.poll(()=>page.evaluate(async module=>(await import(module)).photoMediaPool.snapshot().pinned,mediaModule)).toBe(0);
});

test('local import deduplicates, persists relationships, exports, and keeps originals intact',async({page},testInfo)=>{
  const requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const p=await imported(page);expect(p.width).toBe(640);expect(p.height).toBe(400);
  const digest=()=>page.evaluate(async()=>{const f=await (await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))).join(',');});const before=await digest();
  await call(page,'/photos/'+p.id,'PATCH',{favorite:true,rating:5,tags:['synthetic']});
  const album=await call(page,'/albums','POST',{name:'合成影集',photo_ids:[p.id]});expect(album.count).toBe(1);
  const options={template:'frame',style:'modern_info_bar',show_brand_logo:false,info_bar_ratio:.14,font_scale:1,fields:['date_taken','signature'],signature:'光影',signature_style:'chinese_handwriting',theme:'white',border:.035,info_height:.16,font_size:1,align:'center',radius:.008,blur:.08,intensity:.85,brightness:.7,saturation:1.25,photo_scale:.88,shadow:true,format:'png',quality:95,long_edge:4096,filename_template:'{original}_{index}_{camera}'};
  const draft=await call(page,'/watermark/drafts','POST',{photo_id:p.id,name:'本地草稿',settings_json:options});expect(new URL(draft.preview_url).pathname).toMatch(/^\/_pc-file\//);expect(await page.evaluate(async url=>(await fetch(url)).status,draft.preview_url)).toBe(200);
  const result=await call(page,'/watermark/drafts/'+draft.id+'/export','POST',{});expect(result.path).toMatch(/^exports\//);expect(result.file_name).toBe('synthetic_001_camera.png');
  const second=await call(page,'/watermark/drafts/'+draft.id+'/export','POST',{});expect(second.path).not.toBe(result.path);
  const simultaneous=await Promise.all([call(page,'/watermark/drafts/'+draft.id+'/export','POST',{}),call(page,'/watermark/drafts/'+draft.id+'/export','POST',{})]);expect(simultaneous[0].path).not.toBe(simultaneous[1].path);
  writeFileSync(testInfo.outputPath('synthetic-watermark.png'),Buffer.from(await page.evaluate(async url=>Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),result.url)));
  await navigate(page,'水印图库');await expect(page.getByText('本地草稿',{exact:true}).first()).toBeVisible();await page.screenshot({path:testInfo.outputPath('browser-watermark-gallery.png')});
  expect(await digest()).toBe(before);
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/albums'))[0].name).toBe('合成影集');expect((await call(page,'/watermark/drafts')).total).toBe(1);
  await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('photocollection-browser-handles');r.onsuccess=resolve;r.onerror=reject;}));
  await page.reload();await expect(page.getByRole('button',{name:'打开本地图库或备份'})).toBeVisible();await page.getByRole('button',{name:'打开本地图库或备份'}).click();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/albums'))[0].count).toBe(1);expect((await call(page,'/photos/'+p.id)).missing).toBe(true);
  await navigate(page,'水印图库');await expect(page.getByRole('link',{name:'原片不可用 · 前往授权设置'})).toHaveAttribute('href','#/?page=settings');
  await navigate(page,'照片');await page.locator('.photo-image').first().dblclick();await page.getByRole('button',{name:'照片信息',exact:true}).click();await expect(page.locator('.photo-detail .error-box')).toContainText('原片目录尚未授权或连接');await expect(page.getByText('原图已移动或删除。可重新导入新位置以按 hash 关联。')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('source-permission-notice.png')});await page.getByRole('button',{name:'前往原片授权设置'}).click();await expect(page.getByRole('heading',{name:'原片目录（只读）'})).toBeVisible();
  await page.getByRole('button',{name:'重新选择并授权'}).click();await expect.poll(async()=>(await call(page,'/photos/'+p.id)).missing).toBe(false);expect(await digest()).toBe(before);
  await call(page,'/photos/'+p.id,'DELETE');expect((await call(page,'/photos')).total).toBe(0);expect(await digest()).toBe(before);expect((await call(page,'/watermark/drafts/'+draft.id)).source_missing).toBe(false);
  expect(requests.filter(r=>r.url.includes('/api/')||r.method!=='GET')).toEqual([]);expect(errors).toEqual([]);
});

test('last library can be reauthorized without a folder picker or metadata changes',async({page},info)=>{
  const p=await imported(page);const before=await page.evaluate(async()=>{localStorage.setItem('deny-library','1');return (await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text();});
  await page.reload();const resume=page.getByRole('button',{name:/重新授权并打开上次图库/});await expect(resume).toBeVisible();
  await page.setViewportSize({width:1042,height:815});await page.screenshot({path:info.outputPath('reauthorize-library.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>{window.showDirectoryPicker=async()=>{throw Error('Picker should not be needed');};FileSystemHandle.prototype.requestPermission=async()=>{if(!navigator.userActivation.isActive)throw Error('Permission needs a user gesture');localStorage.removeItem('deny-library');return 'granted';};});
  await resume.click();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/photos/'+p.id)).missing).toBe(false);
  expect(await page.evaluate(async()=>(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(before);
});

test('cancelled or denied folder picker does not offer metadata recovery',async({page})=>{
  await page.goto('/');const button=page.getByRole('button',{name:'打开本地图库或备份',exact:true});await expect(button).toBeEnabled();
  for(const [name,message] of [['AbortError','未选择文件夹'],['NotAllowedError','目录权限不足']]){
    await page.evaluate(name=>{window.showDirectoryPicker=async()=>{throw new DOMException('synthetic picker failure',name);};},name);
    await button.click();await expect(page.getByRole('alert')).toContainText(message);await expect(page.getByRole('button',{name:'从上一份元数据恢复（保留损坏文件）'})).toHaveCount(0);
  }
  expect(await page.evaluate(async()=>{try{await window.__synthetic.data.getFileHandle('library.json');return false;}catch{return true;}})).toBe(true);
});

test('real service worker caches the app for offline reopen',async({page,context})=>{await open(page);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await expect(page.locator('.app-shell')).toBeVisible();await context.setOffline(true);await page.reload();await expect(page.locator('.app-shell')).toBeVisible();await navigate(page,'统计');await expect(page.getByText('每一次快门，都有你的偏好。')).toBeVisible();await context.setOffline(false);});

test('web navigation uses fragments and rejected writes preserve metadata',async({page})=>{const p=await imported(page);await navigate(page,'水印工坊');expect(new URL(page.url()).search).toBe('');expect(new URL(page.url()).hash).toContain('/watermark');const before=await page.evaluate(async()=>await (await (await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());await expect(call(page,'/photos/batch-edit','POST',{photo_ids:[p.id],rating:99})).rejects.toThrow();const after=await page.evaluate(async()=>await (await (await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());expect(after).toBe(before);});

test('metadata conflicts are rejected and interrupted cloud work is not resumed',async({page})=>{
  await open(page);await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),s=JSON.parse(await (await h.getFile()).text());s.jobs.push({id:'synthetic-interrupted',kind:'watercolor',status:'running',total:1,processed:0,success:0,skipped:0,failed:0,current:'',errors:[],results:[]});const w=await h.createWritable();await w.write(JSON.stringify(s));await w.close();});
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/jobs/synthetic-interrupted')).status).toBe('interrupted');
  const changed=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),s=JSON.parse(await (await h.getFile()).text());s.revision++;const text=JSON.stringify(s),w=await h.createWritable();await w.write(text);await w.close();return text;});
  await expect(call(page,'/albums','POST',{name:'must not save',photo_ids:[]})).rejects.toThrow();expect(await page.evaluate(async()=>await (await (await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(changed);
});

test('previous metadata recovery keeps the damaged file and restores the library',async({page})=>{
  await imported(page);await call(page,'/albums','POST',{name:'backup-point',photo_ids:[]});await call(page,'/albums','POST',{name:'later',photo_ids:[]});
  await page.evaluate(async()=>{const w=await (await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write('damaged-synthetic-json');await w.close();});await page.reload();await page.getByRole('button',{name:'从上一份元数据恢复（保留损坏文件）'}).click();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/albums')).map(a=>a.name)).toEqual(['backup-point']);expect(await page.evaluate(async()=>{for await(const name of window.__synthetic.data.keys())if(name.startsWith('library.damaged-'))return true;return false;})).toBe(true);
});

test('backup reopens with derived images and denied access cannot save metadata',async({page})=>{
  const p=await imported(page);await call(page,'/albums','POST',{name:'portable-backup',photo_ids:[p.id]});
  await navigate(page,'设置');await page.evaluate(async()=>{window.__backup=await window.__synthetic.root.getDirectoryHandle('synthetic-backups',{create:true});window.showDirectoryPicker=async()=>window.__backup;});
  await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）',exact:true}).click();
  await expect(page.getByText(/完整图库备份已保存：/)).toBeVisible();
  await page.evaluate(async()=>{for await(const h of window.__backup.values())if(h.kind==='directory'){window.__backupLibrary=h;break;}});
  const before=await page.evaluate(async()=>await (await (await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());
  await page.evaluate(()=>{localStorage.setItem('deny-library','1');});
  // A denied restore permission is never interpreted as a new/empty library.
  await page.reload();await expect(page.getByRole('button',{name:'打开本地图库或备份'})).toBeVisible();
  expect(await page.evaluate(async()=>await (await (await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(before);
  await page.evaluate(async()=>{localStorage.removeItem('deny-library');const backups=await window.__synthetic.root.getDirectoryHandle('synthetic-backups');for await(const h of backups.values())if(h.kind==='directory'){window.showDirectoryPicker=async()=>h;break;}});
  await page.getByRole('button',{name:'打开本地图库或备份'}).click();await expect(page.locator('.app-shell')).toBeVisible();
  expect((await call(page,'/albums'))[0].name).toBe('portable-backup');const restored=await call(page,'/photos/'+p.id);expect(restored.thumbnail_url).toMatch(/^pc-local-media:/);
  await navigate(page,'照片');await expect.poll(()=>page.locator('.photo-image img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
});

test('available browser pages render through the local adapter',async({page})=>{
  const p=await imported(page),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await call(page,'/albums','POST',{name:'页面检查',photo_ids:[p.id]});
  for(const name of ['照片','影集','时间线','统计','摄影报告','水彩转绘','水印工坊','水印图库','设置']){await navigate(page,name);await expect(page.locator('#workspace-content')).not.toBeEmpty();}
  expect(errors).toEqual([]);
});

test('portrait and panoramic ambient exports fit the canvas and leave originals unchanged',async({page})=>{
  await open(page);const before=await page.evaluate(async()=>{const result={};for(const [name,width,height] of [['portrait.png',300,600],['panorama.png',1200,200]]){const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.fillStyle='#973c48';ctx.fillRect(0,0,width,height);const blob=await new Promise(r=>c.toBlob(r,'image/png')),w=await (await window.__synthetic.originals.getFileHandle(name,{create:true})).createWritable();await w.write(blob);await w.close();result[name]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');}return result;});
  const pick=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:pick.paths});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');
  const photos=(await call(page,'/photos')).photos.filter(p=>p.file_name.endsWith('.png'));
  expect(photos.length).toBe(2);for(const p of photos){const d=await call(page,'/watermark/drafts','POST',{photo_id:p.id,settings_json:{template:'ambient',fields:['signature'],signature:'光影中的长署名也应完整显示',signature_style:'chinese_handwriting',format:'png'}}),result=await call(page,'/watermark/drafts/'+d.id+'/export','POST',{long_edge:1000});const size=await page.evaluate(async url=>{const bitmap=await createImageBitmap(await (await fetch(url)).blob());const size=[bitmap.width,bitmap.height];bitmap.close();return size;},result.url);expect(Math.max(...size)).toBeLessThanOrEqual(1000);expect(Math.min(...size)).toBeGreaterThan(0);}
  const after=await page.evaluate(async()=>{const result={};for(const name of ['portrait.png','panorama.png']){const f=await (await window.__synthetic.originals.getFileHandle(name)).getFile();result[name]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))).join(',');}return result;});expect(after).toEqual(before);
});

test('two tabs cannot overwrite a saved draft preview',async({page,context})=>{
  const p=await imported(page),base=await call(page,'/watermark/drafts','POST',{photo_id:p.id,settings_json:{fields:['signature'],signature:'base'}}),other=await context.newPage();await other.goto('/');await expect(other.locator('.app-shell')).toBeVisible();
  const attempts=await Promise.allSettled([call(page,'/watermark/drafts/'+base.id,'PUT',{revision:base.revision,settings_json:{signature:'first'}}),call(other,'/watermark/drafts/'+base.id,'PUT',{revision:base.revision,settings_json:{signature:'second'}})]);
  expect(attempts.filter(a=>a.status==='fulfilled').length).toBe(1);expect(attempts.filter(a=>a.status==='rejected').length).toBe(1);
  const saved=attempts.find(a=>a.status==='fulfilled').value;await other.close();await page.reload();await expect(page.locator('.app-shell')).toBeVisible();
  expect((await call(page,'/watermark/drafts/'+base.id)).settings_json.signature).toBe(saved.settings_json.signature);
  const same=await page.evaluate(async({module,id})=>{const api=await import(module),d=await api.browserAPI('/watermark/drafts/'+id),response=await fetch(d.preview_url),stored=await response.arrayBuffer(),expected=await (await api.browserBlob('/watermark/drafts/'+id+'/render',d.settings_json)).arrayBuffer();return {same:new Uint8Array(stored).toString()===new Uint8Array(expected).toString(),status:response.status,type:response.headers.get('content-type'),stored:stored.byteLength,expected:expected.byteLength,head:[...new Uint8Array(stored).slice(0,24)]};},{module:apiModule,id:base.id});expect(same).toMatchObject({same:true,status:200});
});

test('EXIF exposure, dates, GPS and orientation survive local import without changing originals',async({page})=>{
  const python=process.env.PHOTO_TEST_PYTHON||fileURLToPath(new URL('../../.venv/Scripts/python.exe',import.meta.url));
  const jpeg=execFileSync(python,['-c',`from PIL import Image
from PIL.TiffImagePlugin import IFDRational as R
from io import BytesIO
import sys
exif=Image.Exif()
exif[271]='Synthetic Camera';exif[272]='Synthetic Model';exif[274]=6
exif[34665]={33437:R(28,10),33434:R(1,125),34855:200,37386:R(50,1),36867:'2024:02:29 10:30:00'}
exif[34853]={1:'N',2:(R(51),R(30),R(0)),3:'W',4:(R(0),R(7),R(30))}
output=BytesIO();Image.new('RGB',(120,80),'#815426').save(output,'JPEG',exif=exif)
sys.stdout.buffer.write(output.getvalue())`]);
  await open(page);await page.evaluate(async bytes=>{const w=await (await window.__synthetic.originals.getFileHandle('exif.jpg',{create:true})).createWritable();await w.write(new Uint8Array(bytes));await w.close();},Array.from(jpeg));
  const pick=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:pick.paths});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');
  const p=(await call(page,'/photos')).photos.find(p=>p.file_name==='exif.jpg');expect(p).toBeTruthy();expect(p.camera_model).toBe('Synthetic Model');expect([p.width,p.height]).toEqual([80,120]);expect(p.focal_length).toBe(50);expect(p.f_number).toBeCloseTo(2.8);expect(p.exposure_seconds).toBeCloseTo(1/125);expect(p.iso).toBe(200);expect(p.date_taken).toBe('2024-02-29T10:30:00');expect(p.gps_latitude).toBeCloseTo(51.5);expect(p.gps_longitude).toBeCloseTo(-.125);expect(p.file_hash).toBe(createHash('sha256').update(jpeg).digest('hex'));
  const stats=await call(page,'/stats');expect(stats.summary.unknown_date).toBe(1);expect(stats.summary.shooting_days).toBe(1);
});

test('AI settings preserve input typed while an earlier save is still writing',async({page})=>{
  const p=await imported(page),uploads=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))uploads.push(r.url());});page.on('websocket',ws=>uploads.push(ws.url()));
  await call(page,'/art/settings','PUT',{relay_url:''});await navigate(page,'水彩转绘');await page.getByRole('button',{name:'AI 服务设置',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'AI 服务设置'}),key=settings.getByLabel('API Key',{exact:true}),title=settings.getByLabel('标题建议模型',{exact:true}),relay=settings.getByRole('textbox',{name:'AI 中转地址',exact:true}),save=settings.getByRole('button',{name:'保存设置',exact:true});
  const before=(await call(page,'/photos/'+p.id)).file_hash;
  await page.evaluate(()=>{
    const write=FileSystemWritableFileStream.prototype.write;window.__heldSettings=false;
    FileSystemWritableFileStream.prototype.write=async function(value){
      const text=typeof value==='string'?value:value instanceof Blob?await value.text():null;
      if(!window.__heldSettings&&text?.includes('qwen-synthetic-pending-model')){window.__heldSettings=true;await new Promise(resolve=>window.__releaseSettings=resolve);}
      return write.call(this,value);
    };
  });
  await title.fill('qwen-synthetic-pending-model');await save.click();await page.waitForFunction(()=>window.__heldSettings);await expect(save).toBeDisabled();
  await key.fill('synthetic-later-key');await title.fill('qwen-synthetic-newer-model');await relay.fill('wss://synthetic-relay.invalid/cloud-art');
  await page.evaluate(()=>window.__releaseSettings());await expect(save).toBeEnabled();
  await expect(key).toHaveValue('synthetic-later-key');await expect(title).toHaveValue('qwen-synthetic-newer-model');await expect(relay).toHaveValue('wss://synthetic-relay.invalid/cloud-art');
  expect(await call(page,'/art/settings')).toMatchObject({key_configured:false,relay_url:'',title_model:'qwen-synthetic-pending-model'});
  await save.click();await expect(settings.getByText('API Key 已配置',{exact:true})).toBeVisible();await expect(key).toHaveValue('');
  expect(await call(page,'/art/settings')).toMatchObject({configured:true,title_model:'qwen-synthetic-newer-model',relay_url:'wss://synthetic-relay.invalid/cloud-art'});
  const persisted=await page.evaluate(async()=>({manifest:await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text(),storage:JSON.stringify(localStorage)}));expect(JSON.stringify(persisted)).not.toContain('synthetic-later-key');
  expect((await call(page,'/photos/'+p.id)).file_hash).toBe(before);expect(uploads).toEqual([]);
});

test('AI settings show saved key separately from relay readiness and update tool availability',async({page},info)=>{
  const p=await imported(page),requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await call(page,'/art/settings','PUT',{relay_url:''});await navigate(page,'水彩转绘');await page.getByRole('button',{name:'AI 服务设置',exact:true}).click();const settings=page.getByRole('dialog',{name:'AI 服务设置'});
  await settings.getByRole('button',{name:'保存设置',exact:true}).click();await expect(settings.getByText('API Key 尚未配置',{exact:true})).toBeVisible();expect(await call(page,'/art/settings')).toMatchObject({configured:false,key_configured:false});
  await settings.getByLabel('API Key',{exact:true}).fill('synthetic-ui-session-key');await settings.getByRole('button',{name:'保存设置',exact:true}).click();await expect(settings.getByText('API Key 已配置',{exact:true})).toBeVisible();await expect(settings).toContainText('AI 中转地址尚未配置');
  expect(await call(page,'/art/settings')).toMatchObject({configured:false,key_configured:true,relay_configured:false,key_source:'session'});
  await settings.getByRole('textbox',{name:'AI 中转地址',exact:true}).fill('wss://synthetic-relay.invalid/cloud-art');await settings.getByRole('button',{name:'保存设置',exact:true}).click();expect(await call(page,'/art/settings')).toMatchObject({configured:true,key_configured:true,relay_configured:true});
  await settings.screenshot({path:info.outputPath('ai-settings-saved.png')});await settings.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'选择照片',exact:true}).first().click();await page.getByRole('dialog',{name:'选择照片'}).getByRole('button',{name:p.file_name,exact:true}).click();await page.getByRole('checkbox',{name:'确认不加标题'}).check();await expect(page.getByRole('button',{name:'生成水彩海报',exact:true})).toBeEnabled();
  await expect(call(page,'/art/settings','PUT',{clear_key:true,relay_url:'ws://untrusted.invalid/cloud-art'})).rejects.toThrow();expect(await call(page,'/art/settings')).toMatchObject({configured:true,key_configured:true});
  const persisted=await page.evaluate(async()=>({manifest:await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text(),storage:JSON.stringify(localStorage)}));expect(JSON.stringify(persisted)).not.toContain('synthetic-ui-session-key');
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();expect(await call(page,'/art/settings')).toMatchObject({configured:false,key_configured:false,relay_url:'wss://synthetic-relay.invalid/cloud-art'});expect(requests.filter(r=>r.method!=='GET'||r.url.startsWith('https://synthetic-relay'))).toEqual([]);
});

for(const lang of ['zh','en'])test(`suggested title language follows the interface ${lang}`,async({page})=>{
  const p=await imported(page),title=lang==='zh'?'山间一刻':'A Mountain Moment',evidence=lang==='zh'?'画面可见山峰，地点未核实。':'Visible mountains; location unverified.',received=[];
  page.on('dialog',dialog=>dialog.accept());
  await page.routeWebSocket('**/cloud-art',ws=>{let metadata;ws.onMessage(data=>{if(typeof data!=='string')return;const value=JSON.parse(data);if(!metadata){metadata=value;received.push(value);return;}if(value.type==='submit'){ws.send(JSON.stringify({type:'result',suggestions:[{title,evidence}]}));ws.send(JSON.stringify({type:'done'}));}});});
  await page.goto('/?lang='+lang);await expect(page.locator('.app-shell')).toBeVisible();
  await call(page,'/art/settings','PUT',{api_key:'synthetic-language-key',relay_url:'wss://synthetic-relay.invalid/cloud-art'});
  const target=new URL(page.url());target.hash='/watercolor?photo='+p.id;await page.goto(target.href);await page.getByText(lang==='zh'?'从画面建议标题':'Suggest titles from the photo',{exact:true}).click();await page.getByRole('button',{name:lang==='zh'?'建议标题':'Suggest Titles',exact:true}).click();
  await expect(page.locator('.art-suggestion b')).toHaveText(title);await expect(page.locator('.art-suggestion small')).toHaveText(evidence);expect(received).toHaveLength(1);expect(received[0].language).toBe(lang);
});

test('cloud disconnect keeps the receipt after reload and never resubmits',async({page})=>{
  let submissions=0,disconnect;
  page.on('dialog',dialog=>dialog.accept());
  await page.routeWebSocket('**/cloud-art',ws=>{let meta;ws.onMessage(data=>{
    if(typeof data!=='string')return;
    const value=JSON.parse(data);if(!meta){meta=value;return;}
    if(value.type==='submit'){submissions++;ws.send(JSON.stringify({type:'result',request_id:'synthetic-disconnected-42',mime:'image/png'}));disconnect=()=>ws.close();}
  });});
  const p=await imported(page);
  await call(page,'/art/settings','PUT',{api_key:'synthetic-session-receipt-key',relay_url:'wss://synthetic-relay.invalid/cloud-art'});
  const job=await call(page,'/art/titles','POST',{photo_id:p.id});
  await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).request_id).toBe('synthetic-disconnected-42');
  await expect.poll(()=>page.evaluate(async id=>{
    const saved=JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());
    return saved.jobs.find(j=>j.id===id)?.request_id;
  },job.id)).toBe('synthetic-disconnected-42');disconnect();
  await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('failed');
  expect(await call(page,'/jobs/'+job.id)).toMatchObject({billing_state:'unknown',billing_uncertain:true,request_id:'synthetic-disconnected-42'});
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();
  expect(await call(page,'/jobs/'+job.id)).toMatchObject({billing_state:'unknown',request_id:'synthetic-disconnected-42'});
  expect((await call(page,'/art/settings')).configured).toBe(false);expect(submissions).toBe(1);
  await page.locator('.activity-button').click();await page.locator(`[data-task-id="${job.id}"]`).click();
  await expect(page.locator('.activity-detail .cloud-receipt')).toContainText('synthetic-disconnected-42');
  expect(submissions).toBe(1);
});

test('cloud consent, sanitized chunks, local artwork versions and cancellation without paid calls',async({page})=>{
  const received=[],dialogs=[];let submitted=0;
  page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
  await page.routeWebSocket('**/cloud-art',ws=>{let meta,chunks=[];ws.onMessage(data=>{
    if(typeof data!=='string'){expect(data.length).toBeLessThanOrEqual(65536);chunks.push(data);return;}
    const value=JSON.parse(data);if(!meta){meta=value;received.push(meta);return;}if(value.type!=='submit')return;
    submitted++;if(meta.action==='titles')return; // Hold this mock request so the client can cancel it.
    const png=Buffer.concat(chunks);expect(png.length).toBe(meta.image_size);expect(png.includes(Buffer.from('eXIf'))).toBe(false);
    ws.send(JSON.stringify({type:'result',mime:'image/png',seconds:1}));ws.send(png);ws.send(JSON.stringify({type:'done'}));
  });});
  const p=await imported(page);
  await call(page,'/art/settings','PUT',{api_key:'synthetic-session-key',image_model:'qwen-image-3.0',relay_url:'wss://synthetic-relay.invalid/cloud-art'});
  const layout={title:'合成测试',title_source:'manual',title_evidence:'',layout:'airy',font:'chinese_handwriting',paper:.35};
  await expect(call(page,'/art/generate','POST',{photo_id:p.id,quality:'medium',layout})).rejects.toThrow();
  expect(received).toEqual([]);expect(submitted).toBe(0);
  const job=await call(page,'/art/generate','POST',{photo_id:p.id,quality:'medium',layout,title_confirmed:true});
  await expect.poll(async()=>{const saved=await call(page,'/jobs/'+job.id);return saved.status==='failed'?'failed: '+saved.error:saved.status;},{timeout:20000}).toBe('completed');
  const work=(await call(page,'/art/works')).works[0];expect(new URL(work.poster_url).pathname).toMatch(/^\/_pc-file\//);expect(await page.evaluate(async url=>(await fetch(url)).status,work.poster_url)).toBe(200);expect(work.width).toBe(640);expect(work.height).toBe(400);
  expect(dialogs[0]).toContain('synthetic-relay.invalid');expect(dialogs[0]).toContain('qwen-image-3.0');expect(submitted).toBe(1);
  const draft=await call(page,'/art/works/'+work.id+'/watermark','POST');
  await call(page,'/art/works/'+work.id,'PUT',{revision:work.revision,layout:{...layout,title:'新标题'}});
  expect((await call(page,'/watermark/drafts/'+draft.id)).source_revision).toBe(work.revision);
  await expect(call(page,'/art/works/'+work.id,'DELETE')).rejects.toThrow();
  const libraryID=await page.evaluate(async()=>JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text()).id);
  const pending=await call(page,'/art/titles','POST',{photo_id:p.id});await expect.poll(()=>received.length).toBe(2);
  await call(page,'/jobs/'+pending.id+'/cancel','POST');expect((await call(page,'/jobs/'+pending.id)).status).toBe('cancelled');
  // Read a coherent disk snapshot under the same lock used by job cancellation commits.
  await expect.poll(()=>page.evaluate(async id=>navigator.locks.request('photocollection:'+id,async()=>(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text()).includes('synthetic-session-key')),libraryID)).toBe(false);
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/art/settings')).configured).toBe(false);expect((await call(page,'/art/works')).total).toBe(1);
});

test('cancellation during the durable cloud boundary never sends submit or retries on reopen',async({page})=>{
  let uploads=0,submits=0;page.on('dialog',d=>d.accept());
  await page.routeWebSocket('**/cloud-art',ws=>ws.onMessage(data=>{if(typeof data!=='string'){uploads++;return;}if(JSON.parse(data).type==='submit')submits++;}));
  const p=await imported(page);
  const before=await page.evaluate(async()=>{const f=await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))).join(',');});
  await call(page,'/art/settings','PUT',{api_key:'synthetic-boundary-key',relay_url:'wss://synthetic-relay.invalid/cloud-art'});
  await page.evaluate(()=>{
    const write=FileSystemWritableFileStream.prototype.write;window.__boundaryHeld=false;
    FileSystemWritableFileStream.prototype.write=async function(value){
      const text=typeof value==='string'?value:value instanceof Blob?await value.text():null;
      if(!window.__boundaryHeld&&text?.includes('"application":"photocollection-browser"')&&JSON.parse(text).jobs.some(j=>j.billing_state==='submitted')){
        window.__boundaryHeld=true;await new Promise(resolve=>window.__releaseBoundary=resolve);
      }return write.call(this,value);
    };
  });
  const job=await call(page,'/art/titles','POST',{photo_id:p.id});await page.waitForFunction(()=>window.__boundaryHeld);expect(uploads).toBeGreaterThan(0);expect(submits).toBe(0);
  await page.evaluate(({module,id})=>{window.__boundaryCancellation=import(module).then(m=>m.browserAPI('/jobs/'+id+'/cancel','POST'));},{module:apiModule,id:job.id});
  await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('cancelled');expect(submits).toBe(0);
  await page.evaluate(()=>window.__releaseBoundary());await page.evaluate(()=>window.__boundaryCancellation);
  await expect.poll(async()=>(await call(page,'/tasks/resources')).pending).toBe(0);
  const stages=await call(page,'/jobs/'+job.id+'/children');expect(stages.items).toHaveLength(1);expect(stages.items[0].status).toBe('cancelled');
  expect((await call(page,'/jobs/'+job.id)).billing_uncertain).toBe(true);
  const id=(await call(page,'/jobs/'+job.id)).scope.library_id;
  const saved=await page.evaluate(async id=>navigator.locks.request('photocollection:'+id,async()=>JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())),id);
  expect(saved.jobs.find(j=>j.id===job.id).billing_state).toBe('unknown');expect(JSON.stringify(saved)).not.toContain('synthetic-boundary-key');
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/jobs/'+job.id)).status).toBe('cancelled');expect((await call(page,'/art/settings')).key_configured).toBe(false);expect((await call(page,'/tasks/resources')).pending).toBe(0);expect(submits).toBe(0);
  expect(await page.evaluate(async()=>{const f=await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))).join(',');})).toBe(before);
});

test('cloud source hash mismatch fails before opening a socket or sending a photo',async({page})=>{
  const p=await imported(page),sockets=[],dialogs=[];page.on('websocket',socket=>sockets.push(socket.url()));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
  await call(page,'/art/settings','PUT',{api_key:'synthetic-hash-key',relay_url:'wss://synthetic-relay.invalid/cloud-art'});
  // Deliberately change only this isolated synthetic fixture to simulate an externally edited source.
  await page.evaluate(async()=>{const c=new OffscreenCanvas(640,400);c.getContext('2d').fillRect(0,0,640,400);const file=await window.__synthetic.originals.getFileHandle('synthetic.jpg'),stream=await file.createWritable();await stream.write(await c.convertToBlob({type:'image/jpeg'}));await stream.close();});
  const job=await call(page,'/art/titles','POST',{photo_id:p.id});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('failed');
  expect((await call(page,'/jobs/'+job.id)).error).toContain('source photo changed');expect((await call(page,'/jobs/'+job.id)).billing_state).toBe('not_submitted');expect(sockets).toEqual([]);expect(dialogs).toEqual([]);expect((await call(page,'/art/works')).total).toBe(0);
});



test('browser capability checks separate session key, relay and permission without uploads',async({page})=>{
  const sockets=[],posts=[];page.on('websocket',ws=>sockets.push(ws.url()));page.on('request',r=>{if(r.method()!=='GET')posts.push(r.url());});
  await open(page);await call(page,'/art/settings','PUT',{api_key:'synthetic-session-key-only',relay_url:''});await navigate(page,'设置');
  const panel=page.locator('.capability-panel');await panel.locator('summary').click();await expect(panel.locator('[data-capability]')).toHaveCount(11);
  await expect(panel.locator('[data-capability=semantic]')).toHaveAttribute('data-state','unavailable');await expect(panel.locator('[data-capability=watercolor]')).toHaveAttribute('data-runnable','false');
  await call(page,'/art/settings','PUT',{relay_url:'ws://127.0.0.1:9000/cloud-art'});await panel.getByRole('button',{name:'刷新状态',exact:true}).click();
  await expect(panel.locator('[data-capability=watercolor]')).toHaveAttribute('data-state','degraded');await expect(panel.locator('[data-capability=watercolor]')).toHaveAttribute('data-runnable','true');
  await page.evaluate(()=>localStorage.setItem('deny-library','1'));await panel.getByRole('button',{name:'刷新状态',exact:true}).click();await expect(panel.locator('[data-capability=library]')).toHaveAttribute('data-runnable','false');
  await panel.locator('[data-capability=semantic]').getByRole('button',{name:'查看本机版说明'}).click();await expect(panel.locator('.capability-help')).toBeVisible();
  expect(sockets).toEqual([]);expect(posts).toEqual([]);
  expect(await page.evaluate(()=>Object.values(localStorage).join(' '))).not.toContain('synthetic-session-key-only');
});


test('draft and export metadata stays lazy, active previews survive eviction and old download sessions expire',async({page})=>{
  test.setTimeout(60000);const p=await imported(page);
  const before=await page.evaluate(async()=>{const f=await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].join(',');});
  const base=await call(page,'/watermark/drafts','POST',{photo_id:p.id,settings_json:{long_edge:200,format:'png'}}),job=await call(page,'/watermark/drafts/batch-export','POST',{draft_ids:[base.id]});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');
  const result=(await call(page,'/jobs/'+job.id)).results[0];
  const expected=await page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].join(','),result.url);
  await navigate(page,'设置');
  await page.evaluate(async({base,jobId})=>{
    const data=window.__synthetic.data,h=await data.getFileHandle('library.json'),s=JSON.parse(await(await h.getFile()).text()),folder=await data.getDirectoryHandle('drafts'),source=await(await(await folder.getDirectoryHandle(base.id)).getFileHandle('preview-1.webp')).getFile();
    const template=s.drafts.find(d=>d.id===base.id);s.drafts=[];
    for(let i=0;i<360;i++){
      const id='memory-draft-'+i,d=await folder.getDirectoryHandle(id,{create:true}),w=await(await d.getFileHandle('preview-1.webp',{create:true})).createWritable();await w.write(source);await w.close();s.drafts.push({...structuredClone(template),id,name:'memory '+i,preview_file:`drafts/${id}/preview-1.webp`});
    }
    const completed=s.jobs.find(j=>j.id===jobId);s.jobs=Array.from({length:30},(_,i)=>({...structuredClone(completed),id:'history-'+i,parent_id:undefined,child_count:0,active_child_id:null,results:Array.from({length:30},()=>({...completed.results[0],url:''}))}));
    const stream=await h.createWritable();await stream.write(JSON.stringify(s));await stream.close();
  },{base,jobId:job.id});
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(async module=>{
    (await import(module)).clearPhotoMedia();window.__assetLive=new Set();window.__assetCreates=0;window.__assetReads=0;
    const create=URL.createObjectURL,revoke=URL.revokeObjectURL,read=FileSystemFileHandle.prototype.getFile;
    URL.createObjectURL=function(...args){const url=create.apply(this,args);window.__assetCreates++;window.__assetLive.add(url);return url;};
    URL.revokeObjectURL=function(url){window.__assetLive.delete(url);return revoke.call(this,url);};
    FileSystemFileHandle.prototype.getFile=function(...args){if(/\.(webp|png|jpg)$/.test(this.name))window.__assetReads++;return read.apply(this,args);};
  },mediaModule);
  const all=[...(await call(page,'/watermark/drafts?page_size=200&page=1')).drafts,...(await call(page,'/watermark/drafts?page_size=200&page=2')).drafts];expect(all).toHaveLength(360);expect(all.every(d=>d.preview_url.includes('/_pc-file/'))).toBe(true);
  const history=await call(page,'/jobs');expect(history.flatMap(j=>j.results)).toHaveLength(900);expect(await page.evaluate(()=>({reads:window.__assetReads,creates:window.__assetCreates}))).toEqual({reads:0,creates:0});
  await navigate(page,'水印图库');const image=page.locator('.draft-image img').first();await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);const visibleURL=await image.getAttribute('src');
  const stats=await page.evaluate(async({module,urls})=>{const {photoMediaPool}=await import(module);for(const url of urls){const lease=photoMediaPool.acquire(url,20);await lease.ready;lease.release();}return {...photoMediaPool.snapshot(),live:window.__assetLive.size};},{module:mediaModule,urls:all.map(d=>d.preview_url)});
  expect(stats.entries).toBeLessThanOrEqual(256);expect(stats.bytes).toBeLessThanOrEqual(96*1024*1024);expect(stats.live).toBeLessThanOrEqual(256);expect(await page.evaluate(url=>window.__assetLive.has(url),visibleURL)).toBe(true);expect(await image.evaluate(async img=>(await fetch(img.src)).ok)).toBe(true);
  const old=history[0].results[0].url;await navigate(page,'设置');await page.evaluate(async module=>(await import(module)).clearPhotoMedia(),mediaModule);
  expect(await page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].join(','),old)).toBe(expected);
  expect(await page.evaluate(async()=>{for(const name of await caches.keys())if((await(await caches.open(name)).keys()).some(r=>r.url.includes('/_pc-file/')))return false;return true;})).toBe(true);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'打开本地图库或备份',exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__assetLive.size)).toBe(0);
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();expect(await page.evaluate(async url=>(await fetch(url)).status,old)).toBe(409);
  const fresh=(await call(page,'/jobs/history-0')).results[0].url;expect(fresh).not.toBe(old);expect(await page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].join(','),fresh)).toBe(expected);
  expect(await page.evaluate(async()=>{const f=await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].join(',');})).toBe(before);
});

test.describe('local files without an offline worker',()=>{
  test.use({serviceWorkers:'block'});
  test('draft previews and explicit downloads still use local files with the offline worker disabled',async({page})=>{
    const p=await imported(page);await expect.poll(async()=>(await call(page,'/tasks/resources')).pending).toBe(0);const draft=await call(page,'/watermark/drafts','POST',{photo_id:p.id,settings_json:{long_edge:200,format:'png'}}),job=await call(page,'/watermark/drafts/batch-export','POST',{draft_ids:[draft.id]});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');
    const result=(await call(page,'/jobs/'+job.id)).results[0],expected=await page.evaluate(async path=>{const [folder,name]=path.split('/'),f=await(await(await window.__synthetic.data.getDirectoryHandle(folder)).getFileHandle(name)).getFile();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');},result.path);
    expect(await page.evaluate(()=>navigator.serviceWorker.controller)).toBe(null);await navigate(page,'水印图库');await expect.poll(()=>page.locator('.draft-image img').first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    await page.getByRole('button',{name:'活动中心',exact:true}).click();const center=page.getByRole('dialog',{name:'活动中心',exact:true});await center.locator(`[data-task-id="${job.id}"]`).click();const downloaded=page.waitForEvent('download');await center.getByRole('link',{name:result.file_name,exact:true}).click();const file=await downloaded;expect(file.suggestedFilename()).toBe(result.file_name);expect(createHash('sha256').update((await import('node:fs')).readFileSync(await file.path())).digest('hex')).toBe(expected);
  });
});


test('recent export can open a local result in a new tab',async({page,context})=>{
  const p=await imported(page),draft=await call(page,'/watermark/drafts','POST',{photo_id:p.id,settings_json:{long_edge:200,format:'png'}}),result=await call(page,'/watermark/drafts/'+draft.id+'/export','POST',{});
  await page.evaluate(url=>localStorage.setItem('recent-ops',JSON.stringify([{kind:'export',label:'Open synthetic recent export',time:Date.now(),payload:{urls:[url]}}])),result.url);
  await page.getByRole('button',{name:'最近操作',exact:true}).click();const opened=context.waitForEvent('page');await page.locator('.recent-item').filter({hasText:'Open synthetic recent export'}).click();const popup=await opened;await expect.poll(()=>popup.url().startsWith('blob:')).toBe(true);
  await expect.poll(()=>popup.locator('img').evaluateAll(images=>images.length===1&&images[0].complete&&images[0].naturalWidth>0)).toBe(true);
});


test('recent exports survive reload and task history cleanup but cannot open from another library',async({page,context})=>{
  const p=await imported(page),draft=await call(page,'/watermark/drafts','POST',{photo_id:p.id,settings_json:{long_edge:200,format:'png'}}),job=await call(page,'/watermark/drafts/batch-export','POST',{draft_ids:[draft.id]});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');const done=await call(page,'/jobs/'+job.id),result=done.results[0];
  const expected=await page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].join(','),result.url);
  await page.evaluate(({job,result})=>localStorage.setItem('recent-ops',JSON.stringify([{kind:'export',label:'Stable recent export',time:Date.now(),payload:{libraryId:job.scope.library_id,job:'expired-history',file:{path:result.path,name:result.file_name}}}])),{job:done,result});
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();await page.getByRole('button',{name:'最近操作',exact:true}).click();const opened=context.waitForEvent('page');await page.locator('.recent-item').filter({hasText:'Stable recent export'}).click();const popup=await opened;await expect.poll(()=>popup.url().startsWith('blob:')).toBe(true);await expect.poll(()=>popup.locator('img').evaluateAll(images=>images.length===1&&images[0].naturalWidth>0)).toBe(true);
  expect(await popup.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(location.href)).arrayBuffer()))].join(','))).toBe(expected);expect(await popup.evaluate(()=>opener===null)).toBe(true);await popup.close();
  await navigate(page,'设置');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await page.evaluate(()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('recent-other-library',{create:true});});await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  await page.getByRole('button',{name:'最近操作',exact:true}).click();const blocked=context.waitForEvent('page');await page.locator('.recent-item').filter({hasText:'Stable recent export'}).click();const blank=await blocked;await expect.poll(()=>blank.isClosed()).toBe(true);await expect(page.getByText('此导出属于其他图库，请先打开对应图库。',{exact:true})).toBeVisible();
});


test('completed gallery batch exports record stable recent metadata and reopen the first file',async({page,context})=>{
  const p=await imported(page),draft=await call(page,'/watermark/drafts','POST',{photo_id:p.id,settings_json:{long_edge:200,format:'png'}});await call(page,'/watermark/drafts/'+draft.id+'/duplicate','POST');
  await navigate(page,'水印图库');await expect(page.locator('.draft-card')).toHaveCount(2);await page.getByRole('button',{name:'选择本页',exact:true}).click();await page.getByRole('button',{name:'批量导出',exact:true}).click();await page.getByRole('button',{name:'确认导出',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('recent-ops')||'[]').some(item=>item.kind==='export'))).toBe(true);
  const entry=await page.evaluate(()=>JSON.parse(localStorage.getItem('recent-ops')).find(item=>item.kind==='export'));expect(entry.payload.libraryId).toBeTruthy();expect(entry.payload.file.path).toMatch(/^exports\//);expect(entry.payload.file.name).toMatch(/\.png$/);expect(JSON.stringify(entry)).not.toMatch(/blob:|_pc-file|pc_session/);
  const job=await call(page,'/jobs/'+entry.payload.job);expect(job.status).toBe('completed');expect(job.results).toHaveLength(2);expect(entry.payload.file.path).toBe(job.results[0].path);
  await page.getByRole('button',{name:'最近操作',exact:true}).click();const opened=context.waitForEvent('page');await page.locator('.recent-item').filter({hasText:entry.label}).click();const popup=await opened;await expect.poll(()=>popup.url().startsWith('blob:')).toBe(true);await expect.poll(()=>popup.locator('img').evaluateAll(images=>images.length===1&&images[0].naturalWidth>0)).toBe(true);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser manual notes and tag decisions survive a relabel ${width} ${lang}`,async({page},info)=>{
  const photo=await imported(page),url='/photos/'+photo.id,getPhoto=()=>call(page,url),annotate=async(caption,tags)=>{const p=await getPhoto();return call(page,url+'/annotation','POST',{version:1,source_hash:p.file_hash,expected_revision:p.annotation?.revision||0,caption,tags,provider:'synthetic-local',model:'fixture-v1',detected_text:'TEST ONLY'});};
  const hash=()=>page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(',')),before=await hash();await call(page,url,'PATCH',{tags:['Manual'],favorite:true,rating:0,color_label:'blue',flag:'picked'});await annotate('First AI',['山','溪']);
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1300});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/?page=photos');await page.reload();
  await exercisePhotoAnnotations(page,{lang,photo,getPhoto,relabel:()=>annotate('Second AI',['山','溪','云']),failNext:()=>page.evaluate(()=>{const proto=FileSystemFileHandle.prototype,original=proto.createWritable;proto.createWritable=function(...args){if(this.name==='library.json'){proto.createWritable=original;return Promise.reject(new DOMException('Synthetic note save failure','QuotaExceededError'));}return original.apply(this,args);};}),error:lang==='en'?'Storage is full':'可用存储空间不足',screenshot:info.outputPath('photo-annotations.png')});const p=await getPhoto();expect([p.favorite,p.rating,p.color_label,p.flag]).toEqual([true,0,'blue','picked']);expect(await hash()).toBe(before);
});

test('format7 annotation upgrade preserves manual legacy tags, exact bytes and revision guards',async({page})=>{
  page.on('dialog',d=>d.accept());const p=await imported(page),url='/photos/'+p.id;await call(page,url,'PATCH',{tags:['Legacy manual']});await closeForOrdering(page);
  const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=7;for(const p of m.photos)for(const key of ['user_description','annotation','tag_origins','rejected_ai_tags'])delete p[key];const text=JSON.stringify(m,null,2),w=await h.createWritable();await w.write(text);await w.close();return text;});
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,url)).tag_origins).toEqual({'Legacy manual':'user'});
  const failed=await page.evaluate(async({module,path})=>{const proto=FileSystemDirectoryHandle.prototype,original=proto.getFileHandle;proto.getFileHandle=function(name,...args){if(name.startsWith('library.before-annotations-v8-'))return Promise.reject(new DOMException('Synthetic annotation backup failure','QuotaExceededError'));return original.call(this,name,...args);};try{await(await import(module)).browserAPI(path,'PATCH',{user_description:''});return false;}catch{return true;}finally{proto.getFileHandle=original;}},{module:apiModule,path:url});expect(failed).toBe(true);expect((await call(page,url)).user_description).toBe(null);expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(old);
  await call(page,url,'PATCH',{user_description:''});const upgraded=await page.evaluate(async()=>{const backups=[];for await(const f of window.__synthetic.data.values())if(f.name.startsWith('library.before-annotations-v8-'))backups.push(await(await f.getFile()).text());return {backups,m:JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())};});expect(upgraded.backups).toEqual([old]);expect(upgraded.m.version).toBe(24);
  // Playwright's value deserializer drops an own __proto__ property; JSON bytes preserve tag names.
  const jsonCall=async(path,method='GET',body)=>JSON.parse(await page.evaluate(async args=>JSON.stringify(await(await import(args.module)).browserAPI(args.path,args.method,args.body)),{module:apiModule,path,method,body}));
  const contract=JSON.parse(readFileSync(new URL('./fixtures/annotation-contract.json',import.meta.url),'utf8'));let current=await jsonCall(url,'PATCH',contract.initial);
  for(const step of contract.steps){current=step.ai?await jsonCall(url+'/annotation','POST',{version:1,source_hash:p.file_hash,expected_revision:current.annotation?.revision||0,provider:'synthetic-local',model:'fixture-v1',...step.ai}):await jsonCall(url,'PATCH',step.manual);expect(current.tag_origins).toEqual(step.origins);expect(current.rejected_ai_tags).toEqual(['Legacy manual',...step.rejected].sort());expect([current.description,current.description_source]).toEqual([step.description,step.source]);}
  const body={version:1,source_hash:p.file_hash,expected_revision:current.annotation.revision,provider:'fixture',model:'v1',caption:'Stale',tags:[]};for(const change of [{expected_revision:0},{source_hash:'0'.repeat(64)},{version:2},{tags:[1]},{api_key:'never-persist'}])await expect(call(page,url+'/annotation','POST',{...body,...change})).rejects.toThrow();expect(await jsonCall(url)).toEqual(current);
  const longName='旧'.repeat(150),names=[longName,...Array.from({length:199},(_,i)=>'tag-'+i)];let long=await jsonCall(url,'PATCH',{tags:names});expect(new Set(long.tags)).toEqual(new Set(names));long=await jsonCall(url+'/annotation','POST',{version:1,source_hash:p.file_hash,expected_revision:long.annotation.revision,provider:'fixture',model:'v1',caption:'Long tags retained',tags:['旧'.repeat(100)]});expect(long.tag_origins[longName]).toBe('user');long=await jsonCall(url,'PATCH',{remove_tags:[longName]});expect(long.tags).not.toContain(longName);expect(long.rejected_ai_tags).toContain(longName);long=await jsonCall(url,'PATCH',{add_tags:[longName]});expect(long.tag_origins[longName]).toBe('user');expect(long.rejected_ai_tags).not.toContain(longName);
  const manifest=await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());await closeForOrdering(page);
  for(const kind of ['future','old','origin','revision','rejected']){const bytes=await page.evaluate(async({manifest,kind})=>{const m=JSON.parse(manifest),p=m.photos[0];if(kind==='future')m.version=99;else if(kind==='old')m.version=7;else if(kind==='origin')p.tag_origins[p.tags[0]]='external';else if(kind==='revision')p.annotation.revision=0;else p.rejected_ai_tags=[p.tags[0]];const bytes=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(bytes);await w.close();return bytes;},{manifest,kind});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();if(kind!=='future')await expect(page.getByRole('alert')).toContainText('照片描述或标签来源记录无效');expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bytes);}
});


test('lifecycle batch preserves removed metadata and restores after handle-cache loss offline',async({page,context})=>{
  page.on('dialog',d=>d.accept());const p=await imported(page);
  const originalHash=()=>page.evaluate(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))).join(','));
  const before=await originalHash(),location=await call(page,'/locations/photos/'+p.id);
  const manual={latitude:30.25,longitude:120.15,country:'中国',city:'杭州',label:'西湖',accuracy_m:20};
  await call(page,'/locations/photos/'+p.id,'PUT',{source_hash:location.source_hash,expected_revision:0,operation:'set',value:manual});
  const album=await call(page,'/albums','POST',{name:'Lifecycle retained',photo_ids:[p.id]});
  await call(page,'/photos/'+p.id,'DELETE');expect((await call(page,'/photos')).total).toBe(0);expect((await call(page,'/locations/map')).total).toBe(0);
  expect((await call(page,'/removals/photos')).items[0].id).toBe(p.id);
  const graph=await call(page,'/assets/graph?kind=photo&id='+p.id);expect(graph.nodes.find(n=>n.id===p.id).removed).toBe(true);
  await closeForOrdering(page);
  await page.evaluate(async()=>{for(const {name} of await indexedDB.databases())if(name)await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Synthetic handle cache remained open'));});window.showDirectoryPicker=async()=>window.__synthetic.data;});
  await context.setOffline(true);
  try{
    await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
    expect((await call(page,'/removals/photos')).total).toBe(1);
    await call(page,'/removals/photos/restore','POST',{ids:[p.id]});expect((await call(page,'/photos?album_id='+album.id)).photos[0].id).toBe(p.id);
    expect((await call(page,'/locations/photos/'+p.id)).effective.city).toBe('杭州');expect((await call(page,'/locations/map')).located).toBe(1);
    await navigate(page,'设置');await page.evaluate(()=>{window.showDirectoryPicker=async()=>window.__synthetic.originals;});await page.getByRole('button',{name:'重新选择并授权',exact:true}).first().click();await expect.poll(async()=>(await call(page,'/photos/'+p.id)).missing).toBe(false);
    expect(await originalHash()).toBe(before);
  }finally{await context.setOffline(false);}
});

test('lifecycle batch quarantines orphan outputs while retaining source snapshots and conflicts',async({page})=>{
  await imported(page);const record=await page.evaluate(async()=>{
    const id=crypto.randomUUID(),parent=await window.__synthetic.data.getDirectoryHandle('drafts',{create:true}),splits=await parent.getDirectoryHandle('splits',{create:true}),folder=await splits.getDirectoryHandle(id,{create:true});
    for(const [name,data] of [['panel-01.png','orphan panel'],['source.bin','protected snapshot']]){const w=await(await folder.getFileHandle(name,{create:true})).createWritable();await w.write(data);await w.close();}
    return {id,path:`drafts/splits/${id}/panel-01.png`};
  });
  const candidates=await call(page,'/removals/derived');expect(candidates.items.some(p=>p.path.endsWith('source.bin'))).toBe(false);const item=candidates.items.find(p=>p.path===record.path);expect(item).toBeTruthy();
  const batch=await call(page,'/removals/derived','POST',{items:[item]});
  expect(await page.evaluate(async id=>{const folder=await(await(await window.__synthetic.data.getDirectoryHandle('drafts')).getDirectoryHandle('splits')).getDirectoryHandle(id);return(await(await folder.getFileHandle('source.bin')).getFile()).text();},record.id)).toBe('protected snapshot');
  await call(page,'/removals/derived/'+batch.id+'/restore','POST');
  expect((await call(page,'/removals/derived/history')).items.find(r=>r.id===batch.id).state).toBe('restored');
  expect((await call(page,'/removals/derived')).items.find(p=>p.path===record.path).sha256).toBe(item.sha256);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`lifecycle batch offline map and location controls ${width} ${lang}`,async({page},info)=>{
  const p=await imported(page),record=await call(page,'/locations/photos/'+p.id);
  await call(page,'/locations/photos/'+p.id,'PUT',{source_hash:record.source_hash,expected_revision:0,operation:'set',value:{latitude:30,longitude:120,country:'China',city:'Hangzhou',label:'Lake',accuracy_m:100}});
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);
  await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/?page=locations');await page.reload();
  await expect(page.locator('.locations-page')).toBeVisible();await page.getByRole('button',{name:lang==='zh'?'进阶设置':'Advanced settings',exact:true}).click();await page.locator('.map-other-styles > summary').click();await page.getByRole('button',{name:lang==='zh'?'轮廓地图':'Outline map',exact:true}).click();await expect(page.locator('.map-cluster')).toHaveCount(1);await expect.poll(()=>page.locator('.photo-map svg path').count()).toBeGreaterThan(1);
  const world=await page.locator('.photo-map svg').getAttribute('viewBox');await page.locator('.photo-map').focus();await page.keyboard.press('+');await expect(page.locator('.photo-map svg')).not.toHaveAttribute('viewBox',world);const zoomed=await page.locator('.photo-map svg').getAttribute('viewBox');await page.keyboard.press('ArrowRight');await expect(page.locator('.photo-map svg')).not.toHaveAttribute('viewBox',zoomed);await page.getByRole('button',{name:lang==='zh'?'全世界':'Whole world',exact:true}).click();await expect(page.locator('.photo-map svg')).toHaveAttribute('viewBox',world);
  await expect(page.locator('.map-cluster')).toHaveCount(1);await page.screenshot({path:info.outputPath('lifecycle-map.png'),fullPage:true});
});



for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`map task guidance and coordinate validation ${width} ${lang}`,async({page},info)=>{
  await open(page);
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);
  await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/?page=locations');await page.reload();
  const guide=page.locator('.map-task-guide');await expect(guide).toHaveAttribute('data-state','import');
  await expect(guide.getByRole('button',{name:lang==='zh'?'导入照片':'Import photos',exact:true})).toBeVisible();
  const pick=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:pick.paths});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');
  const photo=(await call(page,'/photos')).photos[0],hash=()=>page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(',')),before=await hash();
  await page.reload();await exerciseLocationGuidance(page,{lang,photo,readLocation:()=>call(page,'/locations/photos/'+photo.id),screenshot:info.outputPath('location-guidance.png')});
  await page.goto('/#/?page=locations');await expect(page.locator('.map-task-guide')).toHaveCount(0);expect((await call(page,'/locations/map')).located).toBe(1);expect(await hash()).toBe(before);
});

test('lifecycle batch publishes only selected derived pixels without linked private sources',async({page})=>{
  page.on('dialog',d=>d.accept());const p=await imported(page);await closeForOrdering(page);
  await page.evaluate(async photo=>{
    const data=window.__synthetic.data,id=crypto.randomUUID(),root=await data.getDirectoryHandle('works',{create:true}),work=await root.getDirectoryHandle(id,{create:true}),canvas=document.createElement('canvas');canvas.width=40;canvas.height=30;canvas.getContext('2d').fillRect(0,0,40,30);
    for(const [name,type] of [['poster-1.png','image/png'],['preview-1.webp','image/webp']]){const blob=await new Promise(resolve=>canvas.toBlob(resolve,type)),writer=await(await work.getFileHandle(name,{create:true})).createWritable();await writer.write(blob);await writer.close();}
    const handle=await data.getFileHandle('library.json'),m=JSON.parse(await(await handle.getFile()).text());m.works=[{id,photo_id:photo.id,source:{file_name:'private-source-location.jpg',width:40,height:30},layout:{title:'private title',title_source:'manual',title_evidence:'private prompt',layout:'airy',font:'',paper:1},generation:{model:'synthetic-no-network',seconds:0},width:40,height:30,revision:1}];m.revision++;
    const writer=await handle.createWritable();await writer.write(JSON.stringify(m));await writer.close();window.showDirectoryPicker=async()=>data;
  },p);
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  expect((await call(page,'/art/works')).total).toBe(1);
  await page.getByRole('button',{name:'导出公开作品',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导出公开作品',exact:true});
  await dialog.getByLabel('作品来源',{exact:true}).selectOption('watercolor');await expect(dialog.locator('.curation-choices button')).toHaveCount(1);await expect(dialog.locator('.curation-choices button')).toHaveAttribute('aria-pressed','false');await dialog.locator('.curation-choices button').click();
  await page.evaluate(async()=>{window.__derivedPublic=await window.__synthetic.root.getDirectoryHandle('derived-public',{create:true});window.showDirectoryPicker=async()=>window.__derivedPublic;});
  await dialog.getByRole('button',{name:'选择目录并导出公开内容',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('公开内容已导出');
  const result=await page.evaluate(async()=>{for await(const folder of window.__derivedPublic.values()){const portfolio=await folder.getDirectoryHandle('portfolio'),text=await(await(await portfolio.getFileHandle('manifest.json')).getFile()).text(),images=await portfolio.getDirectoryHandle('images');let count=0;for await(const file of images.values()){if(file.kind!=='file'||!file.name.endsWith('.jpg'))throw new Error('Unexpected public asset');count++;}return {text,count};}});
  expect(JSON.parse(result.text).photos).toHaveLength(1);expect(result.count).toBeGreaterThan(0);expect(result.text).not.toMatch(/private|synthetic|photo_id|file_path|gps_|generation|source|recipe|prompt/);
});


test('lifecycle batch foreground scans require grants and never revive removed content',async({page})=>{
  await imported(page);const status=await call(page,'/library/scan'),source=status.available[0];expect(status.paths).toEqual([]);
  await call(page,'/library/scan','PUT',{source_id:source.id,enabled:true});
  const first=await call(page,'/library/scan?force=true','POST');expect(first.job).toBeTruthy();await expect.poll(async()=>(await call(page,'/jobs/'+first.job.id)).status).toBe('completed');expect((await call(page,'/photos')).total).toBe(1);
  await page.evaluate(()=>localStorage.setItem('deny-library','1'));
  const denied=await call(page,'/library/scan?force=true','POST');expect(denied.sources[0].state).toBe('permission');
  await page.evaluate(()=>localStorage.removeItem('deny-library'));const p=(await call(page,'/photos')).photos[0];await call(page,'/photos/'+p.id,'DELETE');
  const next=await call(page,'/library/scan?force=true','POST');await expect.poll(async()=>(await call(page,'/jobs/'+next.job.id)).status).toBe('completed');expect((await call(page,'/photos')).total).toBe(0);expect((await call(page,'/removals/photos')).items[0].id).toBe(p.id);
  await call(page,'/library/scan','PUT',{source_id:source.id,enabled:false});
});


test('creation preservation batch exports independent drafts, continues failures and resets edited status',async({page})=>{
  page.on('dialog',d=>d.accept());const p=await imported(page);
  const create=options=>call(page,'/watermark/drafts','POST',{photo_id:p.id,settings_json:{style:'classic_frame',fields:[],long_edge:300,format:'png',...options}});
  const bad=await create({theme:'white'}),a=await create({theme:'white',filename_template:'{index}_white'}),b=await create({theme:'black',filename_template:'{index}_black'});
  await closeForOrdering(page);
  const before=await page.evaluate(async id=>{
    const handle=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await handle.getFile()).text());m.drafts.find(d=>d.id===id).source.file_hash='0'.repeat(64);m.revision++;
    const writer=await handle.createWritable();await writer.write(JSON.stringify(m));await writer.close();window.showDirectoryPicker=async()=>window.__synthetic.data;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(',');
  },bad.id);
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const job=await call(page,'/watermark/drafts/batch-export','POST',{draft_ids:[bad.id,a.id,b.id,a.id]});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');
  const result=await call(page,'/jobs/'+job.id);expect(result).toMatchObject({total:3,processed:3,success:2,failed:1});expect(result.results.map(r=>r.file_name)).toEqual(['002_white.png','003_black.png']);
  const pixels=await page.evaluate(async paths=>{const values=[];for(const path of paths){let folder=window.__synthetic.data;const parts=path.split('/');for(const part of parts.slice(0,-1))folder=await folder.getDirectoryHandle(part);const bitmap=await createImageBitmap(await(await folder.getFileHandle(parts.at(-1))).getFile()),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);values.push([...ctx.getImageData(0,0,1,1).data].slice(0,3).reduce((a,b)=>a+b,0));bitmap.close();}return values;},result.results.map(r=>r.path));expect(pixels[0]).toBeGreaterThan(pixels[1]+300);
  const saved=await call(page,'/watermark/drafts/'+a.id);expect(saved.modified_since_export).toBe(false);
  const edited=await call(page,'/watermark/drafts/'+a.id,'PUT',{revision:saved.revision,settings_json:{...saved.settings_json,quality:80}});expect(edited.status).toBe('draft');expect(edited.modified_since_export).toBe(true);
  expect(await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(','))).toBe(before);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser satellite map isolates Google and keeps original photos private ${width} ${lang}`,async({page},info)=>{
  const probe=await installSatelliteSDK(page),photo=await imported(page),record=await call(page,'/locations/photos/'+photo.id);
  await call(page,'/locations/photos/'+photo.id,'PUT',{source_hash:record.source_hash,expected_revision:0,operation:'set',value:{latitude:30,longitude:120,country:'China',city:'Hangzhou',label:'Lake',accuracy_m:100}});
  const hash=()=>page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(',')),before=await hash();
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);
  await page.setViewportSize({width,height:1000});await page.goto('/#/?page=locations');await page.reload();
  await exerciseSatelliteMap(page,probe,info,lang);
  expect(await hash()).toBe(before);
  const library=await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());
  expect(library).not.toContain(syntheticMapKey);expect(library).not.toContain('photo-google-maps-key-v1');
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser NASA satellite keeps the whole Earth and photos available offline ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(90000);const probe=await installOfflineEarthProbe(page),photo=await imported(page),record=await call(page,'/locations/photos/'+photo.id);
  await call(page,'/locations/photos/'+photo.id,'PUT',{source_hash:record.source_hash,expected_revision:0,operation:'set',value:{latitude:30,longitude:120,country:'China',city:'Hangzhou',label:'Lake',accuracy_m:100}});
  const hash=()=>page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(',')),before=await hash();
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1000});await page.goto('/#/?page=locations');await page.reload();
  await exerciseOfflineEarth(page,probe,info,lang,{checkOfflineCache:true});expect(await hash()).toBe(before);
});


test('browser offline satellite expands a real photo cluster into individual local previews',async({page},info)=>{
  page.on('dialog',dialog=>dialog.accept());const probe=await installOfflineEarthProbe(page),base=await imported(page);
  const hash=()=>page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(',')),before=await hash();
  await closeForOrdering(page);
  await page.evaluate(async base=>{
    const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());
    m.photos=['earth-a','earth-b'].map((id,i)=>({...base,id,file_name:`Earth-${i+1}.jpg`,capture_group_id:id,files:base.files.map(file=>({...file,id,file_name:`Earth-${i+1}.jpg`}))}));m.revision++;
    const photos=await window.__synthetic.data.getDirectoryHandle('photos');
    for(const suffix of ['-thumb.jpg','-preview.jpg']){const file=await(await photos.getFileHandle(base.id+suffix)).getFile();for(const id of ['earth-a','earth-b']){const out=await(await photos.getFileHandle(id+suffix,{create:true})).createWritable();await out.write(file);await out.close();}}
    const writer=await h.createWritable();await writer.write(JSON.stringify(m));await writer.close();window.showDirectoryPicker=async()=>window.__synthetic.data;
  },base);
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  for(const id of ['earth-a','earth-b']){const record=await call(page,'/locations/photos/'+id);await call(page,'/locations/photos/'+id,'PUT',{source_hash:record.source_hash,expected_revision:0,operation:'set',value:{latitude:30,longitude:120,country:'China',city:'Hangzhou',label:'Lake',accuracy_m:100}});}
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/?page=locations');await page.reload();await page.getByRole('button',{name:'地图',exact:true}).click();
  const pin=page.locator('.satellite-photo-pin');await expect(pin).toHaveCount(1);await expect(pin).toContainText('2');await pin.hover();await expect(page.locator('.map-photo-fan button')).toHaveCount(2);
  for(const img of await page.locator('.map-photo-fan button img').all())await expect.poll(()=>img.evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);
  await assertMapPhotoFan(page);await page.locator('.leaflet-satellite-map').screenshot({path:info.outputPath('nasa-cluster-fan.png')});
  await page.locator('.map-photo-fan button').last().click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(probe.external).toEqual([]);expect(await hash()).toBe(before);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser regional Leaflet loads viewport tiles and recovers without exposing photos ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(90000);const probe=await installRegionalTiles(page),photo=await imported(page),record=await call(page,'/locations/photos/'+photo.id);
  await call(page,'/locations/photos/'+photo.id,'PUT',{source_hash:record.source_hash,expected_revision:0,operation:'set',value:{latitude:30,longitude:120,country:'China',city:'Hangzhou',label:'Lake',accuracy_m:100}});
  const hash=()=>page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle('synthetic.jpg')).getFile()).arrayBuffer()))].join(',')),before=await hash();
  await page.evaluate(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1000});await page.goto('/#/?page=locations');await page.reload();
  await exerciseRegionalSatellite(page,probe,info,lang,{failures:lang==='zh'});expect(await hash()).toBe(before);
  const library=await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());expect(library).not.toContain(syntheticArcGISKey);expect(library).not.toContain(syntheticMapTilerKey);
});
