import {displayText,TEXT_LIMITS,TEXT_REFERENCE_EDGE,validateTextLayer} from './text-layers.ts';
import type {TextLayer} from './text-layers.ts';

export type TextMetricsValue={width:number;left:number;right:number;ascent:number;descent:number};
export type TextRect={x:number;y:number;width:number;height:number};
export type TextLine={text:string;x:number;baseline:number;width:number};
export type TextLayout={lines:TextLine[];box:TextRect;ink:TextRect;background:TextRect;effects:TextRect};
export type TextMeasure=(text:string,layer:TextLayer)=>TextMetricsValue;
const bounded=(n:number)=>Number.isFinite(n)&&Math.abs(n)<=TEXT_LIMITS.logicalExtent;
function rectangle(x:number,y:number,right:number,bottom:number):TextRect{
  const result={x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)};
  if(!Object.values(result).every(bounded))throw new Error('Text layout exceeds the supported size.');return result;
}
function union(a:TextRect,b:TextRect){return rectangle(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x+a.width,b.x+b.width),Math.max(a.y+a.height,b.y+b.height));}
function outset(a:TextRect,n:number){return rectangle(a.x-n,a.y-n,a.x+a.width+n,a.y+a.height+n);}
// The caller supplies metrics from the SAME loaded font and Canvas context used
// for drawing. No DOM measurement, fallback before font load, or per-codepoint
// drawing: complete runs preserve ligatures, bidi, combining marks and emoji.
export function layoutTextLayer(layer:TextLayer,measure:TextMeasure):TextLayout{
  validateTextLayer(layer);const text=displayText(layer),lines=text.split('\n');
  if(text.length>TEXT_LIMITS.charactersPerLayer*3)throw new Error('Text layout exceeds the supported size.');
  const metrics=lines.map(line=>measure(line,layer)),probe=measure('Mg国',layer);
  for(const metric of [...metrics,probe])if(!Object.values(metric).every(bounded)||metric.width<0)throw new Error('Invalid text font metrics.');
  const width=Math.max(0,...metrics.map(m=>m.width)),step=layer.size*layer.lineHeight;
  // A line box always exists, including blank/trailing lines. Visible ink may
  // extend outside that box (italic swashes, accents, descenders, short leading).
  const ascent=Math.max(layer.size*.8,probe.ascent),descent=Math.max(layer.size*.2,probe.descent),first=-(lines.length-1)*step/2+(ascent-descent)/2;
  const box=rectangle(-width/2,-lines.length*step/2,width/2,lines.length*step/2);
  let ink:TextRect|null=null;
  const runs=lines.map((text,i)=>{const m=metrics[i],x=layer.align==='left'?-width/2:layer.align==='right'?width/2-m.width:-m.width/2,baseline=first+i*step;
    if(text){let current=rectangle(x-m.left,baseline-m.ascent,x+m.right,baseline+m.descent);
      for(const offset of [layer.underline?layer.size*.12:null,layer.strikethrough?-layer.size*.3:null])if(offset!==null)current=union(current,rectangle(x,baseline+offset,x+m.width,baseline+offset+Math.max(1,layer.size/16)));
      ink=ink?union(ink,current):current;}
    return {text,x,baseline,width:m.width};});
  const visible=ink??rectangle(0,0,0,0),content=union(box,visible),[top,right,bottom,left]=layer.background.padding;
  const background=rectangle(content.x-left,content.y-top,content.x+content.width+right,content.y+content.height+bottom);
  let effects=layer.stroke.enabled?outset(visible,layer.stroke.width/2):visible;
  if(layer.shadow.enabled){const shadow=outset(effects,layer.shadow.blur*3);effects=union(effects,{...shadow,x:shadow.x+layer.shadow.x,y:shadow.y+layer.shadow.y});}
  if(layer.glow.enabled)effects=union(effects,outset(visible,layer.glow.blur*3+(layer.stroke.enabled?layer.stroke.width/2:0)));
  if(layer.background.enabled)effects=union(effects,background);
  return {lines:runs,box,ink:visible,background,effects};
}
export type TextTransform=readonly [number,number,number,number,number,number];
export function textLayerTransform(layer:TextLayer,width:number,height:number):TextTransform{
  validateTextLayer(layer);if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>100_000_000)throw new Error('Invalid text canvas.');
  const scale=Math.max(width,height)/TEXT_REFERENCE_EDGE,angle=layer.rotation*Math.PI/180,c=Math.cos(angle)*scale,s=Math.sin(angle)*scale;return [c,s,-s,c,layer.x*width,layer.y*height];
}
export function transformedTextBounds(rect:TextRect,m:TextTransform):TextRect{
  if(!Object.values(rect).every(bounded)||rect.width<0||rect.height<0||m.length!==6||!m.every(Number.isFinite))throw new Error('Invalid text transform.');
  const points=[[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x+rect.width,rect.y+rect.height],[rect.x,rect.y+rect.height]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);
  return rectangle(Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1])));
}
export function hitTextLayer(point:{x:number;y:number},bounds:TextRect,m:TextTransform){
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||!m.every(Number.isFinite))return false;
  const det=m[0]*m[3]-m[1]*m[2];if(!Number.isFinite(det)||Math.abs(det)<1e-12)return false;
  const x=point.x-m[4],y=point.y-m[5],u=(m[3]*x-m[2]*y)/det,v=(-m[1]*x+m[0]*y)/det;
  return u>=bounds.x&&u<=bounds.x+bounds.width&&v>=bounds.y&&v<=bounds.y+bounds.height;
}
