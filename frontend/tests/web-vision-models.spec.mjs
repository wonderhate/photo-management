import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';

// Explicit public weight fixtures only. Never download models or read a user library.
const fixture=process.env.PHOTO_TEST_VISION_MODELS;
const catalog=JSON.parse(readFileSync('frontend/src/core/vision-models.json','utf8')).filter(m=>m.runtime==='browser');
for(const spec of catalog)test(`real offline browser ${spec.kind} model runs with bundled WASM`,async({page,context})=>{
  test.skip(!fixture,'Explicit local model fixture directory required');test.setTimeout(180000);
  const within=relative(resolve('.test-artifacts'),resolve(fixture));expect(isAbsolute(within)||within.startsWith('..')).toBe(false);
  const files=spec.files.map(item=>{const path=join(fixture,'browser',spec.id,item.name),bytes=readFileSync(path);expect(bytes.length).toBe(item.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256);return {path,name:item.name};});
  const worker='/assets/'+readdirSync('frontend/dist-web/assets').find(f=>/^vision-worker-.*\.js$/.test(f));
  const external=[];await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.protocol.startsWith('http')&&url.origin!=='http://127.0.0.1:4175'){external.push(url.origin);return route.abort();}return route.continue();});
  await page.goto('/');await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.multiple=true;input.id='offline-model-fixture';document.body.append(input);});
  await page.locator('#offline-model-fixture').setInputFiles(files.map(f=>f.path));
  const result=await page.evaluate(async({spec,worker,names})=>{
    const c=new OffscreenCanvas(320,240),x=c.getContext('2d');x.fillStyle='#467f91';x.fillRect(0,0,320,240);x.fillStyle='#dfb484';x.beginPath();x.ellipse(160,90,70,70,0,0,Math.PI*2);x.fill();x.fillStyle='#dd6644';x.fillRect(80,140,160,90);x.fillStyle='#eedc44';x.beginPath();x.ellipse(290,50,25,30,0,0,Math.PI*2);x.fill();
    const image=await c.convertToBlob({type:'image/png'}),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await image.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const files=[...document.querySelector('#offline-model-fixture').files].map((blob,i)=>({blob,name:names[i]}));
    const w=new Worker(worker,{type:'module'});
    try{const output=await new Promise((resolve,reject)=>{w.onmessage=e=>resolve(e.data);w.onerror=e=>reject(new Error(e.message));w.postMessage({image,files,payload:{kind:spec.kind,model_id:spec.id,source:{sha256,width:320,height:240},name:'Synthetic subject',instances:spec.kind==='depth'?[]:[{id:'subject-1',points:[{x:.5,y:.4,label:1},{x:.05,y:.05,label:0},{x:.9,y:.2,label:0}],feather:1},{id:'subject-2',points:[{x:.9,y:.2,label:1},{x:.5,y:.4,label:0}],feather:0}]}});});
      if(output.error)return {error:output.error};const item=output.items[0],b=await createImageBitmap(item.blob),canvas=new OffscreenCanvas(b.width,b.height),ctx=canvas.getContext('2d');ctx.drawImage(b,0,0);b.close();const p=ctx.getImageData(0,0,canvas.width,canvas.height).data;let min=255,max=0,soft=0;for(let i=spec.kind==='depth'?0:3;i<p.length;i+=4){min=Math.min(min,p[i]);max=Math.max(max,p[i]);if(p[i]>10&&p[i]<240)soft++;}return {instances:output.items.map(v=>v.instance_id),count:output.items.length,width:item.width,height:item.height,type:item.blob.type,min,max,soft};
    }finally{w.terminate();}
  },{spec,worker,names:files.map(f=>f.name)});
  expect(result.error).toBeUndefined();expect(result.count).toBe(spec.kind==='depth'?1:2);if(spec.kind==='segment')expect(result.instances).toEqual(['subject-1','subject-2']);expect(result.type).toBe('image/png');expect(result.width).toBeGreaterThan(0);expect(result.height).toBeGreaterThan(0);expect(result.min).toBeLessThan(10);expect(result.max).toBeGreaterThan(240);expect(result.soft).toBeGreaterThan(0);expect(external).toEqual([]);
});
