import {cropCenter,cropCorners,cropForAspect,moveCrop,validateComposition} from './composition-geometry.ts';
import type {CropRect,Point,Size} from './composition-geometry.ts';

export type SplitAspect={width:number;height:number};
export type SplitSpec={version:1;aspect:SplitAspect;count:number|null;region:CropRect;basis:Size;angle:number};
export type SplitCorner='nw'|'ne'|'se'|'sw';
export type PanelRect={x:number;y:number;width:number;height:number};
export type SplitPlan=Size&{count:number;edges:number[];panels:PanelRect[]};
export const SPLIT_PRESETS:ReadonlyArray<SplitAspect>=[{width:1,height:1},{width:3,height:4},{width:2,height:3},{width:9,height:16},{width:4,height:5}];
export const MIN_SPLIT_COUNT=2,MAX_SPLIT_COUNT=10;
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function fail():never{throw new Error('Invalid seamless split.');}
const bounded=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
function size(value:unknown):asserts value is Size{
  if(!object(value)||Object.keys(value).some(k=>!['width','height'].includes(k))||
    !Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||Number(value.width)<1||Number(value.height)<1||Number(value.width)*Number(value.height)>100_000_000)fail();
}
export function validateSplitAspect(value:unknown):asserts value is SplitAspect{
  if(!object(value)||Object.keys(value).some(k=>!['width','height'].includes(k))||
    !finite(value.width)||!finite(value.height)||value.width<1||value.width>100||value.height<1||value.height>100)fail();
}
function requestedCount(value:unknown):asserts value is number|null{
  if(value!==null&&(!Number.isInteger(value)||Number(value)<MIN_SPLIT_COUNT||Number(value)>MAX_SPLIT_COUNT))fail();
}
export function resolveSplitCount(basis:Size,aspect:SplitAspect,count:number|null=null):number{
  size({width:basis.width,height:basis.height});validateSplitAspect(aspect);requestedCount(count);
  return count??bounded(Math.floor(basis.width/(basis.height*(aspect.width/aspect.height))),MIN_SPLIT_COUNT,MAX_SPLIT_COUNT);
}
export function validateSplit(value:unknown):asserts value is SplitSpec{
  if(!object(value)||value.version!==1||Object.keys(value).some(k=>!['version','aspect','count','region','basis','angle'].includes(k)))fail();
  size(value.basis);validateSplitAspect(value.aspect);requestedCount(value.count);
  if(!finite(value.angle)||value.angle < -45||value.angle > 45||!object(value.region))fail();
  const aspect=value.aspect.width/value.aspect.height*resolveSplitCount(value.basis,value.aspect,value.count);
  validateComposition({source_width:value.basis.width,source_height:value.basis.height,angle:value.angle,aspect},value.region as CropRect,0);
}
function maximumRegion(basis:Size,angle:number,aspect:number,center:Point):CropRect{
  const rect=cropForAspect({x:0,y:0,width:1,height:1},basis,angle,aspect);
  return moveCrop(rect,basis,angle,{x:center.x-.5,y:center.y-.5});
}
export function createSplit(basis:Size,angle=0,aspect:SplitAspect={width:3,height:4},count:number|null=null):SplitSpec{
  basis={width:basis.width,height:basis.height};
  const resolved=resolveSplitCount(basis,aspect,count);
  if(!finite(angle)||angle < -45||angle > 45)fail();
  const spec:SplitSpec={version:1,basis:{...basis},aspect:{...aspect},angle,count,region:maximumRegion(basis,angle,aspect.width/aspect.height*resolved,{x:.5,y:.5})};
  validateSplit(spec);return spec;
}
// The ordinary crop and preview zoom have no part in this coordinate frame.
// Ratio/count changes keep the center when possible, then move the largest
// legal rectangle inside the rotated source. Manual counts stay manual.
export function reshapeSplit(spec:SplitSpec,aspect:SplitAspect=spec.aspect,count:number|null=spec.count):SplitSpec{
  validateSplit(spec);const resolved=resolveSplitCount(spec.basis,aspect,count);
  const next:SplitSpec={...spec,aspect:{...aspect},count,region:maximumRegion(spec.basis,spec.angle,aspect.width/aspect.height*resolved,cropCenter(spec.region))};
  validateSplit(next);return next;
}
export function resetSplitRegion(spec:SplitSpec):SplitSpec{
  validateSplit(spec);return createSplit(spec.basis,spec.angle,spec.aspect,spec.count);
}
export function moveSplit(spec:SplitSpec,delta:Point):SplitSpec{
  validateSplit(spec);if(!finite(delta.x)||!finite(delta.y))fail();
  const next={...spec,region:moveCrop(spec.region,spec.basis,spec.angle,delta)};validateSplit(next);return next;
}
export function resizeSplit(spec:SplitSpec,handle:SplitCorner,point:Point):SplitSpec{
  validateSplit(spec);if(!['nw','ne','se','sw'].includes(handle)||!finite(point.x)||!finite(point.y))fail();
  const r=spec.region,b=spec.basis,sx=handle.includes('w')?-1:1,sy=handle.includes('n')?-1:1;
  const anchor={x:r.x+(sx<0?r.width:0),y:r.y+(sy<0?r.height:0)},ratio=spec.aspect.width/spec.aspect.height*resolveSplitCount(b,spec.aspect,spec.count);
  const width=Math.max(1,sx*(point.x-anchor.x)*b.width,sy*(point.y-anchor.y)*b.height*ratio)/b.width,height=width*b.width/(b.height*ratio);
  const target={x:anchor.x+(sx<0?-width:0),y:anchor.y+(sy<0?-height:0),width,height};
  // Inverse-projected corners are affine in the anchored rectangle's size.
  // Move from the known legal start toward the target until the first corner
  // meets the source. This also works when a legal 45-degree frame extends
  // outside the unrotated box; an axis-aligned clamp would move the anchor.
  const start=cropCorners(r,b,spec.angle),end=cropCorners(target,b,spec.angle);let t=1;
  for(let i=0;i<4;i++)for(const axis of ['x','y'] as const){const a=start[i][axis],d=end[i][axis]-a;if(d>0)t=Math.min(t,(1-a)/d);else if(d<0)t=Math.min(t,-a/d);}
  t=bounded(t,0,1);const region={x:r.x+(target.x-r.x)*t,y:r.y+(target.y-r.y)*t,width:r.width+(target.width-r.width)*t,height:r.height+(target.height-r.height)*t};
  const next={...spec,region};validateSplit(next);return next;
}
// Cumulative rounding is the only definition of panel edges. Reusing these
// absolute integer edges for preview labels, encoded pixels and lineage
// avoids both missing columns and repeatedly rounded individual widths.
export function panelBoundaries(width:number,count:number):number[]{
  if(!Number.isSafeInteger(width)||width<1||width>100_000_000||!Number.isInteger(count)||count<MIN_SPLIT_COUNT||count>MAX_SPLIT_COUNT)fail();
  if(width<count)throw new Error('The split region needs at least one pixel per panel.');
  return Array.from({length:count+1},(_,i)=>Math.round(i*width/count));
}
export function splitPlan(spec:SplitSpec):SplitPlan{
  validateSplit(spec);const width=Math.max(1,Math.round(spec.region.width*spec.basis.width)),height=Math.max(1,Math.round(spec.region.height*spec.basis.height));
  if(width*height>100_000_000)fail();
  const count=resolveSplitCount(spec.basis,spec.aspect,spec.count),edges=panelBoundaries(width,count);
  return {width,height,count,edges,panels:edges.slice(0,-1).map((x,i)=>({x,y:0,width:edges[i+1]-x,height}))};
}
