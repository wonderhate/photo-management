import {expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const templates=JSON.parse(readFileSync(new URL('../../src/core/collage-templates.json',import.meta.url),'utf8'));
export async function exerciseCollageWorker(page,module,editModule){
 const raw=[...readFileSync(new URL('../../../.test-artifacts/raw-fixtures/sample.DNG',import.meta.url))];
 const result=await page.evaluate(async({module,editModule,templates,raw})=>{
  const workers=[];
  function session(url){const worker=new Worker(url,{type:'module'});workers.push(worker);let n=0;const pending=new Map();worker.onmessage=({data})=>{if(data.progress)return;const request=pending.get(data.id);if(!request)return;pending.delete(data.id);clearTimeout(request.timer);data.error?request.reject(Error(data.error)):request.resolve(data.result);};return data=>new Promise((resolve,reject)=>{const id=++n,timer=setTimeout(()=>reject(Error('Collage test timeout')),30000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,...data});});}
  const hash=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].join(','),pixels=async blob=>{const im=await createImageBitmap(blob),c=new OffscreenCanvas(im.width,im.height),x=c.getContext('2d');x.drawImage(im,0,0);im.close();return x.getImageData(0,0,c.width,c.height).data;},profile={version:2,extra_orientation:1};
  const c=new OffscreenCanvas(2048,2048),x=c.getContext('2d'),image=x.createImageData(c.width,c.height);for(let i=0;i<image.data.length;i++)image.data[i]=i%4===3?255:(i*157+(i>>13))%256;x.putImageData(image,0,0);
  const file=new File([await c.convertToBlob({type:'image/png'})],'Detail.png'),original=await hash(await file.arrayBuffer()),send=session(module),input={id:'detail',file,profile};
  const make=(sources,template=templates.find(t=>t.cells.length===sources.length),width=317,height=211)=>({version:1,template:template.id,width,height,gap:0,padding:0,radius:0,background:'#ffffff',sources,cells:sources.map(s=>({source_id:s.id,pan:{x:0,y:0},zoom:1}))});
  try{
   const sources=await send({action:'open',inputs:[input]}),scene=make(sources,undefined,2048,2048),preview=await send({action:'render',scene}),full=await send({action:'export',scene});
   const exact=await hash(await pixels(full.blob))===await hash(image.data),small={width:preview.width,height:preview.height};
   const reordered=JSON.parse(JSON.stringify(scene,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v));await send({action:'export',scene:reordered});
   const errors=[];for(const bad of [{...scene,version:2},{...scene,sources:sources.map(s=>({...s,sha256:'0'.repeat(64)}))}]){try{await send({action:'export',scene:bad});errors.push('accepted');}catch(e){errors.push(e.message);}}
   try{await send({action:'open',inputs:[input,{id:'bad',file:new File(['bad'],'Bad.png'),profile}]});errors.push('accepted');}catch(e){errors.push(e.message);}
   const jpegLow=await send({action:'export',scene,options:{format:'jpg',quality:10}}),jpegHigh=await send({action:'export',scene,options:{format:'jpg',quality:95}}),jpeg={type:jpegHigh.blob.type,width:jpegHigh.width,height:jpegHigh.height,low:jpegLow.blob.size,high:jpegHigh.blob.size};
   const webp=await send({action:'export',scene,options:{format:'webp',quality:80}}),webpBitmap=await createImageBitmap(webp.blob),webpInfo={type:webp.blob.type,width:webpBitmap.width,height:webpBitmap.height,magic:Array.from(new Uint8Array(await webp.blob.slice(0,12).arrayBuffer()))};webpBitmap.close();
   try{await send({action:'export',scene,options:{format:'exe',quality:900}});errors.push('accepted');}catch(e){errors.push(e.message);}
   const afterFailure=await hash(await pixels((await send({action:'export',scene})).blob))===await hash(image.data);
   const colors=[];for(let i=0;i<12;i++){const canvas=new OffscreenCanvas(8,8),ctx=canvas.getContext('2d');ctx.fillStyle=`rgb(${20+i*17},${220-i*13},${40+i*9})`;ctx.fillRect(0,0,8,8);colors.push({id:'color-'+i,file:new File([await canvas.convertToBlob()],i+'.png'),profile});}
   const all=await send({action:'open',inputs:colors});let coverage=0;
   for(const template of templates){const layout=make(all.slice(0,template.cells.length),template),out=await pixels((await send({action:'export',scene:layout})).blob);let correct=true;
    for(const [i,cell] of template.cells.entries()){const left=Math.round(cell.x*317),top=Math.round(cell.y*211),right=Math.round((cell.x+cell.w)*317),bottom=Math.round((cell.y+cell.h)*211);for(let y=top;y<bottom;y++)for(let xx=left;xx<right;xx++){const k=(y*317+xx)*4;if(out[k]!==20+i*17||out[k+1]!==220-i*13||out[k+2]!==40+i*9||out[k+3]!==255)correct=false;}}
    if(correct)coverage++;
   }
   const gap=make(all.slice(0,1));gap.cells[0].zoom=.25;const guide=await pixels((await send({action:'render',scene:gap})).blob),clean=await pixels((await send({action:'export',scene:gap})).blob);let stripes=0;for(let i=0;i<clean.length;i+=4)if(clean[i]===255&&clean[i+1]===255&&clean[i+2]===255&&guide[i]!==255)stripes++;
   const hidden=await pixels((await send({action:'render',scene:gap,options:{format:'png',quality:95,showGuides:false}})).blob),hiddenMatches=await hash(hidden)===await hash(clean);
   const rawFile=new File([new Uint8Array(raw)],'sample.DNG'),rawHash=await hash(await rawFile.arrayBuffer()),rawSources=await send({action:'open',inputs:[{id:'raw',file:rawFile,profile}]}),rawScene=make(rawSources,undefined,rawSources[0].width,rawSources[0].height),rawOutput=await send({action:'export',scene:rawScene}),edit=session(editModule);
   await edit({action:'open',file:rawFile,profile});const recipe={version:1,exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX:false,flipY:false,crop:{x:0,y:0,width:1,height:1},sharpen:0,denoise:0,match:0,preserveLuminance:true},neutral=await edit({action:'export',recipe,edge:0,format:'png'});
   return {webpInfo,exact,small,errors,afterFailure,coverage,stripes,jpeg,hiddenMatches,rawBits:rawSources[0].bits,rawMatches:await hash(await pixels(rawOutput.blob))===await hash(await pixels(neutral.blob)),originalUnchanged:original===await hash(await file.arrayBuffer()),rawUnchanged:rawHash===await hash(await rawFile.arrayBuffer())};
  }finally{for(const worker of workers)worker.terminate();}
 },{module,editModule,templates,raw});
 expect(result).toMatchObject({exact:true,small:{width:1000,height:1000},afterFailure:true,coverage:80,hiddenMatches:true,jpeg:{type:'image/jpeg',width:2048,height:2048},rawBits:16,rawMatches:true,originalUnchanged:true,rawUnchanged:true});expect(result.webpInfo).toMatchObject({type:'image/webp',width:2048,height:2048});expect(String.fromCharCode(...result.webpInfo.magic.slice(8))).toBe('WEBP');expect(result.stripes).toBeGreaterThan(100);expect(result.jpeg.high).toBeGreaterThan(result.jpeg.low);expect(result.errors).toHaveLength(4);expect(result.errors).not.toContain('accepted');return result;
}
