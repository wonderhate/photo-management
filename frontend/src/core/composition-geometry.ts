// Coordinates use the source after quarter turns and flips. The free angle
// turns that image about the crop's center; the output rectangle stays upright.
export type CropRect={x:number;y:number;width:number;height:number};
export type Composition={source_width:number;source_height:number;angle:number;aspect?:number};
export type Size={width:number;height:number};
export type Point={x:number;y:number};
export type CompositionView={scale:number;center:Point};
export type CropHandle='n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw';
export const MIN_ANGLE=-45,MAX_ANGLE=45;
const epsilon=1e-6;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function compositionBasis(source:Size,rotation:number):Size{
  return rotation===90||rotation===270?{width:source.height,height:source.width}:source;
}
export function cropCenter(crop:CropRect):Point{return {x:crop.x+crop.width/2,y:crop.y+crop.height/2};}
export function inverseComposition(crop:CropRect,size:Size,angle:number):[number,number,number,number,number,number]{
  const center=cropCenter(crop),r=angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r),a=c,b=-s*size.width/size.height,d=c,e=s*size.height/size.width;
  return [a,b,e,d,center.x*(1-a)-e*center.y,center.y*(1-d)-b*center.x];
}
export function unrotateCropPoint(point:Point,crop:CropRect,size:Size,angle:number):Point{
  if(angle===0)return point;const [a,b,c,d,e,f]=inverseComposition(crop,size,angle);
  return {x:a*point.x+c*point.y+e,y:b*point.x+d*point.y+f};
}
export function cropCorners(crop:CropRect,size:Size,angle:number):Point[]{
  return [[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>unrotateCropPoint({x:crop.x+x*crop.width,y:crop.y+y*crop.height},crop,size,angle));
}
export function validateComposition(value:unknown,crop:CropRect,rotation:number):asserts value is Composition{
  const g=value as Composition;
  if(!g||typeof g!=='object'||Array.isArray(g)||Object.keys(g).some(k=>!['source_width','source_height','angle','aspect'].includes(k))||
    !Number.isSafeInteger(g.source_width)||g.source_width<1||!Number.isSafeInteger(g.source_height)||g.source_height<1||g.source_width*g.source_height>100_000_000||
    !finite(g.angle)||g.angle<MIN_ANGLE||g.angle>MAX_ANGLE||g.aspect!==undefined&&(!finite(g.aspect)||g.aspect<=0||g.aspect>100_000_000)||
    !crop||Object.keys(crop).some(k=>!['x','y','width','height'].includes(k))||![crop.x,crop.y,crop.width,crop.height].every(finite)||crop.width<=0||crop.height<=0)throw new Error('Invalid composition.');
  const size=compositionBasis({width:g.source_width,height:g.source_height},rotation);
  if(cropCorners(crop,size,g.angle).some(p=>!finite(p.x)||!finite(p.y)||p.x < -epsilon||p.x > 1+epsilon||p.y < -epsilon||p.y > 1+epsilon)||
    g.aspect!==undefined&&Math.abs(crop.width*size.width/(crop.height*size.height)/g.aspect-1)>epsilon)throw new Error('Invalid composition.');
}
// Preserve the requested center when resizing/straightening. A rotated crop's
// projected corner extents, rather than its unrotated box, constrain the fit.
export function fitCrop(crop:CropRect,size:Size,angle:number):CropRect{
  const center=cropCenter(crop),cx=clamp(center.x,1e-9,1-1e-9),cy=clamp(center.y,1e-9,1-1e-9),a=Math.abs(angle)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  let w=Math.max(Number.EPSILON,crop.width*size.width),h=Math.max(Number.EPSILON,crop.height*size.height);
  const scale=Math.min(1,2*Math.min(cx,1-cx)*size.width/(c*w+s*h),2*Math.min(cy,1-cy)*size.height/(s*w+c*h));w*=scale;h*=scale;
  return {x:cx-w/size.width/2,y:cy-h/size.height/2,width:w/size.width,height:h/size.height};
}
export function cropForAspect(crop:CropRect,size:Size,angle:number,aspect:number):CropRect{
  const center=cropCenter(crop),a=Math.abs(angle)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),availableW=2*Math.min(center.x,1-center.x)*size.width,availableH=2*Math.min(center.y,1-center.y)*size.height;
  const height=Math.min(availableW/(c*aspect+s),availableH/(s*aspect+c)),width=height*aspect;
  return fitCrop({x:center.x-width/size.width/2,y:center.y-height/size.height/2,width:width/size.width,height:height/size.height},size,angle);
}
export function moveCrop(crop:CropRect,size:Size,angle:number,delta:Point):CropRect{
  const a=Math.abs(angle)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),w=crop.width*size.width,h=crop.height*size.height,ex=(c*w+s*h)/size.width/2,ey=(s*w+c*h)/size.height/2,center=cropCenter(crop);
  const cx=clamp(center.x+delta.x,ex,1-ex),cy=clamp(center.y+delta.y,ey,1-ey);
  return {...crop,x:cx-crop.width/2,y:cy-crop.height/2};
}
export function resizeCrop(crop:CropRect,size:Size,angle:number,handle:CropHandle,point:Point,aspect?:number):CropRect{
  const center=cropCenter(crop);let width=crop.width*size.width,height=crop.height*size.height;
  if(/[ew]/.test(handle))width=Math.max(1,Math.abs(point.x-center.x)*size.width*2);
  if(/[ns]/.test(handle))height=Math.max(1,Math.abs(point.y-center.y)*size.height*2);
  if(aspect){if(handle==='n'||handle==='s')width=height*aspect;else if(handle==='e'||handle==='w')height=width/aspect;else if(width/height>aspect)height=width/aspect;else width=height*aspect;}
  return fitCrop({x:center.x-width/size.width/2,y:center.y-height/size.height/2,width:width/size.width,height:height/size.height},size,angle);
}
export function rotateCrop(crop:CropRect,clockwise=true):CropRect{return clockwise?{x:1-crop.y-crop.height,y:crop.x,width:crop.height,height:crop.width}:{x:crop.y,y:1-crop.x-crop.width,width:crop.height,height:crop.width};}
export function flipCrop(crop:CropRect,axis:'x'|'y'):CropRect{return axis==='x'?{...crop,x:1-crop.x-crop.width}:{...crop,y:1-crop.y-crop.height};}
