import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

for(const [lang,width,theme]of [['zh',1440,'dark'],['en',390,'light']])test(`first-use sample exports the displayed image without library access ${lang}`,async({page},info)=>{
 test.setTimeout(60000);
 const forbidden=[];await page.route('**/*',route=>{const request=route.request();if(new URL(request.url()).origin!=='http://127.0.0.1:4185'||!['GET','HEAD'].includes(request.method())){forbidden.push(request.url());return route.abort();}return route.continue();});
 await page.addInitScript(({lang,theme})=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',theme);window.__folderCalls=0;window.__databaseCalls=0;window.showDirectoryPicker=async()=>{window.__folderCalls++;throw new Error('No library access allowed');};const open=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{window.__databaseCalls++;return open(...args);};},{lang,theme});
 await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?local=1&demo=1');
 const download=page.getByRole('button',{name:lang==='zh'?'下载示例 PNG':'Download demo PNG',exact:true});await expect(download).toBeEnabled();
 const initial=await page.locator('.demo-stage img').getAttribute('src');
 const exposure=page.getByLabel(lang==='zh'?'示例亮度':'Demo exposure',{exact:true});await exposure.focus();await exposure.press('Home');for(let i=0;i<20;i++)await exposure.press('ArrowRight');
 const saturation=page.getByLabel(lang==='zh'?'示例饱和度':'Demo saturation',{exact:true});await saturation.focus();await saturation.press('End');for(let i=0;i<35;i++)await saturation.press('ArrowLeft');
 await page.getByLabel(lang==='zh'?'示例边框':'Demo frame',{exact:true}).selectOption('dark');await expect(download).toBeEnabled();
 await expect(page.locator('.demo-stage img')).not.toHaveAttribute('src',initial);
 const material=await page.evaluate(()=>({
  panels:[...document.querySelectorAll('.demo-stage,.demo-controls')].map(panel=>{const style=getComputedStyle(panel);return {name:panel.className,material:panel.getAttribute('data-liquid-glass'),backdrop:style.backdropFilter,filter:style.filter};}),
  image:(()=>{const image=document.querySelector('.demo-stage img'),style=getComputedStyle(image);return {excluded:image.hasAttribute('data-glass-exclude'),filter:style.filter,backdrop:style.backdropFilter};})()
 }));
 expect(material.panels).toHaveLength(2);for(const panel of material.panels){expect(panel.material).toBe('panel');expect(panel.backdrop).toMatch(/blur\([1-9][\d.]*px\)/);expect(panel.filter).toBe('none');}
 expect(material.image).toEqual({excluded:true,filter:'none',backdrop:'none'});
 await info.attach(`demo-material-${lang}`,{body:JSON.stringify(material,null,2),contentType:'application/json'});
 const displayed=await page.locator('.demo-stage img').evaluate(async image=>{const blob=await(await fetch(image.src)).blob();return [...new Uint8Array(await blob.arrayBuffer())];});
 const event=page.waitForEvent('download');await download.click();const file=await event;expect(file.suggestedFilename()).toBe('lumina-demo-edited.png');const bytes=readFileSync(await file.path());
 expect(bytes.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(Buffer.from(displayed)).digest('hex'));
 expect(await page.evaluate(()=>({folders:window.__folderCalls,databases:window.__databaseCalls,overflow:document.documentElement.scrollWidth>innerWidth+1}))).toEqual({folders:0,databases:0,overflow:false});expect(forbidden).toEqual([]);
 await page.screenshot({path:info.outputPath(`demo-${lang}-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:lang==='zh'?'返回开始页':'Back to start',exact:true}).click();await expect(page.locator('.browser-start-card')).toBeVisible();await expect(page.getByRole('button',{name:lang==='zh'?'用示例体验':'Try a sample',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath(`start-${lang}-${width}.png`),fullPage:true});
});

test('a cancelled library picker preserves darkroom intent and successful setup resumes it',async({page})=>{
 test.setTimeout(60000);
 await page.addInitScript(()=>{localStorage.setItem('lang','zh');window.__pickerCount=0;FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';window.showDirectoryPicker=async()=>{window.__pickerCount++;if(window.__pickerCount===1)throw new DOMException('Cancelled','AbortError');const root=await navigator.storage.getDirectory();return root.getDirectoryHandle('first-use-synthetic-library',{create:true});};});
 await page.goto('/?local=1');await page.getByRole('button',{name:'跳过，先浏览',exact:true}).click();
 await page.evaluate(()=>{history.pushState(null,'','#/tools/darkroom');window.dispatchEvent(new PopStateEvent('popstate'));});
 await page.getByRole('button',{name:'打开照片 / RAW',exact:true}).click();
 const prompt=page.locator('.browser-library-prompt');await expect(prompt).toBeVisible();
 await prompt.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(prompt.getByRole('alert')).toContainText('未选择文件夹');await expect(prompt).toBeVisible();
 await prompt.getByRole('button',{name:'新建本地图库',exact:true}).click();await expect(prompt).not.toBeVisible();await expect(page.locator('.editor-resume')).toBeVisible();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'继续打开照片 / RAW',exact:true}).click();await(await chooser).setFiles({name:'synthetic-demo.png',mimeType:'image/png',buffer:readFileSync(new URL('../public/demo/lumina-original.png',import.meta.url))});
 await expect(page.locator('.editor-resume')).not.toBeVisible();await expect(page.locator('.edit-image img')).toBeVisible();expect(await page.evaluate(()=>window.__pickerCount)).toBe(2);
});
