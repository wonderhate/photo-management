export interface ViewSize {width:number;height:number}
export interface ViewPoint {x:number;y:number}
export const ZOOM_MIN=.01,ZOOM_MAX=8;
export function fitScale(image:ViewSize,area:ViewSize){return image.width>0&&image.height>0&&area.width>0&&area.height>0?Math.min(1,area.width/image.width,area.height/image.height):1;}
export function boundedZoom(value:number){return Math.min(ZOOM_MAX,Math.max(ZOOM_MIN,typeof value==='number'&&!Number.isNaN(value)?value:1));}
export function boundedPan(pan:ViewPoint,image:ViewSize,area:ViewSize,scale:number):ViewPoint{
  const x=Math.max(0,(image.width*scale-area.width)/2),y=Math.max(0,(image.height*scale-area.height)/2);
  return {x:x?Math.max(-x,Math.min(x,Number.isFinite(pan.x)?pan.x:0)):0,y:y?Math.max(-y,Math.min(y,Number.isFinite(pan.y)?pan.y:0)):0};
}
export function zoomAt(pan:ViewPoint,oldScale:number,newScale:number,anchor:ViewPoint,image:ViewSize,area:ViewSize){
  const ratio=newScale/oldScale;return boundedPan({x:anchor.x-(anchor.x-pan.x)*ratio,y:anchor.y-(anchor.y-pan.y)*ratio},image,area,newScale);
}
export function zoomStep(scale:number,direction:number){
  const stops=[.01,.05,.1,.125,.25,.5,.75,1,1.5,2,3,4,6,8];
  return direction>0?stops.find(v=>v>scale+.00001)||ZOOM_MAX:[...stops].reverse().find(v=>v<scale-.00001)||ZOOM_MIN;
}
