import type {StickerLayer} from '../core/layer-stack';
import type {TextTransform} from '../core/text-layout';
import {transformedTextBounds} from '../core/text-layout';
import {positionedTransform,stickerBounds} from '../core/layer-geometry';
import {multiplyTextTransforms} from '../core/text-recipe';
type Context=OffscreenCanvasRenderingContext2D;
// Effects derive from the PNG alpha silhouette, not its rectangular bounds.
export function drawSticker(ctx:Context,layer:StickerLayer,image:ImageBitmap,view:{reference:{width:number;height:number};transform:TextTransform}){
  const local=stickerBounds(layer),m=multiplyTextTransforms(view.transform,positionedTransform(layer,view.reference.width,view.reference.height)),s=Math.max(Math.hypot(m[0],m[1]),Math.hypot(m[2],m[3])),bounds=transformedTextBounds(local,m);
  const halo=Math.ceil((Math.max(layer.stroke.enabled?layer.stroke.width:0,layer.shadow.enabled?3*layer.shadow.blur+Math.abs(layer.shadow.x)+Math.abs(layer.shadow.y):0,layer.glow.enabled?3*layer.glow.blur:0))*s)+3;
  const left=Math.max(-halo,Math.floor(bounds.x)-halo),top=Math.max(-halo,Math.floor(bounds.y)-halo),right=Math.min(ctx.canvas.width+halo,Math.ceil(bounds.x+bounds.width)+halo),bottom=Math.min(ctx.canvas.height+halo,Math.ceil(bounds.y+bounds.height)+halo);
  if(right<=left||bottom<=top)return;
  const w=right-left,h=bottom-top;if(w*h>100_000_000)throw new Error('Layer effects exceed the canvas limit.');
  const mask=new OffscreenCanvas(w,h),mc=mask.getContext('2d')!,effect=new OffscreenCanvas(w,h),ec=effect.getContext('2d')!,group=new OffscreenCanvas(w,h),gc=group.getContext('2d')!;
  try{
    mc.setTransform(m[0],m[1],m[2],m[3],m[4]-left,m[5]-top);mc.drawImage(image,local.x,local.y,local.width,local.height);
    const tint=(color:string)=>{ec.resetTransform();ec.clearRect(0,0,w,h);ec.globalCompositeOperation='source-over';ec.drawImage(mask,0,0);ec.globalCompositeOperation='source-in';ec.fillStyle=color;ec.fillRect(0,0,w,h);ec.globalCompositeOperation='source-over';};
    if(layer.glow.enabled){tint(layer.glow.color);gc.save();gc.globalAlpha=layer.glow.opacity;gc.filter=`blur(${layer.glow.blur*s}px)`;for(let n=0;n<layer.glow.passes;n++)gc.drawImage(effect,0,0);gc.restore();}
    if(layer.shadow.enabled){tint(layer.shadow.color);gc.save();gc.globalAlpha=layer.shadow.opacity;gc.filter=`blur(${layer.shadow.blur*s}px)`;gc.drawImage(effect,layer.shadow.x*s,layer.shadow.y*s);gc.restore();}
    if(layer.stroke.enabled&&layer.stroke.width>0){tint(layer.stroke.color);const r=layer.stroke.width*s,steps=Math.min(192,Math.max(32,Math.ceil(2*Math.PI*r)));for(let i=0;i<steps;i++){const a=i*Math.PI*2/steps;gc.drawImage(effect,Math.cos(a)*r,Math.sin(a)*r);}}
    gc.drawImage(mask,0,0);ctx.save();ctx.resetTransform();ctx.globalAlpha=layer.opacity;ctx.drawImage(group,left,top);ctx.restore();
  }finally{mask.width=1;effect.width=1;group.width=1;}
}
