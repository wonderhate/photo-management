import {collageRects} from './collage.ts';
import type {CollageScene,CollageCell,CollageRect} from './collage.ts';
export function collageHit(scene:CollageScene,x:number,y:number){return collageRects(scene).findIndex(r=>x>=r.x&&y>=r.y&&x<r.x+r.width&&y<r.y+r.height);}
export function collagePan(cell:CollageCell,rect:CollageRect,dx:number,dy:number,scale:number,bypass=false){
 const clamp=(n:number)=>Math.max(-2,Math.min(2,n)),pan={x:clamp(cell.pan.x+dx/(rect.width*scale)),y:clamp(cell.pan.y+dy/(rect.height*scale))};
 const guides={x:!bypass&&Math.abs(pan.x*rect.width*scale)<8,y:!bypass&&Math.abs(pan.y*rect.height*scale)<8};
 if(guides.x)pan.x=0;if(guides.y)pan.y=0;return {pan,guides};
}
export function collageZoom(zoom:number,factor:number){return Math.max(.25,Math.min(5,zoom*factor));}
export function collageWheelFactor(delta:number,pinch=false,fine=false){return delta===0?1:pinch?Math.exp(Math.max(-2,Math.min(2,-delta*.01))):delta>0?(fine?.985:.94):(fine?1.015:1.06);}
export function collageRatioSize(edge:number,width:number,height:number){const ratio=width/height;return ratio>=1?{width:Math.round(edge),height:Math.round(edge/ratio)}:{width:Math.round(edge*ratio),height:Math.round(edge)};}
