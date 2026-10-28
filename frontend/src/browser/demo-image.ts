import type {FrameDocument} from '../core/frame-v2';
import {neutralRecipe} from './editing.ts';

export type DemoFrame='none'|'paper'|'dark';
export function demoRecipe(exposure:number,saturation:number){return {...neutralRecipe(),exposure,saturation};}
export function demoFrame(style:Exclude<DemoFrame,'none'>):FrameDocument{
  const dark=style==='dark';
  return {version:2,margin:1,text_scale:1,tokens:{},logo:null,logo_mode:'none',logo_tone:'auto',template:{
    id:'lumina-demo-'+style,name:'Lumina generated demo',family:'demo',canvas:{pad:{top:.045,right:.045,bottom:.12,left:.045},bg:{type:'solid',color:dark?'#20252a':'#f5f0e6'}},
    elements:[{type:'text',content:'LUMINA / GENERATED DEMO',anchor:{region:'bottom',h:'center',v:'center'},style:{font:'grotesk',size:.018,color:dark?'#f5f0e6':'#303a42',tracking:.1}}],
  }};
}

// Original procedural illustration for the built-in tutorial. No source photo,
// external image, library record or user file is read to create this sample.
export async function createDemoImage():Promise<File>{
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas is unavailable.');
  const sky=ctx.createLinearGradient(0,0,0,800);sky.addColorStop(0,'#456b86');sky.addColorStop(.6,'#eab889');sky.addColorStop(1,'#9fb1a2');ctx.fillStyle=sky;ctx.fillRect(0,0,1200,800);
  ctx.fillStyle='#ffe3ab';ctx.beginPath();ctx.arc(890,220,68,0,Math.PI*2);ctx.fill();
  const ridge=(points:number[][],color:string)=>{ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(0,800);for(const [x,y]of points)ctx.lineTo(x,y);ctx.lineTo(1200,800);ctx.closePath();ctx.fill();};
  ridge([[0,440],[180,330],[310,420],[530,205],[710,410],[900,300],[1200,450]],'#748e91');
  ridge([[0,570],[190,420],[350,530],[660,360],[890,530],[1100,430],[1200,495]],'#3f6a71');
  ridge([[0,645],[240,570],[430,630],[620,520],[850,595],[1050,565],[1200,635]],'#254c58');
  ctx.fillStyle='#132f3f';ctx.fillRect(0,702,1200,98);ctx.fillStyle='#f5f0e6';ctx.font='26px sans-serif';ctx.fillText('LUMINA · GENERATED DEMO',44,746);ctx.font='16px sans-serif';ctx.fillText('Procedural illustration · Not a photograph',44,776);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Demo image could not be encoded.')),'image/png'));
  return new File([blob],'lumina-generated-demo.png',{type:'image/png'});
}
