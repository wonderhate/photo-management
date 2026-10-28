// Complementary alpha/additive composition adapted from AfterFrame collageRender.js
// (26e19935469e696133088b798f23b5b3654d910f, MIT; public/licenses/AfterFrame-MIT.txt).
// This implementation uses a single transparent output and bounded scratch strips.
import {collageFrameRect,collageRampStops,collageUncovered} from '../core/collage-blend';
import {collageImageRect,collageRects} from '../core/collage';
import type {CollageScene,CollageSource} from '../core/collage';
export const COLLAGE_BLEND_SCRATCH_PIXELS=4_000_000;
export async function drawBlendedCollage(canvas:OffscreenCanvas,scene:CollageScene,image:(source:CollageSource)=>Promise<{image:ImageBitmap;release:()=>void}>,guides:boolean){
 const ctx=canvas.getContext('2d')!,sx=canvas.width/scene.width,sy=canvas.height/scene.height,pad=Math.min(scene.width,scene.height)*scene.padding;
 const scratch=new OffscreenCanvas(1,1),g=scratch.getContext('2d')!;ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='lighter';
 ctx.beginPath();ctx.rect(pad*sx,pad*sy,(scene.width-2*pad)*sx,(scene.height-2*pad)*sy);ctx.clip();
 try{for(let i=0;i<scene.cells.length;i++){
  const cell=scene.cells[i],source=scene.sources.find(s=>s.id===cell.source_id)!,reach=collageFrameRect(scene,i),draw=collageImageRect(source,reach,cell);
  const x=Math.max(0,Math.floor(reach.x*sx)),y=Math.max(0,Math.floor(reach.y*sy)),right=Math.min(canvas.width,Math.ceil((reach.x+reach.width)*sx)),bottom=Math.min(canvas.height,Math.ceil((reach.y+reach.height)*sy)),width=right-x;
  if(width<=0||bottom<=y)continue;const loaded=await image(source);
  try{for(let top=y;top<bottom;){
   const height=Math.min(bottom-top,Math.max(1,Math.floor(COLLAGE_BLEND_SCRATCH_PIXELS/width)));scratch.width=width;scratch.height=height;
   g.setTransform(sx,0,0,sy,-x,-top);g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(loaded.image,draw.x,draw.y,draw.width,draw.height);g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='destination-in';
   for(const axis of ['x','y']){const horizontal=axis==='x',a=horizontal?reach.ramps.left:reach.ramps.top,b=horizontal?reach.ramps.right:reach.ramps.bottom;if(!a&&!b)continue;
    const length=horizontal?reach.width:reach.height,from=horizontal?reach.x*sx-x:reach.y*sy-top,to=from+length*(horizontal?sx:sy),gradient=horizontal?g.createLinearGradient(from,0,to,0):g.createLinearGradient(0,from,0,to);
    for(const [position,alpha] of collageRampStops(a,b,length))gradient.addColorStop(position,`rgba(0,0,0,${alpha})`);g.fillStyle=gradient;g.fillRect(0,0,width,height);
   }
   ctx.drawImage(scratch,x,top);top+=height;
  }}finally{loaded.release();}
 }}finally{ctx.restore();scratch.width=1;scratch.height=1;}
 ctx.save();ctx.setTransform(sx,0,0,sy,0,0);ctx.globalCompositeOperation='destination-over';
 try{
  if(guides){const rects=collageRects(scene);for(let i=0;i<scene.cells.length;i++){const cell=scene.cells[i],source=scene.sources.find(s=>s.id===cell.source_id)!,draw=collageImageRect(source,collageFrameRect(scene,i),cell);for(const rect of collageUncovered(rects[i],draw)){
   ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();ctx.strokeStyle='#9a783b';ctx.lineWidth=1/sx;ctx.beginPath();for(let x=rect.x-rect.height;x<rect.x+rect.width;x+=12/sx){ctx.moveTo(x,rect.y);ctx.lineTo(x+rect.height,rect.y+rect.height);}ctx.stroke();ctx.restore();
  }}}
  ctx.fillStyle=scene.background;ctx.fillRect(0,0,scene.width,scene.height);
 }finally{ctx.restore();}
}
