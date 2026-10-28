import {collageBlend,collageRects,collageTemplate,collageImageRect} from './collage.ts';
import type {CollageScene,CollageRect} from './collage.ts';
export type CollageReach=CollageRect&{ramps:{left:number;right:number;top:number;bottom:number}};
/** Shared band centres use unrounded template edges, preventing odd-pixel seam bias. */
export function collageFrameRect(scene:CollageScene,index:number):CollageReach{
 const blend=collageBlend(scene);if(!blend)return {...collageRects(scene)[index],ramps:{left:0,right:0,top:0,bottom:0}};
 const c=collageTemplate(scene.template).cells[index],pad=Math.min(scene.width,scene.height)*scene.padding,w=scene.width-pad*2,h=scene.height-pad*2;
 const left=c.x>1e-8,right=c.x+c.w<1-1e-8,top=c.y>1e-8,bottom=c.y+c.h<1-1e-8;
 const x=pad+c.x*w-(left?blend/2:0),y=pad+c.y*h-(top?blend/2:0);
 return {x,y,width:c.w*w+(left?blend/2:0)+(right?blend/2:0),height:c.h*h+(top?blend/2:0)+(bottom?blend/2:0),ramps:{left:left?blend:0,right:right?blend:0,top:top?blend:0,bottom:bottom?blend:0}};
}
export function collageUncovered(rect:CollageRect,draw:CollageRect):CollageRect[]{
 const clamp=(n:number,max:number)=>n>.5?Math.min(n,max):0,top=clamp(draw.y-rect.y,rect.height),bottom=clamp(rect.y+rect.height-draw.y-draw.height,rect.height-top),height=rect.height-top-bottom,parts:CollageRect[]=[];
 if(top)parts.push({...rect,height:top});if(bottom)parts.push({...rect,y:rect.y+rect.height-bottom,height:bottom});
 if(height>0){const left=clamp(draw.x-rect.x,rect.width),right=clamp(rect.x+rect.width-draw.x-draw.width,rect.width-left);if(left)parts.push({x:rect.x,y:rect.y+top,width:left,height});if(right)parts.push({x:rect.x+rect.width-right,y:rect.y+top,width:right,height});}return parts;
}
export function collageSceneHasGap(scene:CollageScene,index:number){const cell=scene.cells[index],source=scene.sources.find(s=>s.id===cell.source_id)!;return collageUncovered(collageRects(scene)[index],collageImageRect(source,collageFrameRect(scene,index),cell)).length>0;}
export function collageRampStops(start:number,end:number,length:number):[number,number][]{
 if(start+end>length){const k=length/(start+end);start*=k;end*=k;}
 const stops:[number,number][]=[[0,start?0:1]];if(start)stops.push([start/length,1]);if(end)stops.push([1-end/length,1]);stops.push([1,end?0:1]);return stops;
}
