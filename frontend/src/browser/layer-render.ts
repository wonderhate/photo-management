import {drawTextLayers} from './text-render';
import type {TextRenderResult} from './text-render';
import {multiplyTextTransforms} from '../core/text-recipe';
import {validateLayerStack,overlayRect,legacyText} from '../core/layer-stack';
import type {LayerDocument} from '../core/layer-stack';
import {positionedTransform,inverseLayerTransform,transformPoint} from '../core/layer-geometry';
import type {layerRenderView} from '../core/layer-geometry';
import {textLayerTransform} from '../core/text-layout';
import {depthVisibility} from '../core/vision-assets';
import {drawSticker} from './sticker-render';
type Context=OffscreenCanvasRenderingContext2D;
const rgba=(color:string,opacity:number)=>`rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},${opacity})`;
// The worker owns this private canvas: no partial result is published on failure.
// Photo adjustments run first. Layer order alone determines overlay/text order.
export async function drawLayerStack(ctx:Context,document:LayerDocument,view:ReturnType<typeof layerRenderView>,assets:ReadonlyMap<string,ImageBitmap>=new Map()):Promise<TextRenderResult>{
  const frozen=structuredClone(document);validateLayerStack(frozen);const layouts:TextRenderResult=[];
  for(const layer of frozen.layers){if(!layer.visible||layer.opacity===0)continue;if(layer.kind!=='overlay'){
      const depth=layer.depth,mask=depth?assets.get(depth.asset_hash):null;
      if(depth&&!mask)throw new Error('Depth asset is missing. Restore it or disable depth.');
      const scratch=depth?new OffscreenCanvas(ctx.canvas.width,ctx.canvas.height):null,out=scratch?scratch.getContext('2d')!:ctx;
      try{
        if(layer.kind==='text'){
          const local=textLayerTransform(legacyText(layer),view.reference.width,view.reference.height),extended=positionedTransform(layer,view.reference.width,view.reference.height);
          layouts.push(...await drawTextLayers(out,{version:1,layers:[legacyText(layer)]},{...view,transform:multiplyTextTransforms(view.transform,multiplyTextTransforms(extended,inverseLayerTransform(local)))}));
        }else{const image=assets.get(layer.asset_hash);if(!image)throw new Error('Sticker asset is missing. Restore a backup.');drawSticker(out,layer,image,view);}
        if(depth&&mask&&scratch){const mc=new OffscreenCanvas(mask.width,mask.height),mx=mc.getContext('2d')!;try{
          mx.drawImage(mask,0,0);const values=mx.getImageData(0,0,mask.width,mask.height).data,w=scratch.width;
          for(let row=0;row<scratch.height;row+=128){const height=Math.min(128,scratch.height-row),pixels=out.getImageData(0,row,w,height);
          for(let y=0;y<height;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(!pixels.data[i+3])continue;const p=transformPoint(view.toSource,x+.5,row+y+.5),sx=Math.max(0,Math.min(mask.width-1,p.x*mask.width-.5)),sy=Math.max(0,Math.min(mask.height-1,p.y*mask.height-.5)),x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(mask.width-1,x0+1),y1=Math.min(mask.height-1,y0+1),fx=sx-x0,fy=sy-y0;
            const v=((values[(y0*mask.width+x0)*4]*(1-fx)+values[(y0*mask.width+x1)*4]*fx)*(1-fy)+(values[(y1*mask.width+x0)*4]*(1-fx)+values[(y1*mask.width+x1)*4]*fx)*fy)/255;pixels.data[i+3]*=depthVisibility(v,depth);}
          out.putImageData(pixels,0,row);}
          ctx.save();ctx.resetTransform();ctx.globalAlpha=1;ctx.drawImage(scratch,0,0);ctx.restore();
        }finally{mc.width=1;}}
      }finally{if(scratch)scratch.width=1;}continue;
    }
    // Unlike positioned text, a wash follows the current photo content rect.
    // A split is one full mother canvas here, never one new gradient per panel.
    const r=overlayRect(layer,ctx.canvas.width,ctx.canvas.height);ctx.save();try{ctx.resetTransform();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=layer.opacity;const p=layer.paint;
      if(p.kind==='solid')ctx.fillStyle=rgba(p.color,p.opacity);else{const a=p.angle*Math.PI/180,dx=Math.cos(a),dy=Math.sin(a),span=Math.abs(dx)*r.width+Math.abs(dy)*r.height,cx=r.x+r.width/2,cy=r.y+r.height/2,g=ctx.createLinearGradient(cx-dx*span/2,cy-dy*span/2,cx+dx*span/2,cy+dy*span/2);for(const stop of p.stops)g.addColorStop(stop.offset,rgba(stop.color,stop.opacity));ctx.fillStyle=g;}
      ctx.fillRect(r.x,r.y,r.width,r.height);
    }finally{ctx.restore();}
  }return layouts;
}
