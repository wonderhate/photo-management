import {test,expect} from '@playwright/test';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {browserApiModule} from './fixtures/browser-api-module.mjs';

const assets=fileURLToPath(new URL('../dist-web/assets/',import.meta.url));
const mainModule='/assets/'+readdirSync(assets).find(name=>/^main-.*\.js$/.test(name));
const apiModule=browserApiModule(assets);
const editorModule='/assets/'+readdirSync(assets).find(name=>/^editor-adapter-.*\.js$/.test(name));

async function setup(page){
  page.on('dialog',dialog=>dialog.accept());
  const denied=[];
  await page.route('**/*',route=>{
    const request=route.request();if(new URL(request.url()).origin!=='http://127.0.0.1:4185'||!['GET','HEAD'].includes(request.method())){denied.push(request.url());return route.abort();}return route.continue();
  });
  await page.addInitScript(()=>{
    localStorage.setItem('lang','zh');
    FileSystemHandle.prototype.queryPermission=async()=> 'granted';FileSystemHandle.prototype.requestPermission=async()=> 'granted';
    const Native=Worker;window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',event=>{if(this.__heldMetadataID!==undefined&&event.data?.id===this.__heldMetadataID)window.__lateMetadataReturned=true;});}postMessage(message,...rest){if(window.__holdTemporaryMetadata&&message.action==='metadata'){this.__heldMetadataID=message.id;window.__lateMetadata=()=>super.postMessage(message,...rest);return;}return super.postMessage(message,...rest);}};
  });
  await page.goto('/?local=1&demo=1');await expect(page.locator('.editor-page')).toBeVisible();await expect(page.locator('.edit-image img')).toBeVisible();await expect.poll(()=>page.locator('.edit-image img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await page.evaluate(async module=>{
    const storage=(await import(module)).storage;
    if(!storage?.isTemporaryLibrary())throw new Error('The demo did not open its isolated memory session.');
    const root=await navigator.storage.getDirectory(),data=await root.getDirectoryHandle('lifecycle-synthetic-library',{create:true}),originals=await root.getDirectoryHandle('lifecycle-synthetic-originals',{create:true});
    const canvas=new OffscreenCanvas(96,64),context=canvas.getContext('2d');context.fillStyle='#355b79';context.fillRect(0,0,96,64);context.fillStyle='#d9c088';context.fillRect(12,8,40,35);
    const blob=await canvas.convertToBlob({type:'image/png'}),original=await originals.getFileHandle('synthetic-original.png',{create:true}),writer=await original.createWritable();await writer.write(blob);await writer.close();
    const file=await original.getFile(),hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await value.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
    window.__lifecycle={storage,root,data,originals,original,file,hash,before:await hash(file),oldId:storage.current().id};window.showDirectoryPicker=async()=>data;
  },mainModule);
  return async()=>{
    expect(denied).toEqual([]);
    const result=await page.evaluate(async()=>{const f=window.__lifecycle;return {before:f.before,after:await f.hash(await f.original.getFile()),manifest:JSON.parse(await(await(await f.data.getFileHandle('library.json')).getFile()).text())};});
    expect(result.after).toBe(result.before);expect(result.manifest.photos).toEqual([]);expect(result.manifest.jobs).toEqual([]);expect(result.manifest.drafts).toEqual([]);expect(result.manifest.settings.export_quality).toBe(95);
    return result;
  };
}

test('temporary disposal drains late saves before a later real library can open',async({page})=>{
  const check=await setup(page);
  await page.evaluate(async()=>{
    const f=window.__lifecycle;await f.storage.writeFile('photos/source.png',f.file);const folder=await f.storage.directory().getDirectoryHandle('photos');f.oldHandle=await folder.getFileHandle('source.png');f.oldWriter=await f.oldHandle.createWritable();await f.oldWriter.write('unpublished source mutation');
    f.gate=new Promise(resolve=>f.release=resolve);f.started=false;f.lateSave=f.storage.runLibraryLock('temporary-held-save:'+f.oldId,async()=>{f.started=true;await f.gate;await f.storage.commit(value=>{value.settings.export_quality=7;});}).then(()=>'',error=>error.name+': '+error.message);
  });
  await expect.poll(()=>page.evaluate(()=>window.__lifecycle.started)).toBe(true);
  await page.getByRole('button',{name:'返回开始页',exact:true}).click();await expect(page.locator('.browser-start-card')).toBeVisible();
  await page.getByRole('button',{name:'新建本地图库',exact:true}).click();
  // The new library cannot become writable while an old unguarded continuation
  // is still inside its temporary lock. This is the real FSA/OPFS fixture only.
  const waiting=await page.evaluate(async()=>{try{await window.__lifecycle.data.getFileHandle('library.json');return false;}catch(error){if(error.name==='NotFoundError')return true;throw error;}});expect(waiting).toBe(true);
  await page.evaluate(()=>window.__lifecycle.release());await expect(page.locator('.app-shell')).toBeVisible();
  const stale=await page.evaluate(async()=>{const f=window.__lifecycle,save=await f.lateSave;let writer='';try{await f.oldWriter.close();}catch(error){writer=error.name;}return {save,writer,changed:f.storage.current().id!==f.oldId,temporary:f.storage.isTemporaryLibrary()};});
  expect(stale.save).not.toBe('');expect(stale.writer).toBe('AbortError');expect(stale.changed).toBe(true);expect(stale.temporary).toBe(false);await check();
});

test('a delayed temporary import result cannot publish photos or tasks into the next library',async({page})=>{
  const check=await setup(page);
  await page.evaluate(async module=>{window.__holdTemporaryMetadata=true;const f=window.__lifecycle;f.importJob=await(await import(module)).importSelectedFiles([f.file]);},apiModule);
  await expect.poll(()=>page.evaluate(()=>typeof window.__lateMetadata==='function')).toBe(true);
  await page.getByRole('button',{name:'返回开始页',exact:true}).click();await expect(page.locator('.browser-start-card')).toBeVisible();
  await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate(()=>{window.__holdTemporaryMetadata=false;window.__lateMetadata();});
  // Let the real image worker reply and the cancelled TaskContext settle.
  await expect.poll(()=>page.evaluate(()=>window.__lateMetadataReturned)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.__lifecycle.storage.current().jobs.length)).toBe(0);
  await check();
});

test('temporary LUT folders remain fully usable without reading or writing remembered handles',async({page})=>{
  const check=await setup(page);
  const result=await page.evaluate(async module=>{
    const f=window.__lifecycle,folder=await f.root.getDirectoryHandle('lifecycle-synthetic-luts',{create:true}),file=await folder.getFileHandle('Identity.cube',{create:true}),writer=await file.createWritable();
    const cube='TITLE "Identity"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';await writer.write(cube);await writer.close();const before=await f.hash(await file.getFile());
    const open=indexedDB.open;let accesses=0;indexedDB.open=()=>{accesses++;throw new Error('Temporary LUTs cannot access the remembered handle database.');};window.showDirectoryPicker=async()=>folder;
    try{
      const library=(await import(module)).createEditorServices().library,linked=await library.linkLutFolder(),scanned=await library.scanLutFolder(linked.id),read=await library.lutSource(scanned.entries[0].asset.id);
      await f.storage.handleValue('lifecycle-temporary-handle',folder);f.temporaryHandleName=(await f.storage.handleValue('lifecycle-temporary-handle')).name;
      return {accesses,state:scanned.state,entries:scanned.entries.length,text:await read.text(),before,after:await f.hash(await file.getFile()),handleName:f.temporaryHandleName};
    }finally{indexedDB.open=open;window.showDirectoryPicker=async()=>f.data;}
  },editorModule);
  expect(result.accesses).toBe(0);expect(result.state).toBe('ready');expect(result.entries).toBe(1);expect(result.text).toContain('LUT_3D_SIZE 2');expect(result.after).toBe(result.before);expect(result.handleName).toBe('lifecycle-synthetic-luts');
  await page.getByRole('button',{name:'返回开始页',exact:true}).click();await page.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(page.locator('.app-shell')).toBeVisible();
  expect(await page.evaluate(()=>window.__lifecycle.storage.handleValue('lifecycle-temporary-handle'))).toBeUndefined();await check();
});
