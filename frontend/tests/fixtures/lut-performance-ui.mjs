import {expect} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {invertCube} from './lut-ui.mjs';
import {imageDigest} from './text-ui.mjs';
export async function installLutPerformanceProbe(page){
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'hardwareConcurrency',{value:8,configurable:true});Object.defineProperty(navigator,'deviceMemory',{value:8,configurable:true});
  const Original=window.Worker;window.__lutProbe={workers:[],thumbs:[],renders:[],hashes:[],holdThumb:false,holdRender:false};
  window.Worker=class extends Original{
   constructor(url,options){super(url,options);this.isLutThumb=String(url).includes('lut-preview-worker');this.probe={terminated:false};if(this.isLutThumb)window.__lutProbe.workers.push(this.probe);}
   postMessage(message,...args){const probe=window.__lutProbe;
    if(this.isLutThumb&&probe.holdThumb&&probe.hashes.includes(message.hash)){probe.thumbs.push({worker:this.probe,release:()=>super.postMessage(message,...args)});return;}
    if(probe.holdRender&&message.action==='render'&&message.recipe?.lut){probe.renders.push({hash:message.recipe.lut.asset_hash,release:()=>super.postMessage(message,...args),fail:()=>this.dispatchEvent(new MessageEvent('message',{data:{id:message.id,error:'Synthetic held LUT failure'}}))});return;}
    return super.postMessage(message,...args);
   }
   terminate(){this.probe.terminated=true;super.terminate();}
  };
 });
}
export async function exerciseLutPerformance(page,info,lang){
 const t=(zh,en)=>lang==='en'?en:zh,prefix='Parallel-'+randomUUID().slice(0,8),names=Array.from({length:6},(_,i)=>prefix+'-'+i+'.cube'),texts=names.map((name,i)=>i===1||i===2?`TITLE "${name}"\nLUT_3D_SIZE 2\n`+Array(8).fill(i===1?'0.8 0.1 0.2':'0.1 0.2 0.7').join('\n'):invertCube(name)),hashes=texts.map(s=>createHash('sha256').update(s).digest('hex')),panel=page.locator('.lut-panel'),image=page.locator('.edit-image img'),original=await imageDigest(image);
 await page.evaluate(hashes=>{window.__lutProbe.hashes=hashes;window.__lutProbe.holdThumb=true;},hashes);
 await panel.locator(':scope>summary').click();await panel.getByRole('searchbox').fill(prefix);await panel.getByRole('combobox',{name:t('样式分组','Style group'),exact:true}).selectOption('all');await panel.getByRole('combobox',{name:t('缩略图列数','Thumbnail columns'),exact:true}).selectOption('3');
 await panel.locator('input[type=file]').first().setInputFiles(names.map((name,i)=>({name,mimeType:'application/octet-stream',buffer:Buffer.from(texts[i])})));await expect(panel.locator('.lut-import-report')).toContainText(t('新增 6','Added 6'));
 const choice=i=>panel.getByRole('button',{name:t('应用 LUT ','Apply LUT ')+names[i],exact:true});await choice(0).scrollIntoViewIfNeeded();await page.waitForFunction(()=>window.__lutProbe.thumbs.length===4);expect(await page.evaluate(()=>window.__lutProbe.workers.filter(w=>!w.terminated).length)).toBe(4);
 await panel.locator(':scope>summary').click();await expect.poll(()=>page.evaluate(()=>window.__lutProbe.workers.filter(w=>!w.terminated).length)).toBe(0);expect(await imageDigest(image)).toBe(original);await page.evaluate(()=>window.__lutProbe.holdThumb=false);await panel.locator(':scope>summary').click();await choice(0).scrollIntoViewIfNeeded();await expect(choice(0).locator('img')).toBeVisible();expect(await page.evaluate(()=>window.__lutProbe.workers.filter(w=>!w.terminated).length)).toBeLessThanOrEqual(4);
 await choice(2).click();await expect.poll(()=>imageDigest(image)).not.toBe(original);const final=await imageDigest(image);await choice(0).click();await expect.poll(()=>imageDigest(image)).not.toBe(final);const first=await imageDigest(image);expect(first).not.toBe(original);
 await page.evaluate(()=>{const image=document.querySelector('.edit-image img'),canvas=new OffscreenCanvas(8,8),ctx=canvas.getContext('2d');window.__lutFrameHash=()=>{if(!image.complete||!image.naturalWidth)return 'empty';ctx.drawImage(image,0,0,8,8);let h=2166136261;for(const value of ctx.getImageData(0,0,8,8).data)h=Math.imul(h^value,16777619);return String(h);};window.__lutFrames=[];window.__watchLut=true;const frame=()=>{window.__lutFrames.push(window.__lutFrameHash());if(window.__watchLut)requestAnimationFrame(frame);};requestAnimationFrame(frame);window.__lutProbe.holdRender=true;});const firstFrame=await page.evaluate(()=>window.__lutFrameHash());
 await choice(1).click();await page.waitForFunction(()=>window.__lutProbe.renders.length===1);expect(await imageDigest(image)).toBe(first);await choice(2).click();await page.evaluate(()=>window.__lutProbe.renders[0].release());await page.waitForFunction(()=>window.__lutProbe.renders.length===2);expect(await imageDigest(image)).toBe(first);await page.evaluate(()=>window.__lutProbe.renders[1].release());await expect.poll(()=>imageDigest(image)).toBe(final);const frames=await page.evaluate(()=>{window.__watchLut=false;return {seen:window.__lutFrames,last:window.__lutFrameHash()};});expect(frames.seen.length).toBeGreaterThan(2);expect([...new Set(frames.seen)].filter(value=>value!==firstFrame&&value!==frames.last)).toEqual([]);
 await choice(1).click();await page.waitForFunction(()=>window.__lutProbe.renders.length===3);await choice(0).click();await page.evaluate(()=>window.__lutProbe.renders[2].fail());await page.waitForFunction(()=>window.__lutProbe.renders.length===4);expect(await imageDigest(image)).toBe(final);await expect(page.getByRole('alert')).toHaveCount(0);await page.evaluate(()=>window.__lutProbe.renders[3].release());await expect.poll(()=>imageDigest(image)).toBe(first);
 await choice(1).click();await page.waitForFunction(()=>window.__lutProbe.renders.length===5);await page.evaluate(()=>window.__lutProbe.renders[4].fail());await expect(page.getByRole('alert')).toContainText('Synthetic held LUT failure');expect(await imageDigest(image)).toBe(first);await page.evaluate(()=>window.__lutProbe.holdRender=false);await choice(2).click();await expect.poll(()=>imageDigest(image)).toBe(final);await expect(page.getByRole('alert')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('lut-performance.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await panel.locator(':scope>summary').click();await expect.poll(()=>page.evaluate(()=>window.__lutProbe.workers.filter(w=>!w.terminated).length)).toBe(0);
}
