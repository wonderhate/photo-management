import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

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
