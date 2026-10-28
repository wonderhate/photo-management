import {frameLayers,validateFrame,validateLogo} from '../core/frame-v2';
import type {FrameDocument,LogoAsset} from '../core/frame-v2';
import {photoBitmap} from './raw-decode';

let handFont:Promise<string>|undefined;
async function family(style:string){
  if(style==='serif')return '"Microsoft YaHei", Georgia, serif';
  if(style==='mono')return 'Consolas, monospace';
  if(style!=='hand')return '"Microsoft YaHei", "Segoe UI", sans-serif';
  return handFont??=(async()=>{const response=await fetch('/local-assets/signatures/Sacramento-Regular.ttf');if(!response.ok)throw new Error('Signature asset is unavailable.');const font=new FontFace('pc-frame-hand',await response.arrayBuffer());await font.load();(self as unknown as {fonts:FontFaceSet}).fonts.add(font);return 'pc-frame-hand, "Microsoft YaHei", sans-serif';})();
}
async function logoBitmap(asset:LogoAsset){
  validateLogo(asset);const bytes=Uint8Array.from(atob(asset.data_url.split(',')[1]),c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:'image/png'});
  if(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')!==asset.sha256)throw new Error('Invalid logo asset.');
  const bitmap=await createImageBitmap(blob);if(bitmap.width!==asset.width||bitmap.height!==asset.height){bitmap.close();throw new Error('Invalid logo asset.');}return bitmap;
}
export async function renderFrameV2(file:Blob,doc:FrameDocument,profile:unknown,edge:number,format:'jpg'|'png'|'webp',quality:number){
  validateFrame(doc);const image=await photoBitmap(file,profile);let logo:ImageBitmap|undefined;
  try{
    const plan=frameLayers(image.width,image.height,doc,edge),canvas=new OffscreenCanvas(plan.width,plan.height),ctx=canvas.getContext('2d')!;ctx.scale(plan.scale,plan.scale);
    ctx.fillStyle=doc.template.canvas.bg.color;ctx.fillRect(0,0,plan.fullWidth,plan.fullHeight);ctx.drawImage(image,plan.pad.left,plan.pad.top,image.width,image.height);
    const scrim=doc.template.canvas.scrim;
    if(scrim){const h=plan.fullHeight*scrim.height,top=scrim.edge==='top',y=top?0:plan.fullHeight-h,gradient=ctx.createLinearGradient(0,top?h:y,0,top?0:plan.fullHeight);gradient.addColorStop(0,scrim.from);gradient.addColorStop(1,scrim.to);ctx.fillStyle=gradient;ctx.fillRect(0,y,plan.fullWidth,h);}
    if(doc.logo)logo=await logoBitmap(doc.logo);
    for(const layer of plan.layers){
      const e=layer.element,s=e.style,rotation=s.rotation||0;ctx.save();ctx.translate(layer.x,layer.y);ctx.globalAlpha=(s.opacity??100)/100;
      if(e.type==='logo'){
        if(logo){let h=layer.size,w=h*logo.width/logo.height;if(w>plan.fullWidth*.8){h*=plan.fullWidth*.8/w;w=plan.fullWidth*.8;}
          const tone=doc.logo_tone,ink=tone==='auto'?e.color:({black:'#000000',white:'#ffffff',gold:'#b08d4c'} as Record<string,string>)[tone];
          const c=new OffscreenCanvas(Math.max(1,Math.round(w*plan.scale)),Math.max(1,Math.round(h*plan.scale))),l=c.getContext('2d')!;l.drawImage(logo,0,0,c.width,c.height);
          if(ink){l.globalCompositeOperation='source-in';l.fillStyle=ink;l.fillRect(0,0,c.width,c.height);}
          ctx.rotate(rotation*Math.PI/180);ctx.drawImage(c,layer.align==='left'?0:layer.align==='right'?-w:-w/2,-h/2,w,h);
        }
      }else{
        const font=await family(s.font||'grotesk'),tracking=(s.tracking||0)*layer.size;
        ctx.font=`${s.weight||400} ${layer.size}px ${font}`;
        if(tracking&& !('letterSpacing' in ctx))throw new Error('Text spacing is not supported in this browser.');
        if('letterSpacing' in ctx)ctx.letterSpacing=tracking+'px';
        const available=Math.abs(rotation)%180===90?plan.fullHeight*.8:layer.align==='left'?plan.fullWidth-layer.x-plan.unit*.03:layer.align==='right'?layer.x-plan.unit*.03:2*Math.min(layer.x,plan.fullWidth-layer.x)-plan.unit*.06;
        const fit=Math.min(1,Math.max(1,available)/Math.max(1,ctx.measureText(layer.text).width));ctx.font=`${s.weight||400} ${layer.size*fit}px ${font}`;
        if('letterSpacing' in ctx)ctx.letterSpacing=tracking*fit+'px';ctx.rotate(rotation*Math.PI/180);ctx.textAlign=layer.align;ctx.textBaseline='middle';ctx.fillStyle=s.color||'#1a1a1a';ctx.fillText(layer.text,0,0);
      }
      ctx.restore();
    }
    const type=format==='jpg'?'image/jpeg':format==='png'?'image/png':'image/webp',blob=await canvas.convertToBlob({type,quality:quality/100});if(blob.type!==type)throw new Error('This browser cannot encode the selected frame format.');return blob;
  }finally{image.close();logo?.close();}
}
