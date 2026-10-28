import {navigateWorkspace} from './fixtures/workspace-navigation.mjs';
import {exerciseCollagePresets} from './fixtures/collage-presets-ui.mjs';
import {browserApiModule} from './fixtures/browser-api-module.mjs';
import {exerciseDepthUI} from './fixtures/vision-depth-ui.mjs';
import {exerciseVisionUI} from './fixtures/vision-ui.mjs';
import {exerciseFrameV2,exerciseVideoPlayer} from './fixtures/media-frame-ui.mjs';
import {execFileSync} from 'node:child_process';
import {exerciseCollageOutput} from './fixtures/collage-output-ui.mjs';
import {exerciseCollageTen} from './fixtures/collage-ten-ui.mjs';
import {exerciseCollageProject} from './fixtures/collage-project-ui.mjs';
import {exerciseBlendWorker,exerciseBlendUI} from './fixtures/collage-blend-ui.mjs';
import {installBatchProbe,exerciseCollageBatch,exerciseBatchTransfer,exerciseBatchGallery} from './fixtures/collage-batch-ui.mjs';
import {exerciseCollageInteraction} from './fixtures/collage-interaction-ui.mjs';
import {exerciseCollageUI,installCollageProbe,exerciseGalleryCollage} from './fixtures/collage-ui.mjs';
import {exerciseCollageWorker} from './fixtures/collage-worker.mjs';
import {exerciseLutFolds} from './fixtures/lut-fold-ui.mjs';
import {exerciseLutBandWorker} from './fixtures/lut-band-worker.mjs';
import {installLutPerformanceProbe,exerciseLutPerformance} from './fixtures/lut-performance-ui.mjs';
import {exerciseLutManagement,exerciseLargeLutTree} from './fixtures/lut-management-ui.mjs';
import {exerciseLutConvenience} from './fixtures/lut-convenience-ui.mjs';
import {exerciseLutCopy} from './fixtures/lut-copy-ui.mjs';
import {exerciseLutFolders} from './fixtures/lut-folders-ui.mjs';
import {exerciseLutBrowse} from './fixtures/lut-browse-ui.mjs';
import {exerciseOverlayUI} from './fixtures/overlay-ui.mjs';
import {exerciseLutUI,invertCube} from './fixtures/lut-ui.mjs';
import {exerciseLutWorker} from './fixtures/lut-worker.mjs';
import {exerciseLutErrors} from './fixtures/lut-errors.mjs';
import {exerciseTextUI} from './fixtures/text-ui.mjs';
import {exerciseTextWorker} from './fixtures/text-worker.mjs';
import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {cacheRows,damageCache,seedOtherLibraries} from './fixtures/display-cache.mjs';
import {exercisePhotoActivation} from './fixtures/photo-activation.mjs';
import {exerciseComposition,pngPixelsDigest} from './fixtures/composition-ui.mjs';
import {exerciseSplitWorker} from './fixtures/split-worker.mjs';
import {exerciseSplitUI,holdSplitWorker,cancelSplitUI} from './fixtures/split-ui.mjs';
import {prepareLinkedSplit} from './fixtures/split-linked.mjs';
import {exerciseSplitChildUI} from './fixtures/split-child-ui.mjs';
const assets=fileURLToPath(new URL('../dist-web/assets/',import.meta.url));
const apiModule=browserApiModule(assets);
const workerModule='/assets/'+readdirSync(assets).find(f=>/^edit-worker-.*\.js$/.test(f));
const editorAdapterModule='/assets/'+readdirSync(assets).find(f=>/^editor-adapter-.*\.js$/.test(f));

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser LUT folded groups persist and arrows skip hidden cells ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),before=await sourceHash(page);await openEditor(page,photos[0].id);await exerciseLutFolds(page,info,lang);expect(await sourceHash(page)).toBe(before);
});
test('browser LUT full-resolution band workers keep export pixels and recover failed bands',async({page})=>{
 test.setTimeout(120000);await setup(page);await exerciseLutBandWorker(page,workerModule);
});

test('browser LUT bulk visibility is atomic and preserves source bytes and metadata',async({page})=>{
 await setup(page);const original=await sourceHash(page);
 const result=await page.evaluate(async({module,cube})=>{
  const l=(await import(module)).createEditorServices().library,assets=[];
  for(let i=0;i<2;i++)assets.push(await l.importLut(new File(['# bulk '+i+'\n'+cube],i+'.cube')));
  await l.updateLut(assets[0].id,{favorite:true});await l.noteLutUsed(assets[0].id);
  const read=async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text(),before=await read(),sources=await Promise.all(assets.map(async a=>await(await l.lutSource(a.id)).text()));
  const create=FileSystemFileHandle.prototype.createWritable;let error='';
  FileSystemFileHandle.prototype.createWritable=async function(options){if(this.name==='library.json')throw new DOMException('Synthetic bulk commit failure','NotAllowedError');return create.call(this,options);};
  try{await l.setLutLibraryHidden(true);}catch(e){error=e.message;}finally{FileSystemFileHandle.prototype.createWritable=create;}
  const afterFailure=await read(),hidden=await l.setLutLibraryHidden(true),again=await l.setLutLibraryHidden(true),restored=await l.setLutLibraryHidden(false),finalSources=await Promise.all(assets.map(async a=>await(await l.lutSource(a.id)).text()));
  return {before,afterFailure,error,hidden,again,restored,sources,finalSources};
 },{module:editorAdapterModule,cube:invertCube('Bulk')});
 expect(result.error).not.toBe('');expect(result.afterFailure).toBe(result.before);expect(result.hidden.changed).toBe(2);expect(result.hidden.assets.every(a=>a.hidden)).toBe(true);expect(result.again.changed).toBe(0);expect(result.restored.changed).toBe(2);expect(result.restored.assets).toEqual(JSON.parse(result.before).luts);expect(result.finalSources).toEqual(result.sources);expect(await sourceHash(page)).toBe(original);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser LUT parallel thumbnails close cleanly and rapid switching keeps graded pixels ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(90000);await installLutPerformanceProbe(page);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),before=await sourceHash(page);await openEditor(page,photos[0].id);await exerciseLutPerformance(page,info,lang);expect(await sourceHash(page)).toBe(before);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser LUT management batch menu groups bulk hide restore ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),before=await sourceHash(page);await openEditor(page,photos[0].id);await exerciseLutManagement(page,info,lang);expect(await sourceHash(page)).toBe(before);
});
test('browser LUT expanded directory tree keeps a global DOM budget and every folder reachable',async({page})=>{test.setTimeout(90000);const photos=await setup(page),before=await sourceHash(page);await openEditor(page,photos[0].id);await exerciseLargeLutTree(page);expect(await sourceHash(page)).toBe(before);});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser LUT convenience batch drop all-fold source download and thumbnail retry ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),before=await sourceHash(page);await openEditor(page,photos[0].id);await exerciseLutConvenience(page,info,lang);expect(await sourceHash(page)).toBe(before);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser LUT copied folders batch groups context duplicate outcomes ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),before=await sourceHash(page);await openEditor(page,photos.find(p=>p.file_name==='Landscape-1.png').id);const group=await exerciseLutCopy(page,info,lang),saved=await manifest(page);expect(saved.luts).toHaveLength(3);expect(saved.luts.every(a=>a.version===2&&a.context.groups[0]===group)).toBe(true);expect(await sourceHash(page)).toBe(before);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser external LUT directories batch ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),original=await sourceHash(page);
  await page.evaluate(async cube=>{const root=await window.__synthetic.root.getDirectoryHandle('LinkedStyles',{create:true}),dir=await root.getDirectoryHandle('Cinema',{create:true}),w=await(await dir.getFileHandle('Directory.cube',{create:true})).createWritable();await w.write('# Input: S-Log3\n'+cube);await w.close();window.__lutRoot=root;window.showDirectoryPicker=async()=>root;},invertCube('Directory'));
  await openEditor(page,photos[0].id);await exerciseLutFolders(page,info,lang,async()=>{await page.evaluate(async cube=>{const w=await(await window.__lutRoot.getFileHandle('New.cube',{create:true})).createWritable();await w.write(cube);await w.close();},invertCube('New'));});expect(await sourceHash(page)).toBe(original);
});

test('browser LUT volume-root label snapshots a display group without an absolute path',async({page})=>{
 await setup(page);const before=await sourceHash(page),result=await page.evaluate(async({module,cube})=>{
  const l=(await import(module)).createEditorServices().library,root=await window.__synthetic.root.getDirectoryHandle('MockVolume',{create:true}),w=await(await root.getFileHandle('Volume.cube',{create:true})).createWritable();await w.write(cube);await w.close();window.showDirectoryPicker=async()=>root;
  const descriptor=Object.getOwnPropertyDescriptor(FileSystemHandle.prototype,'name');let f;try{Object.defineProperty(FileSystemHandle.prototype,'name',{...descriptor,get(){const name=descriptor.get.call(this);return name==='MockVolume'?'E:':name;}});f=await l.linkLutFolder();}finally{Object.defineProperty(FileSystemHandle.prototype,'name',descriptor);}
  const scanned=await l.scanLutFolder(f.id),asset=scanned.entries[0].asset,source=await(await l.lutSource(asset.id)).text();await l.removeLutFolder(f.id);return {source,asset:(await l.listLuts()).find(a=>a.id===asset.id)};
 },{module:editorAdapterModule,cube:invertCube('Volume')});expect(result.asset.context.groups).toEqual(['E']);expect(result.source).toBe(invertCube('Volume'));expect(await sourceHash(page)).toBe(before);
});

test('browser LUT copied context migration rollback and complete backup retain exact sources',async({page})=>{
 await setup(page);const original=await sourceHash(page);await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();
 const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=16;const text=JSON.stringify(m,null,2),w=await h.createWritable();await w.write(text);await w.close();return text;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
 const result=await page.evaluate(async({module,cube})=>{
  const l=(await import(module)).createEditorServices().library,file=new File(['# Input: F-Log2\n'+cube],'Stored.cube');Object.defineProperty(file,'webkitRelativePath',{value:'Archive/Film/Stored.cube'});
  const proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;proto.getFileHandle=async function(name,options){if(name.startsWith('library.before-lut-context-v17-'))throw new DOMException('Synthetic context backup failure','NotAllowedError');return get.call(this,name,options);};let error='';try{await l.importLutDetailed(file);}catch(e){error=e.message;}finally{proto.getFileHandle=get;}
  const after=await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text(),added=await l.importLutDetailed(file),duplicate=await l.importLutDetailed(file),backups=[];for await(const h of window.__synthetic.data.values())if(h.name.startsWith('library.before-lut-context-v17-'))backups.push(await(await h.getFile()).text());return {error,after,added,duplicate,backups};
 },{module:editorAdapterModule,cube:invertCube('Archive')});expect(result.error).not.toBe('');expect(result.after).toBe(old);expect(result.backups).toEqual([old]);expect(result.added.kind).toBe('added');expect(result.duplicate.kind).toBe('existing');expect(result.added.asset.context).toEqual({groups:['Archive','Film'],comments:['Input: F-Log2']});const valid=await manifest(page);
 await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.__contextBackup=await window.__synthetic.root.getDirectoryHandle('context-backup',{create:true});window.showDirectoryPicker=async()=>window.__contextBackup;});await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）',exact:true}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();
 const backup=await page.evaluate(async()=>{for await(const dir of window.__contextBackup.values()){const m=JSON.parse(await(await(await dir.getFileHandle('library.json')).getFile()).text()),assets=await(await dir.getDirectoryHandle('drafts')).getDirectoryHandle('luts');return {metadata:m.luts,source:await(await(await assets.getFileHandle(m.luts[0].id+'.cube')).getFile()).text()};}});expect(backup.metadata).toEqual(valid.luts);expect(backup.source).toBe('# Input: F-Log2\n'+invertCube('Archive'));
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await page.evaluate(()=>{window.showDirectoryPicker=async()=>window.__synthetic.data;});
 for(const version of [16,99]){const text=await page.evaluate(async({valid,version})=>{const text=JSON.stringify({...valid,version}),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{valid,version});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(text);}
 expect(await sourceHash(page)).toBe(original);
});

test('browser external LUT directories relink retains identity and failed publication cannot redirect handles',async({page})=>{
  await setup(page);const before=await sourceHash(page);
  const result=await page.evaluate(async({module,cube})=>{
    const l=(await import(module)).createEditorServices().library;
    async function make(name){const dir=await window.__synthetic.root.getDirectoryHandle(name,{create:true}),w=await(await dir.getFileHandle(name+'.cube',{create:true})).createWritable();await w.write(cube);await w.close();return dir;}
    const a=await make('First'),b=await make('Second');window.showDirectoryPicker=async()=>a;const f=await l.linkLutFolder();await l.scanLutFolder(f.id);
    window.showDirectoryPicker=async()=>b;const create=FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable=async function(options){if(this.name==='library.json')throw new DOMException('Synthetic failed manifest','NotAllowedError');return create.call(this,options);};let failure='';try{await l.linkLutFolder(f.id);}catch(e){failure=e.message;}finally{FileSystemFileHandle.prototype.createWritable=create;}
    const stillFirst=await l.scanLutFolder(f.id),second=await l.linkLutFolder(f.id),scanned=await l.scanLutFolder(f.id);return {failure,first:f,stillFirst,second,scanned};
  },{module:editorAdapterModule,cube:invertCube('Relink')});
  expect(result.failure).not.toBe('');expect(result.stillFirst.name).toBe('First');expect(result.stillFirst.entries[0].path).toBe('First.cube');expect(result.second.id).toBe(result.first.id);expect(result.second.binding).not.toBe(result.first.binding);expect(result.scanned.entries[0].path).toBe('Second.cube');expect(await sourceHash(page)).toBe(before);
});

test('browser external LUT directories snapshot isolation offline metadata and publication race',async({page})=>{
  await setup(page);const before=await sourceHash(page);
  const result=await page.evaluate(async({module,cube})=>{
    const l=(await import(module)).createEditorServices().library,root=await window.__synthetic.root.getDirectoryHandle('External',{create:true}),h=await root.getFileHandle('ReadOnly.cube',{create:true});
    async function write(text){const w=await h.createWritable();await w.write(text);await w.close();}await write(cube);window.showDirectoryPicker=async()=>root;
    const f=await l.linkLutFolder(),scanned=await l.scanLutFolder(f.id),asset=scanned.entries[0].asset,preview=await(await l.lutPreviewSource(asset.id)).text();
    const manifest=async()=>JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text());const noCopies=(await manifest()).luts?.length||0;
    const original=await(await l.lutSource(asset.id)).text();await write('# updated\n'+cube);const updated=await l.scanLutFolder(f.id),old=await(await l.lutSource(asset.id)).text();
    const query=FileSystemHandle.prototype.queryPermission;FileSystemHandle.prototype.queryPermission=async function(){return this.name==='External'?'denied':'granted';};const offline=await l.scanLutFolder(f.id);FileSystemHandle.prototype.queryPermission=query;
    await l.scanLutFolder(f.id);const newAsset=updated.entries[0].asset,create=FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable=async function(options){const w=await create.call(this,options);if(this.name===newAsset.id+'.cube'){FileSystemFileHandle.prototype.createWritable=create;const write=w.write.bind(w);w.write=async data=>{await l.removeLutFolder(f.id);return write(data);};}return w;};
    let race='';try{await l.lutSource(newAsset.id);}catch(e){race=e.message;}finally{FileSystemFileHandle.prototype.createWritable=create;}
    return {preview,original,old,noCopies,offline,race,final:await manifest(),raw:await(await h.getFile()).text()};
  },{module:editorAdapterModule,cube:invertCube('ReadOnly')});
  expect(result.noCopies).toBe(0);expect(result.preview).toBe(invertCube('ReadOnly'));expect(result.old).toBe(result.original);expect(result.offline.state).toBe('permission');expect(result.race).toContain('LUT folder changed');expect(result.final.luts).toHaveLength(1);expect(result.final.lut_folders).toEqual([]);expect(result.raw).toBe('# updated\n'+invertCube('ReadOnly'));expect(await sourceHash(page)).toBe(before);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser LUT browsing batch log hints preferences keyboard history and temporary comparison ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),before=await sourceHash(page);await openEditor(page,photos.find(p=>p.file_name==='Landscape-1.png').id);await exerciseLutBrowse(page,info,lang);expect(await sourceHash(page)).toBe(before);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser LUT batch invalid imports explain errors and recover ${width} ${lang}`,async({page})=>{
  await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});const photos=await setup(page,lang),before=await sourceHash(page);await openEditor(page,photos.find(p=>p.file_name==='Landscape-1.png').id);await exerciseLutErrors(page,lang);expect(await sourceHash(page)).toBe(before);
});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser LUT batch import favorites strength undo and reopen ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),before=await sourceHash(page);await openEditor(page,photos.find(p=>p.file_name==='Landscape-1.png').id);await exerciseLutUI(page,info,lang);const saved=await manifest(page);expect(saved.version).toBe(24);expect(saved.edits[0].recipe.version).toBe(5);expect(saved.luts).toHaveLength(1);expect(await sourceHash(page)).toBe(before);
});
test('browser LUT batch worker and complete backup retain hidden LUT assets and neutral children',async({page})=>{
  test.setTimeout(90000);await setup(page);const original=await sourceHash(page),document=JSON.parse(readFileSync('frontend/tests/fixtures/layer-stack-contract.json','utf8')),result=await exerciseLutWorker(page,editorAdapterModule,document),saved=await manifest(page);
  await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('lut-backup',{create:true});});await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）'}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();
  await page.evaluate(async()=>{for await(const dir of (await window.__synthetic.root.getDirectoryHandle('lut-backup')).values())if(dir.kind==='directory'){window.showDirectoryPicker=async()=>dir;break;}});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const restored=await page.evaluate(async({module,id,hash})=>{const services=(await import(module)).createEditorServices(),l=services.library,r=await l.getRecord(id),file=await l.lutSource(hash),session=services.render.session();try{await session.open(await l.source(r),r.decode_profile);const output=await session.export(r.recipe,0,'png',95);return {record:r,source:await file.text(),bytes:output.blob.size,assets:await l.listLuts()};}finally{session.dispose();}},{module:editorAdapterModule,id:result.recordId,hash:result.asset.id});
  expect(restored.record).toEqual(saved.edits.find(e=>e.id===result.recordId));expect(restored.source).toBe(invertCube('Worker'));expect(restored.bytes).toBeGreaterThan(100);expect(restored.assets[0].hidden).toBe(true);expect(await sourceHash(page)).toBe(original);
});
test('browser LUT batch upgrade failure keeps the old manifest and rejects missing or future assets',async({page})=>{
  test.setTimeout(90000);await setup(page);const original=await sourceHash(page);
  async function close(){await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'打开本地图库或备份',exact:true})).toBeVisible();}
  await close();const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=14;const text=JSON.stringify(m,null,2),w=await h.createWritable();await w.write(text);await w.close();return text;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const result=await page.evaluate(async({module,cube})=>{
    const l=(await import(module)).createEditorServices().library,file=new File([cube],'Backup.cube'),proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;proto.getFileHandle=async function(name,options){if(name.startsWith('library.before-lut-folders-v16-'))throw new DOMException('Synthetic backup failure','NotAllowedError');return get.call(this,name,options);};let failed=false;try{await l.importLut(file);}catch{failed=true;}finally{proto.getFileHandle=get;}
    const after=await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text(),asset=await l.importLut(file),again=await l.importLut(file),backups=[];for await(const h of window.__synthetic.data.values())if(h.name.startsWith('library.before-lut-folders-v16-'))backups.push(await(await h.getFile()).text());return {failed,after,asset,again,backups};
  },{module:editorAdapterModule,cube:invertCube('Backup')});expect(result.failed).toBe(true);expect(result.after).toBe(old);expect(result.backups).toEqual([old]);expect(result.again).toEqual(result.asset);expect((await manifest(page)).luts).toHaveLength(1);
  const damaged=await page.evaluate(async({module,id})=>{const d=await(await window.__synthetic.data.getDirectoryHandle('drafts')).getDirectoryHandle('luts'),handle=await d.getFileHandle(id+'.cube'),original=await(await handle.getFile()).arrayBuffer(),w=await handle.createWritable();await w.write('changed');await w.close();let failed='';try{await(await import(module)).createEditorServices().library.lutSource(id);}catch(e){failed=e.message;}const restore=await handle.createWritable();await restore.write(original);await restore.close();return failed;},{module:editorAdapterModule,id:result.asset.id});expect(damaged).toContain('changed');
  await close();const valid=await manifest(page);for(const kind of ['old','future','asset','duplicate']){const bytes=await page.evaluate(async({valid,kind})=>{const m=structuredClone(valid);if(kind==='old')m.version=14;else if(kind==='future')m.version=99;else if(kind==='asset')m.luts[0].version=3;else m.luts.push(structuredClone(m.luts[0]));const text=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{valid,kind});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toHaveCount(0);expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bytes);}expect(await sourceHash(page)).toBe(original);
});
const fixtureRoot=fileURLToPath(new URL('../../.test-artifacts/raw-fixtures/',import.meta.url));

test('browser LUT batch real 16-bit RAW identity and inversion match preview and PNG export',async({page})=>{
  test.setTimeout(120000);const path=fixtureRoot+'sample.DNG';expect(existsSync(path)).toBe(true);const before=createHash('sha256').update(readFileSync(path)).digest('hex');await setup(page);await page.goto('/#/tools/raw');await page.locator('.editor-toolbar input[type=file]').setInputFiles(path);await expect(page.locator('.edit-image img')).toBeVisible();
  const identity=JSON.parse(readFileSync('frontend/tests/fixtures/cube-lut-contract.json','utf8')).valid[0].text,result=await page.evaluate(async({module,identity,invert,bytes})=>{
    const services=(await import(module)).createEditorServices(),session=services.render.session(),file=new File([new Uint8Array(bytes)],'sample.DNG'),plain={version:1,exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX:false,flipY:false,crop:{x:0,y:0,width:1,height:1},sharpen:0,denoise:0,match:0,preserveLuminance:true},hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].join(',');
    try{const opened=await session.open(file,{version:2,extra_orientation:1}),asset=await services.library.importLut(new File([identity],'RAW-identity.cube')),recipe={...plain,version:5,composition:{source_width:opened.width,source_height:opened.height,angle:0},layer_stack:{version:1,layers:[]},lut:{version:1,asset_hash:asset.id,strength:1,input:'srgb'}},baseline=await session.export(plain,2048,'png',95),identical=await session.export(recipe,2048,'png',95),inverse=await services.library.importLut(new File([invert],'RAW-invert.cube'));recipe.lut.asset_hash=inverse.id;const preview=await session.render(recipe),output=await session.export(recipe,2048,'png',95),pixels=async blob=>{const b=await createImageBitmap(blob),c=new OffscreenCanvas(b.width,b.height),x=c.getContext('2d');x.drawImage(b,0,0);b.close();return x.getImageData(0,0,c.width,c.height).data;},a=await pixels(baseline.blob),b=await pixels(output.blob);return {bits:opened.bits,identity:await hash(baseline.blob)===await hash(identical.blob),same:await hash(preview.blob)===await hash(output.blob),inverse:a.every((v,i)=>b[i]===(i%4===3?v:255-v))};}finally{session.dispose();}
  },{module:editorAdapterModule,identity,invert:invertCube('RAW inverse'),bytes:[...readFileSync(path)]});expect(result).toEqual({bits:16,identity:true,same:true,inverse:true});expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before);
});

test('browser LUT batch late import after closing does not publish into another library session',async({page})=>{
  await setup(page);const original=await sourceHash(page);
  await page.evaluate(async({module,cube})=>{const services=(await import(module)).createEditorServices(),proto=FileSystemFileHandle.prototype,create=proto.createWritable;window.__lutGate=new Promise(resolve=>window.__lutRelease=resolve);window.__lutWaiting=false;proto.createWritable=async function(...args){const stream=await create.apply(this,args);if(this.name.endsWith('.cube')){const write=stream.write.bind(stream);stream.write=async(...values)=>{window.__lutWaiting=true;await window.__lutGate;return write(...values);};}return stream;};window.__lutImport=services.library.importLut(new File([cube],'late.cube')).then(()=>null,e=>e.message).finally(()=>{proto.createWritable=create;});},{module:editorAdapterModule,cube:invertCube('Late')});await expect.poll(()=>page.evaluate(()=>window.__lutWaiting)).toBe(true);
  await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'打开本地图库或备份',exact:true})).toBeVisible();const outcome=await page.evaluate(async()=>{window.__lutRelease();return window.__lutImport;});expect(outcome).toContain('Library changed');expect((await manifest(page)).luts||[]).toEqual([]);expect(await sourceHash(page)).toBe(original);
});

async function prepareSplitExport(page){
  const photos=await setup(page),p=photos.find(p=>p.file_name==='Landscape-1.png');await prepareLinkedSplit(page,editorAdapterModule,p.id);
  return page.evaluate(async()=>{const f=window.__linkedSplit;f.group=await f.services.library.saveSplit(f.record,f.result,f.file.name,f.request);f.output=await window.__synthetic.root.getDirectoryHandle('split-output',{create:true});window.showDirectoryPicker=async()=>f.output;f.folder=await f.services.library.chooseSplitFolder();return {hashes:f.result.panels.map(p=>p.sha256),group:f.group.id};});
}
test('browser split directory export keeps saved bytes, defaults and idempotent results',async({page})=>{
  const prepared=await prepareSplitExport(page),original=await sourceHash(page);
  const result=await page.evaluate(async()=>{const f=window.__linkedSplit,id=crypto.randomUUID(),first=await f.services.library.exportSplit(f.group.id,null,true,id),again=await f.services.library.exportSplit(f.group.id,null,true,id),custom=await f.services.library.exportSplit(f.group.id,f.folder,false,crypto.randomUUID()),hash=async file=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');const files=[];for(const entry of custom.files)files.push(await hash(await(await f.output.getFileHandle(entry.file_name)).getFile()));window.showDirectoryPicker=async()=>{throw new DOMException('Cancelled','AbortError');};const cancelled=await f.services.library.chooseSplitFolder();return {first,again,custom,files,cancelled};});
  expect(result.first).toEqual(result.again);expect(result.first.directory).toBe('exports/Landscape-1_split');expect(result.files).toEqual(prepared.hashes);expect(result.custom.files.map(f=>f.sha256)).toEqual(prepared.hashes);expect(result.cancelled).toBeNull();expect(await sourceHash(page)).toBe(original);
});
test('browser split export failures roll back files and empty folders before retry',async({page})=>{
  await prepareSplitExport(page);const before=await manifest(page),original=await sourceHash(page);
  const outcomes=await page.evaluate(async()=>{const f=window.__linkedSplit,rows=[];
    for(const phase of ['open','write','close']){const prototype=FileSystemFileHandle.prototype,create=prototype.createWritable;prototype.createWritable=async function(options){if(this.name==='Landscape-1_split_02.png'){if(phase==='open')throw new DOMException('Synthetic writer failure','QuotaExceededError');const stream=await create.call(this,options);if(phase==='write')stream.write=async()=>{throw new DOMException('Synthetic full disk','QuotaExceededError');};else{const close=stream.close.bind(stream);stream.close=async()=>{await close();throw new DOMException('Synthetic lost completion','QuotaExceededError');};}return stream;}return create.call(this,options);};const id=crypto.randomUUID();let error='';try{await f.services.library.exportSplit(f.group.id,f.folder,true,id);}catch(e){error=e.name;}finally{prototype.createWritable=create;}const remaining=[];for await(const name of f.output.keys())remaining.push(name);const result=await f.services.library.exportSplit(f.group.id,f.folder,true,id);rows.push({error,remaining,result});for await(const name of f.output.keys())await f.output.removeEntry(name,{recursive:true});}
    return rows;
  });for(const row of outcomes){expect(row.error).toBe('QuotaExceededError');expect(row.remaining).toEqual([]);expect(row.result.files).toHaveLength(2);}expect(await manifest(page)).toEqual(before);expect(await sourceHash(page)).toBe(original);
});
test('browser split export detects a late destination photo and renumbers the complete group',async({page})=>{
  await prepareSplitExport(page);const original=await sourceHash(page);
  const result=await page.evaluate(async()=>{const f=window.__linkedSplit,prototype=FileSystemDirectoryHandle.prototype,get=prototype.getFileHandle;let fired=false;prototype.getFileHandle=async function(name,options){const h=await get.call(this,name,options);if(name==='Landscape-1_split_02.png'&&options?.create&&!fired){fired=true;const stream=await h.createWritable();await stream.write(f.file);await stream.close();}return h;};let result;try{result=await f.services.library.exportSplit(f.group.id,f.folder,false,crypto.randomUUID());}finally{prototype.getFileHandle=get;}const files=[];for await(const name of f.output.keys())files.push(name);const data=await(await f.output.getFileHandle('Landscape-1_split_02.png')).getFile(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await data.arrayBuffer()))].join(',');return {result,files,hash};});
  expect(result.result.files.map(p=>p.file_name)).toEqual(['Landscape-1_split_1_01.png','Landscape-1_split_1_02.png']);expect(result.files).toHaveLength(3);expect(result.hash).toBe(original);expect(await sourceHash(page)).toBe(original);
});
test('browser split export preserves externally changed files and refuses an altered retry',async({page})=>{
  await prepareSplitExport(page);const original=await sourceHash(page);
  const result=await page.evaluate(async()=>{const f=window.__linkedSplit,id=crypto.randomUUID(),first=await f.services.library.exportSplit(f.group.id,f.folder,false,id),handle=await f.output.getFileHandle(first.files[0].file_name),writer=await handle.createWritable();await writer.write(f.file);await writer.close();let error='';try{await f.services.library.exportSplit(f.group.id,f.folder,false,id);}catch(e){error=e.message;}const fresh=await f.services.library.exportSplit(f.group.id,f.folder,false,crypto.randomUUID()),file=await handle.getFile(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].join(',');return {error,fresh,hash};});
  expect(result.error).toContain('Start a new export');expect(result.fresh.files[0].file_name).toContain('_split_1_');expect(result.hash).toBe(original);expect(await sourceHash(page)).toBe(original);
});
test('browser split export rechecks earlier panels and keeps an external change during the last write',async({page})=>{
  await prepareSplitExport(page);const original=await sourceHash(page);
  const result=await page.evaluate(async()=>{const f=window.__linkedSplit,proto=FileSystemFileHandle.prototype,create=proto.createWritable;proto.createWritable=async function(options){const stream=await create.call(this,options);if(this.name==='Landscape-1_split_02.png'){proto.createWritable=create;const close=stream.close.bind(stream);stream.close=async()=>{await close();const changed=await(await f.output.getFileHandle('Landscape-1_split_01.png')).createWritable();await changed.write(f.file);await changed.close();};}return stream;};let error='';try{await f.services.library.exportSplit(f.group.id,f.folder,false,crypto.randomUUID());}catch(e){error=e.message;}finally{proto.createWritable=create;}const files=[];for await(const name of f.output.keys())files.push(name);const file=await(await f.output.getFileHandle(files[0])).getFile(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].join(',');return {error,files,hash};});
  expect(result.error).toContain('changed before completion');expect(result.files).toEqual(['Landscape-1_split_01.png']);expect(result.hash).toBe(original);expect(await sourceHash(page)).toBe(original);
});
test('browser split export aborts a late library switch without publishing into either library',async({page})=>{
  await prepareSplitExport(page);const before=await manifest(page),original=await sourceHash(page);
  await page.evaluate(async()=>{const f=window.__linkedSplit,proto=FileSystemFileHandle.prototype,create=proto.createWritable;proto.createWritable=async function(options){const stream=await create.call(this,options);if(this.name==='Landscape-1_split_02.png'){proto.createWritable=create;const write=stream.write.bind(stream);stream.write=async value=>{await new Promise(resolve=>window.__resumeExport=resolve);return write(value);};}return stream;};window.__pendingExport=f.services.library.exportSplit(f.group.id,f.folder,false,crypto.randomUUID()).then(()=>window.__exportOutcome='unexpected success',e=>window.__exportOutcome=e.message);});await page.waitForFunction(()=>!!window.__resumeExport);
  await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('export-other-library',{create:true});});await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const result=await page.evaluate(async()=>{window.__resumeExport();await window.__pendingExport;const files=[];for await(const name of window.__linkedSplit.output.keys())files.push(name);return {files,error:window.__exportOutcome};});expect(result.error).toContain('Library changed');expect(result.files).toEqual([]);expect(await manifest(page)).toEqual(before);expect((await manifest(page,'export-other-library')).splits).toBeUndefined();expect(await sourceHash(page)).toBe(original);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser split directory UI selects a folder and retries failed writes ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(60000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});const text=(zh,en)=>lang==='en'?en:zh,photos=await setup(page,lang),original=await sourceHash(page);await page.goto('/#/tools/edit?photo='+photos.find(p=>p.file_name==='Landscape-1.png').id);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',1200);
  await page.getByRole('button',{name:text('无缝分图','Seamless split'),exact:true}).click();const dialog=page.getByRole('dialog',{name:text('无缝分图','Seamless split')});await dialog.getByRole('button',{name:text('保存整组分图','Save split group'),exact:true}).click();await expect(dialog.getByRole('button',{name:text('已保存整组','Group saved'),exact:true})).toBeDisabled();const panel=dialog.locator('.split-export');
  await page.evaluate(async()=>{window.showDirectoryPicker=async()=>{throw new DOMException('Cancelled','AbortError');};});await panel.getByRole('button',{name:text('选择分图目录','Choose split directory'),exact:true}).click();await expect(panel.locator('.split-output-folder>span')).toHaveText(text('默认导出目录','Default export directory'));
  await page.evaluate(async()=>{window.__chosenSplit=await window.__synthetic.root.getDirectoryHandle('chosen-split',{create:true});window.showDirectoryPicker=async()=>window.__chosenSplit;const proto=FileSystemFileHandle.prototype,create=proto.createWritable;proto.createWritable=async function(options){const stream=await create.call(this,options);if(this.name==='Landscape-1_split_02.png'){proto.createWritable=create;stream.write=async()=>{throw new DOMException('Synthetic full disk','QuotaExceededError');};}return stream;};});
  await panel.getByRole('button',{name:text('选择分图目录','Choose split directory'),exact:true}).click();await expect(panel.locator('.split-output-folder>span')).toHaveText('chosen-split');await panel.getByRole('checkbox',{name:text('为整组创建子目录','Create a subfolder for the group')}).uncheck();await panel.getByRole('button',{name:text('导出整组到目录','Export group to directory'),exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();await panel.getByRole('button',{name:text('重试整组导出','Retry group export'),exact:true}).click();await expect(panel.locator('.split-export-result')).toContainText('chosen-split');
  const hashes=await page.evaluate(async()=>{const values=[];for await(const entry of window.__chosenSplit.values())values.push({name:entry.name,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await entry.getFile()).arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('')});return values.sort((a,b)=>a.name.localeCompare(b.name)).map(v=>v.hash);});expect(hashes).toEqual((await manifest(page)).splits[0].panels.map(p=>p.sha256));expect(await sourceHash(page)).toBe(original);await panel.screenshot({path:info.outputPath('split-directory.png')});if(lang==='en')expect(await panel.innerText()).not.toMatch(/[\u3400-\u9fff]/);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`web split UI preserves gestures, crop, saved groups and downloads ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(60000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),photo=photos.find(p=>p.file_name==='Landscape-1.png'),original=await sourceHash(page);await page.goto('/#/tools/edit?photo='+photo.id);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',1200);
  const result=await exerciseSplitUI(page,info,lang),saved=await manifest(page),group=saved.splits[0],text=(zh,en)=>lang==='en'?en:zh;expect(saved.edits[0].recipe.crop).toEqual({x:0,y:0,width:.8,height:1});expect(group.plan).toMatchObject({width:result.width,height:result.height,count:3});expect(createHash('sha256').update(readFileSync(result.path)).digest('hex')).toBe(group.panels[0].sha256);
  await page.reload();await page.goto('/#/tools/edit');await page.locator('.edit-records').getByRole('button',{name:/^Landscape-1\.png/}).click();await page.getByRole('button',{name:text('无缝分图','Seamless split'),exact:true}).click();const dialog=page.getByRole('dialog',{name:text('无缝分图','Seamless split')});await expect(dialog.getByRole('button',{name:'4:5',exact:true})).toHaveAttribute('aria-pressed','true');await dialog.locator('.split-groups button').first().click();await expect(dialog.locator('.split-saved img')).toHaveCount(3);await expect(dialog.locator('.split-saved img').first()).toHaveJSProperty('naturalHeight',result.height);expect(await sourceHash(page)).toBe(original);
});
test('web split UI cancellation rebuilds the worker without discarding the edit',async({page})=>{
  test.setTimeout(60000);await holdSplitWorker(page);const photos=await setup(page),original=await sourceHash(page);await openEditor(page,photos.find(p=>p.file_name==='Landscape-1.png').id);await cancelSplitUI(page);expect(await sourceHash(page)).toBe(original);
});

test('linked photo split keeps a private source snapshot after removal, editing and backup reopen',async({page})=>{
  const photos=await setup(page),photo=photos.find(p=>p.file_name==='Landscape-1.png'),original=await sourceHash(page),fixture=await prepareLinkedSplit(page,editorAdapterModule,photo.id);
  expect(fixture.record.source_path).toBeUndefined();
  const group=await page.evaluate(async()=>{const f=window.__linkedSplit;return f.services.library.saveSplit(f.record,f.result,f.file.name,f.request);});
  let saved=await manifest(page),record=saved.edits.find(e=>e.id===fixture.record.id);expect(record.source_path).toBe(`drafts/splits/${group.id}/source.bin`);expect(record.photo_id).toBe(photo.id);
  const privateSource=await page.evaluate(async group=>{const url=group.master.preview_url.replace('master.png','source.bin');return (await fetch(url)).status;},group);expect(privateSource).toBe(409);
  await call(page,'/photos/'+photo.id,'DELETE');expect((await call(page,'/photos')).total).toBe(2);
  const detached=await page.evaluate(async()=>{const f=window.__linkedSplit,record=(await f.services.library.listRecords()).items.find(r=>r.id===f.record.id),source=await f.services.library.source(f.record);const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await source.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');return {record,hash};});
  expect(detached.record.photo_id).toBe(photo.id);expect(detached.hash).toBe(fixture.record.source_hash);
  await page.goto('/#/tools/edit');await page.locator('.edit-records').getByRole('button',{name:/^Landscape-1\.png/}).click();await expect(page.locator('.edit-stage-top')).toContainText('1200 × 800');await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',960);
  await page.getByRole('button',{name:'保存编辑',exact:true}).click();await expect(page.getByText('编辑参数已保存，原图保持不变。',{exact:true})).toBeVisible();saved=await manifest(page);record=saved.edits.find(e=>e.id===fixture.record.id);expect(record.source_path).toBe(detached.record.source_path);expect(record.photo_id).toBe(photo.id);expect(record.revision).toBe(2);
  await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('linked-split-backups',{create:true});});await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）'}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();
  await page.evaluate(async()=>{for await(const dir of (await window.__synthetic.root.getDirectoryHandle('linked-split-backups')).values())if(dir.kind==='directory'){window.showDirectoryPicker=async()=>dir;break;}});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const restored=await page.evaluate(async({module,id,edit})=>{const library=(await import(module)).createEditorServices().library,group=await library.splitGroup(id),source=await library.source(edit),digest=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),hashes=[];for(const panel of group.panels)hashes.push(await digest(await(await fetch(panel.preview_url)).blob()));return {hash:await digest(source),hashes};},{module:editorAdapterModule,id:group.id,edit:fixture.record});
  expect(restored.hash).toBe(fixture.record.source_hash);expect(restored.hashes).toEqual(fixture.hashes);expect(await sourceHash(page)).toBe(original);
});

test('linked split snapshot and manifest failures roll back before a concurrent retry shares one source',async({page})=>{
  const photos=await setup(page),p=photos.find(p=>p.file_name==='Landscape-1.png'),original=await sourceHash(page);await prepareLinkedSplit(page,editorAdapterModule,p.id);
  const result=await page.evaluate(async()=>{
    const f=window.__linkedSplit,root=window.__synthetic.data,read=async()=>await(await(await root.getFileHandle('library.json')).getFile()).text(),before=await read(),failures=[];
    for(const phase of ['source','manifest']){
      const proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle,files=FileSystemFileHandle.prototype,create=files.createWritable;
      proto.getFileHandle=async function(name,options){if(phase==='source'&&name==='source.bin'&&options?.create)throw new DOMException('Synthetic snapshot quota','QuotaExceededError');return get.call(this,name,options);};
      files.createWritable=async function(options){if(phase==='manifest'&&this.name==='library.json')throw new DOMException('Synthetic metadata quota','QuotaExceededError');return create.call(this,options);};
      let error='';try{await f.services.library.saveSplit(f.record,f.result,f.file.name,f.request);}catch(e){error=e.name;}finally{proto.getFileHandle=get;files.createWritable=create;}
      const parent=await(await root.getDirectoryHandle('drafts')).getDirectoryHandle('splits'),names=[];for await(const name of parent.keys())names.push(name);failures.push({error,unchanged:before===await read(),names});
    }
    const other=crypto.randomUUID(),groups=await Promise.all([f.services.library.saveSplit(f.record,f.result,f.file.name,f.request),f.services.library.saveSplit(f.record,f.result,f.file.name,other)]),parent=await(await root.getDirectoryHandle('drafts')).getDirectoryHandle('splits');let snapshots=0;
    for await(const dir of parent.values())try{await dir.getFileHandle('source.bin');snapshots++;}catch{}
    const record=(await f.services.library.listRecords()).items.find(r=>r.id===f.record.id);return {failures,snapshots,groups:groups.map(g=>g.id),source:record.source_path};
  });
  for(const f of result.failures)expect(f).toEqual({error:'QuotaExceededError',unchanged:true,names:[]});expect(new Set(result.groups).size).toBe(2);expect(result.snapshots).toBe(1);expect(result.source).toBe(`drafts/splits/${result.groups[0]}/source.bin`);expect(await sourceHash(page)).toBe(original);
});

test('linked split refuses a changing original before publication and uses its immutable snapshot afterwards',async({page})=>{
  const photos=await setup(page),p=photos.find(p=>p.file_name==='Landscape-1.png');await prepareLinkedSplit(page,editorAdapterModule,p.id);
  await page.evaluate(async()=>{const f=window.__linkedSplit,proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;window.__originalBytes=await(await(await window.__synthetic.originals.getFileHandle(f.file.name)).getFile()).arrayBuffer();proto.getFileHandle=async function(name,options){if(name==='panel-02.png'&&options?.create){proto.getFileHandle=get;await new Promise(resolve=>window.__releaseLinked=resolve);}return get.call(this,name,options);};window.__linkedPending=f.services.library.saveSplit(f.record,f.result,f.file.name,f.request).then(()=>window.__linkedOutcome='unexpected',e=>window.__linkedOutcome=e.message);});
  await page.waitForFunction(()=>!!window.__releaseLinked);const result=await page.evaluate(async()=>{
    const f=window.__linkedSplit,handle=await window.__synthetic.originals.getFileHandle(f.file.name),write=async bytes=>{const w=await handle.createWritable();await w.write(bytes);await w.close();};await write('changed synthetic original');window.__releaseLinked();await window.__linkedPending;
    const failed=window.__linkedOutcome,recordBefore=(await f.services.library.listRecords()).items.find(r=>r.id===f.record.id),parent=await(await window.__synthetic.data.getDirectoryHandle('drafts')).getDirectoryHandle('splits'),names=[];for await(const name of parent.keys())names.push(name);
    await write(window.__originalBytes);const group=await f.services.library.saveSplit(f.record,f.result,f.file.name,f.request);await write('changed again outside the application');
    try{const source=await f.services.library.source(f.record),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await source.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),again=await f.services.library.saveSplit(f.record,f.result,f.file.name,crypto.randomUUID());return {failed,pathBefore:recordBefore.source_path,names,hash,expected:f.record.source_hash,group:group.id,again:again.id,external:await(await handle.getFile()).text()};}finally{await write(window.__originalBytes);}
  });expect(result.failed).toContain('source photo changed');expect(result.pathBefore).toBeUndefined();expect(result.names).toEqual([]);expect(result.hash).toBe(result.expected);expect(result.again).not.toBe(result.group);expect(result.external).toBe('changed again outside the application');
});

test('linked split serializes with edit saves and cannot resurrect a photo removed during output',async({page})=>{
  const photos=await setup(page),p=photos.find(p=>p.file_name==='Landscape-1.png'),fixture=await prepareLinkedSplit(page,editorAdapterModule,p.id),original=await sourceHash(page);
  const result=await page.evaluate(async()=>{
    const f=window.__linkedSplit,proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;let entered,release;const writing=new Promise(r=>entered=r),hold=new Promise(r=>release=r);proto.getFileHandle=async function(name,options){if(name==='source.bin'&&options?.create){proto.getFileHandle=get;entered();await hold;}return get.call(this,name,options);};
    const split=f.services.library.saveSplit(f.record,f.result,f.file.name,f.request);await writing;
    const edit=f.services.library.save(f.file,{...f.recipe,exposure:.3},f.photoID,f.record,f.profile);release();const [group,updated]=await Promise.all([split,edit]);let stale='';try{await f.services.library.save(f.file,f.recipe,f.photoID,f.record,f.profile);}catch(e){stale=e.message;}
    return {group,updated,stale};
  });expect(result.updated.source_path).toBe(`drafts/splits/${fixture.request}/source.bin`);expect(result.updated.revision).toBe(2);expect(result.group.parent_recipe.exposure).toBe(.2);expect(result.stale).toContain('changed in another window');
  const second=photos.find(q=>q.id!==p.id);await prepareLinkedSplit(page,editorAdapterModule,second.id);
  await page.evaluate(async()=>{const f=window.__linkedSplit,proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;proto.getFileHandle=async function(name,options){if(name==='panel-02.png'&&options?.create){proto.getFileHandle=get;await new Promise(resolve=>window.__releaseDeletedSplit=resolve);}return get.call(this,name,options);};window.__deletedSplit=f.services.library.saveSplit(f.record,f.result,f.file.name,f.request).then(()=>window.__deletedOutcome='saved-with-archived-source',e=>window.__deletedOutcome=e.message);});
  await page.waitForFunction(()=>!!window.__releaseDeletedSplit);await call(page,'/photos/'+second.id,'DELETE');const after=await page.evaluate(async()=>{window.__releaseDeletedSplit();await window.__deletedSplit;const f=window.__linkedSplit,parent=await(await window.__synthetic.data.getDirectoryHandle('drafts')).getDirectoryHandle('splits'),ids=[];for await(const name of parent.keys())ids.push(name);return {outcome:window.__deletedOutcome,ids,request:f.request,edits:(await f.services.library.listRecords()).items.map(r=>r.id),removed:f.record.id};});
  expect(after.outcome).toBe('saved-with-archived-source');expect(after.ids).toContain(after.request);expect(after.edits).toContain(after.removed);expect((await manifest(page)).splits).toHaveLength(2);expect((await call(page,'/photos')).photos.some(p=>p.id===second.id)).toBe(false);expect((await call(page,'/removals/photos')).items.some(p=>p.id===second.id)).toBe(true);expect(await sourceHash(page)).toBe(original);
});

for(const action of ['split','external-edit'])test(`new ${action} source writes stay in their starting library and roll back on a switch`,async({page})=>{
  const photos=await setup(page),photo=photos.find(p=>p.file_name==='Landscape-1.png'),original=await sourceHash(page);await prepareLinkedSplit(page,editorAdapterModule,photo.id);const before=await manifest(page);
  await page.evaluate(async action=>{
    const f=window.__linkedSplit,proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;
    proto.getFileHandle=async function(name,options){if(name===(action==='split'?'source.bin':'source.png')&&options?.create){proto.getFileHandle=get;await new Promise(resolve=>window.__resumeSource=resolve);}return get.call(this,name,options);};
    const pending=action==='split'?f.services.library.saveSplit(f.record,f.result,f.file.name,f.request):f.services.library.save(f.file,f.recipe,null,undefined,f.profile);
    window.__pendingSource=pending.then(()=>window.__sourceOutcome='unexpected',e=>window.__sourceOutcome=e.message);
  },action);await page.waitForFunction(()=>!!window.__resumeSource);
  await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();
  await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('switched-source-library',{create:true});});await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const result=await page.evaluate(async action=>{
    window.__resumeSource();await window.__pendingSource;const base=window.__synthetic.data,other=await window.__synthetic.root.getDirectoryHandle('switched-source-library'),parent=await(await base.getDirectoryHandle('drafts')).getDirectoryHandle(action==='split'?'splits':'edits'),dirs=[];for await(const name of parent.keys())dirs.push(name);const read=async d=>JSON.parse(await(await(await d.getFileHandle('library.json')).getFile()).text());return {outcome:window.__sourceOutcome,dirs,old:await read(base),next:await read(other)};
  },action);expect(result.outcome).toContain('Library changed');expect(result.dirs).toEqual([]);expect(result.old).toEqual(before);expect(result.next.edits).toBeUndefined();expect(result.next.splits).toBeUndefined();expect(await sourceHash(page)).toBe(original);
});

test('split source references cannot cross documents or survive a missing owner group',async({page})=>{
  const photos=await setup(page);for(const photo of photos.slice(0,2)){await prepareLinkedSplit(page,editorAdapterModule,photo.id);await page.evaluate(async()=>{const f=window.__linkedSplit;await f.services.library.saveSplit(f.record,f.result,f.file.name,f.request);});}
  const good=await manifest(page);await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();
  for(const kind of ['foreign','missing','traversal']){
    const bytes=await page.evaluate(async({good,kind})=>{const value=structuredClone(good);if(kind==='foreign')value.edits[0].source_path=value.edits[1].source_path;else if(kind==='missing')value.splits=value.splits.filter(g=>g.document_id!==value.edits[0].id);else value.edits[0].source_path=value.edits[0].source_path.replace('source.bin','../source.bin');const text=JSON.stringify(value),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{good,kind});
    await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bytes);
  }
});
test('browser real split worker encodes whole-frame panels, validates snapshots and cancels queued work',async({page})=>{
  test.setTimeout(90000);await setup(page);await exerciseSplitWorker(page,editorAdapterModule,true);
});
test('browser split groups retain frozen pixels through parent edits, concurrent retries and full backup',async({page})=>{
  await setup(page);const initial=await exerciseSplitWorker(page,editorAdapterModule,true),original=await sourceHash(page);
  const result=await page.evaluate(async module=>{
    const services=(await import(module)).createEditorServices(),f=window.__splitFixture,request=crypto.randomUUID();
    const pair=await Promise.all([services.library.saveSplit(f.record,f.result,f.file.name,request),services.library.saveSplit(f.record,f.result,f.file.name,request)]);
    const updated=await services.library.save(f.file,{...f.recipe,exposure:1},null,f.record,f.profile),retry=await services.library.saveSplit(f.record,f.result,f.file.name,f.request);
    let stale='',removed='',conflict='';
    try{await services.library.saveSplit(f.record,f.result,f.file.name,crypto.randomUUID());}catch(e){stale=e.message;}
    try{await services.library.remove(updated);}catch(e){removed=e.message;}
    try{await services.library.saveSplit(f.record,f.result,'different.png',f.request);}catch(e){conflict=e.message;}
    return {ids:pair.map(g=>g.id),retry:retry.id,stale,removed,conflict,revision:updated.revision};
  },editorAdapterModule);
  expect(new Set(result.ids).size).toBe(1);expect(result.retry).toBe(initial.saved.id);expect(result.stale).toContain('edit changed');expect(result.removed).toContain('used by a split');expect(result.conflict).toContain('already used');expect(result.revision).toBe(2);
  const before=await manifest(page);expect(before.splits).toHaveLength(2);expect(before.photos).toHaveLength(3);expect(before.splits[1].parent_recipe.exposure).toBe(.2);expect(before.edits[0].recipe.exposure).toBe(1);
  await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('split-backups',{create:true});});
  await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）'}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();
  await page.evaluate(async()=>{for await(const dir of (await window.__synthetic.root.getDirectoryHandle('split-backups')).values())if(dir.kind==='directory'){window.__splitBackup=dir;window.showDirectoryPicker=async()=>dir;break;}});
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const restored=await page.evaluate(async({module,id})=>{
    const library=(await import(module)).createEditorServices().library,group=await library.splitGroup(id),hashes=[];
    for(const p of group.panels){const response=await fetch(p.preview_url);if(!response.ok)throw new Error('Missing copied split');hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join(''));}
    return {group,hashes};
  },{module:editorAdapterModule,id:initial.saved.id});
  expect(restored.hashes).toEqual(initial.saved.expected);expect(restored.group.parent_recipe.exposure).toBe(.2);expect(await sourceHash(page)).toBe(original);
});
test('browser split save rolls back only new files on interrupted writes and validates saved checksums',async({page})=>{
  await setup(page);await exerciseSplitWorker(page,editorAdapterModule,true);
  const result=await page.evaluate(async module=>{
    const services=(await import(module)).createEditorServices(),f=window.__splitFixture,root=window.__synthetic.data,read=async()=>await(await(await root.getFileHandle('library.json')).getFile()).text();
    const old=await read(),request=crypto.randomUUID(),proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;
    proto.getFileHandle=async function(name,options){if(name==='panel-02.png'&&options?.create)throw new DOMException('Synthetic split disk full','QuotaExceededError');return get.call(this,name,options);};
    let error='';try{await services.library.saveSplit(f.record,f.result,f.file.name,request);}catch(e){error=e.name;}finally{proto.getFileHandle=get;}
    const parent=await(await root.getDirectoryHandle('drafts')).getDirectoryHandle('splits'),remaining=[];for await(const p of parent.keys())remaining.push(p);
    const unchanged=old===await read(),again=await services.library.saveSplit(f.record,f.result,f.file.name,request);
    const dir=await parent.getDirectoryHandle(request),file=await dir.getFileHandle('panel-02.png'),bytes=await(await file.getFile()).arrayBuffer(),writer=await file.createWritable();await writer.write('damaged synthetic split');await writer.close();
    let damaged='';try{await services.library.splitGroup(request);}catch(e){damaged=e.message;}
    const repaired=await file.createWritable();await repaired.write(bytes);await repaired.close();const restored=await services.library.splitGroup(request);
    return {error,unchanged,remaining,existing:f.request,again:again.id,request,damaged,restored:restored.id};
  },editorAdapterModule);
  expect(result.error).toBe('QuotaExceededError');expect(result.unchanged).toBe(true);expect(result.remaining).toEqual([result.existing]);expect(result.again).toBe(result.request);expect(result.damaged).toContain('damaged');expect(result.restored).toBe(result.request);
});
test('browser split format upgrades require exact backups and a library switch aborts unpublished files',async({page})=>{
  await setup(page);await exerciseSplitWorker(page,editorAdapterModule,true);
  async function close(){await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();}
  await close();const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=10;delete m.splits;for(const e of m.edits)delete e.revision;const bytes=JSON.stringify(m,null,2),w=await h.createWritable();await w.write(bytes);await w.close();return bytes;});
  await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const upgraded=await page.evaluate(async module=>{
    const library=(await import(module)).createEditorServices().library,f=window.__splitFixture,record=(await library.listRecords()).items[0],request=crypto.randomUUID();
    const proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;proto.getFileHandle=async function(name,options){if(name.startsWith('library.before-splits-v11-'))throw new DOMException('Synthetic backup failure','NotAllowedError');return get.call(this,name,options);};
    let failed=false;try{await library.saveSplit(record,f.result,f.file.name,request);}catch{failed=true;}finally{proto.getFileHandle=get;}
    const afterFailure=await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text(),saved=await library.saveSplit(record,f.result,f.file.name,request),backups=[];
    for await(const entry of window.__synthetic.data.values())if(entry.name.startsWith('library.before-splits-v11-'))backups.push(await(await entry.getFile()).text());
    window.__splitFixture={...f,record,request};return {failed,afterFailure,backups,saved:saved.id};
  },editorAdapterModule);expect(upgraded.failed).toBe(true);expect(upgraded.afterFailure).toBe(old);expect(upgraded.backups).toEqual([old]);expect((await manifest(page)).version).toBe(24);
  const before=await manifest(page);
  await page.evaluate(async module=>{
    const library=(await import(module)).createEditorServices().library,f=window.__splitFixture,proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;window.__heldSplitID=crypto.randomUUID();
    proto.getFileHandle=async function(name,options){if(name==='panel-02.png'&&options?.create){proto.getFileHandle=get;await new Promise(resolve=>window.__releaseSplit=resolve);}return get.call(this,name,options);};
    window.__pendingSplit=library.saveSplit(f.record,f.result,f.file.name,window.__heldSplitID).then(()=>window.__splitOutcome='unexpected success',e=>window.__splitOutcome=e.message);
  },editorAdapterModule);await page.waitForFunction(()=>!!window.__releaseSplit);await close();
  await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('other-split-library',{create:true});});await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const switched=await page.evaluate(async()=>{window.__releaseSplit();await window.__pendingSplit;const dir=await(await window.__synthetic.data.getDirectoryHandle('drafts')).getDirectoryHandle('splits'),dirs=[];for await(const name of dir.keys())dirs.push(name);const other=await window.__synthetic.root.getDirectoryHandle('other-split-library');return {outcome:window.__splitOutcome,held:window.__heldSplitID,dirs,current:JSON.parse(await(await(await other.getFileHandle('library.json')).getFile()).text()),old:JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())};});
  expect(switched.outcome).toContain('Library changed');expect(switched.dirs).not.toContain(switched.held);expect(switched.old).toEqual(before);expect(switched.current.splits).toBeUndefined();
});
test.beforeEach(async({context})=>{await context.addInitScript(()=>{
  if(location.origin!=='http://127.0.0.1:4185')return;
  window.__syntheticReady=(async()=>{
    localStorage.setItem('onboarded','1');localStorage.setItem('theme',localStorage.getItem('theme')||'dark');
  FileSystemHandle.prototype.queryPermission=async()=> 'granted';FileSystemHandle.prototype.requestPermission=async()=> 'granted';
  const root=await navigator.storage.getDirectory(),data=await root.getDirectoryHandle('editor-library',{create:true}),originals=await root.getDirectoryHandle('editor-originals',{create:true});
  window.__synthetic={root,data,originals};
  for(let j=0;j<3;j++){const name=`Landscape-${j+1}.png`;try{await originals.getFileHandle(name);continue;}catch{}const c=document.createElement('canvas');c.width=1200;c.height=800;const x=c.getContext('2d'),g=x.createLinearGradient(0,0,0,800);g.addColorStop(0,['#718889','#9a7466','#72798c'][j]);g.addColorStop(.6,'#ddc79f');g.addColorStop(1,'#273c3f');x.fillStyle=g;x.fillRect(0,0,1200,800);x.fillStyle='#edce8f';x.beginPath();x.arc(840,240,70,0,Math.PI*2);x.fill();for(let k=0;k<3;k++){x.fillStyle=['#647571','#455f5e','#263f3d'][k];x.beginPath();x.moveTo(0,800);for(let i=0;i<=12;i++)x.lineTo(i*100,480+k*90-Math.sin(i*1.7+j+k)*90);x.lineTo(1200,800);x.fill();}const blob=await new Promise(r=>c.toBlob(r,'image/png')),w=await(await originals.getFileHandle(name,{create:true})).createWritable();await w.write(blob);await w.close();}
  })();
  window.showDirectoryPicker=async({mode})=>{await window.__syntheticReady;return mode==='readwrite'?window.__synthetic.data:window.__synthetic.originals;};
});});
async function call(page,path,method='GET',body){return page.evaluate(async({module,path,method,body})=>(await import(module)).browserAPI(path,method,body),{module:apiModule,path,method,body});}
async function setup(page,lang='zh'){await page.goto('/');await page.getByRole('button',{name:lang==='en'?'New local library':'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();const picked=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');return (await call(page,'/photos')).photos;}
async function manifest(page,directory='editor-library'){
  await page.waitForFunction(()=>!!window.__synthetic);
  return page.evaluate(async name=>{
    const handle=name==='editor-library'?window.__synthetic.data:await window.__synthetic.root.getDirectoryHandle(name);
    const read=async()=>JSON.parse(await(await(await handle.getFileHandle('library.json')).getFile()).text());
    window.__manifestIdentities??={};let id=window.__manifestIdentities[name];
    if(!id){for(let attempt=0;attempt<4;attempt++){try{id=(await read()).id;break;}catch(e){if(e.name!=='NotReadableError'||attempt===3)throw e;const locks=await navigator.locks.query();await Promise.all(locks.held.filter(l=>l.name.startsWith('photocollection:')).map(l=>navigator.locks.request(l.name,async()=>{})));}}window.__manifestIdentities[name]=id;}
    return navigator.locks.request('photocollection:'+id,read);
  },directory);
}
async function sourceHash(page){return page.evaluate(async()=>{const f=await(await window.__synthetic.originals.getFileHandle('Landscape-1.png')).getFile();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].join(',');});}

for(const [lang,width] of [['zh',1440],['en',390]])test(`appearance index and original viewer with independent palette ${lang} ${width}`,async({page})=>{
 test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='zh'?'dark':'light');},lang);await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion:'reduce'});
 const photos=await setup(page,lang),before=await sourceHash(page),photo=photos.find(p=>p.file_name==='Landscape-1.png');
 await call(page,'/photos/'+photo.id,'PATCH',{favorite:true,color_label:'red',flag:'picked'});
 const job=await call(page,'/similarity/index','POST');await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');
 const complete=await call(page,'/jobs/'+job.id);expect(complete.failed).toBe(0);expect(complete.success).toBe(3);
 const analysis=await call(page,'/similarity/photos/'+photo.id+'/analysis');expect(analysis.indexed).toBe(true);expect(analysis.palette.length).toBeGreaterThan(0);
 const matches=await call(page,'/similarity/photos/'+photo.id+'?distance=16');expect(matches.source_id).toBe(photo.id);expect(matches.candidates.some(p=>p.id===photo.id)).toBe(false);
 const filtered=await call(page,'/photos?analyzed_color='+encodeURIComponent(analysis.palette[0]));expect(filtered.photos.map(p=>p.id)).toContain(photo.id);
 expect(await call(page,'/photos/'+photo.id)).toMatchObject({favorite:true,color_label:'red',flag:'picked'});
 const groups=await call(page,'/similarity/groups?distance=16');const pairs=groups.groups.flatMap(g=>g.candidates.map(p=>g.source.id+':'+p.id));expect(new Set(pairs).size).toBe(pairs.length);
 await page.goto('/#/?page=photos');const card=page.locator('.photo-card').filter({hasText:photo.file_name}).locator('.photo-image');await card.focus();await card.press('Shift+F10');
 await page.getByRole('menuitem',{name:lang==='zh'?'按外观查相似照片':'Find photos with similar appearance'}).click();await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('button',{name:lang==='zh'?'画面语义':'Visual meaning',exact:true})).toBeDisabled();
 await expect(page.locator('.palette-swatches button').first()).toBeVisible();await page.locator('.palette-swatches button').first().click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.photo-card').filter({hasText:photo.file_name})).toBeVisible();await page.locator('.photo-card').filter({hasText:photo.file_name}).locator('.photo-image').dblclick();await expect(page.locator('.detail-image')).toBeVisible();
 expect(await sourceHash(page)).toBe(before);expect((await manifest(page)).visual_fingerprints).toHaveLength(3);
});

test('appearance cancellation keeps finished fingerprints and can explicitly resume',async({page})=>{
 await page.addInitScript(()=>{const Original=window.Worker;window.Worker=class extends Original{postMessage(message,...args){if(message?.action==='visual-fingerprint'&&++window.__appearanceCount===2){window.__appearanceHeld=true;window.__releaseAppearance=()=>super.postMessage(message,...args);return;}return super.postMessage(message,...args);}};window.__appearanceCount=0;});
 await setup(page);const before=await sourceHash(page),job=await call(page,'/similarity/index','POST');await page.waitForFunction(()=>window.__appearanceHeld);
 await call(page,'/jobs/'+job.id+'/cancel','POST');await page.evaluate(()=>window.__releaseAppearance());
 await expect.poll(async()=>(await manifest(page)).visual_fingerprints?.length||0).toBe(1);
 const resumed=await call(page,'/similarity/index','POST');await expect.poll(async()=>(await call(page,'/jobs/'+resumed.id)).status).toBe('completed');
 expect((await manifest(page)).visual_fingerprints).toHaveLength(3);expect((await call(page,'/jobs/'+resumed.id)).failed).toBe(0);expect(await sourceHash(page)).toBe(before);
});

test('appearance manifest upgrade backs up old bytes and rejects malformed or future records',async({page})=>{
 const photos=await setup(page),before=await sourceHash(page);
 const close=async()=>{await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();};
 const open=async()=>{await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();};
 await close();const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=20;delete m.visual_fingerprints;const bytes=JSON.stringify(m),w=await h.createWritable();await w.write(bytes);await w.close();return bytes;});
 await open();await expect(page.locator('.app-shell')).toBeVisible();
 const failure=await page.evaluate(async module=>{const original=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=async function(...args){if(this.name.startsWith('library.before-appearance-v21-'))throw new Error('synthetic backup unavailable');return original.apply(this,args);};try{await(await import(module)).browserAPI('/similarity/index','POST');return '';}catch(e){return e.message;}finally{FileSystemFileHandle.prototype.createWritable=original;}},apiModule);
 expect(failure).toContain('synthetic backup unavailable');expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(old);
 const job=await call(page,'/similarity/index','POST');await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');
 const saved=await manifest(page);expect(saved.version).toBe(24);expect(saved.visual_fingerprints).toHaveLength(3);
 const backups=await page.evaluate(async()=>{const result=[];for await(const f of window.__synthetic.data.values())if(f.name.startsWith('library.before-appearance-v21-'))result.push(await(await f.getFile()).text());return result;});expect(backups.filter(Boolean)).toEqual([old]);expect(backups.every(bytes=>bytes===''||bytes===old)).toBe(true);
 await close();for(const kind of ['future','bad-hash','missing-id','foreign-photo','duplicate']){
   const bytes=await page.evaluate(async({saved,kind})=>{const m=structuredClone(saved);if(kind==='future')m.version=99;if(kind==='bad-hash')m.visual_fingerprints[0].phash='invalid';if(kind==='missing-id')delete m.visual_fingerprints[0].photo_id;if(kind==='foreign-photo')m.visual_fingerprints[0].photo_id='missing';if(kind==='duplicate')m.visual_fingerprints.push(m.visual_fingerprints[0]);const bytes=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(bytes);await w.close();return bytes;},{saved,kind});
   await open();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bytes);
 }
 expect(photos).toHaveLength(3);expect(await sourceHash(page)).toBe(before);
});
async function openEditor(page,id){await page.goto('/#/tools/edit?photo='+id);await expect(page.locator('.edit-image img')).toBeVisible();await expect(page.getByText('正在处理，请稍候…',{exact:true})).toHaveCount(0);await expect(page.getByText('更新预览…',{exact:true})).toHaveCount(0);}

async function displayPhoto(page,id,edge=4096,expected='ready'){await page.goto('/#/?page=photos');await page.reload();await expect(page.locator('.app-shell')).toBeVisible();const photo=(await call(page,'/photos/'+id));await page.locator('.photo-card').filter({hasText:photo.file_name}).locator('.photo-image').dblclick();await page.getByRole('combobox',{name:/^(预览清晰度|Preview quality)$/}).selectOption(String(edge));await expect(page.locator('.detail-image')).toHaveAttribute('data-display-preview',expected);}

test('RAW batch import keeps real source files, uses embedded previews and opens a 16-bit darkroom source',async({page})=>{
  test.setTimeout(120000);const requests=[];page.on('request',request=>requests.push({url:request.url(),method:request.method()}));const names=['sample.CR2','sample.NEF','sample.ARW','sample.DNG'],paths=names.map(name=>fixtureRoot+name);for(const path of paths)expect(existsSync(path)).toBe(true);
  const hashes=Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));await setup(page);
  const before=(await call(page,'/jobs?summary=true')).map(j=>j.id);await page.locator('.topbar-actions').getByRole('button',{name:'导入照片',exact:true}).click();await page.getByLabel('导入照片文件',{exact:true}).setInputFiles(paths);await page.getByRole('button',{name:'开始导入',exact:true}).click();
  let job;await expect.poll(async()=>{job=(await call(page,'/jobs?summary=true')).find(j=>j.kind==='import'&&!before.includes(j.id));return job?.status;},{timeout:90000}).toBe('completed');
  const detail=await call(page,'/jobs/'+job.id);expect(detail).toMatchObject({total:4,success:4,failed:0,preview_total:4,preview_processed:4,preview_failed:0});
  const raw=(await call(page,'/photos?file_type=raw')).photos;expect(raw).toHaveLength(4);
  for(const photo of raw){expect(photo.is_raw).toBe(true);expect(photo.files[0].is_raw).toBe(true);expect(photo.file_hash).toBe(hashes[fixtureRoot+photo.file_name]);expect(photo.preview_status).toBe('ready');expect(photo.width*photo.height).toBeGreaterThan(0);}
  expect(raw.filter(p=>p.preview_source==='embedded-jpeg').length).toBeGreaterThanOrEqual(2);expect(raw.find(p=>p.file_name==='sample.DNG').preview_source).toBe('decoded-raw');
  const managed=await page.evaluate(async()=>{const library=JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text()),rows=[];for(const photo of library.photos.filter(p=>p.is_raw)){const file=await(await(await window.__synthetic.data.getDirectoryHandle('photos')).getFileHandle(photo.managed_path.split('/').at(-1))).getFile();rows.push([photo.file_name,[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('')]);}return rows;});
  for(const [name,hash] of managed)expect(hash).toBe(hashes[fixtureRoot+name]);
  await openEditor(page,raw.find(p=>p.file_name==='sample.DNG').id);await expect(page.locator('.edit-stage-top')).toContainText('16-bit');
  await page.getByRole('button',{name:'保存编辑',exact:true}).click();await expect(page.getByText('编辑参数已保存，原图保持不变。',{exact:true})).toBeVisible();expect((await manifest(page)).edits[0].source_hash).toBe(hashes[fixtureRoot+'sample.DNG']);
  // RAW can use the existing workshop and public display conversion, without replacing the source.
  const watermark=await call(page,'/watermark/export','POST',{photo_id:raw.find(p=>p.file_name==='sample.DNG').id,options:{long_edge:100,show_brand_logo:false,fields:[]}});expect(watermark.path).toMatch(/\.jpg$/);
  const display=await page.evaluate(async({workerPath,photo})=>{const file=await(await(await window.__synthetic.data.getDirectoryHandle('photos')).getFileHandle(photo.managed_path.split('/').at(-1))).getFile(),worker=new Worker(workerPath,{type:'module'});try{const result=await new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.result);worker.postMessage({id:1,action:'portfolio',payload:{file,edge:1600,quality:85}});});const bytes=new Uint8Array(await result.preview.arrayBuffer());return {type:result.preview.type,width:result.width,height:result.height,exif:new TextDecoder().decode(bytes).includes('Exif\0\0')};}finally{worker.terminate();}},{workerPath:'/assets/'+readdirSync(assets).find(f=>/^worker-.*\.js$/.test(f)),photo:raw.find(p=>p.file_name==='sample.DNG')});expect(display).toEqual({type:'image/jpeg',width:256,height:168,exif:false});
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/photos?file_type=raw')).total).toBe(4);expect((await call(page,'/photos?file_type=jpeg_only')).total).toBe(3);
  for(const path of paths)expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hashes[path]);
  expect(requests.filter(request=>request.method!=='GET'||(!request.url.startsWith('http://127.0.0.1:4185')&&!request.url.startsWith('blob:')))).toEqual([]);
});

test('linked RAW import cancellation terminates its worker and a rescan can finish the retained record',async({page})=>{
  await setup(page);const bytes=[...readFileSync(fixtureRoot+'sample.DNG')];
  await page.evaluate(async bytes=>{const handle=await window.__synthetic.originals.getFileHandle('linked.DNG',{create:true}),writer=await handle.createWritable();await writer.write(new Uint8Array(bytes));await writer.close();window.__rawTerminations=0;const terminate=Worker.prototype.terminate;Worker.prototype.terminate=function(){window.__rawTerminations++;return terminate.call(this);};window.__heldRaw=[];window.__holdRaw=true;const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){if(window.__holdRaw&&args[0]?.action==='previews'&&args[0]?.payload?.file?.name==='linked.DNG')window.__heldRaw.push(()=>send.apply(this,args));else send.apply(this,args);};},bytes);
  const picked=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:picked.paths});await page.waitForFunction(()=>window.__heldRaw.length===1);
  const raw=(await call(page,'/photos?file_type=raw')).photos[0];expect(raw.preview_status).toBe('pending');await call(page,'/jobs/'+job.id+'/cancel','POST');expect((await call(page,'/jobs/'+job.id)).status).toBe('cancelled');
  expect(await page.evaluate(()=>window.__rawTerminations)).toBe(1);
  await page.evaluate(()=>{window.__holdRaw=false;window.__heldRaw.shift()();});
  const again=await call(page,'/photos/import','POST',{paths:picked.paths});await expect.poll(async()=>(await call(page,'/jobs/'+again.id)).status,{timeout:20000}).toBe('completed');
  expect((await call(page,'/photos?file_type=raw')).total).toBe(1);expect((await call(page,'/photos/'+raw.id)).preview_status).toBe('ready');expect((await call(page,'/jobs/'+again.id)).skipped).toBe(4);
  expect(await page.evaluate(async()=>[...new Uint8Array(await(await(await window.__synthetic.originals.getFileHandle('linked.DNG')).getFile()).arrayBuffer())])).toEqual(bytes);
});

test('RAW preview refuses a source changed during decoding and a restored source can be rescanned',async({page})=>{
  await setup(page);const bytes=[...readFileSync(fixtureRoot+'sample.DNG')];
  await page.evaluate(async bytes=>{const h=await window.__synthetic.originals.getFileHandle('changing.DNG',{create:true}),w=await h.createWritable();await w.write(new Uint8Array(bytes));await w.close();window.__rawPublication=[];window.__holdPublication=true;const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){if(window.__holdPublication&&args[0]?.action==='previews'&&args[0]?.payload?.file?.name==='changing.DNG')window.__rawPublication.push(()=>send.apply(this,args));else send.apply(this,args);};},bytes);
  const picked=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:picked.paths});await page.waitForFunction(()=>window.__rawPublication.length===1);
  const raw=(await call(page,'/photos?file_type=raw')).photos[0];
  await page.evaluate(async bytes=>{const h=await window.__synthetic.originals.getFileHandle('changing.DNG'),w=await h.createWritable();await w.write(new Uint8Array([...bytes,42]));await w.close();window.__holdPublication=false;window.__rawPublication.shift()();},bytes);
  await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');expect((await call(page,'/jobs/'+job.id)).preview_failed).toBe(1);expect((await call(page,'/photos/'+raw.id)).preview_status).toBe('failed');
  expect(await page.evaluate(async id=>{try{await(await window.__synthetic.data.getDirectoryHandle('photos')).getFileHandle(id+'-preview.jpg');return true;}catch{return false;}},raw.id)).toBe(false);
  await page.evaluate(async bytes=>{const w=await(await window.__synthetic.originals.getFileHandle('changing.DNG')).createWritable();await w.write(new Uint8Array(bytes));await w.close();},bytes);
  const retry=await call(page,'/photos/import','POST',{paths:picked.paths});await expect.poll(async()=>(await call(page,'/jobs/'+retry.id)).status).toBe('completed');expect((await call(page,'/photos/'+raw.id)).preview_status).toBe('ready');
});

test('portrait embedded RAW previews rotate once and a damaged RAW does not block the batch',async({page})=>{
  const path=fixtureRoot+'sample.NEF',original=readFileSync(path),before=createHash('sha256').update(original).digest('hex'),portrait=Buffer.from(original),little=portrait.toString('ascii',0,2)==='II';
  const read16=offset=>little?portrait.readUInt16LE(offset):portrait.readUInt16BE(offset),read32=offset=>little?portrait.readUInt32LE(offset):portrait.readUInt32BE(offset),ifd=read32(4);let found=false;
  for(let i=0;i<read16(ifd);i++){const entry=ifd+2+i*12;if(read16(entry)===274){expect(read16(entry+2)).toBe(3);expect(read32(entry+4)).toBe(1);little?portrait.writeUInt16LE(6,entry+8):portrait.writeUInt16BE(6,entry+8);found=true;break;}}expect(found).toBe(true);
  await setup(page);const prior=(await call(page,'/jobs?summary=true')).map(j=>j.id);await page.locator('.topbar-actions').getByRole('button',{name:'导入照片',exact:true}).click();
  await page.getByLabel('导入照片文件',{exact:true}).setInputFiles([{name:'portrait.NEF',mimeType:'application/octet-stream',buffer:portrait},{name:'damaged.CR3',mimeType:'application/octet-stream',buffer:Buffer.from('not a RAW photo')}]);await page.getByRole('button',{name:'开始导入',exact:true}).click();
  let job;await expect.poll(async()=>{job=(await call(page,'/jobs?summary=true')).find(j=>j.kind==='import'&&!prior.includes(j.id));return job?.status;},{timeout:30000}).toBe('completed');
  const detail=await call(page,'/jobs/'+job.id);expect(detail).toMatchObject({total:2,success:1,failed:1,preview_failed:0});expect(detail.errors[0]).toContain('RAW file is unsupported by this decoder or is damaged.');
  const photo=(await call(page,'/photos?file_type=raw')).photos[0];expect(photo.file_name).toBe('portrait.NEF');
  expect(photo.height).toBeGreaterThan(photo.width);expect(photo.preview_source).toBe('embedded-jpeg');
  const size=await page.evaluate(async id=>{const file=await(await(await window.__synthetic.data.getDirectoryHandle('photos')).getFileHandle(id+'-preview.jpg')).getFile(),bitmap=await createImageBitmap(file);try{return [bitmap.width,bitmap.height];}finally{bitmap.close();}},photo.id);expect(size[1]).toBeGreaterThan(size[0]);expect(Math.max(...size)).toBeLessThanOrEqual(1600);
  await openEditor(page,photo.id);await expect(page.locator('.edit-stage-top')).toContainText(photo.width+' × '+photo.height+' · 16-bit');
  await page.goto('/#/?page=photos');await page.getByRole('button',{name:'筛选',exact:true}).click();await page.getByLabel('文件类型',{exact:true}).selectOption('raw');await expect(page.locator('.photo-card')).toHaveCount(1);
  expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before);
});

test('local persistent display survives reload and repairs a damaged cached JPEG',async({page})=>{
  test.setTimeout(90000);const photos=await setup(page),before=await sourceHash(page);await page.addInitScript(()=>{window.__displayDecodes=0;const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){if(args[0]?.action==='display')window.__displayDecodes++;return send.apply(this,args);};});
  await displayPhoto(page,photos[0].id);expect(await page.evaluate(()=>window.__displayDecodes)).toBe(1);expect(await cacheRows(page)).toHaveLength(1);
  await displayPhoto(page,photos[0].id);expect(await page.evaluate(()=>window.__displayDecodes)).toBe(0);await damageCache(page);await displayPhoto(page,photos[0].id);expect(await page.evaluate(()=>window.__displayDecodes)).toBe(1);expect(await sourceHash(page)).toBe(before);expect(await cacheRows(page)).toHaveLength(1);
  const changed=await page.evaluate(async name=>{const c=new OffscreenCanvas(1200,800),x=c.getContext('2d');x.fillStyle='orange';x.fillRect(0,0,c.width,c.height);const blob=await c.convertToBlob({type:'image/png'}),w=await(await window.__synthetic.originals.getFileHandle(name)).createWritable();await w.write(blob);await w.close();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');},photos[0].file_name);
  await displayPhoto(page,photos[0].id,4096,'error');expect(await page.evaluate(()=>window.__displayDecodes)).toBe(0);expect(await page.evaluate(async name=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await window.__synthetic.originals.getFileHandle(name)).getFile()).arrayBuffer()))].join(','),photos[0].file_name)).toBe(changed);
});

test('failed persistent writes are atomic soft misses and do not hide a local preview',async({page})=>{
  const photos=await setup(page),before=await sourceHash(page);await page.addInitScript(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='images'&&this.transaction.db.name==='photocollection-display-cache')throw new DOMException('Synthetic quota','QuotaExceededError');return put.apply(this,args);};});
  await displayPhoto(page,photos[0].id);expect(await cacheRows(page)).toHaveLength(0);await expect(page.locator('.detail-image>img')).toHaveJSProperty('naturalWidth',1200);expect(await sourceHash(page)).toBe(before);
});

test('denied display storage keeps previews working and explains the unavailable cache',async({page},info)=>{
  const photos=await setup(page),before=await sourceHash(page);await page.addInitScript(()=>{localStorage.setItem('lang','en');localStorage.setItem('theme','light');const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name,...args){if(name==='photocollection-display-cache')throw new DOMException('Synthetic denial','SecurityError');return open.call(this,name,...args);};});
  await displayPhoto(page,photos[0].id);await expect(page.locator('.detail-image>img')).toHaveJSProperty('naturalWidth',1200);expect(await sourceHash(page)).toBe(before);await page.goto('/#/?page=settings');await page.setViewportSize({width:390,height:1000});const cache=page.locator('.settings-card').filter({has:page.getByRole('heading',{name:'High-resolution display cache',exact:true})});await expect(cache).toContainText('Persistent cache is unavailable. Current previews still work.');await expect(cache.getByRole('button')).toBeDisabled();await cache.screenshot({path:info.outputPath('display-cache-unavailable.png')});
});

test('persistent publication trims other-library LRU, while clear preserves active images and export bytes',async({page,context})=>{
  test.setTimeout(90000);const photos=await setup(page),before=await sourceHash(page);await displayPhoto(page,photos[0].id);await seedOtherLibraries(page);await page.getByRole('combobox',{name:'预览清晰度',exact:true}).selectOption('6144');await expect(page.locator('.detail-image')).toHaveAttribute('data-display-preview','ready');const rows=await cacheRows(page);expect(rows).toHaveLength(64);expect(rows.reduce((sum,r)=>sum+r.size,0)).toBeLessThanOrEqual(256*1024*1024);expect(rows.filter(r=>r.library.startsWith('cache-fixture-'))).toHaveLength(62);
  const src=await page.locator('.detail-image>img').getAttribute('src'),result=await page.evaluate(async module=>{const c=new OffscreenCanvas(80,60);c.getContext('2d').fillRect(0,0,80,60);return(await import(module)).exported(await c.convertToBlob(),'cache-export.png');},apiModule),digest=()=>page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].join(','),result.url),exportBefore=await digest();
  const settings=await context.newPage();await settings.goto('/#/?page=settings');await settings.getByRole('button',{name:'清理此图库的高清缓存',exact:true}).click();await expect(settings.getByText('高清显示缓存已清理，原片和作品保留。',{exact:true})).toBeVisible();expect((await cacheRows(page)).every(row=>row.library.startsWith('cache-fixture-'))).toBe(true);expect(await page.evaluate(async url=>(await fetch(url)).status,src)).toBe(200);await expect(page.locator('.detail-image>img')).toHaveAttribute('src',src);expect(await digest()).toBe(exportBefore);expect(await sourceHash(page)).toBe(before);await settings.close();
});

for(const [width,lang,theme] of [[1440,'zh','dark'],[390,'en','light']])test(`editor command bindings, menu and actual local export agree ${width} ${lang}`,async({page},info)=>{
  const en=lang==='en';await page.setViewportSize({width,height:1000});await page.addInitScript(({lang,theme})=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',theme);},{lang,theme});const photos=await setup(page,lang),before=await sourceHash(page);
  await page.goto('/#/?page=settings');const recorder=page.getByLabel(en?'Editor · Save':'编辑器 · 保存',{exact:true});await recorder.press('Control+Shift+S');await expect(recorder).toHaveValue('Ctrl + Shift + S');
  await openEditor(page,photos[0].id);const initialPreview=await page.locator('.edit-image img').getAttribute('src');const exposure=page.getByRole('slider',{name:en?'Exposure EV':'曝光 EV',exact:true});await exposure.fill('1.7');const text=page.getByRole('textbox',{name:en?'Find library photo':'查找图库照片',exact:true});await text.fill('typing');await text.press('Delete');await text.press('Control+z');await expect(exposure).toHaveValue('1.7');
  await page.locator('.studio-heading h1').click();await page.keyboard.press('Control+z');await expect(exposure).toHaveValue('0');await page.keyboard.press('Control+y');await expect(exposure).toHaveValue('1.7');
  await page.evaluate(()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'S',ctrlKey:true,shiftKey:true,repeat:true,bubbles:true,cancelable:true})));expect((await manifest(page)).edits||[]).toHaveLength(0);await page.keyboard.press('Control+Shift+S');await expect(page.getByText(en?'Edits saved. Original unchanged.':'编辑参数已保存，原图保持不变。',{exact:true})).toBeVisible();expect((await manifest(page)).edits.find(e=>e.photo_id===photos[0].id).recipe.exposure).toBe(1.7);
  const trigger=page.getByRole('button',{name:en?'Edit actions':'编辑操作菜单',exact:true});await trigger.click();await expect(page.getByRole('menuitem',{name:en?'Save edits':'保存编辑',exact:true})).toHaveAttribute('aria-keyshortcuts','Control+Shift+S');const box=await page.getByRole('menu').boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(width);await page.screenshot({path:info.outputPath('local-command-menu.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  await expect(page.locator('.edit-image img')).not.toHaveAttribute('src',initialPreview);await expect(page.getByText(en?'Updating preview…':'更新预览…',{exact:true})).toHaveCount(0);const edited=await page.locator('.edit-image img').getAttribute('src');await page.keyboard.press('b');await expect(page.locator('.edit-image img')).not.toHaveAttribute('src',edited);await page.keyboard.press('b');await expect(page.locator('.edit-image img')).toHaveAttribute('src',edited);const download=page.waitForEvent('download');await page.keyboard.press('Control+e');expect((await download).suggestedFilename()).toMatch(/-edited\.(jpg|png)$/);expect(await sourceHash(page)).toBe(before);expect((await call(page,'/photos')).photos).toHaveLength(3);
});

test('watermark menu keeps undo, explicit save and the unsaved modal isolated from typing',async({page})=>{
  const photos=await setup(page),before=await sourceHash(page);await page.goto('/#/watermark/workshop?photo='+photos[0].id);const templates=page.locator('.template-tabs button');await expect(templates.first()).toBeVisible();await templates.nth(1).click();await page.locator('.draft-editor-bar small').click();await page.keyboard.press('Control+z');await expect(templates.first()).toHaveClass('active');await page.keyboard.press('Control+y');await expect(templates.nth(1)).toHaveClass('active');
  const title=page.getByRole('textbox',{name:'水印作品名称',exact:true});await title.fill('Local command frame');await title.press('Delete');await title.press('Control+s');expect((await manifest(page)).drafts).toHaveLength(0);await expect(templates.nth(1)).toHaveClass('active');
  await navigateWorkspace(page,'照片');const leave=page.getByRole('dialog',{name:'当前水印尚未保存',exact:true});await expect(leave).toBeVisible();await page.keyboard.press('Control+s');expect((await manifest(page)).drafts).toHaveLength(0);await page.keyboard.press('Escape');await expect(leave).toHaveCount(0);await expect(page).toHaveURL(/watermark\/workshop/);
  await page.getByRole('button',{name:'编辑操作菜单',exact:true}).click();await page.getByRole('menuitem',{name:'保存到水印图库',exact:true}).click();await expect.poll(async()=>(await manifest(page)).drafts.length).toBe(1);const draft=(await manifest(page)).drafts[0];expect(draft.name).toBe('Local command frame');expect(draft.settings_json.template).toBe('ambient');expect(await sourceHash(page)).toBe(before);expect((await call(page,'/photos')).photos).toHaveLength(3);
});

for(const [width,lang,theme] of [[1440,'zh','dark'],[390,'en','light']])test(`local comparison synchronizes authorized previews without modifying originals ${width} ${lang}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.addInitScript(({lang,theme})=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',theme);},{lang,theme});const photos=await setup(page,lang);
  const hashes=()=>page.evaluate(async()=>Promise.all([1,2,3].map(async i=>{const file=await(await window.__synthetic.originals.getFileHandle(`Landscape-${i}.png`)).getFile();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].join(',');}))),before=await hashes();
  await page.goto('/#/compare?ids='+photos.slice(0,2).map(p=>p.id).join(','));const cards=page.locator('.compare-item'),stages=cards.locator('.compare-stage');await expect(cards).toHaveCount(2);await expect.poll(()=>cards.locator('img').evaluateAll(images=>images.every(img=>img.naturalWidth>0&&parseFloat(img.style.width)>0))).toBe(true);
  const first=stages.first(),second=stages.nth(1),bounds=await first.boundingBox(),x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;await page.mouse.move(x,y);await page.mouse.wheel(0,-1000);await expect.poll(async()=>Number(await first.getAttribute('data-zoom'))).toBeGreaterThan(4);expect(await first.getAttribute('data-zoom')).toBe(await second.getAttribute('data-zoom'));
  if(width===390){const session=await page.context().newCDPSession(page);await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+25,y:y+20}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.send('Emulation.setTouchEmulationEnabled',{enabled:false});await session.detach();}
  else{await page.mouse.down();await page.mouse.move(x+25,y+20,{steps:3});await page.mouse.up();}
  await expect.poll(async()=>Number(await first.getAttribute('data-focus-x'))).toBeLessThan(.5);expect(await first.getAttribute('data-focus-x')).toBe(await second.getAttribute('data-focus-x'));await expect(first).toHaveAttribute('data-dragging','false');
  const sync=page.getByRole('button',{name:lang==='en'?'Sync views':'同步视图',exact:true});await sync.click();await first.focus();const secondX=await second.getAttribute('data-focus-x');await page.keyboard.press('ArrowRight');expect(await second.getAttribute('data-focus-x')).toBe(secondX);await page.keyboard.press('Delete');await expect(cards).toHaveCount(2);await expect(page.getByRole('dialog')).toHaveCount(0);
  await sync.click();await page.getByRole('button',{name:lang==='en'?'Fit views':'适应窗口',exact:true}).click();await expect(first).toHaveAttribute('data-zoom','1');await page.screenshot({path:info.outputPath('local-compare.png'),animations:'disabled'});
  expect(await hashes()).toEqual(before);await page.getByRole('button',{name:lang==='en'?'Back to Library':'返回图库',exact:true}).click();await expect(page).toHaveURL(/page=photos/);expect((await call(page,'/photos')).photos).toHaveLength(3);expect(await hashes()).toEqual(before);
});

test('multi-file import counts first, keeps local copies and reports duplicates and damaged photos',async({page},info)=>{
  await page.goto('/');await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const hash=await sourceHash(page),files=await page.evaluate(async()=>Promise.all([1,2,3].map(async i=>({name:`Landscape-${i}.png`,bytes:[...new Uint8Array(await(await(await window.__synthetic.originals.getFileHandle(`Landscape-${i}.png`)).getFile()).arrayBuffer())]}))));
  await page.getByRole('button',{name:'导入照片',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'导入你的照片'});
  await expect(dialog.getByRole('button',{name:'选择照片 单张 / 多张'})).toBeVisible();
  const inputs=files.map(f=>({name:f.name,mimeType:'image/png',buffer:Buffer.from(f.bytes)}));
  await dialog.locator('input[type=file]').setInputFiles([...inputs,{...inputs[0],name:'duplicate.png'},{name:'damaged.png',mimeType:'image/png',buffer:Buffer.from('damaged')}]);
  await expect(dialog).toContainText('已选择 5 张照片');await page.screenshot({path:info.outputPath('multi-file-import.png')});
  await page.evaluate(()=>{window.__holdImports=true;window.__importQueue=[];const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){if(window.__holdImports&&args[0]?.action==='metadata')window.__importQueue.push(()=>send.apply(this,args));else send.apply(this,args);};});
  await dialog.getByRole('button',{name:'开始导入'}).click();await page.waitForFunction(()=>window.__importQueue.length===1);
  const job=(await call(page,'/jobs'))[0];expect(job).toMatchObject({total:5,processed:0,phase:'processing'});await expect(page.locator('.job-summary b')).toHaveText('0 / 5');
  await page.evaluate(()=>window.__importQueue.shift()());await page.waitForFunction(()=>window.__importQueue.length===1);
  expect(await call(page,'/jobs/'+job.id)).toMatchObject({total:5,processed:1});
  await page.evaluate(()=>{window.__holdImports=false;window.__importQueue.shift()();});
  await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');expect(await call(page,'/jobs/'+job.id)).toMatchObject({total:5,processed:5,success:3,skipped:1,failed:1});
  const saved=await manifest(page);expect(saved.sources).toHaveLength(0);expect(saved.photos).toHaveLength(3);expect(saved.photos.every(p=>p.managed_path.startsWith('photos/'))).toBe(true);
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();const photos=(await call(page,'/photos')).photos;expect(photos.every(p=>!p.missing)).toBe(true);await openEditor(page,photos[0].id);
  expect(await sourceHash(page)).toBe(hash);
  await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('file-backup',{create:true});});
  await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）'}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();
  expect(await page.evaluate(async()=>{const root=await window.__synthetic.root.getDirectoryHandle('file-backup');for await(const dir of root.values()){const s=JSON.parse(await(await(await dir.getFileHandle('library.json')).getFile()).text());const photos=await dir.getDirectoryHandle('photos');for(const p of s.photos){const f=await(await photos.getFileHandle(p.managed_path.split('/').at(-1))).getFile(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==p.file_hash)return false;}return s.photos.length===3;}return false;})).toBe(true);
});

test('directory import counts only supported photos before processing and cancels safely',async({page})=>{
  await setup(page);const hash=await sourceHash(page);
  await page.evaluate(async()=>{const w=await(await window.__synthetic.originals.getFileHandle('notes.txt',{create:true})).createWritable();await w.write('not a photo');await w.close();window.__importQueue=[];const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){if(args[0]?.action==='metadata')window.__importQueue.push(()=>send.apply(this,args));else send.apply(this,args);};});
  const picked=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});await page.waitForFunction(()=>window.__importQueue.length===1);
  expect(await call(page,'/jobs/'+job.id)).toMatchObject({total:3,processed:0,phase:'processing'});
  await call(page,'/jobs/'+job.id+'/cancel','POST');await page.evaluate(()=>window.__importQueue.shift()());expect(await call(page,'/jobs/'+job.id)).toMatchObject({status:'cancelled',total:3,success:0});expect((await manifest(page)).photos).toHaveLength(3);expect(await sourceHash(page)).toBe(hash);
});

test('darkroom unifies tools and legacy routes; signature tiles render their fonts before selection',async({page},info)=>{
  const photos=await setup(page);await page.goto('/#/tools');await expect(page.locator('.studio-tool')).toHaveCount(4);await page.getByRole('button',{name:/光影暗房/}).click();await expect(page).toHaveURL(/#\/tools\/darkroom$/);
  for(const route of ['darkroom','analyze','raw','edit']){await page.goto('/#/tools/'+route+'?photo='+photos[0].id);await expect(page.getByRole('heading',{name:'光影暗房',exact:true})).toBeVisible();await expect(page.locator('.image-analysis')).toBeVisible();await expect(page.getByRole('button',{name:'打开参考图'})).toBeVisible();await expect(page.getByRole('slider',{name:'曝光 EV',exact:true})).toBeVisible();}
  await page.goto('/#/watermark/workshop?photo='+photos[0].id);await expect(page.locator('.browser-signature')).toHaveCount(7);
  const fonts=await page.locator('.browser-signature').evaluateAll(async spans=>Promise.all(spans.map(async span=>{const family=getComputedStyle(span).fontFamily;const loaded=await document.fonts.load('32px '+family,span.textContent);return {family,loaded:loaded.length};})));
  expect(fonts.map(f=>f.family.replaceAll('"',''))).toEqual(['pc-fine','pc-brush','pc-calligraphy','pc-chinese_brush','pc-chinese_running','pc-chinese_cursive','pc-chinese_handwriting']);expect(fonts.every(f=>f.loaded>0)).toBe(true);
  await page.locator('.signature-editor').screenshot({path:info.outputPath('signature-fonts-before-selection.png')});
});

test('ambient unsigned watermark differs only inside the signature area',async({page})=>{
  await setup(page);const hash=await sourceHash(page),worker='/assets/'+readdirSync(assets).find(f=>/^worker-.*\.js$/.test(f));
  const results=await page.evaluate(async workerPath=>{
    const w=new Worker(workerPath,{type:'module'});let id=0;const render=payload=>new Promise((resolve,reject)=>{w.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.result);w.postMessage({id:++id,action:'watermark',payload});});
    const photo={file_name:'test.png',camera_make:'Canon',camera_model:'Camera',lens_model:'Lens',iso:100,f_number:4,date_taken:'2026-10-16T10:00:00'},results=[];
    try{for(const [width,height] of [[1200,800],[600,900],[1600,400]]){
      const source=new OffscreenCanvas(width,height),ctx=source.getContext('2d');ctx.fillStyle='#68828a';ctx.fillRect(0,0,width,height);const file=await source.convertToBlob();
      const options={template:'ambient',style:'modern_info_bar',show_brand_logo:false,fields:['camera_make','camera_model','lens_model','iso','f_number','date_taken','signature'],signature:'wonder',signature_style:'text',theme:'white',font_size:1.5,font_scale:1,photo_scale:.88,blur:.08,intensity:.85,brightness:.7,saturation:1.25,shadow:true,radius:.008,format:'png',quality:95,long_edge:0};
      const signed=await createImageBitmap(await render({file,photo,options})),unsigned=await createImageBitmap(await render({file,photo,options:{...options,fields:options.fields.filter(f=>f!=='signature')}}));
      const a=new OffscreenCanvas(signed.width,signed.height),b=new OffscreenCanvas(unsigned.width,unsigned.height);a.getContext('2d').drawImage(signed,0,0);b.getContext('2d').drawImage(unsigned,0,0);
      const ap=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bp=b.getContext('2d').getImageData(0,0,b.width,b.height).data;let inside=0,outside=0;
      const u=Math.min(width,height),border=u*(1-options.photo_scale)/2,fullW=width+border*2,y=height+border*2;
      for(let i=0;i<ap.length;i+=4)if(ap.slice(i,i+4).some((v,c)=>v!==bp[i+c])){const x=(i/4)%a.width,py=Math.floor(i/4/a.width);if(x>=Math.floor(fullW*.34)&&x<=Math.ceil(fullW*.66)&&py>=Math.floor(y))inside++;else outside++;}
      const previewSigned=await createImageBitmap(await render({file,photo,options,preview:true})),previewUnsigned=await createImageBitmap(await render({file,photo,options:{...options,signature:''},preview:true}));
      results.push({sameSize:a.width===b.width&&a.height===b.height,inside,outside,previewSameSize:previewSigned.width===previewUnsigned.width&&previewSigned.height===previewUnsigned.height});for(const image of [signed,unsigned,previewSigned,previewUnsigned])image.close();
    }return results;}finally{w.terminate();}
  },worker);
  for(const r of results){expect(r.sameSize).toBe(true);expect(r.previewSameSize).toBe(true);expect(r.inside).toBeGreaterThan(0);expect(r.outside).toBe(0);}expect(await sourceHash(page)).toBe(hash);
});

test('curated showcase, editor history, persistence, export and workshop snapshot preserve originals',async({page},info)=>{
  const requests=[],errors=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));page.on('pageerror',e=>errors.push(e.message));
  const photos=await setup(page),hash=await sourceHash(page);await call(page,'/albums','POST',{name:'山野来信',photo_ids:photos.map(p=>p.id)});await page.reload();
  await page.getByRole('button',{name:'策展首页',exact:true}).click();await page.locator('.curation-choices button').nth(1).click();await page.locator('.curation-choices button').nth(0).click();await page.getByRole('button',{name:'保存首页',exact:true}).click();await expect(page.locator('.showcase-grid .showcase-photo')).toHaveCount(2);
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{scrollTo(0,0);document.activeElement?.blur()});await expect(page.locator('.showcase-images img.active')).toHaveJSProperty('naturalWidth',1200);await expect(page.locator('.showcase-images img.active')).toHaveCSS('opacity','1');await page.screenshot({path:info.outputPath('showcase-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath('showcase-mobile.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1440,height:1000});
  const chosen=(await manifest(page)).showcase.photo_ids;await page.reload();expect((await manifest(page)).showcase.photo_ids).toEqual(chosen);
  await page.goto('/#/tools');await expect(page.locator('.studio-tool')).toHaveCount(4);await page.screenshot({path:info.outputPath('tools-desktop.png'),fullPage:true});
  await openEditor(page,photos[0].id);await page.getByRole('slider',{name:'曝光 EV',exact:true}).fill('1.5');await expect(page.getByRole('button',{name:'保存编辑 •',exact:true})).toBeVisible();await page.getByRole('button',{name:'撤销编辑',exact:true}).click();await expect(page.getByRole('slider',{name:'曝光 EV',exact:true})).toHaveValue('0');await page.getByRole('button',{name:'重做编辑',exact:true}).click();await expect(page.getByRole('slider',{name:'曝光 EV',exact:true})).toHaveValue('1.5');await page.getByRole('button',{name:'保存编辑 •',exact:true}).click();await expect(page.getByRole('button',{name:'保存编辑',exact:true})).toBeEnabled();await expect.poll(async()=>(await manifest(page)).edits?.length).toBe(1);
  await expect(page.getByText('更新预览…',{exact:true})).toHaveCount(0);if(await page.getByRole('button',{name:'关闭提示',exact:true}).isVisible())await page.getByRole('button',{name:'关闭提示',exact:true}).click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath('editor-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('editor-mobile.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('combobox').filter({has:page.locator('option[value="png"]')}).selectOption('png');await page.getByRole('spinbutton',{name:'导出最长边'}).fill('600');const download=page.waitForEvent('download');await page.getByRole('button',{name:'另存并下载'}).click();const downloaded=await download;expect(downloaded.suggestedFilename()).toMatch(/edited\.png$/);await expect(page.getByText('正在处理，请稍候…',{exact:true})).toHaveCount(0);
  await page.goto('/#/tools/edit');await page.reload();await page.locator('.edit-records button').first().click();await expect(page.getByRole('slider',{name:'曝光 EV',exact:true})).toHaveValue('1.5');
  await page.getByRole('button',{name:'送入水印',exact:true}).click();await expect(page).toHaveURL(/#\/watermark\/workshop\?photo=/);const derivative=(await call(page,'/photos')).photos.find(p=>p.file_name.includes('-edited'));expect(derivative).toBeTruthy();expect(derivative.missing).toBe(false);expect((await manifest(page)).edits[0].recipe.exposure).toBe(1.5);expect(await sourceHash(page)).toBe(hash);expect(requests.filter(r=>r.method!=='GET'||r.url.includes('/api/')||!r.url.startsWith('http://127.0.0.1:4185')&&!r.url.startsWith('blob:'))).toEqual([]);expect(errors).toEqual([]);
});

test('worker preview/export agree and corrupt input recovers without uploading',async({page})=>{
  await setup(page);const result=await page.evaluate(async workerPath=>{const w=new Worker(workerPath,{type:'module'});let id=0;const call=(action,payload)=>new Promise((resolve,reject)=>{w.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.result);w.postMessage({id:++id,action,...payload});});try{const file=await(await window.__synthetic.originals.getFileHandle('Landscape-1.png')).getFile();await call('open',{file});const recipe={version:1,exposure:.5,contrast:10,highlights:0,shadows:0,temperature:8,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:90,flipX:false,flipY:false,crop:{x:0,y:0,width:1,height:1},sharpen:15,denoise:10,match:0,preserveLuminance:true};const preview=await call('render',{recipe}),output=await call('export',{recipe,edge:0,format:'png'});const digest=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].join(',');return {same:await digest(preview.blob)===await digest(output.blob),width:output.width,height:output.height};}finally{w.terminate();}},workerModule);expect(result).toEqual({same:true,width:800,height:1200});
  await page.goto('/#/tools/raw');await page.locator('input[type=file]').first().setInputFiles({name:'damaged.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not an image')});await expect(page.locator('.editor-page [role=alert]')).toBeVisible();await expect(page.getByText('正在处理，请稍候…',{exact:true})).toHaveCount(0);const p=(await call(page,'/photos')).photos[0];await page.getByRole('combobox',{name:'图库照片',exact:true}).selectOption(p.id);await expect(page.locator('.edit-image img')).toBeVisible();
});

test('browser viewer generates an on-demand high-resolution image locally and reuses it',async({page})=>{
  test.setTimeout(60000);const requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));await setup(page);
  const hash=await page.evaluate(async()=>{
    const c=new OffscreenCanvas(4800,900),x=c.getContext('2d');x.fillStyle='#8ea9ad';x.fillRect(0,0,4800,900);x.fillStyle='#25454c';x.fillRect(1200,400,2000,500);
    const blob=await c.convertToBlob({type:'image/png'}),stream=await(await window.__synthetic.originals.getFileHandle('High-resolution.png',{create:true})).createWritable();await stream.write(blob);await stream.close();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');
  });
  const picked=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');
  await page.goto('/#/?page=photos');await page.waitForFunction(()=>!!window.__synthetic);
  // The wrapper must survive navigation/reload in order to observe current-application work.
  await page.evaluate(()=>{const send=Worker.prototype.postMessage;window.__displayCalls=0;Worker.prototype.postMessage=function(...args){if(args[0]?.action==='display')window.__displayCalls++;return send.apply(this,args);};});
  await page.evaluate(()=>{window.__viewerEntryEvents=[];for(const type of ['pointerdown','pointerup','click','dblclick'])document.addEventListener(type,event=>{if(window.__viewerEntryEvents.length<24)window.__viewerEntryEvents.push({type,detail:event.detail,tag:event.target.tagName,label:event.target.closest?.('button')?.getAttribute('aria-label'),x:event.clientX,y:event.clientY});},true);});
  const card=page.locator('.photo-card').filter({hasText:'High-resolution.png'});await card.locator('.photo-image').dblclick();
  try{await expect(page.locator('.detail-image>img')).toHaveJSProperty('naturalWidth',1600);}catch(error){console.log('viewer-entry-diagnostic',JSON.stringify(await page.evaluate(()=>({events:window.__viewerEntryEvents,viewers:document.querySelectorAll('.photo-viewer').length,selected:document.querySelectorAll('.photo-card.selected').length}))));throw error;}expect(await page.evaluate(()=>window.__displayCalls)).toBe(0);
  await page.getByRole('button',{name:'预览实际像素',exact:true}).click();await expect.poll(()=>page.locator('.detail-image>img').evaluate(img=>img.getBoundingClientRect().width)).toBe(1600);
  await page.getByRole('combobox',{name:'预览清晰度'}).selectOption('4096');await expect(page.locator('.detail-image>img')).toHaveJSProperty('naturalWidth',4096,{timeout:30000});
  await expect.poll(()=>page.locator('.detail-image>img').evaluate(img=>img.getBoundingClientRect().width)).toBe(4096);
  expect(await page.evaluate(()=>window.__displayCalls)).toBe(1);await page.keyboard.press('Escape');await card.locator('.photo-image').dblclick();
  await expect(page.locator('.detail-image>img')).toHaveJSProperty('naturalWidth',4096);expect(await page.evaluate(()=>window.__displayCalls)).toBe(1);
  expect(await page.evaluate(async()=>{const f=await(await window.__synthetic.originals.getFileHandle('High-resolution.png')).getFile();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].join(',');})).toBe(hash);
  expect(requests.filter(r=>r.method!=='GET'||r.url.includes('/api/')||!r.url.startsWith('http://127.0.0.1:4185')&&!r.url.startsWith('blob:'))).toEqual([]);
});

test('one-shot display respects alpha background without replacing an editor source',async({page})=>{
  await setup(page);const result=await page.evaluate(async workerPath=>{
    const worker=new Worker(workerPath,{type:'module'});let id=0;
    const call=(action,payload)=>new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.result);worker.postMessage({id:++id,action,...payload});});
    const pixel=async blob=>{const bitmap=await createImageBitmap(blob);try{const c=new OffscreenCanvas(1,1),x=c.getContext('2d');x.drawImage(bitmap,0,0,1,1);return [...x.getImageData(0,0,1,1).data];}finally{bitmap.close();}};
    const original=new OffscreenCanvas(32,24);original.getContext('2d').fillStyle='#288c46';original.getContext('2d').fillRect(0,0,32,24);
    const clear=new OffscreenCanvas(20,16);clear.getContext('2d').clearRect(0,0,20,16);
    const file=new File([await original.convertToBlob()],'original.png'),transparent=new File([await clear.convertToBlob()],'transparent.png');
    const recipe={version:1,exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX:false,flipY:false,crop:{x:0,y:0,width:1,height:1},sharpen:0,denoise:0,match:0,preserveLuminance:true};
    try{await call('open',{file});const white=await call('display',{file:transparent,edge:4096,background:'white'}),black=await call('display',{file:transparent,edge:4096,background:'black'}),saved=await call('export',{recipe,format:'png',edge:0});return {white:await pixel(white.blob),black:await pixel(black.blob),saved:await pixel(saved.blob),size:[saved.width,saved.height]};}finally{worker.terminate();}
  },workerModule);
  expect(result.white.slice(0,3).every(v=>v>245)).toBe(true);expect(result.black.slice(0,3).every(v=>v<10)).toBe(true);expect(result.saved).toEqual([40,140,70,255]);expect(result.size).toEqual([32,24]);
});

test('public export includes only selected display copies and preserves originals',async({page},info)=>{
  const requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  const photos=await setup(page),hash=await sourceHash(page),before=await manifest(page);
  await call(page,'/albums','POST',{name:'山野来信',photo_ids:photos.map(p=>p.id)});await page.reload();
  await page.getByRole('button',{name:'导出公开作品',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导出公开作品'});
  await expect(dialog.locator('.curation-choices button')).toHaveCount(3);await dialog.locator('.curation-choices button').nth(0).click();await dialog.locator('.curation-choices button').nth(1).click();
  await dialog.getByLabel('作品标题',{exact:true}).nth(0).fill('山间来信');await dialog.getByLabel('作品标题',{exact:true}).nth(1).fill('暮色之下');await dialog.getByLabel('作品说明',{exact:true}).nth(0).fill('风吹过山谷。');await dialog.getByLabel('公开标签（逗号分隔）').first().fill('山野,旅行');
  await dialog.getByRole('checkbox').check();await page.screenshot({path:info.outputPath('publish-selection.png')});
  await page.evaluate(async()=>{window.__exportRoot=await window.__synthetic.root.getDirectoryHandle('public-exports',{create:true});window.showDirectoryPicker=async()=>window.__exportRoot;});
  await dialog.getByRole('button',{name:'选择目录并导出公开内容'}).click();await expect(dialog.getByRole('status')).toContainText('公开内容已导出：');
  const result=await page.evaluate(async()=>{for await(const folder of window.__exportRoot.values()){
    const out={};async function walk(dir,prefix=''){for await(const item of dir.values()){if(item.kind==='directory')await walk(item,prefix+item.name+'/');else out[prefix+item.name]=[...new Uint8Array(await(await item.getFile()).arrayBuffer())];}}await walk(folder);return out;
  }});
  const catalog=JSON.parse(Buffer.from(result['portfolio/manifest.json']).toString());expect(catalog.photos).toHaveLength(2);expect(catalog.albums[0].photoIds).toHaveLength(2);expect(catalog.photos[0].title).toBe('山间来信');
  expect(JSON.stringify(catalog)).not.toMatch(/Landscape-|file_path|relative_path|gps_|raw_exif|source_id|file_hash/);
  expect(catalog.photos.every(p=>p.src.startsWith('/portfolio/images/')&&p.width===1200&&p.height===800)).toBe(true);
  expect(await sourceHash(page)).toBe(hash);expect((await manifest(page)).photos).toEqual(before.photos);
  const output=fileURLToPath(new URL('../../.test-artifacts/public-export/',import.meta.url));
  for(const [name,bytes] of Object.entries(result)){mkdirSync(output+name.slice(0,name.lastIndexOf('/')+1),{recursive:true});writeFileSync(output+name,Buffer.from(bytes));}
  writeFileSync(output+'private-test.txt','Synthetic sentinel: must not enter the public build.');
  // Canvas-generated JPEGs contain no EXIF APP1 segment (including GPS).
  for(const [name,bytes] of Object.entries(result))if(name.endsWith('.jpg'))expect(Buffer.from(bytes).includes(Buffer.from('Exif\0\0'))).toBe(false);
  expect(requests.filter(r=>r.method!=='GET'||r.url.includes('/api/')||(!r.url.startsWith('http://127.0.0.1:4185')&&!r.url.startsWith('blob:')))).toEqual([]);
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'导出公开作品',exact:true}).click();await dialog.locator('.curation-choices button').first().click();
  await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.originals;});await dialog.getByRole('button',{name:'选择目录并导出公开内容'}).click();await expect(dialog.getByRole('alert')).toContainText('分开的导出目录');expect(await sourceHash(page)).toBe(hash);
});

test('cancelled public export and changed source never produce a publishable manifest',async({page})=>{
  const photos=await setup(page),hash=await sourceHash(page);await page.reload();await page.getByRole('button',{name:'导出公开作品',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导出公开作品'});await dialog.locator('.curation-choices button').first().click();
  await page.evaluate(async()=>{window.__exportRoot=await window.__synthetic.root.getDirectoryHandle('failed-public-exports',{create:true});window.showDirectoryPicker=async()=>window.__exportRoot;const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){if(args[0]?.action==='portfolio'){window.__publicPending=true;setTimeout(()=>send.apply(this,args),400);}else send.apply(this,args);};});
  await dialog.getByRole('button',{name:'选择目录并导出公开内容'}).click();await page.waitForFunction(()=>window.__publicPending);await dialog.getByRole('button',{name:'取消导出'}).click();await expect(dialog.getByRole('alert')).toContainText('操作已取消');expect(await sourceHash(page)).toBe(hash);
  const manifests=()=>page.evaluate(async()=>{let count=0;for await(const folder of window.__exportRoot.values()){try{const d=await folder.getDirectoryHandle('portfolio');await d.getFileHandle('manifest.json');count++;}catch{}}return count;});expect(await manifests()).toBe(0);
  await page.evaluate(async name=>{const handle=await window.__synthetic.originals.getFileHandle(name),bytes=await(await handle.getFile()).arrayBuffer(),writer=await handle.createWritable();await writer.write(new Blob([bytes,'changed-test-source']));await writer.close();},photos[0].file_name);
  await dialog.getByRole('button',{name:'选择目录并导出公开内容'}).click();await expect(dialog.getByRole('alert')).toContainText('原片内容已变化');expect(await manifests()).toBe(0);
});

for(const extension of ['DNG','CR2','NEF','ARW'])test(`real ${extension} decodes to 16-bit pixels and works offline after caching`,async({page,context},info)=>{
  test.setTimeout(180000);const path=fixtureRoot+`sample.${extension}`;test.skip(!existsSync(path),'Download the documented public validation fixtures first.');const before=createHash('sha256').update(readFileSync(path)).digest('hex');
  await setup(page);await page.goto('/#/tools/raw');await page.locator('input[type=file]').first().setInputFiles(path);await expect(page.locator('.edit-image img')).toBeVisible({timeout:120000});await expect(page.locator('.edit-stage-top')).toContainText('16-bit');await expect(page.getByText('更新预览…',{exact:true})).toHaveCount(0,{timeout:90000});await page.screenshot({path:info.outputPath(`${extension}-decoded.png`)});
  const caches=await page.evaluate(async()=>{const c=await window.caches.open((await window.caches.keys()).find(k=>k.startsWith('photo-browser-')));return (await c.keys()).map(r=>r.url);});expect(caches.some(u=>u.endsWith('/libraw.wasm'))).toBe(true);
  if(extension==='DNG'){await context.setOffline(true);await page.reload();await page.locator('input[type=file]').first().setInputFiles(path);await expect(page.locator('.edit-image img')).toBeVisible({timeout:90000});await context.setOffline(false);}
  expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before);
});

test('light theme, English and narrow tools remain accessible',async({page},info)=>{await setup(page);await page.evaluate(()=>{localStorage.setItem('theme','light')});await page.goto('/?lang=en#/tools');await expect(page.getByRole('heading',{name:'From light to a finished frame.'})).toBeVisible();await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('tools-light-english-mobile.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);});

test('reference colors and external-file edits survive backup; stale windows cannot overwrite them',async({page,context})=>{
  await setup(page);const originalHash=await sourceHash(page);const bytes=await page.evaluate(async()=>[...new Uint8Array(await(await(await window.__synthetic.originals.getFileHandle('Landscape-1.png')).getFile()).arrayBuffer())]);
  await page.goto('/#/tools/analyze');await page.locator('input[type=file]').first().setInputFiles({name:'external.png',mimeType:'image/png',buffer:Buffer.from(bytes)});await expect(page.locator('.edit-image img')).toBeVisible();
  await page.locator('input[type=file]').nth(1).setInputFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from(bytes)});await expect(page.locator('.reference-preview')).toBeVisible();await expect(page.getByRole('slider',{name:'仿色强度'})).toHaveValue('75');
  for(const value of ['1','2','-1','0.5'])await page.getByRole('slider',{name:'曝光 EV',exact:true}).fill(value);
  await page.getByRole('button',{name:'保存编辑 •',exact:true}).click();await expect(page.getByRole('button',{name:'保存编辑',exact:true})).toBeEnabled();await expect.poll(async()=>(await manifest(page)).edits?.length).toBe(1);const record=(await manifest(page)).edits[0];expect(record.photo_id).toBeNull();expect(record.source_path).toMatch(/^drafts\/edits\//);expect(record.recipe.reference.mean).toHaveLength(3);expect(record.recipe.exposure).toBe(.5);
  const other=await context.newPage();await other.goto('/#/tools/edit');await other.locator('.edit-records button').first().click();await expect(other.getByRole('slider',{name:'曝光 EV',exact:true})).toHaveValue('0.5');
  await page.getByRole('slider',{name:'曝光 EV',exact:true}).fill('1');await page.getByRole('button',{name:'保存编辑 •',exact:true}).click();await expect(page.getByRole('button',{name:'保存编辑',exact:true})).toBeEnabled();await expect.poll(async()=>(await manifest(page)).edits[0].recipe.exposure).toBe(1);
  await other.getByRole('slider',{name:'曝光 EV',exact:true}).fill('2');await other.getByRole('button',{name:'保存编辑 •',exact:true}).click();await expect(other.locator('.editor-page [role=alert]')).toContainText('其他窗口');expect((await manifest(page)).edits[0].recipe.exposure).toBe(1);other.on('dialog',d=>d.accept());await other.close();
  await page.goto('/#/?page=settings');await expect(page.getByRole('button',{name:'备份图库（含导入副本与派生作品）'})).toBeVisible();await page.evaluate(async()=>{const backup=await window.__synthetic.root.getDirectoryHandle('edit-backup',{create:true});window.showDirectoryPicker=async()=>backup;});await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）'}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();
  expect(await page.evaluate(async()=>{const backup=await window.__synthetic.root.getDirectoryHandle('edit-backup');for await(const d of backup.values()){const s=JSON.parse(await(await(await d.getFileHandle('library.json')).getFile()).text());let h=d;const parts=s.edits[0].source_path.split('/');for(const part of parts.slice(0,-1))h=await h.getDirectoryHandle(part);const f=await(await h.getFileHandle(parts.at(-1))).getFile();return f.size>0&&s.edits[0].recipe.exposure===1;}return false;})).toBe(true);expect(await sourceHash(page)).toBe(originalHash);
});

test('RAW decoding can be cancelled and a fresh photo opens afterwards',async({page,context})=>{
  const path=fixtureRoot+'sample.ARW';test.skip(!existsSync(path),'Download public RAW fixtures first.');await setup(page);await page.goto('/#/tools/raw');
  let release;const waiting=new Promise(r=>release=r);await context.route('**/raw-1.6.0/worker.js',async route=>{await waiting;await route.continue().catch(()=>{});});
  await page.locator('input[type=file]').first().setInputFiles(path);await page.getByRole('button',{name:'取消处理',exact:true}).click();release();await context.unroute('**/raw-1.6.0/worker.js');await expect(page.locator('.editor-welcome')).toBeVisible();const photo=(await call(page,'/photos')).photos[0];await page.getByRole('combobox',{name:'图库照片',exact:true}).selectOption(photo.id);await expect(page.locator('.edit-image img')).toBeVisible();
});

test('gallery and immersive viewer render at desktop and narrow widths',async({page},info)=>{
  await setup(page);await page.goto('/#/?page=photos');await expect(page.locator('.photo-card .photo-image img').first()).toBeVisible();await expect.poll(()=>page.locator('.photo-image img').evaluateAll(images=>images.length>0&&images.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:info.outputPath('gallery-desktop.png'),animations:'disabled'});await page.locator('.photo-image').first().dblclick();await expect(page.locator('.photo-viewer')).toBeVisible();await expect.poll(()=>page.locator('.detail-image>img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);await page.screenshot({path:info.outputPath('viewer-desktop.png'),animations:'disabled'});await page.getByRole('button',{name:'照片信息',exact:true}).click();const originalDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载',exact:true}).click();const originalFile=await originalDownload;expect(readFileSync(await originalFile.path()).length).toBeGreaterThan(1000);await page.getByRole('button',{name:'照片信息',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('viewer-mobile.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('library presentation and document zoom stay in their own scopes across library changes',async({page})=>{
  const photos=await setup(page),hash=await sourceHash(page);
  await openEditor(page,photos[0].id);await page.getByRole('combobox',{name:'预览缩放'}).selectOption('2');
  await page.getByRole('button',{name:/^保存编辑/}).click();
  await expect.poll(async()=>(await manifest(page)).edits?.[0]?.view_preferences?.zoom).toBe(2);
  await page.goto('/#/tools/darkroom');await page.locator('.edit-records button').filter({hasText:photos[0].file_name}).click();
  await expect(page.getByRole('combobox',{name:'预览缩放'})).toHaveValue('2');
  await openEditor(page,photos[1].id);await expect(page.getByRole('combobox',{name:'预览缩放'})).toHaveValue('1');
  await page.goto('/#/?page=photos');await page.getByRole('slider',{name:'网格大小',exact:true}).fill('315');
  await page.getByRole('button',{name:'网格显示设置',exact:true}).click();await page.getByRole('combobox',{name:'浏览布局'}).selectOption('waterfall');
  await expect.poll(async()=>(await manifest(page)).view_preferences).toMatchObject({grid:315,layout:'waterfall'});
  const first=(await manifest(page)).id;
  async function close(){await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();}
  await close();await page.evaluate(async()=>{const second=await window.__synthetic.root.getDirectoryHandle('second-library',{create:true});window.showDirectoryPicker=async()=>second;});
  await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  await page.goto('/#/?page=photos');await expect(page.getByRole('slider',{name:'网格大小',exact:true})).toHaveValue('230');
  await page.getByRole('button',{name:'网格显示设置',exact:true}).click();await expect(page.getByRole('combobox',{name:'浏览布局'})).toHaveValue('justified');
  await page.getByRole('slider',{name:'网格大小',exact:true}).fill('210');
  await expect.poll(async()=>(await manifest(page,'second-library')).view_preferences?.grid).toBe(210);
  await close();await page.evaluate(()=>{window.showDirectoryPicker=async()=>window.__synthetic.data;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  await page.goto('/#/?page=photos');await expect(page).toHaveURL(/#\/\?page=photos$/);await expect(page.getByRole('slider',{name:'网格大小',exact:true})).toHaveValue('315');
  expect((await manifest(page)).id).toBe(first);expect(await sourceHash(page)).toBe(hash);
});


test('a fragment change immediately after library mount is handled before the first paint',async({page})=>{
  await page.goto('/#/?page=settings');await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();
  await page.evaluate(()=>{window.__routeAtMount=false;const observer=new MutationObserver(()=>{if(document.querySelector('.app-shell')&&!window.__routeAtMount){window.__routeAtMount=true;observer.disconnect();location.hash='/?page=photos';}});observer.observe(document.documentElement,{childList:true,subtree:true});});
  await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page).toHaveURL(/#\/\?page=photos$/);
  await expect(page.locator('.gallery-heading h1')).toBeVisible();
});


async function holdAnalysis(page){await page.evaluate(()=>{
  window.__holdAnalysis=true;window.__heldAnalysis=[];window.__analysisCalls=0;window.__analysisReplies=0;
  const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...rest){
    const deliver=()=>{if(message.action==='metadata'){const listener=({data})=>{if(data.id===message.id){window.__analysisReplies++;this.removeEventListener('message',listener);}};this.addEventListener('message',listener);}return send.call(this,message,...rest);};
    if(message.action==='metadata'){window.__analysisCalls++;if(window.__holdAnalysis){window.__heldAnalysis.push(deliver);return;}}return deliver();
  };
});}

test('browser task queues cancel waiting work, retain the image slot and expose real stages',async({page})=>{
  const photos=await setup(page),hash=await sourceHash(page),picked=await call(page,'/dialog/directory','POST');
  const draft=await call(page,'/watermark/drafts','POST',{photo_id:photos[0].id,settings_json:{long_edge:200,format:'png'}});await holdAnalysis(page);
  const first=await call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});await page.waitForFunction(()=>window.__heldAnalysis.length===1);
  const waiting=await call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});expect((await call(page,'/jobs/'+waiting.id)).status).toBe('queued');
  const exported=await call(page,'/watermark/drafts/batch-export','POST',{draft_ids:[draft.id]});
  await expect.poll(async()=>(await call(page,'/tasks/resources')).items.find(i=>i.name==='render').running).toBe(1);
  await call(page,'/jobs/'+waiting.id+'/cancel','POST');await call(page,'/jobs/'+first.id+'/cancel','POST');
  await expect.poll(async()=>(await call(page,'/tasks/resources')).items.find(i=>i.name==='io').running).toBe(0);
  const last=await call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});await expect.poll(async()=>(await call(page,'/tasks/resources')).items.find(i=>i.name==='io').running).toBe(1);
  expect(await page.evaluate(()=>window.__analysisCalls)).toBe(1);
  await page.evaluate(()=>{window.__holdAnalysis=false;for(const send of window.__heldAnalysis.splice(0))send();});
  await expect.poll(async()=>(await call(page,'/jobs/'+last.id)).status).toBe('completed');await expect.poll(async()=>(await call(page,'/jobs/'+exported.id)).status).toBe('completed');
  expect((await call(page,'/jobs/'+first.id)).status).toBe('cancelled');expect((await call(page,'/jobs/'+waiting.id)).status).toBe('cancelled');expect(await page.evaluate(()=>window.__analysisCalls)).toBe(4);
  const stages=await call(page,'/jobs/'+last.id+'/children');expect(stages.items.map(s=>s.kind)).toEqual(['import-scan','import-index','import-preview']);expect(stages.items.every(s=>s.status==='completed')).toBe(true);
  const output=(await call(page,'/jobs/'+exported.id)).results[0];expect(await page.evaluate(async url=>(await fetch(url)).ok,output.url)).toBe(true);
  await page.getByRole('button',{name:'活动中心',exact:true}).click();const dialog=page.getByRole('dialog',{name:'活动中心',exact:true});await dialog.locator(`[data-task-id="${last.id}"]`).click();await expect(dialog.locator('.activity-stages button')).toHaveCount(3);await dialog.locator('.activity-resources summary').click();await expect(dialog.locator('.activity-resource-grid p')).toHaveCount(4);
  expect((await call(page,'/photos')).total).toBe(3);expect(await sourceHash(page)).toBe(hash);
});

test('live library close isolates delayed workers, cancels queues and clears the session key',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);const before=await sourceHash(page),old=(await manifest(page)).id,picked=await call(page,'/dialog/directory','POST');
  await call(page,'/art/settings','PUT',{api_key:'scope-session-secret',relay_url:'wss://synthetic-relay.invalid/cloud-art'});await holdAnalysis(page);await page.evaluate(()=>window.__sessionSentinel='same-document');
  const first=await call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});await page.waitForFunction(()=>window.__heldAnalysis.length===1);const second=await call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});
  async function close(){await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();}
  await close();expect(await page.evaluate(()=>window.__sessionSentinel)).toBe('same-document');
  await page.evaluate(async()=>{window.__synthetic.second=await window.__synthetic.root.getDirectoryHandle('live-second-library',{create:true});window.showDirectoryPicker=async()=>window.__synthetic.second;});
  await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/art/settings')).key_configured).toBe(false);
  await page.evaluate(()=>{window.__holdAnalysis=false;for(const send of window.__heldAnalysis.splice(0))send();});await page.waitForFunction(()=>window.__analysisReplies===1);
  const next=await manifest(page,'live-second-library');expect(next.id).not.toBe(old);expect(next.photos).toEqual([]);expect(next.jobs).toEqual([]);expect(next.works).toEqual([]);expect(next.drafts).toEqual([]);
  await expect(call(page,'/jobs/'+first.id)).rejects.toThrow();const saved=await manifest(page);expect(saved.jobs.find(j=>j.id===first.id).status).toBe('cancelled');expect(saved.jobs.find(j=>j.id===second.id).status).toBe('cancelled');expect(JSON.stringify(saved)+JSON.stringify(next)).not.toContain('scope-session-secret');
  await close();await page.evaluate(()=>window.showDirectoryPicker=async()=>window.__synthetic.data);await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/photos')).total).toBe(3);expect((await call(page,'/tasks/resources')).pending).toBe(0);expect(await page.evaluate(()=>window.__analysisCalls)).toBe(1);
  expect(await sourceHash(page)).toBe(before);expect(errors).toEqual([]);
});

test('reload interrupts unfinished stages without replay and keeps completed exports and stages',async({page})=>{
  const photos=await setup(page),before=await sourceHash(page),picked=await call(page,'/dialog/directory','POST');
  const draft=await call(page,'/watermark/drafts','POST',{photo_id:photos[0].id,settings_json:{long_edge:200,format:'png'}}),exported=await call(page,'/watermark/drafts/batch-export','POST',{draft_ids:[draft.id]});
  await expect.poll(async()=>(await call(page,'/jobs/'+exported.id)).status).toBe('completed');const result=(await call(page,'/jobs/'+exported.id)).results[0];
  const outputHash=await page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].join(','),result.url);
  await holdAnalysis(page);const first=await call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});await page.waitForFunction(()=>window.__heldAnalysis.length===1);const waiting=await call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();
  expect((await call(page,'/jobs/'+first.id)).status).toBe('interrupted');expect((await call(page,'/jobs/'+waiting.id)).status).toBe('interrupted');expect((await call(page,'/tasks/resources')).pending).toBe(0);
  const stages=(await call(page,'/jobs/'+first.id+'/children')).items;expect(stages.map(s=>s.kind)).toEqual(['import-scan','import-index','import-preview']);expect(stages.map(s=>s.status)).toEqual(['completed','interrupted','interrupted']);
  const kept=await call(page,'/jobs/'+exported.id);expect(kept.status).toBe('completed');expect(kept.results[0].path).toBe(result.path);expect(await page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].join(','),kept.results[0].url)).toBe(outputHash);
  expect((await call(page,'/photos')).total).toBe(3);expect(await sourceHash(page)).toBe(before);
});


async function holdProgressivePreviews(page,advance=0){await page.evaluate(advance=>{
  window.__previewHeld=[];window.__holdPreviews=true;window.__imageActions=[];window.__previewBoundaries=[];window.__metadataReplies=0;window.__importClock=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>window.__importClock});
  const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...rest){
    if(message.action==='metadata'){
      const listener=({data})=>{if(data.id===message.id){window.__metadataReplies++;window.__importClock+=advance;this.removeEventListener('message',listener);}};this.addEventListener('message',listener);
    }
    if(['metadata','previews','watermark'].includes(message.action))window.__imageActions.push(message.action);
    if(message.action==='previews'){
      window.__previewBoundaries.push(window.__metadataReplies);
      if(window.__holdPreviews){window.__previewHeld.push(()=>send.call(this,message,...rest));return;}
    }
    return send.call(this,message,...rest);
  };
},advance);}
async function releasePreviews(page){await page.evaluate(()=>{window.__holdPreviews=false;for(const send of window.__previewHeld.splice(0))send();});}
async function selectedImport(page,names){return page.evaluate(async({module,names})=>{
  const files=await Promise.all(names.map(async name=>(await window.__synthetic.originals.getFileHandle(name)).getFile()));return (await import(module)).importSelectedFiles(files);
},{module:apiModule,names});}

test('progressive first-screen and steady batches preserve live annotations and deletion and yield to exports',async({page})=>{
  test.setTimeout(60000);const photos=await setup(page),before=await sourceHash(page);
  const draft=await call(page,'/watermark/drafts','POST',{photo_id:photos[0].id,settings_json:{long_edge:200,format:'png'}});
  const names=await page.evaluate(async()=>{
    const names=[],c=new OffscreenCanvas(64,48),x=c.getContext('2d');window.__progressiveHashes={};
    for(let i=0;i<127;i++){
      x.fillStyle=`rgb(${i},${i*17%255},${i*59%255})`;x.fillRect(0,0,64,48);const blob=await c.convertToBlob({type:'image/png'}),name=`Batch-${i}.png`,w=await(await window.__synthetic.originals.getFileHandle(name,{create:true})).createWritable();await w.write(blob);await w.close();names.push(name);
      window.__progressiveHashes[name]=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');
    }return names;
  });
  await holdProgressivePreviews(page);const job=await selectedImport(page,names);await page.waitForFunction(()=>window.__previewHeld.length===1);
  expect(await call(page,'/jobs/'+job.id)).toMatchObject({total:127,processed:24,success:24,phase:'previews',preview_total:24});
  const indexed=(await call(page,'/photos?page_size=200')).photos.filter(p=>p.file_name.startsWith('Batch-'));expect(indexed).toHaveLength(24);expect(indexed.every(p=>p.preview_status==='pending'&&!p.thumbnail_url&&!p.preview_url)).toBe(true);
  const deleted=indexed.find(p=>p.file_name==='Batch-0.png'),marked=indexed.find(p=>p.id!==deleted.id);
  await call(page,'/photos/'+marked.id,'PATCH',{rating:4,favorite:true,tags:['during preview']});expect((await call(page,'/photos?search=during%20preview')).total).toBe(1);
  const album=await call(page,'/albums','POST',{name:'during preview',photo_ids:[marked.id]});await call(page,'/photos/'+deleted.id,'DELETE');
  const exported=await call(page,'/watermark/drafts/batch-export','POST',{draft_ids:[draft.id]});expect((await call(page,'/jobs/'+exported.id)).status).toBe('queued');
  expect(await page.evaluate(()=>window.__previewHeld.length)).toBe(1);await releasePreviews(page);
  await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status,{timeout:40000}).toBe('completed');await expect.poll(async()=>(await call(page,'/jobs/'+exported.id)).status).toBe('completed');
  expect(await call(page,'/jobs/'+job.id)).toMatchObject({total:127,processed:127,success:127,failed:0,preview_total:127,preview_processed:127,preview_failed:0});
  const boundaries=await page.evaluate(()=>[window.__previewBoundaries[0],window.__previewBoundaries[24],window.__previewBoundaries[124]]);expect(boundaries).toEqual([24,124,127]);
  const actions=await page.evaluate(()=>window.__imageActions),first=actions.indexOf('previews');expect(actions.indexOf('watermark')).toBeGreaterThan(first);expect(actions.indexOf('watermark')).toBeLessThan(actions.indexOf('previews',first+1));
  expect((await call(page,'/photos')).total).toBe(129);await expect(call(page,'/photos/'+deleted.id)).rejects.toThrow();expect(await call(page,'/photos/'+marked.id)).toMatchObject({rating:4,favorite:true,tags:['during preview'],preview_status:'ready'});expect((await call(page,'/albums/'+album.id)).count).toBe(1);
  expect(await page.evaluate(async()=>{for(const [name,expected] of Object.entries(window.__progressiveHashes)){const f=await(await window.__synthetic.originals.getFileHandle(name)).getFile();if([...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].join(',')!==expected)return false;}return true;})).toBe(true);expect(await sourceHash(page)).toBe(before);
});

test('eight-second preview boundary publishes a short batch without waiting for the count limit',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();const before=await sourceHash(page);
  await holdProgressivePreviews(page,4000);const job=await selectedImport(page,['Landscape-1.png','Landscape-2.png','Landscape-3.png']);await page.waitForFunction(()=>window.__previewHeld.length===1);
  expect(await call(page,'/jobs/'+job.id)).toMatchObject({total:3,processed:2,success:2,phase:'previews',preview_total:2});expect((await call(page,'/photos')).total).toBe(2);
  await releasePreviews(page);await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');expect(await page.evaluate(()=>window.__previewBoundaries)).toEqual([2,2,3]);expect(await sourceHash(page)).toBe(before);
});

test('cancelling a live preview keeps the completed index and explicit reimport repairs pending records',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();const before=await sourceHash(page);
  const names=['Landscape-1.png','Landscape-2.png','Landscape-3.png'];await holdProgressivePreviews(page);const job=await selectedImport(page,names);await page.waitForFunction(()=>window.__previewHeld.length===1);
  await page.goto('/#/?page=photos');await page.locator('.photo-image[aria-label$=\"Landscape-1.png\"]').dblclick();await expect(page.locator('.photo-viewer').getByRole('status')).toHaveText('预览正在生成');
  const stages=(await call(page,'/jobs/'+job.id+'/children')).items;expect(stages.map(j=>j.status)).toEqual(['completed','completed','running']);await call(page,'/jobs/'+stages[2].id+'/cancel','POST');await releasePreviews(page);
  await expect.poll(async()=>(await call(page,'/tasks/resources')).pending).toBe(0);expect(await call(page,'/jobs/'+job.id)).toMatchObject({status:'cancelled',total:3,processed:3,success:3,preview_processed:1});expect((await call(page,'/jobs/'+job.id+'/children')).items.map(j=>j.status)).toEqual(['completed','completed','cancelled']);
  expect((await call(page,'/photos')).photos.filter(p=>p.preview_status==='ready')).toHaveLength(1);
  await expect.poll(()=>page.locator('.photo-viewer .detail-image img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);await page.keyboard.press('Escape');
  const repaired=await selectedImport(page,names);await expect.poll(async()=>(await call(page,'/jobs/'+repaired.id)).status).toBe('completed');expect(await call(page,'/jobs/'+repaired.id)).toMatchObject({success:0,skipped:3,preview_total:2,preview_processed:2,preview_failed:0});expect((await call(page,'/photos')).photos.every(p=>p.preview_status==='ready')).toBe(true);expect(await sourceHash(page)).toBe(before);
});


for(const [width,lang,theme] of [[1440,'zh','dark'],[390,'en','light']])test(`local viewer zoom and white proof preserve source files ${width} ${lang}`,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.addInitScript(({lang,theme})=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',theme);},{lang,theme});await setup(page,lang);const before=await sourceHash(page);let dialogs=0;page.on('dialog',dialog=>{dialogs++;void dialog.dismiss();});
  await page.goto('/#/?page=photos');await page.locator('.photo-image').first().dblclick();const stage=page.locator('.detail-image'),image=stage.locator(':scope > img'),tools=page.getByRole('toolbar',{name:lang==='en'?'Photo view tools':'照片查看工具',exact:true}),field=tools.getByRole('spinbutton',{name:lang==='en'?'View zoom percent':'查看缩放百分比',exact:true});await expect(field).toBeEnabled();
  const source=await image.getAttribute('src');await field.fill('150');await field.press('Delete');expect(dialogs).toBe(0);await field.fill('200');await field.press('Enter');await expect(stage).toHaveAttribute('data-view-scale','2');
  const initial=await image.boundingBox(),box=await stage.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2+40,{steps:3});await page.mouse.up();const moved=await image.boundingBox();expect(Math.abs(moved.x-initial.x-70)).toBeLessThan(1);expect(Math.abs(moved.y-initial.y-40)).toBeLessThan(1);
  if(width===390){const session=await page.context().newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height/2;await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+50,y:y+30}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(async()=>Math.abs((await image.boundingBox()).x-moved.x-50)).toBeLessThan(1);await expect(stage).toHaveAttribute('data-dragging','false');await session.send('Emulation.setTouchEmulationEnabled',{enabled:false});await session.detach();}
  const caption=await page.locator('.viewer-caption b').innerText();await stage.evaluate(el=>{el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[new Touch({identifier:1,target:el,clientX:280,clientY:200})]}));el.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[new Touch({identifier:1,target:el,clientX:120,clientY:205})]}));});await expect(page.locator('.viewer-caption b')).toHaveText(caption);
  await tools.getByRole('button',{name:lang==='en'?'White proof background':'白底校样',exact:true}).click();await expect(stage).toHaveCSS('background-color','rgb(255, 255, 255)');expect(await image.getAttribute('src')).toBe(source);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await tools.getByRole('button',{name:lang==='en'?'Fit':'适应',exact:true}).click();await expect(stage).toHaveAttribute('data-zoom-mode','fit');await stage.evaluate(el=>{el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[new Touch({identifier:1,target:el,clientX:280,clientY:200})]}));el.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[new Touch({identifier:1,target:el,clientX:120,clientY:205})]}));});await expect(page.locator('.viewer-caption b')).not.toHaveText(caption);
  await page.keyboard.press('Escape');expect((await call(page,'/photos')).total).toBe(3);expect(await sourceHash(page)).toBe(before);
});

for(const layout of ['justified','grid','tiles','waterfall'])test(`browser photos remain interactive immediately after scrolling ${layout}`,async({page},info)=>{
  await page.addInitScript(()=>localStorage.setItem('lang','en'));await page.setViewportSize({width:390,height:740});await page.emulateMedia({reducedMotion:'reduce'});
  const photos=await setup(page,'en'),before=await sourceHash(page);await page.goto('/#/?page=photos');await expect(page.locator('.photo-card')).toHaveCount(3);
  const id=await page.locator('.photo-card').last().getAttribute('data-photo-id'),photo=photos.find(p=>p.id===id);
  await exercisePhotoActivation(page,{id,name:photo.file_name,layout,screenshot:info.outputPath('browser-photo-activation.png')});
  expect(await sourceHash(page)).toBe(before);
});


test('composition v2 pins the old catalog before its first save, aborts a failed backup and reopens its actual pixels',async({page},info)=>{
  const photos=await setup(page),photoId=photos.find(p=>p.file_name==='Landscape-1.png').id,before=await sourceHash(page);
  const result=await page.evaluate(async({module,photoId})=>{
    const services=await(await import(module)).createEditorServices(),photo={id:photoId};
    const file=await(await window.__synthetic.originals.getFileHandle('Landscape-1.png')).getFile();
    const neutral={version:1,exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX:false,flipY:false,crop:{x:0,y:0,width:1,height:1},sharpen:0,denoise:0,match:0,preserveLuminance:true};
    await services.library.save(file,{...neutral,crop:{x:0,y:0,width:.5,height:1}},photo.id);
    const old=await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text(),recipe={...neutral,version:2,crop:{x:.2,y:.2,width:.6,height:.6},composition:{source_width:1200,source_height:800,angle:20,aspect:1.5}};
    const proto=Object.getPrototypeOf(window.__synthetic.data),get=proto.getFileHandle;let failed=false;
    proto.getFileHandle=async function(name,options){if(name.startsWith('library.before-composition-v2-'))throw new DOMException('Blocked backup','NotAllowedError');return get.call(this,name,options)};
    try{await services.library.save(file,recipe,photo.id);}catch{failed=true;}finally{proto.getFileHandle=get;}
    const unchanged=await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text()===old;
    const saved=await services.library.save(file,recipe,photo.id),next=await services.library.save(file,{...recipe,composition:{...recipe.composition,angle:22}},photo.id,saved),backups=[];
    for await(const entry of window.__synthetic.data.values())if(entry.name.startsWith('library.before-composition-v2-'))backups.push(await(await entry.getFile()).text());
    return {failed,unchanged,old,backups,recipe:next.recipe,records:(await services.library.listRecords()).items.map(r=>r.recipe.version)};
  },{module:editorAdapterModule,photoId});
  expect(result.failed).toBe(true);expect(result.unchanged).toBe(true);expect(result.backups).toEqual([result.old]);expect(result.records.sort()).toEqual([1,2]);expect(result.recipe.composition.angle).toBe(22);
  await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  await page.goto('/#/tools/edit');await page.locator('.edit-records>div').first().getByRole('button').first().click();await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',720);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalHeight',480);
  const preview=await page.locator('.edit-image img').evaluate(async img=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(img.src)).arrayBuffer()))].join(','));
  const controls=page.locator('.edit-controls details').last();await controls.getByRole('combobox').selectOption('png');await page.getByRole('spinbutton',{name:'导出最长边',exact:true}).fill('0');const download=page.waitForEvent('download');await controls.getByRole('button',{name:'另存并下载',exact:true}).click();const path=info.outputPath('composition-v2.png');await(await download).saveAs(path);
  const bytes=readFileSync(path);expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]).toEqual([720,480]);expect([...createHash('sha256').update(bytes).digest()].join(',')).toBe(preview);expect(await sourceHash(page)).toBe(before);
  const current=await manifest(page);await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'新建本地图库',exact:true})).toBeVisible();
  for(const kind of ['future','mislabeled','old-catalog']){
    const protectedBytes=await page.evaluate(async({current,kind})=>{const next=structuredClone(current),edit=next.edits.find(e=>e.recipe.version===2);if(kind==='future')edit.recipe.version=3;else if(kind==='mislabeled')edit.recipe.version=1;else next.version=9;const bytes=JSON.stringify(next),stream=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await stream.write(bytes);await stream.close();return bytes;},{current,kind});
    await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(protectedBytes);
  }
});

test('real worker composition uses the same coordinates for a scaled preview and full PNG output',async({page})=>{
  test.setTimeout(90000);await setup(page);const result=await page.evaluate(async workerPath=>{
    const width=3201,height=2401,canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d'),pixels=context.createImageData(width,height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.data.set([Math.round(x/width*200),Math.round(y/height*200),180,255],(y*width+x)*4);
    context.putImageData(pixels,0,0);const file=new File([await canvas.convertToBlob({type:'image/png'})],'gradient-source.png',{type:'image/png'}),digest=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(','),before=await digest(file);
    const worker=new Worker(workerPath,{type:'module'});let sequence=0;const call=(action,payload={})=>new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.result);worker.postMessage({id:++sequence,action,...payload});});
    const inspect=async image=>{const bitmap=await createImageBitmap(image.blob),c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const data=ctx.getImageData(0,0,c.width,c.height).data;return {width:c.width,height:c.height,points:[.1,.5,.9].flatMap(y=>[.1,.5,.9].map(x=>{const at=(Math.round(y*(c.height-1))*c.width+Math.round(x*(c.width-1)))*4;return [...data.slice(at,at+4)];}))};};
    try{
      await call('open',{file});const rows=[];
      for(const [angle,crop,flipX,flipY] of [[17,{x:.1,y:.2,width:.8,height:.6},true,false],[-45,{x:.16,y:.25,width:.68,height:.5},false,true]]){
        const recipe={version:2,exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX,flipY,crop,sharpen:0,denoise:0,match:0,preserveLuminance:true,composition:{source_width:width,source_height:height,angle}};
        const preview=await call('render',{recipe}),sameSize=await call('export',{recipe,format:'png',edge:2048}),full=await call('export',{recipe,format:'png',edge:0});rows.push({same:await digest(preview.blob)===await digest(sameSize.blob),preview:await inspect(preview),full:await inspect(full)});
      }
      return {rows,before,after:await digest(file)};
    }finally{worker.terminate();}
  },workerModule);
  expect(result.after).toBe(result.before);for(const row of result.rows){expect(row.same).toBe(true);expect(row.preview.width).toBe(2048);expect(row.full.width).toBeGreaterThan(2048);for(let i=0;i<row.preview.points.length;i++){for(let c=0;c<3;c++)expect(Math.abs(row.preview.points[i][c]-row.full.points[i][c])).toBeLessThanOrEqual(1);expect(row.preview.points[i][3]).toBe(255);expect(row.full.points[i][3]).toBe(255);}}
});


for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser interactive composition saves its parameters and exact pixels ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(60000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark')},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),photo=photos.find(p=>p.file_name==='Landscape-1.png'),before=await sourceHash(page),text=(zh,en)=>lang==='en'?en:zh;
  await openEditor(page,photo.id);const result=await exerciseComposition(page,info,lang);await page.getByRole('button',{name:new RegExp('^'+text('保存编辑','Save edits'))}).click();await expect.poll(async()=>(await manifest(page)).edits?.[0]?.recipe.version).toBe(2);const record=(await manifest(page)).edits[0];expect(record.recipe.composition).toEqual({source_width:1200,source_height:800,angle:result.angle,aspect:2/3});
  await page.goto('/#/tools/edit');await page.reload();await page.locator('.edit-records>div').first().getByRole('button').first().click();await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',result.width);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalHeight',result.height);
  const controls=page.locator('.edit-controls details').last();await controls.getByRole('combobox').selectOption('png');await page.getByRole('spinbutton',{name:text('导出最长边','Export long edge'),exact:true}).fill('0');const download=page.waitForEvent('download');await controls.getByRole('button',{name:text('另存并下载','Save & download'),exact:true}).click();const path=info.outputPath('composition-web.png');await(await download).saveAs(path);const bytes=readFileSync(path);expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]).toEqual([result.width,result.height]);expect(await pngPixelsDigest(page,bytes)).toBe(result.digest);expect(await sourceHash(page)).toBe(before);
});


test('crop detail preview composites transparent pixels once over the current theme',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('lang','en');localStorage.setItem('theme','light')});await page.setViewportSize({width:390,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await setup(page,'en');await page.goto('/#/tools/edit');
  const fixture=await page.evaluate(async()=>{const c=new OffscreenCanvas(256,256),ctx=c.getContext('2d');ctx.fillStyle='rgba(200,60,30,.5)';ctx.fillRect(0,0,256,256);return {bytes:[...new Uint8Array(await(await c.convertToBlob({type:'image/png'})).arrayBuffer())],pixel:[...ctx.getImageData(128,128,1,1).data]};});
  await page.locator('.editor-toolbar input[type=file]').setInputFiles({name:'transparent-source.png',mimeType:'image/png',buffer:Buffer.from(fixture.bytes)});await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',256);await page.locator('.composition-panel summary').click();await page.locator('.interactive-crop-trigger').click();const canvas=page.locator('.composition-canvas');await expect(canvas.locator('[data-crop-detail]')).toBeVisible();await canvas.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  const sample=await canvas.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.querySelector('[data-crop-body]').getBoundingClientRect();return {x:Math.round((b.left+b.right)/2-a.left),y:Math.round((b.top+b.bottom)/2-a.top),background:getComputedStyle(el).backgroundColor.match(/[\d.]+/g).slice(0,3).map(Number)};});const screen=await canvas.screenshot();
  const actual=await page.evaluate(async({base64,x,y})=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),image=await createImageBitmap(new Blob([bytes],{type:'image/png'})),c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();return [...ctx.getImageData(x,y,1,1).data];},{base64:screen.toString('base64'),x:sample.x,y:sample.y});
  for(let c=0;c<3;c++){const expected=(fixture.pixel[c]*fixture.pixel[3]+sample.background[c]*(255-fixture.pixel[3]))/255;expect(Math.abs(actual[c]-expected)).toBeLessThanOrEqual(3);}expect(actual[3]).toBe(255);
});

async function prepareChildParent(page){
  const photos=await setup(page),photo=photos.find(p=>p.file_name==='Landscape-1.png');await prepareLinkedSplit(page,editorAdapterModule,photo.id);
  return page.evaluate(async()=>{const f=window.__linkedSplit;f.group=await f.services.library.saveSplit(f.record,f.result,f.file.name,f.request);f.childID=crypto.randomUUID();return f.group;});
}

test('browser split child owns exact neutral pixels, preserves versions and protects saved workshop lineage',async({page})=>{
  await prepareChildParent(page);const original=await sourceHash(page);
  const result=await page.evaluate(async()=>{
    const f=window.__linkedSplit,l=f.services.library,child=await l.createSplitEdit(f.group.id,f.group.panels[0].id,f.childID),file=await l.source(child),hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const updatedParent=await l.save(f.file,{...f.recipe,exposure:2},f.photoID,f.record,f.profile),updated=await l.save(file,{...child.recipe,contrast:17},null,child,child.decode_profile),retry=await l.createSplitEdit(f.group.id,f.group.panels[0].id,f.childID);let conflict='';try{await l.createSplitEdit(f.group.id,f.group.panels[1].id,f.childID);}catch(e){conflict=e.message;}
    const session=f.services.render.session();let sent;try{await session.open(file,child.decode_profile);const pixels=await session.export(updated.recipe,0,'png',95);sent=await f.services.render.send(pixels.blob,child.source_name,null,updated,'watermark');}finally{session.dispose();}
    let removed='';try{await l.remove(updated);}catch(e){removed=e.message;}
    f.child=updated;f.output=sent;return {child,updated,retry,hash:await hash(file),expected:f.result.panels[0].sha256,conflict,removed,sent,parent:updatedParent};
  });
  expect(result.hash).toBe(result.expected);expect(result.child.recipe.exposure).toBe(0);expect(result.child.recipe.crop.width).toBe(1);expect(result.child.decode_profile).toEqual({version:2,extra_orientation:1});expect(result.retry).toEqual(result.updated);expect(result.conflict).toContain('conflicts');expect(result.removed).toContain('saved output');
  let state=await manifest(page);const output=state.photos.find(p=>p.id===result.sent.id);expect(output.edit_origin.document_revision).toBe(2);expect(output.edit_origin.recipe.contrast).toBe(17);expect(output.edit_origin.derived_from).toEqual(result.child.derived_from);
  const draft=await call(page,'/watermark/drafts','POST',{photo_id:output.id});await call(page,'/photos/'+output.id,'DELETE');
  expect(await page.evaluate(async()=>{try{await window.__linkedSplit.services.library.remove(window.__linkedSplit.child);return '';}catch(e){return e.message;}})).toContain('saved output');state=await manifest(page);expect(state.drafts.find(d=>d.id===draft.id).source.edit_origin).toEqual(output.edit_origin);expect(await sourceHash(page)).toBe(original);
});

for(const phase of ['write','manifest','close'])test(`browser split child handles ${phase} failure without orphaned records or duplicate retry`,async({page})=>{
  await prepareChildParent(page);const before=await manifest(page),original=await sourceHash(page);
  const result=await page.evaluate(async phase=>{
    const f=window.__linkedSplit,l=f.services.library,proto=FileSystemFileHandle.prototype,create=proto.createWritable;let fired=false;
    proto.createWritable=async function(options){const stream=await create.call(this,options);if(!fired&&this.name===(phase==='write'?'source.png':'library.json')){fired=true;if(phase==='close'){const close=stream.close.bind(stream);stream.close=async()=>{await close();throw new Error('Synthetic lost close result');};}else stream.write=async()=>{throw new DOMException('Synthetic full disk','QuotaExceededError');};}return stream;};
    let error='',created;try{created=await l.createSplitEdit(f.group.id,f.group.panels[0].id,f.childID);}catch(e){error=e.message;}finally{proto.createWritable=create;}
    const raw=JSON.parse(await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text()),folder=await(await window.__synthetic.data.getDirectoryHandle('drafts')).getDirectoryHandle('edits'),dirs=[];for await(const id of folder.keys())dirs.push(id);
    const retry=await l.createSplitEdit(f.group.id,f.group.panels[0].id,f.childID);return {error,created,raw,dirs,retry,request:f.childID};
  },phase);
  if(phase==='close'){expect(result.error).toBe('');expect(result.created.id).toBe(result.retry.id);expect(result.raw.edits.filter(e=>e.id===result.request)).toHaveLength(1);}else{expect(result.error).toContain('Synthetic full disk');expect(result.raw).toEqual(before);expect(result.dirs).not.toContain(result.request);}
  expect((await manifest(page)).edits.filter(e=>e.id===result.request)).toHaveLength(1);expect(await sourceHash(page)).toBe(original);
});

test('browser split child schema12 requires exact backup and rejects future, mislabeled and broken relationships',async({page})=>{
  await prepareChildParent(page);await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();
  const old=await page.evaluate(async()=>{const handle=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await handle.getFile()).text());m.version=11;const text=JSON.stringify(m,null,2),stream=await handle.createWritable();await stream.write(text);await stream.close();return text;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const result=await page.evaluate(async()=>{
    const f=window.__linkedSplit,proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;proto.getFileHandle=async function(name,options){if(name.startsWith('library.before-edit-lineage-v12-'))throw new DOMException('Synthetic backup failure','NotAllowedError');return get.call(this,name,options);};let error='';try{await f.services.library.createSplitEdit(f.group.id,f.group.panels[0].id,f.childID);}catch(e){error=e.message;}finally{proto.getFileHandle=get;}
    const after=await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text();f.child=await f.services.library.createSplitEdit(f.group.id,f.group.panels[0].id,f.childID);const backups=[];for await(const entry of window.__synthetic.data.values())if(entry.name.startsWith('library.before-edit-lineage-v12-'))backups.push(await(await entry.getFile()).text());return {error,after,backups,child:f.child};
  });expect(result.error).toContain('backup failure');expect(result.after).toBe(old);expect(result.backups).toEqual([old]);expect((await manifest(page)).version).toBe(24);
  await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();const valid=await manifest(page);
  for(const kind of ['future','mislabeled','path','hash','parent','source-version']){
    const bytes=await page.evaluate(async({valid,kind})=>{const m=structuredClone(valid),child=m.edits.find(e=>e.derived_from);if(kind==='future')m.version=99;else if(kind==='mislabeled')m.version=11;else if(kind==='path')child.source_path='photos/original.png';else if(kind==='hash')child.derived_from.source_hash='a'.repeat(64);else if(kind==='parent')child.derived_from.document_id=child.id;else child.derived_from.version=2;const text=JSON.stringify(m),stream=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await stream.write(text);await stream.close();return text;},{valid,kind});
    await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bytes);
  }
});

test('browser split child complete backup reopens its own source and parent versions',async({page})=>{
  await prepareChildParent(page);const original=await sourceHash(page),saved=await page.evaluate(async()=>{const f=window.__linkedSplit;f.child=await f.services.library.createSplitEdit(f.group.id,f.group.panels[0].id,f.childID);return f.child;});
  await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('child-backup',{create:true});});await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）'}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();
  await page.evaluate(async()=>{for await(const dir of (await window.__synthetic.root.getDirectoryHandle('child-backup')).values())if(dir.kind==='directory'){window.showDirectoryPicker=async()=>dir;break;}});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const restored=await page.evaluate(async({module,id})=>{const l=(await import(module)).createEditorServices().library,r=await l.getRecord(id),file=await l.source(r),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');return {r,hash,parent:await l.getRecord(r.derived_from.document_id)};},{module:editorAdapterModule,id:saved.id});expect(restored.r).toEqual(saved);expect(restored.hash).toBe(saved.source_hash);expect(restored.parent.id).toBe(saved.derived_from.document_id);expect(await sourceHash(page)).toBe(original);
});

test('browser split child late library switch rolls back only the old unpublished snapshot',async({page})=>{
  await prepareChildParent(page);const before=await manifest(page),original=await sourceHash(page);
  await page.evaluate(()=>{const f=window.__linkedSplit,proto=FileSystemFileHandle.prototype,create=proto.createWritable;proto.createWritable=async function(options){const s=await create.call(this,options);if(this.name==='source.png'){proto.createWritable=create;const write=s.write.bind(s);s.write=async data=>{await new Promise(resolve=>window.__continueChild=resolve);return write(data);};}return s;};window.__pendingChild=f.services.library.createSplitEdit(f.group.id,f.group.panels[0].id,f.childID).then(()=>window.__childOutcome='unexpected success',e=>window.__childOutcome=e.message);});await page.waitForFunction(()=>!!window.__continueChild);
  await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await page.evaluate(()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('child-other-library',{create:true});});await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const outcome=await page.evaluate(async()=>{window.__continueChild();await window.__pendingChild;let exists=true;try{await(await(await window.__synthetic.data.getDirectoryHandle('drafts')).getDirectoryHandle('edits')).getDirectoryHandle(window.__linkedSplit.childID);}catch(e){if(e.name!=='NotFoundError')throw e;exists=false;}return {error:window.__childOutcome,exists};});expect(outcome.error).toContain('Library changed');expect(outcome.exists).toBe(false);expect(await manifest(page)).toEqual(before);expect((await manifest(page,'child-other-library')).edits).toBeUndefined();expect(await sourceHash(page)).toBe(original);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser split child UI preserves dirty edits, neutral pixels and source navigation ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});const photos=await setup(page,lang),original=await sourceHash(page);await page.goto('/#/tools/edit?photo='+photos.find(p=>p.file_name==='Landscape-1.png').id);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',1200);
  const child=await exerciseSplitChildUI(page,info,lang),state=await manifest(page),saved=state.edits.find(e=>e.source_name===child.name&&e.derived_from);expect(saved.recipe.exposure).toBe(.3);expect(saved.revision).toBe(2);expect(saved.derived_from.document_revision).toBe(1);expect(await sourceHash(page)).toBe(original);
});

test('browser split child supports nested editing and keeps its snapshot when the saved panel changes',async({page})=>{
  await prepareChildParent(page);const original=await sourceHash(page);
  const result=await page.evaluate(async()=>{
    const f=window.__linkedSplit,l=f.services.library,children=await Promise.all([l.createSplitEdit(f.group.id,f.group.panels[0].id,f.childID),l.createSplitEdit(f.group.id,f.group.panels[0].id,f.childID)]),child=children[0],file=await l.source(child),session=f.services.render.session();let group;
    try{const info=await session.open(file,child.decode_profile),spec={...f.spec,basis:{width:info.width,height:info.height},aspect:{width:3,height:8}};group=await l.saveSplit(child,await session.split(child.recipe,spec,'png',95),child.source_name,crypto.randomUUID());}finally{session.dispose();}
    const nested=await l.createSplitEdit(group.id,group.panels[0].id,crypto.randomUUID()),dir=await(await window.__synthetic.data.getDirectoryHandle('drafts')).getDirectoryHandle('splits'),old=await dir.getDirectoryHandle(f.group.id),handle=await old.getFileHandle('panel-01.png'),writer=await handle.createWritable();await writer.write('changed saved panel');await writer.close();let failed='';try{await l.createSplitEdit(f.group.id,f.group.panels[0].id,crypto.randomUUID());}catch(e){failed=e.message;}
    const own=await l.source(child),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await own.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');return {ids:children.map(e=>e.id),child,nested,hash,failed};
  });expect(new Set(result.ids).size).toBe(1);expect(result.nested.derived_from.document_id).toBe(result.child.id);expect(result.hash).toBe(result.child.source_hash);expect(result.failed).toContain('damaged');
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();const restored=await page.evaluate(async({module,id})=>{const l=(await import(module)).createEditorServices().library,r=await l.getRecord(id),source=await l.source(r);return {r,size:source.size};},{module:editorAdapterModule,id:result.nested.id});expect(restored.r).toEqual(result.nested);expect(restored.size).toBeGreaterThan(0);expect(await sourceHash(page)).toBe(original);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser text layers batch persists styles and touch/undo ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(120000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),before=await sourceHash(page);await openEditor(page,photos.find(p=>p.file_name==='Landscape-1.png').id);await exerciseTextUI(page,info,lang);const saved=await manifest(page);expect(saved.version).toBe(24);expect(saved.edits[0].recipe.version).toBe(4);expect(saved.edits[0].recipe.layer_stack.layers).toHaveLength(1);expect(await sourceHash(page)).toBe(before);
});
test('browser text layers batch real worker retains seamless glyphs and neutral child pixels',async({page})=>{
  test.setTimeout(90000);await setup(page);const document=JSON.parse(readFileSync('frontend/tests/fixtures/text-layer-contract.json','utf8'));await exerciseTextWorker(page,editorAdapterModule,document);
});

test('browser text layers batch backs up format12, protects output origins and rejects damaged saved text',async({page})=>{
  test.setTimeout(90000);const photos=await setup(page),before=await sourceHash(page);await prepareLinkedSplit(page,editorAdapterModule,photos.find(p=>p.file_name==='Landscape-1.png').id);
  async function close(){await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'打开本地图库或备份',exact:true})).toBeVisible();}
  await close();const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=12;const text=JSON.stringify(m,null,2),w=await h.createWritable();await w.write(text);await w.close();return text;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const document=JSON.parse(readFileSync('frontend/tests/fixtures/text-layer-contract.json','utf8')),result=await page.evaluate(async text_layers=>{
    const f=window.__linkedSplit,l=f.services.library,recipe={...f.record.recipe,version:3,composition:{source_width:1200,source_height:800,angle:0},text_layers},proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;proto.getFileHandle=async function(name,options){if(name.startsWith('library.before-text-layers-v13-'))throw new DOMException('Synthetic backup failure','NotAllowedError');return get.call(this,name,options);};let failed='';try{await l.save(f.file,recipe,f.photoID,f.record,f.profile);}catch(e){failed=e.message;}finally{proto.getFileHandle=get;}
    const after=await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text(),saved=await l.save(f.file,recipe,f.photoID,f.record,f.profile),backups=[];for await(const h of window.__synthetic.data.values())if(h.name.startsWith('library.before-text-layers-v13-'))backups.push(await(await h.getFile()).text());
    const session=f.services.render.session();let sent;try{await session.open(f.file,f.profile);const output=await session.export(recipe,0,'png',95);sent=await f.services.render.send(output.blob,f.file.name,f.photoID,saved,'watermark');}finally{session.dispose();}let removed='';try{await l.remove(saved);}catch(e){removed=e.message;}f.textSaved=saved;return {failed,after,saved,backups,sent,removed};
  },document);expect(result.failed).toContain('backup failure');expect(result.after).toBe(old);expect(result.backups).toEqual([old]);expect(result.removed).toContain('saved output');let state=await manifest(page);const output=state.photos.find(p=>p.id===result.sent.id);expect(output.edit_origin.version).toBe(2);expect(output.edit_origin.recipe).toEqual(result.saved.recipe);expect(output.edit_origin.derived_from).toBeUndefined();const draft=await call(page,'/watermark/drafts','POST',{photo_id:result.sent.id});await call(page,'/photos/'+result.sent.id,'DELETE');state=await manifest(page);expect(state.drafts.find(d=>d.id===draft.id).source.edit_origin).toEqual(output.edit_origin);
  await close();const valid=await manifest(page);for(const kind of ['old-format','future-recipe','future-text','unknown-font','output-recipe']){
    const bytes=await page.evaluate(async({valid,kind,id,draft})=>{const m=structuredClone(valid),r=m.edits.find(e=>e.id===id).recipe;if(kind==='old-format')m.version=12;else if(kind==='future-recipe')r.version=9;else if(kind==='future-text')r.text_layers.version=99;else if(kind==='unknown-font')r.text_layers.layers[0].font='https://invalid/font';else m.drafts.find(d=>d.id===draft).source.edit_origin.recipe.text_layers.version=99;const text=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{valid,kind,id:result.saved.id,draft:draft.id});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toHaveCount(0);expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bytes);
  }expect(await sourceHash(page)).toBe(before);
});


test('browser text layers batch complete backup restores text recipes, split child and all local sources',async({page})=>{
  test.setTimeout(90000);await setup(page);const original=await sourceHash(page),document=JSON.parse(readFileSync('frontend/tests/fixtures/text-layer-contract.json','utf8'));await exerciseTextWorker(page,editorAdapterModule,document);const saved=await manifest(page);
  await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('text-backup',{create:true});});await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）'}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();
  await page.evaluate(async()=>{for await(const dir of (await window.__synthetic.root.getDirectoryHandle('text-backup')).values())if(dir.kind==='directory'){window.showDirectoryPicker=async()=>dir;break;}});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const restored=await page.evaluate(async({module,ids})=>{const l=(await import(module)).createEditorServices().library,rows=[];for(const id of ids){const r=await l.getRecord(id),file=await l.source(r),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');rows.push({r,hash});}return rows;},{module:editorAdapterModule,ids:saved.edits.map(e=>e.id)});
  for(const row of restored){expect(row.r).toEqual(saved.edits.find(e=>e.id===row.r.id));expect(row.hash).toBe(row.r.source_hash);}expect(restored.some(({r})=>r.recipe.version===3)).toBe(true);expect(restored.some(({r})=>r.derived_from)).toBe(true);expect(await sourceHash(page)).toBe(original);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser overlay layers batch mixed order, alpha, undo and reopening ${width} ${lang}`,async({page},info)=>{
  test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),before=await sourceHash(page);await openEditor(page,photos.find(p=>p.file_name==='Landscape-1.png').id);await exerciseOverlayUI(page,info,lang);const saved=await manifest(page);expect(saved.version).toBe(24);expect(saved.edits[0].recipe.version).toBe(4);expect(saved.edits[0].recipe.layer_stack.layers.map(l=>l.kind)).toEqual(['overlay','text']);expect(await sourceHash(page)).toBe(before);
});
test('browser overlay layers batch worker order coverage and split pixels persist',async({page})=>{
  test.setTimeout(90000);await setup(page);const document=JSON.parse(readFileSync('frontend/tests/fixtures/text-layer-contract.json','utf8')),overlay=JSON.parse(readFileSync('frontend/tests/fixtures/layer-stack-contract.json','utf8')).layers[0];await exerciseTextWorker(page,editorAdapterModule,document,overlay);
});

test('browser overlay layers batch backs up format13, protects output origins and rejects damaged saved text',async({page})=>{
  test.setTimeout(90000);const photos=await setup(page),before=await sourceHash(page);await prepareLinkedSplit(page,editorAdapterModule,photos.find(p=>p.file_name==='Landscape-1.png').id);
  async function close(){await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await expect(page.getByRole('button',{name:'打开本地图库或备份',exact:true})).toBeVisible();}
  await close();const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=13;const text=JSON.stringify(m,null,2),w=await h.createWritable();await w.write(text);await w.close();return text;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const document=JSON.parse(readFileSync('frontend/tests/fixtures/layer-stack-contract.json','utf8')),result=await page.evaluate(async layer_stack=>{
    const f=window.__linkedSplit,l=f.services.library,recipe={...f.record.recipe,version:4,composition:{source_width:1200,source_height:800,angle:0},layer_stack},proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;proto.getFileHandle=async function(name,options){if(name.startsWith('library.before-layer-stack-v14-'))throw new DOMException('Synthetic backup failure','NotAllowedError');return get.call(this,name,options);};let failed='';try{await l.save(f.file,recipe,f.photoID,f.record,f.profile);}catch(e){failed=e.message;}finally{proto.getFileHandle=get;}
    const after=await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text(),saved=await l.save(f.file,recipe,f.photoID,f.record,f.profile),backups=[];for await(const h of window.__synthetic.data.values())if(h.name.startsWith('library.before-layer-stack-v14-'))backups.push(await(await h.getFile()).text());
    const session=f.services.render.session();let sent;try{await session.open(f.file,f.profile);const output=await session.export(recipe,0,'png',95);sent=await f.services.render.send(output.blob,f.file.name,f.photoID,saved,'watermark');}finally{session.dispose();}let removed='';try{await l.remove(saved);}catch(e){removed=e.message;}f.textSaved=saved;return {failed,after,saved,backups,sent,removed};
  },document);expect(result.failed).toContain('backup failure');expect(result.after).toBe(old);expect(result.backups).toEqual([old]);expect(result.removed).toContain('saved output');let state=await manifest(page);const output=state.photos.find(p=>p.id===result.sent.id);expect(output.edit_origin.version).toBe(2);expect(output.edit_origin.recipe).toEqual(result.saved.recipe);expect(output.edit_origin.derived_from).toBeUndefined();const draft=await call(page,'/watermark/drafts','POST',{photo_id:result.sent.id});await call(page,'/photos/'+result.sent.id,'DELETE');state=await manifest(page);expect(state.drafts.find(d=>d.id===draft.id).source.edit_origin).toEqual(output.edit_origin);
  await close();const valid=await manifest(page);for(const kind of ['old-format','future-recipe','future-text','unknown-font','output-recipe']){
    const bytes=await page.evaluate(async({valid,kind,id,draft})=>{const m=structuredClone(valid),r=m.edits.find(e=>e.id===id).recipe;if(kind==='old-format')m.version=13;else if(kind==='future-recipe')r.version=9;else if(kind==='future-text')r.layer_stack.version=99;else if(kind==='unknown-font')r.layer_stack.layers[1].font='https://invalid/font';else m.drafts.find(d=>d.id===draft).source.edit_origin.recipe.layer_stack.version=99;const text=JSON.stringify(m),w=await(await window.__synthetic.data.getFileHandle('library.json')).createWritable();await w.write(text);await w.close();return text;},{valid,kind,id:result.saved.id,draft:draft.id});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toHaveCount(0);expect(await page.evaluate(async()=>await(await(await window.__synthetic.data.getFileHandle('library.json')).getFile()).text())).toBe(bytes);
  }expect(await sourceHash(page)).toBe(before);
});


test('browser overlay layers batch complete backup restores text recipes, split child and all local sources',async({page})=>{
  test.setTimeout(90000);await setup(page);const original=await sourceHash(page),document=JSON.parse(readFileSync('frontend/tests/fixtures/layer-stack-contract.json','utf8'));await exerciseTextWorker(page,editorAdapterModule,{version:1,layers:document.layers.filter(l=>l.kind==='text')},document.layers[0]);const saved=await manifest(page);
  await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('text-backup',{create:true});});await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）'}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();
  await page.evaluate(async()=>{for await(const dir of (await window.__synthetic.root.getDirectoryHandle('text-backup')).values())if(dir.kind==='directory'){window.showDirectoryPicker=async()=>dir;break;}});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  const restored=await page.evaluate(async({module,ids})=>{const l=(await import(module)).createEditorServices().library,rows=[];for(const id of ids){const r=await l.getRecord(id),file=await l.source(r),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');rows.push({r,hash});}return rows;},{module:editorAdapterModule,ids:saved.edits.map(e=>e.id)});
  for(const row of restored){expect(row.r).toEqual(saved.edits.find(e=>e.id===row.r.id));expect(row.hash).toBe(row.r.source_hash);}expect(restored.some(({r})=>r.recipe.version===4)).toBe(true);expect(restored.some(({r})=>r.derived_from)).toBe(true);expect(await sourceHash(page)).toBe(original);
});


for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser collage layout framing source recovery and cancellation ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(120000);await installCollageProbe(page);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await setup(page,lang);const before=await sourceHash(page);await page.goto('/#/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageUI(page,info,lang);expect(await sourceHash(page)).toBe(before);
});
test('browser collage worker renders 80 layouts exact pixels full sources RAW and atomic recovery',async({page},info)=>{
 test.setTimeout(120000);await setup(page);const module='/assets/'+readdirSync(assets).find(f=>/^collage-worker-.*\.js$/.test(f));const result=await exerciseCollageWorker(page,module,workerModule);await info.attach('collage-pixels',{body:JSON.stringify(result),contentType:'application/json'});
});

test('browser collage gallery entry registers source identity and preserves original files',async({page})=>{
 const photos=await setup(page),before=await sourceHash(page);await page.goto('/#/?page=photos');await exerciseGalleryCollage(page,photos.slice(0,2));expect(await sourceHash(page)).toBe(before);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser collage direct swap pinch snap canvas controls and JPEG ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await setup(page,lang);const before=await sourceHash(page);await page.goto('/#/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageInteraction(page,info,lang);expect(await sourceHash(page)).toBe(before);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser collage batch grouping edit swap recovery cancel and ZIP ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(120000);await installBatchProbe(page);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await setup(page,lang);const before=await sourceHash(page);await page.goto('/#/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageBatch(page,info,lang);expect(await sourceHash(page)).toBe(before);
});

test('browser collage batch transfer preserves visual order and stops inspection',async({page})=>{
 await installBatchProbe(page);await setup(page);await page.goto('/#/tools');await page.locator('.studio-tool').filter({hasText:'照片拼图'}).click();await exerciseBatchTransfer(page);
});
test('browser collage batch gallery automatically handles thirteen originals without mutation',async({page})=>{
 await setup(page);const before=await sourceHash(page);await page.evaluate(async()=>{const c=new OffscreenCanvas(80,60),x=c.getContext('2d');for(let i=0;i<13;i++){x.fillStyle=`rgb(${i*17},40,90)`;x.fillRect(0,0,80,60);const w=await(await window.__synthetic.originals.getFileHandle(`BatchGallery-${String(i).padStart(2,'0')}.png`,{create:true})).createWritable();await w.write(await c.convertToBlob());await w.close();}});const picked=await call(page,'/dialog/directory','POST'),job=await call(page,'/photos/import','POST',{paths:picked.paths,recursive:true});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status,{timeout:30000}).toBe('completed');const photos=(await call(page,'/photos?search=BatchGallery')).photos;expect(photos).toHaveLength(13);await page.setViewportSize({width:1440,height:1400});await page.goto('/#/?page=photos&search=BatchGallery');await exerciseBatchGallery(page,photos);expect(await sourceHash(page)).toBe(before);
});

test('browser collage complementary blend pixels all layouts odd seams and full resolution',async({page},info)=>{test.setTimeout(120000);await setup(page);const module='/assets/'+readdirSync(assets).find(f=>/^collage-worker-.*\.js$/.test(f));const result=await exerciseBlendWorker(page,module);await info.attach('blend-pixels',{body:JSON.stringify(result),contentType:'application/json'});});
for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser collage blend canvas reset legacy recovery ${width} ${lang}`,async({page},info)=>{test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await setup(page,lang);const before=await sourceHash(page);await page.goto('/#/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseBlendUI(page,info,lang);expect(await sourceHash(page)).toBe(before);});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser collage project save reopen revise copy delete ${width} ${lang}`,async({page},info)=>{test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await setup(page,lang);const before=await sourceHash(page);await page.goto('/#/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageProject(page,info,lang);expect(await sourceHash(page)).toBe(before);});

async function prepareCollageProject(page,photoId,batch=false){return page.evaluate(async({module,photoId,batch})=>{
 const l=(await import(module)).createEditorServices().library,{file,photo}=await l.photo(photoId),source={id:crypto.randomUUID(),name:file.name,sha256:photo.file_hash,width:photo.width,height:photo.height,bits:8,profile:photo.decode_profile,photo_id:photoId},cell={source_id:source.id,pan:{x:.2,y:0},zoom:1.3},scene={version:2,edge_blend:18,template:'1-full',width:600,height:400,gap:.008,padding:.02,radius:.1,background:'#f7f3eb',sources:[source],cells:[cell]};
 let document={kind:'single',value:scene},files=[file];if(batch){const other={...source,id:crypto.randomUUID()},omitted={...source,id:crypto.randomUUID()},second={...cell,source_id:other.id},last={...cell,source_id:omitted.id};document={kind:'batch',value:{version:2,size:2,order:'selection',remainder:'drop',items:[source,other,omitted].map(source=>({source,capture_time:null})),sequence:[source.id,other.id,omitted.id],pages:[{...scene,template:'2-lr',sources:[source,other],cells:[cell,second]}],omitted:[omitted.id],placements:[cell,second,last]}};files=[file,file,file];}
 const payload={id:crypto.randomUUID(),request_id:crypto.randomUUID(),expected_revision:0,name:'Stored batch',document};window.__collageProject={l,payload,files};return payload;
},{module:editorAdapterModule,photoId,batch});}

test('browser collage storage migration rollback revision dedup detach and complete backup reopen',async({page})=>{
 test.setTimeout(90000);const photos=await setup(page),photo=photos.find(p=>p.file_name==='Landscape-1.png'),before=await sourceHash(page);
 await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=17;const text=JSON.stringify(m),w=await h.createWritable();await w.write(text);await w.close();return text;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();const payload=await prepareCollageProject(page,photo.id,true);
 const result=await page.evaluate(async()=>{
  const f=window.__collageProject,root=window.__synthetic.data,read=async()=>await(await(await root.getFileHandle('library.json')).getFile()).text(),proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;proto.getFileHandle=async function(name,options){if(name.startsWith('library.before-collages-v18-'))throw new DOMException('Synthetic collage backup failure','NotAllowedError');return get.call(this,name,options);};let error='';try{await f.l.saveCollage(f.payload,f.files);}catch(e){error=e.message;}finally{proto.getFileHandle=get;}
  const afterFailure=await read(),parent=await(await root.getDirectoryHandle('drafts')).getDirectoryHandle('collages'),dirs=[];for await(const name of parent.keys())dirs.push(name);const first=await f.l.saveCollage(f.payload,f.files),retry=await f.l.saveCollage(f.payload,f.files),assets=JSON.parse(await read()).collages[0].assets,changed={...f.payload,name:'Revision two',request_id:crypto.randomUUID(),expected_revision:1},second=await f.l.saveCollage(changed,f.files);let conflict='';try{await f.l.saveCollage({...changed,request_id:crypto.randomUUID()},f.files);}catch(e){conflict=e.message;}const finalAssets=JSON.parse(await read()).collages[0].assets,backups=[];for await(const h of root.values())if(h.name.startsWith('library.before-collages-v18-'))backups.push(await(await h.getFile()).text());return {error,afterFailure,dirs,first,retry,second,assets,finalAssets,conflict,backups};
 });expect(result.error).toContain('backup failure');expect(result.afterFailure).toBe(old);expect(result.dirs).toEqual([]);expect(result.first).toEqual(result.retry);expect(result.second.revision).toBe(2);expect(result.assets).toHaveLength(1);expect(result.finalAssets).toEqual(result.assets);expect(result.conflict).toContain('another window');expect(result.backups).toEqual([old]);
 await call(page,'/photos/'+photo.id,'DELETE');const detached=await page.evaluate(async id=>{const f=window.__collageProject,r=await f.l.getCollage(id),source=await f.l.collageSource(r,r.document.value.items[2].source.id);return {record:r,bytes:source.size};},payload.id);expect(detached.record.document).toEqual(payload.document);expect(detached.bytes).toBeGreaterThan(0);
 await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('collage-backup',{create:true});});await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）',exact:true}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await page.evaluate(async()=>{for await(const dir of (await window.__synthetic.root.getDirectoryHandle('collage-backup')).values())if(dir.kind==='directory'){window.showDirectoryPicker=async()=>dir;break;}});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
 const restored=await page.evaluate(async({module,id})=>{const l=(await import(module)).createEditorServices().library,r=await l.getCollage(id),source=await l.collageSource(r,r.document.value.items[2].source.id);await l.removeCollage(r);return {record:r,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await source.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),total:(await l.listCollages()).total};},{module:editorAdapterModule,id:payload.id});expect(restored.record).toEqual(result.second);expect(restored.hash).toBe(payload.document.value.items[2].source.sha256);expect(restored.total).toBe(0);expect(await sourceHash(page)).toBe(before);
});

test('browser collage late source save rolls back after switching libraries',async({page})=>{
 const photos=await setup(page),before=await manifest(page),original=await sourceHash(page);await prepareCollageProject(page,photos[0].id);
 await page.evaluate(()=>{const f=window.__collageProject,proto=FileSystemFileHandle.prototype,create=proto.createWritable;proto.createWritable=async function(...args){const stream=await create.apply(this,args);if(this.name.endsWith('.bin')){const write=stream.write.bind(stream);stream.write=async(...values)=>{await new Promise(resolve=>window.__resumeCollage=resolve);return write(...values);};}return stream;};window.__pendingCollage=f.l.saveCollage(f.payload,f.files).then(()=> 'unexpected',e=>e.message).finally(()=>{proto.createWritable=create;});});await page.waitForFunction(()=>!!window.__resumeCollage);
 await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('switched-collage-library',{create:true});});await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
 const result=await page.evaluate(async()=>{window.__resumeCollage();const error=await window.__pendingCollage,base=window.__synthetic.data,other=await window.__synthetic.root.getDirectoryHandle('switched-collage-library'),read=async d=>JSON.parse(await(await(await d.getFileHandle('library.json')).getFile()).text()),parent=await(await base.getDirectoryHandle('drafts')).getDirectoryHandle('collages'),dirs=[];for await(const name of parent.keys())dirs.push(name);return {error,dirs,old:await read(base),next:await read(other)};});expect(result.error).toContain('Library changed');expect(result.dirs).toEqual([]);expect(result.old).toEqual(before);expect(result.next.collages).toBeUndefined();expect(await sourceHash(page)).toBe(original);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser collage ten-part defaults context menu project controls and WebP ${width} ${lang}`,async({page},info)=>{test.setTimeout(120000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await setup(page,lang);const before=await sourceHash(page);await page.goto('/#/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageTen(page,info,lang);expect(await sourceHash(page)).toBe(before);});

test('browser collage search filters before pagination and sorts literal names',async({page})=>{
 const photos=await setup(page),before=await sourceHash(page);await prepareCollageProject(page,photos[0].id);const result=await page.evaluate(async()=>{const f=window.__collageProject;for(let i=0;i<23;i++)await f.l.saveCollage({...f.payload,id:crypto.randomUUID(),request_id:crypto.randomUUID(),name:(i<21?'Alpha_% ':'Other ')+String(i).padStart(2,'0')},f.files);return {first:await f.l.listCollages(1,{search:'ALPHA_%',sort:'name',direction:'asc'}),second:await f.l.listCollages(2,{search:'ALPHA_%',sort:'name',direction:'asc'}),none:await f.l.listCollages(1,{search:'absent'}),descending:await f.l.listCollages(1,{search:'ALPHA_%',sort:'name',direction:'desc'})};});expect(result.first.total).toBe(21);expect(result.first.items).toHaveLength(20);expect(result.second.items).toHaveLength(1);expect(result.first.items[0].name).toBe('Alpha_% 00');expect(result.second.items[0].name).toBe('Alpha_% 20');expect(result.descending.items[0].name).toBe('Alpha_% 20');expect(result.none.total).toBe(0);expect(await sourceHash(page)).toBe(before);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser collage immutable output library restore download and batch ${width} ${lang}`,async({page},info)=>{test.setTimeout(120000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await setup(page,lang);const before=await sourceHash(page);await page.goto('/#/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollageOutput(page,info,lang);expect(await sourceHash(page)).toBe(before);});

async function prepareCollageOutput(page,photoId){await prepareCollageProject(page,photoId);return page.evaluate(async()=>{const f=window.__collageProject,r=await f.l.saveCollage(f.payload,f.files),c=new OffscreenCanvas(600,400);c.getContext('2d').fillRect(0,0,600,400);const blob=await c.convertToBlob({type:'image/webp',quality:.9}),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),payload={id:crypto.randomUUID(),project_id:r.id,project_revision:r.revision,page:0,format:'webp',quality:90,sha256};window.__collageOutput={blob,payload};return payload;});}

test('browser collage output upgrade rollback immutable source detach and full backup restore',async({page})=>{
 test.setTimeout(90000);const photos=await setup(page),before=await sourceHash(page),payload=await prepareCollageOutput(page,photos[0].id);await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();const old=await page.evaluate(async()=>{const h=await window.__synthetic.data.getFileHandle('library.json'),m=JSON.parse(await(await h.getFile()).text());m.version=18;const text=JSON.stringify(m),w=await h.createWritable();await w.write(text);await w.close();return text;});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
 const result=await page.evaluate(async()=>{const {l}=window.__collageProject,f=window.__collageOutput,root=window.__synthetic.data,read=async()=>await(await(await root.getFileHandle('library.json')).getFile()).text(),proto=FileSystemDirectoryHandle.prototype,get=proto.getFileHandle;proto.getFileHandle=async function(name,options){if(name.startsWith('library.before-collage-outputs-v19-'))throw new DOMException('Synthetic output backup failure','NotAllowedError');return get.call(this,name,options);};let error='';try{await l.saveCollageOutput(f.payload,f.blob);}catch(e){error=e.message;}finally{proto.getFileHandle=get;}const failed=await read(),parent=await(await root.getDirectoryHandle('drafts')).getDirectoryHandle('collage-outputs'),dirs=[];for await(const name of parent.keys())dirs.push(name);const record=await l.saveCollageOutput(f.payload,f.blob),retry=await l.saveCollageOutput(f.payload,f.blob);let bad='';try{await l.saveCollageOutput({...f.payload,id:crypto.randomUUID(),format:'png'},f.blob);}catch(e){bad=e.message;}const r=await l.getCollage(f.payload.project_id);await l.removeCollage(r);const detached=await l.getCollageOutput(f.payload.id),source=await l.collageOutputSource(detached,detached.project.document.value.sources[0].id),backups=[];for await(const h of root.values())if(h.name.startsWith('library.before-collage-outputs-v19-'))backups.push(await(await h.getFile()).text());return {error,failed,dirs,record,retry,bad,detached,source:source.size,backups};});
 expect(result.error).toContain('backup failure');expect(result.failed).toBe(old);expect(result.dirs).toEqual([]);expect(result.retry).toEqual(result.record);expect(result.bad).not.toBe('');expect(result.detached).toEqual(result.record);expect(result.source).toBeGreaterThan(0);expect(result.backups).toEqual([old]);
 await page.goto('/#/?page=settings');await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('collage-output-backup',{create:true});});await page.getByRole('button',{name:'备份图库（含导入副本与派生作品）',exact:true}).click();await expect(page.getByText(/完整图库备份已保存/)).toBeVisible();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await page.evaluate(async()=>{for await(const dir of (await window.__synthetic.root.getDirectoryHandle('collage-output-backup')).values())if(dir.kind==='directory'){window.showDirectoryPicker=async()=>dir;break;}});await page.getByRole('button',{name:'打开本地图库或备份',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();const restored=await page.evaluate(async({module,id})=>{const l=(await import(module)).createEditorServices().library,r=await l.getCollageOutput(id),blob=await l.collageOutputImage(id),source=await l.collageOutputSource(r,r.project.document.value.sources[0].id);return {r,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),source:source.size};},{module:editorAdapterModule,id:payload.id});expect(restored.r).toEqual(result.record);expect(restored.hash).toBe(payload.sha256);expect(restored.source).toBe(result.source);expect(await sourceHash(page)).toBe(before);
});

test('browser collage output unpublished writes cannot cross a library switch',async({page})=>{
 const photos=await setup(page),original=await sourceHash(page);await prepareCollageOutput(page,photos[0].id);const before=await manifest(page);
 await page.evaluate(()=>{const {l}=window.__collageProject,f=window.__collageOutput,proto=FileSystemFileHandle.prototype,create=proto.createWritable;proto.createWritable=async function(...args){const stream=await create.apply(this,args);if(this.name===f.payload.sha256+'.webp'){const write=stream.write.bind(stream);stream.write=async(...values)=>{await new Promise(resolve=>window.__resumeOutput=resolve);return write(...values);};}return stream;};window.__pendingOutput=l.saveCollageOutput(f.payload,f.blob).then(()=> 'unexpected',e=>e.message).finally(()=>{proto.createWritable=create;});});await page.waitForFunction(()=>!!window.__resumeOutput);await page.goto('/#/?page=settings');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'关闭图库',exact:true}).click();await page.evaluate(async()=>{window.showDirectoryPicker=async()=>window.__synthetic.root.getDirectoryHandle('switched-output-library',{create:true});});await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
 const result=await page.evaluate(async()=>{window.__resumeOutput();const error=await window.__pendingOutput,root=window.__synthetic.data,other=await window.__synthetic.root.getDirectoryHandle('switched-output-library'),read=async h=>JSON.parse(await(await(await h.getFileHandle('library.json')).getFile()).text()),dirs=[],parent=await(await root.getDirectoryHandle('drafts')).getDirectoryHandle('collage-outputs');for await(const name of parent.keys())dirs.push(name);return {error,dirs,old:await read(root),next:await read(other)};});expect(result.error).toContain('Library changed');expect(result.dirs).toEqual([]);expect(result.old).toEqual(before);expect(result.next.collage_outputs).toBeUndefined();expect(await sourceHash(page)).toBe(original);
});


for(const lang of ['zh','en'])test('browser frame v2 templates and WebP retain source '+lang,async({page},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width:lang==='en'?390:1440,height:1100});await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);
 const photos=await setup(page,lang),before=await sourceHash(page);
 await page.goto('/#/watermark/workshop?photo='+photos[0].id);await exerciseFrameV2(page,lang,info);
 const saved=await manifest(page);expect(saved.version).toBe(24);expect(saved.frame_templates).toHaveLength(1);
 expect(await sourceHash(page)).toBe(before);
 const exports=await page.evaluate(async()=>{const folder=await window.__synthetic.data.getDirectoryHandle('exports'),out=[];for await(const [name,entry] of folder.entries()){if(!name.endsWith('.webp'))continue;const file=await entry.getFile(),bytes=new Uint8Array(await file.arrayBuffer());out.push({name,head:String.fromCharCode(...bytes.slice(0,4)),kind:String.fromCharCode(...bytes.slice(8,12))});}return out;});
 expect(exports).toHaveLength(1);expect(exports[0].head).toBe('RIFF');expect(exports[0].kind).toBe('WEBP');
});


test('browser videos remain independent and native controls play only on request',async({page},info)=>{
 test.setTimeout(120000);const photos=await setup(page),before=await sourceHash(page);
 const path=fileURLToPath(new URL('../../.test-artifacts/afterframe-upgrade/synthetic-browser-video.mp4',import.meta.url));
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x240:rate=24','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',path],{windowsHide:true});
 const bytes=readFileSync(path);await page.goto('/#/?page=videos');
 await page.locator('.video-library input[type=file]').setInputFiles({name:'synthetic-browser-video.mp4',mimeType:'video/mp4',buffer:bytes});
 await expect.poll(async()=>{const state=await manifest(page),job=state.jobs.find(j=>j.kind==='video-import');if(job?.failed)throw new Error(job.errors.join('\n'));return state.videos?.length||0;}).toBe(1);await expect(page.locator('.video-card')).toHaveCount(1);await exerciseVideoPlayer(page,info);
 const state=await manifest(page);expect(state.videos).toHaveLength(1);expect(state.photos).toHaveLength(photos.length);expect(state.videos[0].file_hash).toBe(createHash('sha256').update(bytes).digest('hex'));
 expect(state.jobs.filter(j=>j.kind==='video-import').every(j=>j.billable===false&&j.status==='completed')).toBe(true);
 expect(await sourceHash(page)).toBe(before);
 page.once('dialog',d=>d.accept());await page.locator('.video-card').getByRole('button',{name:'移出视频记录，保留原片',exact:true}).click();await expect(page.locator('.video-card')).toHaveCount(0);
 const retained=await page.evaluate(async path=>{let dir=window.__synthetic.data;const parts=path.split('/');for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);return (await(await dir.getFileHandle(parts.at(-1))).getFile()).size;},state.videos[0].source_path);expect(retained).toBe(bytes.length);
});


test('creation preservation refuses cached edit bytes after the linked original changes',async({page})=>{
 const photos=await setup(page),p=photos[0];
 const result=await page.evaluate(async({module,id})=>{
  const library=(await import(module)).createEditorServices().library,source=await library.photo(id);
  const recipe={version:1,exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX:false,flipY:false,crop:{x:0,y:0,width:1,height:1},sharpen:0,denoise:0,match:0,preserveLuminance:true};
  const record=await library.save(source.file,recipe,id,undefined,source.photo.decode_profile);
  // Detached File bytes represent the still-open editor, independent of the handle.
  const cached=new File([await source.file.arrayBuffer()],source.file.name,{type:source.file.type});
  const handle=await window.__synthetic.originals.getFileHandle(source.photo.file_name),old=await(await handle.getFile()).arrayBuffer();
  const writer=await handle.createWritable();await writer.write(new Uint8Array([1,2,3,4]));await writer.close();
  let error='';try{await library.save(cached,{...recipe,exposure:1},id,record,source.photo.decode_profile);}catch(e){error=String(e.message);}
  const retained=await library.getRecord(record.id),restore=await handle.createWritable();await restore.write(old);await restore.close();
  return {error,revision:retained.revision,initial:record.revision,exposure:retained.recipe.exposure};
 },{module:editorAdapterModule,id:p.id});
 expect(result.error).toContain('source photo changed');expect(result.revision).toBe(result.initial);expect(result.exposure).toBe(0);
});


test('browser domestic AI scoped annotation and handwriting stay explicit and local after generation',async({page},info)=>{
  test.setTimeout(120000);const photos=await setup(page),before=await sourceHash(page);
  const profile=await call(page,'/ai/profiles','POST',{name:'Synthetic account',provider:'qwen-cn',region:'cn-beijing',workspace:'',image_model:'qwen-image-3.0',vision_model:'qwen3-vl-plus',revision:0,api_key:'synthetic-web-only-key',clear_key:false});
  await call(page,'/ai/relay','PUT',{relay_url:'ws://127.0.0.1:9000/cloud-studio'});
  await page.evaluate(()=>{
    window.__studioSubmits=0;window.__studioBytes=0;
    window.WebSocket=class {
      bufferedAmount=0;binaryType='arraybuffer';closed=false;
      constructor(url){if(!url.endsWith('/cloud-studio'))throw new Error('Unexpected fake AI relay');setTimeout(()=>this.onopen?.(),0);}
      close(){this.closed=true;}
      send(data){if(typeof data!=='string'){window.__studioBytes+=data.byteLength;return;}const value=JSON.parse(data);if(value.type!=='submit'){this.request=value;return;}window.__studioSubmits++;
        void(async()=>{const id='synthetic-'+window.__studioSubmits;
          if(this.request.action==='annotation'){this.onmessage?.({data:JSON.stringify({type:'result',request_id:id,result:{version:1,caption_zh:'合成山景',caption_en:'Synthetic mountains',tags:[{zh:'山',en:'Mountain'}],detected_text:'SYNTHETIC 42',place_guess:{name:'Unverified lake',confidence:.2,evidence:'Shape only'}}})});}
          else {const c=new OffscreenCanvas(80,60),x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,80,60);x.fillStyle='#000';x.fillRect(20,20,20,20);const image=await c.convertToBlob({type:'image/png'});this.onmessage?.({data:JSON.stringify({type:'result',request_id:id})});this.onmessage?.({data:await image.arrayBuffer()});}
          this.onmessage?.({data:JSON.stringify({type:'done'})});})();
      }
    };
  });
  const scope=await call(page,'/ai/annotation-scope','POST',{profile_id:profile.id,photo_ids:[photos[0].id],options:{language:'both',tag_count:4,caption_length:100,ocr:true,place_guess:true}});
  expect(scope.count).toBe(1);expect(await page.evaluate(()=>window.__studioSubmits)).toBe(0);
  const job=await call(page,'/ai/annotate','POST',{token:scope.token,count:1,confirmed:true});await expect.poll(async()=>(await call(page,'/jobs/'+job.id)).status).toBe('completed');
  const done=await call(page,'/jobs/'+job.id);expect(done.success).toBe(1);const result=await call(page,'/ai/results/'+done.results[0].result_id);
  expect((await call(page,'/photos/'+photos[0].id)).tags).toEqual(expect.arrayContaining(['山','Mountain']));
  const location=await call(page,'/locations/photos/'+photos[0].id);await call(page,'/ai/results/'+result.id+'/place-review','POST',{revision:result.revision,status:'accepted'});expect(await call(page,'/locations/photos/'+photos[0].id)).toEqual(location);
  const query=JSON.stringify({version:1,root:{field:'detected_text',op:'icontains',value:'SYNTHETIC 42'}});expect((await call(page,'/photos/ids?query='+encodeURIComponent(query)+'&count_mode=file')).ids).toEqual([photos[0].id]);
  await page.goto('/#/?page=ai-studio');await expect(page.locator('.ai-studio h1')).toBeVisible();await expect.poll(()=>page.locator('.ai-photo-picker img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);await page.getByRole('button',{name:'AI手写字',exact:true}).click();await page.getByLabel('准确文字（生成后需人工核对）').fill('测试');
  const start=page.getByRole('button',{name:'开始已确认的任务',exact:true});await expect(start).toBeDisabled();expect(await page.evaluate(()=>window.__studioSubmits)).toBe(1);
  await page.getByLabel(/确认将所选照片/).check();await start.click();await expect(page.getByRole('button',{name:'查看结果',exact:true})).toBeVisible();await page.getByRole('button',{name:'查看结果',exact:true}).click();await expect(page.locator('.ai-ink')).toBeVisible();
  const image=page.locator('.ai-ink>div');await expect(image).toHaveCSS('visibility','visible');await expect(page.getByRole('button',{name:'导出PNG',exact:true})).toBeDisabled();await page.getByLabel('我已核对文字准确，可使用此结果').check();await page.getByRole('button',{name:'导出PNG',exact:true}).click();await expect(page.getByText('下载本地结果',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__studioSubmits)).toBe(2);expect(await sourceHash(page)).toBe(before);
  const state=await manifest(page);expect(state.ai_results).toHaveLength(2);expect(JSON.stringify(state)).not.toContain('synthetic-web-only-key');await expect.poll(()=>page.locator('.ai-results img').evaluateAll(images=>images.length>0&&images.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
  await page.screenshot({path:info.outputPath('ai-handwriting.png'),fullPage:true});
});


test('browser encrypted settings opt-in keys import only into the live session',async({page},info)=>{
  test.setTimeout(90000);await setup(page);const before=await sourceHash(page),key='synthetic-transfer-session-key';
  await call(page,'/ai/profiles','POST',{name:'Transfer fixture',provider:'qwen-cn',region:'cn-beijing',workspace:'',image_model:'qwen-image-3.0',vision_model:'qwen3-vl-plus',revision:0,api_key:key,clear_key:false});
  await page.goto('/#/?page=settings');const section=page.locator('.settings-card').filter({has:page.getByRole('heading',{name:'加密设置迁移',exact:true})});
  const include=section.getByLabel('另外包含全部AI工作室账户及已配置密钥（加密保存）');await expect(include).not.toBeChecked();
  await section.getByLabel('迁移口令（至少12字符）').fill('synthetic-password-123');await include.check();
  const pending=page.waitForEvent('download');await section.getByRole('button',{name:'导出加密设置',exact:true}).click();const download=await pending,file=info.outputPath('synthetic-settings.encrypted.json');await download.saveAs(file);
  const bytes=readFileSync(file,'utf8');expect(bytes).not.toContain(key);expect(JSON.parse(bytes).cipher).toBe('AES-256-GCM');
  await section.getByLabel('迁移口令（至少12字符）').fill('synthetic-password-123');await section.locator('input[type=file]').setInputFiles(file);
  await expect(section.getByText(/另有 1 份AI账户，其中 1 份含密钥/)).toBeVisible();await section.getByRole('button',{name:'确认导入所列内容',exact:true}).click();
  await expect.poll(async()=>(await call(page,'/ai/profiles')).length).toBe(2);expect((await call(page,'/ai/profiles')).every(p=>p.configured)).toBe(true);
  expect(JSON.stringify(await manifest(page))).not.toContain(key);expect(await sourceHash(page)).toBe(before);
  await page.reload();await expect(page.locator('.app-shell')).toBeVisible();expect((await call(page,'/ai/profiles')).every(p=>!p.configured)).toBe(true);expect(await sourceHash(page)).toBe(before);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser vision sticker eight handles, hidden assets and reopen ${width} ${lang}`,async({page},info)=>{
 test.setTimeout(90000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const photos=await setup(page,lang),before=await sourceHash(page);await openEditor(page,photos.find(p=>p.file_name==='Landscape-1.png').id);await exerciseVisionUI(page,info,lang);expect(await sourceHash(page)).toBe(before);
});

test('browser real local depth UI imports weights cancels and reopens the mask',async({page},info)=>{
 test.skip(!process.env.PHOTO_TEST_VISION_MODELS,'Explicit public model fixtures required');test.setTimeout(150000);const photos=await setup(page),before=await sourceHash(page);await openEditor(page,photos.find(p=>p.file_name==='Landscape-1.png').id);await exerciseDepthUI(page,info,'browser','/#/tools/edit');expect(await sourceHash(page)).toBe(before);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`browser collage six presets adapt recover export and batch ${width} ${lang}`,async({page},info)=>{test.setTimeout(120000);await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);await page.setViewportSize({width,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await setup(page,lang);const before=await sourceHash(page);await page.goto('/#/tools');await page.locator('.studio-tool').filter({hasText:lang==='en'?'Photo collage':'照片拼图'}).click();await exerciseCollagePresets(page,info,lang);expect(await sourceHash(page)).toBe(before);});
