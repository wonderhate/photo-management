import {boundedPan,fitScale,zoomAt} from './viewer-geometry.ts';
import type {ViewPoint,ViewSize} from './viewer-geometry.ts';

// Zoom is relative to each image's fit size; focus is a normalized image point.
export type ComparisonPose={zoom:number;focus:ViewPoint};
export const comparisonDefault=():ComparisonPose=>({zoom:1,focus:{x:.5,y:.5}});
export function comparisonZoom(value:number){return Math.max(.5,Math.min(8,Number.isNaN(value)?1:value));}
export function comparisonFrame(pose:ComparisonPose,image:ViewSize,area:ViewSize){
  const scale=fitScale(image,area)*pose.zoom;
  return {scale,pan:boundedPan({x:(.5-pose.focus.x)*image.width*scale,y:(.5-pose.focus.y)*image.height*scale},image,area,scale)};
}
function focused(zoom:number,pan:ViewPoint,image:ViewSize,scale:number):ComparisonPose{
  return {zoom,focus:{x:image.width>0&&scale>0 ? .5-pan.x/(image.width*scale) : .5,y:image.height>0&&scale>0 ? .5-pan.y/(image.height*scale) : .5}};
}
export function moveComparison(pose:ComparisonPose,delta:ViewPoint,image:ViewSize,area:ViewSize){
  const {scale,pan}=comparisonFrame(pose,image,area);
  return focused(pose.zoom,boundedPan({x:pan.x+delta.x,y:pan.y+delta.y},image,area,scale),image,scale);
}
export function zoomComparison(pose:ComparisonPose,value:number,image:ViewSize,area:ViewSize,anchor:ViewPoint={x:0,y:0}){
  const zoom=comparisonZoom(value),before=comparisonFrame(pose,image,area),scale=fitScale(image,area)*zoom;
  return focused(zoom,zoomAt(before.pan,before.scale,scale,anchor,image,area),image,scale);
}
