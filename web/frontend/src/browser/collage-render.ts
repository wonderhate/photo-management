import {drawBlendedCollage} from './collage-blend-render';
import {validateCollage,collageRects,collageImageRect,collageHasGap,collageBlend} from '../core/collage';
import type {CollageScene,CollageSource} from '../core/collage';
export type CollageOutput={format:'png'|'jpg'|'webp';quality:number;edge?:number};
export async function renderCollage(scene:CollageScene,image:(source:CollageSource)=>Promise<{image:ImageBitmap;release:()=>void}>,preview=false,options:CollageOutput&{showGuides?:boolean}={format:'png',quality:95}){
 if(!['png','jpg','webp'].includes(options.format)||!Number.isInteger(options.quality)||options.quality<1||options.quality>100||options.showGuides!==undefined&&typeof options.showGuides!=='boolean')throw new Error('Invalid collage output settings.');
 if(options.edge!==undefined&&(!Number.isInteger(options.edge)||options.edge<256||options.edge>16000))throw new Error('Invalid collage output settings.');
 validateCollage(scene);const edge=preview?1000:options.edge,scale=edge?Math.min(1,edge/Math.max(scene.width,scene.height)):1;
 const canvas=new OffscreenCanvas(Math.max(1,Math.round(scene.width*scale)),Math.max(1,Math.round(scene.height*scale))),ctx=canvas.getContext('2d')!;
 ctx.scale(canvas.width/scene.width,canvas.height/scene.height);if(!collageBlend(scene)){ctx.fillStyle=scene.background;ctx.fillRect(0,0,scene.width,scene.height);}const rects=collageRects(scene);
 try{
  if(collageBlend(scene)>0)await drawBlendedCollage(canvas,scene,image,preview&&options.showGuides!==false);
  else for(let i=0;i<scene.cells.length;i++){
   const cell=scene.cells[i],source=scene.sources.find(s=>s.id===cell.source_id)!,rect=rects[i],draw=collageImageRect(source,rect,cell),loaded=await image(source);
   try{ctx.save();ctx.beginPath();ctx.roundRect(rect.x,rect.y,rect.width,rect.height,Math.min(rect.width,rect.height)*scene.radius);ctx.clip();
    if(preview&&options.showGuides!==false&&collageHasGap(source,rect,cell)){ctx.strokeStyle='#9a783b';ctx.lineWidth=1/scale;const step=12/scale;ctx.beginPath();for(let x=rect.x-rect.height;x<rect.x+rect.width;x+=step){ctx.moveTo(x,rect.y);ctx.lineTo(x+rect.height,rect.y+rect.height);}ctx.stroke();}
    ctx.drawImage(loaded.image,draw.x,draw.y,draw.width,draw.height);ctx.restore();
   }finally{loaded.release();}
  }
  const type=preview||options.format==='png'?'image/png':options.format==='webp'?'image/webp':'image/jpeg',blob=await canvas.convertToBlob({type,quality:options.quality/100});if(blob.type!==type)throw new Error('This browser cannot encode the selected collage format.');return {blob,width:canvas.width,height:canvas.height};
 }finally{canvas.width=1;canvas.height=1;}
}
