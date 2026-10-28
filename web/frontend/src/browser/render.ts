import {renderFrameV2} from './frame-v2-render';
import type {WatermarkOptions} from '../types';
import type {ArtLayout} from './storage';
import {photoBitmap} from './raw-decode';
import {watercolorLayout} from '../core/watercolor';
export const fontFiles:Record<string,string>={fine:'Sacramento-Regular.ttf',brush:'KaushanScript-Regular.ttf',calligraphy:'AlexBrush-Regular.ttf',chinese_brush:'MaShanZheng-Regular.ttf',chinese_running:'ZhiMangXing-Regular.ttf',chinese_cursive:'LiuJianMaoCao-Regular.ttf',chinese_handwriting:'LongCang-Regular.ttf'};
const loaded=new Map<string,Promise<string>>();
async function family(style:string){
  if(!fontFiles[style])return 'sans-serif';
  if(!loaded.has(style))loaded.set(style,(async()=>{
    const response=await fetch('/local-assets/signatures/'+fontFiles[style]);
    if(!response.ok)throw new Error('Signature font is unavailable.');
    const name='pc-'+style,face=new FontFace(name,await response.arrayBuffer());await face.load();
    (self as unknown as {fonts:FontFaceSet}).fonts.add(face);return name+', sans-serif';
  })().catch(error=>{loaded.delete(style);throw error;}));
  return loaded.get(style)!;
}
type Ctx=OffscreenCanvasRenderingContext2D;
type Rect=[number,number,number,number];
function canvas(w:number,h:number){w=Math.max(1,Math.round(w));h=Math.max(1,Math.round(h));if(w>16000||h>16000||w*h>64_000_000)throw new Error('Export exceeds the browser canvas limit (16000 px / 64 megapixels).');return new OffscreenCanvas(w,h);}
function block(ctx:Ctx,lines:string[],[x,y,w,h]:Rect,size:number,color:string,align:CanvasTextAlign='left',font='sans-serif'){
  lines=lines.filter(Boolean);if(!lines.length)return;size=Math.max(8,Math.round(size));
  while(size>8){ctx.font=`${size}px ${font}`;if(lines.length*size*1.5<=h&&lines.every(t=>ctx.measureText(t).width<=w))break;size--;}
  ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.font=`${size}px ${font}`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';const step=size*1.5,start=y+h/2-(lines.length-1)*step/2;
  lines.forEach((text,i)=>ctx.fillText(text,align==='center'?x+w/2:align==='right'?x+w:x,start+i*step,w));ctx.restore();
}
async function signature(ctx:Ctx,text:string,style:string,rect:Rect,color:string){
  if(!text)return;
  if(style==='natural'){const response=await fetch('/local-assets/signatures/natural.png');if(!response.ok)throw new Error('Signature asset is unavailable.');const image=await createImageBitmap(await response.blob());try{const [x,y,w,h]=rect,s=Math.min(w/image.width,h/image.height);const c=canvas(image.width,image.height),m=c.getContext('2d')!;m.drawImage(image,0,0);m.globalCompositeOperation='source-in';m.fillStyle=color;m.fillRect(0,0,c.width,c.height);ctx.drawImage(c,x+(w-image.width*s)/2,y+(h-image.height*s)/2,image.width*s,image.height*s);}finally{image.close();}}
  else block(ctx,[text],rect,rect[3]*.75,color,'center',await family(style));
}
function info(photo:Record<string,any>,o:WatermarkOptions){const has=(f:string)=>o.fields.includes(f),make=has('camera_make')?photo.camera_make:'',model=has('camera_model')?photo.camera_model:'';const left=[make,model,has('lens_model')?photo.lens_model:''].filter(Boolean);if(!photo.camera_make&&!photo.camera_model)left.push(photo.file_name?.replace(/\.[^.]+$/,'')||'');const params=[['focal_length',(v:unknown)=>v+'mm'],['f_number',(v:unknown)=>'F'+v],['exposure_time',(v:unknown)=>v+'s'],['iso',(v:unknown)=>'ISO'+v]] as const;const right=[params.filter(([key])=>has(key)&&photo[key]!=null).map(([key,format])=>format(photo[key])).join('  '),has('date_taken')?(photo.date_taken||'').replace('T',' ').slice(0,19):''];return {left,right};}
export async function renderWatermark(file:Blob,photo:Record<string,any>,o:WatermarkOptions,preview=false){
  if(!o||!Number.isInteger(o.quality)||o.quality<1||o.quality>100||!Array.isArray(o.fields)||!['jpg','png','webp'].includes(o.format)||!['frame','ambient'].includes(o.template)||!Number.isFinite(o.long_edge)||o.long_edge<0||o.long_edge>16000)throw new Error('Invalid export settings.');
  if(o.template==='frame'&&o.frame_v2)return renderFrameV2(file,o.frame_v2,photo.decode_profile,preview?1200:o.long_edge,preview?'webp':o.format,preview?90:o.quality);
  const image=await photoBitmap(file,photo.decode_profile);try{
    // Layout uses full-size coordinates in both modes; only final sampling changes.
    const w=image.width,h=image.height,u=Math.min(w,h),{left,right}=info(photo,o),signed=o.fields.includes('signature')&&!!o.signature;
    const border=o.template==='ambient'?u*(1-o.photo_scale)/2:o.style==='classic_frame'?u*o.border:0;
    const footer=o.template==='ambient'?Math.max(u*.13,Math.max(left.length,2)*u*.024*o.font_size*1.55+u*.048):o.style==='classic_frame'?Math.max(u*o.info_height,(left.length+1)*u*.023*o.font_size*1.65+border+(signed?u*.09:0)):h*o.info_bar_ratio/(1-o.info_bar_ratio);
    const fullW=w+2*border,fullH=h+border+(o.template==='ambient'?border:0)+footer;
    const edge=preview?1000:o.long_edge||Math.max(fullW,fullH),s=Math.min(1,edge/Math.max(fullW,fullH));const c=canvas(fullW*s,fullH*s),ctx=c.getContext('2d')!;ctx.scale(s,s);
    let dark=o.theme==='black';if(o.theme==='auto'){const sample=new OffscreenCanvas(1,1),sctx=sample.getContext('2d')!;sctx.drawImage(image,0,0,1,1);const p=sctx.getImageData(0,0,1,1).data;dark=(p[0]+p[1]+p[2])/3<130;}
    const foreground=o.template==='ambient'?'#f4f4ee':dark&&o.style==='classic_frame'?'#f2f0e9':'#111111';
    ctx.fillStyle=o.template==='ambient'?'#111315':dark&&o.style==='classic_frame'?'#151719':o.style==='classic_frame'?'#f7f5f0':'white';ctx.fillRect(0,0,fullW,fullH);
    if(o.template==='ambient'){ctx.save();ctx.globalAlpha=o.intensity;ctx.filter=`blur(${Math.max(1,u*o.blur)}px) saturate(${o.saturation}) brightness(${o.brightness})`;const fit=Math.max(fullW/w,fullH/h);ctx.drawImage(image,(fullW-w*fit)/2,(fullH-h*fit)/2,w*fit,h*fit);ctx.restore();}
    ctx.save();if(o.shadow&&o.template==='ambient'){ctx.shadowColor='#0009';ctx.shadowBlur=u*.02;ctx.shadowOffsetY=u*.012;}ctx.beginPath();ctx.roundRect(border,border,w,h,o.style==='modern_info_bar'&&o.template==='frame'?0:u*o.radius);ctx.clip();ctx.drawImage(image,border,border,w,h);ctx.restore();
    const y=h+border+(o.template==='ambient'?border:0),size=w*.022*o.font_scale,pad=w*.04;
    if(o.template==='ambient'){ctx.fillStyle='#12181c91';ctx.beginPath();ctx.roundRect(pad,y,fullW-pad*2,footer-u*.022,footer/2);ctx.fill();}
    if(o.template==='frame'&&o.style==='modern_info_bar'){
      const divider=w*(signed?.71:.64);block(ctx,left,[pad,y+footer*.18,w*(signed?.36:.52)-pad*1.5,footer*.64],size,foreground);
      block(ctx,right,[divider+pad*.5,y+footer*.18,w-divider-pad*1.5,footer*.64],size*.72,'#8a8a8a','right');
      if(signed)await signature(ctx,o.signature,o.signature_style,[w*.36,y+footer*.18,w*.28,footer*.64],foreground);
      ctx.strokeStyle='#e6e6e6';ctx.lineWidth=Math.max(1,w/1920);ctx.beginPath();ctx.moveTo(divider,y+footer*.25);ctx.lineTo(divider,y+footer*.75);ctx.stroke();
      if(o.show_brand_logo&&photo.camera_make){const brand=Object.keys({canon:1,nikon:1,sony:1,leica:1,fujifilm:1}).find(v=>String(photo.camera_make).toLowerCase().includes(v));if(brand){const response=await fetch('/local-assets/brand_logos/'+brand+'.png');if(!response.ok)throw new Error('Camera logo asset is unavailable.');const logo=await createImageBitmap(await response.blob());try{const l=Math.min(footer*.46,w*.085)/Math.max(logo.width,logo.height),center=w*(signed?.65:.58);ctx.drawImage(logo,center-logo.width*l/2,y+(footer-logo.height*l)/2,logo.width*l,logo.height*l);}finally{logo.close();}}}
    }else if(o.template==='ambient'||signed){block(ctx,left,[pad,y,fullW*.3-pad,footer],u*.023*o.font_size,foreground);block(ctx,right,[fullW*.7,y,fullW*.3-pad,footer],u*.023*o.font_size,foreground,'right');if(signed)await signature(ctx,o.signature,o.signature_style,[fullW*.34,y+footer*.15,fullW*.32,footer*.7],foreground);}
    else block(ctx,[...left,right.filter(Boolean).join('  ·  ')],[pad,y,fullW-pad*2,footer],u*.023*o.font_size,foreground,o.align);
    const type=preview||o.format==='webp'?'image/webp':o.format==='png'?'image/png':'image/jpeg',result=await c.convertToBlob({type,quality:preview?.9:Math.max(.01,Math.min(1,o.quality/100))});if(result.type!==type)throw new Error('This browser cannot encode the selected image format.');return result;
  }finally{image.close();}
}
export async function renderPoster(file:Blob,layout:ArtLayout,originalSize:[number,number],preview=false){
  layout=watercolorLayout(layout);
  if(originalSize.length!==2||originalSize.some(n=>!Number.isInteger(n)||n<1)||originalSize[0]*originalSize[1]>100_000_000)throw new Error('Invalid watercolor source dimensions.');
  const image=await photoBitmap(file);try{const s=Math.min(1,(preview?1000:1536)/Math.max(...originalSize)),w=Math.max(1,Math.round(originalSize[0]*s)),h=Math.max(1,Math.round(originalSize[1]*s)),c=canvas(w,h),ctx=c.getContext('2d')!;
    ctx.fillStyle='#faf7ef';ctx.fillRect(0,0,w,h);if(layout.paper){const pixels=ctx.getImageData(0,0,w,h);let seed=42;for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=((seed/4294967296)-.5)*6*layout.paper;for(let j=0;j<3;j++)pixels.data[i+j]+=noise;}ctx.putImageData(pixels,0,0);}
    const margin=Math.min(w,h)*.05,titleHeight=layout.title?Math.min(w,h)*.047:0,gap=layout.title?Math.min(w,h)*.025:0,fit=Math.min(w*(layout.layout==='airy'?.55:.85)/image.width,(h-margin*2-titleHeight-gap)/image.height),iw=image.width*fit,ih=image.height*fit,top=Math.max(0,(h-ih-titleHeight-gap)/2);ctx.drawImage(image,(w-iw)/2,top,iw,ih);
    if(layout.title)await signature(ctx,layout.title,layout.font,[margin,top+ih+gap,w-margin*2,titleHeight],'#393832');return c.convertToBlob({type:preview?'image/webp':'image/png',quality:.9});
  }finally{image.close();}
}
