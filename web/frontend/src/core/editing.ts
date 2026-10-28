import {validateLutSelection} from './lut-contract.ts';
import type {LutSelection} from './lut-contract.ts';
import {validateLayerStack} from './layer-stack.ts';
import type {LayerDocument} from './layer-stack.ts';
import {validateTextLayers} from './text-layers.ts';
import type {TextLayerDocument} from './text-layers.ts';
import {compositionBasis,inverseComposition,validateComposition} from './composition-geometry.ts';
import type {Composition,CropRect} from './composition-geometry.ts';
export type Pixels={width:number;height:number;channels:3|4;data:Uint8ClampedArray|Uint8Array|Uint16Array;linear?:boolean};
export type ColorStats={mean:number[];std:number[]};
type EditParameters={exposure:number;contrast:number;highlights:number;shadows:number;temperature:number;tint:number;saturation:number;hue:number;hslSaturation:number;lightness:number;curve:number[];rotation:0|90|180|270;flipX:boolean;flipY:boolean;crop:CropRect;sharpen:number;denoise:number;match:number;preserveLuminance:boolean;reference?:ColorStats};
export type EditRecipeV1=EditParameters&{version:1};
export type EditRecipeV2=EditParameters&{version:2;composition:Composition};
export type EditRecipeV3=EditParameters&{version:3;composition:Composition;text_layers:TextLayerDocument};
export type EditRecipeV4=EditParameters&{version:4;composition:Composition;layer_stack:LayerDocument};
export type EditRecipeV5=EditParameters&{version:5;composition:Composition;layer_stack:LayerDocument;lut?:LutSelection};
export type EditRecipe=EditRecipeV1|EditRecipeV2|EditRecipeV3|EditRecipeV4|EditRecipeV5;
export const neutralRecipe=():EditRecipeV1=>({version:1,exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX:false,flipY:false,crop:{x:0,y:0,width:1,height:1},sharpen:0,denoise:0,match:0,preserveLuminance:true});
export const clamp=(v:number,min=0,max=1)=>Math.min(max,Math.max(min,v));
export function validateRecipe(value:unknown):asserts value is EditRecipe{
  const r=value as EditRecipe;if(!r||![1,2,3,4,5].includes(r.version))throw new Error('Invalid edit recipe.');
  const keys=[...Object.keys(neutralRecipe()),'reference',...(r.version!==1?['composition']:[]),...(r.version===3?['text_layers']:r.version>=4?['layer_stack',...(r.version===5?['lut']:[])]:[])];if(Object.keys(r).some(k=>!keys.includes(k)))throw new Error('Invalid edit recipe.');
  const ranges:Record<string,number[]>={exposure:[-5,5],contrast:[-100,100],highlights:[-100,100],shadows:[-100,100],temperature:[-100,100],tint:[-100,100],saturation:[-100,100],hue:[-180,180],hslSaturation:[-100,100],lightness:[-100,100],sharpen:[0,100],denoise:[0,100],match:[0,100]};
  for(const [k,[a,b]]of Object.entries(ranges)){const v=r[k as keyof EditRecipe];if(typeof v!=='number'||!Number.isFinite(v)||v<a||v>b)throw new Error('Invalid edit recipe.');}
  if(![0,90,180,270].includes(r.rotation)||typeof r.flipX!=='boolean'||typeof r.flipY!=='boolean'||typeof r.preserveLuminance!=='boolean'||!Array.isArray(r.curve)||r.curve.length!==5||r.curve.some(v=>!Number.isFinite(v)||v<0||v>1))throw new Error('Invalid edit recipe.');
  if(r.version===3)validateTextLayers(r.text_layers);if(r.version===4||r.version===5)validateLayerStack(r.layer_stack);if(r.version===5&&r.lut!==undefined)validateLutSelection(r.lut);
  const c=r.crop;if(r.version!==1)validateComposition(r.composition,c,r.rotation);else if(!c||[c.x,c.y,c.width,c.height].some(v=>!Number.isFinite(v))||c.x<0||c.y<0||c.width<=0||c.height<=0||c.x+c.width>1.000001||c.y+c.height>1.000001)throw new Error('Invalid crop.');
  if(r.reference&&(!Array.isArray(r.reference.mean)||!Array.isArray(r.reference.std)||r.reference.mean.length!==3||r.reference.std.length!==3||r.reference.mean.some(v=>!Number.isFinite(v)||Math.abs(v)>200)||r.reference.std.some(v=>!Number.isFinite(v)||v<0||v>200)))throw new Error('Invalid reference colors.');
}
export const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
export const srgb=(v:number)=>v<=.0031308?v*12.92:1.055*Math.max(0,v)**(1/2.4)-.055;
export function lab(r:number,g:number,b:number){r=linear(r);g=linear(g);b=linear(b);const f=(v:number)=>v>.008856?Math.cbrt(v):7.787*v+16/116;const x=f((r*.4124564+g*.3575761+b*.1804375)/.95047),y=f(r*.2126729+g*.7151522+b*.072175),z=f((r*.0193339+g*.119192+b*.9503041)/1.08883);return [116*y-16,500*(x-y),200*(y-z)];}
function fromLab(l:number,a:number,b:number){const y=(l+16)/116,x=a/500+y,z=y-b/200,f=(v:number)=>v**3>.008856?v**3:(v-16/116)/7.787;const X=f(x)*.95047,Y=f(y),Z=f(z)*1.08883;return [srgb(X*3.2404542-Y*1.5371385-Z*.4985314),srgb(-X*.969266+Y*1.8760108+Z*.041556),srgb(X*.0556434-Y*.2040259+Z*1.0572252)];}
export function colorStats(p:Pixels):ColorStats{const mean=[0,0,0],squares=[0,0,0],step=Math.max(1,Math.floor(p.width*p.height/65536)),max=p.data instanceof Uint16Array?65535:255;let n=0;for(let i=0;i<p.width*p.height;i+=step){const at=i*p.channels;if(p.channels===4&&p.data[at+3]===0)continue;const rgb=[0,1,2].map(c=>p.linear?clamp(srgb(p.data[at+c]/max)):p.data[at+c]/max),v=lab(rgb[0],rgb[1],rgb[2]);for(let c=0;c<3;c++){mean[c]+=v[c];squares[c]+=v[c]*v[c];}n++;}return {mean:mean.map(v=>v/(n||1)),std:squares.map((v,i)=>Math.sqrt(Math.max(0,v/(n||1)-(mean[i]/(n||1))**2)))};}
export function dimensions(p:Pixels,r:EditRecipe,edge=0){const swapped=r.rotation===90||r.rotation===270,w=Math.max(1,Math.round((swapped?p.height:p.width)*r.crop.width)),h=Math.max(1,Math.round((swapped?p.width:p.height)*r.crop.height)),s=edge?Math.min(1,edge/Math.max(w,h)):1;return {width:Math.max(1,Math.round(w*s)),height:Math.max(1,Math.round(h*s))};}
export function validateRecipeSource(r:EditRecipe,p:{width:number;height:number}){
  validateRecipe(r);if(r.version!==1&&(p.width!==r.composition.source_width||p.height!==r.composition.source_height))throw new Error('Composition source dimensions changed. Reopen the photo.');
}
function hslAdjust(rgb:number[],r:EditRecipe){const max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;let h=0,l=(max+min)/2,s=d?d/(1-Math.abs(2*l-1)):0;if(d){h=max===rgb[0]?((rgb[1]-rgb[2])/d)%6:max===rgb[1]?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4;h*=60;}h=((h+r.hue)%360+360)%360;s=clamp(s*(1+r.hslSaturation/100));l=clamp(l+r.lightness/100);const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h/60%2-1)),m=l-c/2;return (h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x]).map(v=>v+m);}
export function renderPixels(p:Pixels,r:EditRecipe,edge=0):Pixels{
  validateRecipeSource(r,p);const {width,height}=dimensions(p,r,edge);if(width*height>100_000_000)throw new Error('Image exceeds the 100 megapixel limit.');
  const basis=compositionBasis(p,r.rotation);
  const transform=r.version!==1&&r.composition.angle!==0?inverseComposition(r.crop,basis,r.composition.angle):null;
  const out=new Uint8ClampedArray(width*height*4),max=p.data instanceof Uint16Array?65535:255,exposure=2**r.exposure,sourceStats=r.reference&&r.match?colorStats(p):null;
  const gains=[2**(r.temperature/150),2**(-r.tint/180),2**(-r.temperature/150)];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let u=r.crop.x+(x+.5)/width*r.crop.width,v=r.crop.y+(y+.5)/height*r.crop.height;
    if(transform){const [a,b,c,d,e,f]=transform,oldU=u;u=a*u+c*v+e;v=b*oldU+d*v+f;}
    if(r.flipX)u=1-u;if(r.flipY)v=1-v;
    [u,v]=r.rotation===90?[v,1-u]:r.rotation===180?[1-u,1-v]:r.rotation===270?[1-v,u]:[u,v];
    const sx=clamp(u*p.width-.5,0,p.width-1),sy=clamp(v*p.height-.5,0,p.height-1),x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,p.width-1),y1=Math.min(y0+1,p.height-1),fx=sx-x0,fy=sy-y0;
    const sample=(c:number)=>((p.data[(y0*p.width+x0)*p.channels+c]*(1-fx)+p.data[(y0*p.width+x1)*p.channels+c]*fx)*(1-fy)+(p.data[(y1*p.width+x0)*p.channels+c]*(1-fx)+p.data[(y1*p.width+x1)*p.channels+c]*fx)*fy)/max;
    let rgb=[0,1,2].map(c=>{let value=sample(c);value=(p.linear?value:linear(value))*exposure*gains[c];value=clamp(srgb(value));value=clamp(value+(r.shadows/100)*.35*(1-value)**3+(r.highlights/100)*.35*value**3);value=clamp((value-.5)*(1+r.contrast/100)+.5);const at=Math.min(3,Math.floor(value*4)),f=value*4-at;return r.curve[at]*(1-f)+r.curve[at+1]*f;});
    const l=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;rgb=rgb.map(c=>clamp(l+(c-l)*(1+r.saturation/100)));
    if(r.hue||r.hslSaturation||r.lightness)rgb=hslAdjust(rgb,r);
    if(sourceStats&&r.reference){const a=lab(rgb[0],rgb[1],rgb[2]),t=r.match/100;const mapped=a.map((value,c)=>{if(c===0&&r.preserveLuminance)return value;const ratio=sourceStats.std[c]<.01?1:clamp(r.reference!.std[c]/sourceStats.std[c],0,4);return value*(1-t)+((value-sourceStats.mean[c])*ratio+r.reference!.mean[c])*t;});rgb=fromLab(mapped[0],mapped[1],mapped[2]);}
    const i=(y*width+x)*4;for(let c=0;c<3;c++)out[i+c]=clamp(rgb[c])*255;out[i+3]=p.channels===4?sample(3)*255:255;
  }
  if(r.sharpen||r.denoise){const copy=out.slice();const radius=Math.max(1,Math.round(Math.max(width,height)/2048));for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){let sum=0,n=0;const at=(y*width+x)*4+c,center=copy[at];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const v=copy[(clamp(y+dy*radius,0,height-1)*width+clamp(x+dx*radius,0,width-1))*4+c];if(!r.denoise||Math.abs(v-center)<12+r.denoise*.5){sum+=v;n++;}}const avg=sum/n;out[at]=center+(avg-center)*r.denoise/100+(center-avg)*r.sharpen/50;}}
  return {width,height,channels:4,data:out};
}
export function analyzePixels(p:Pixels){const hist=Array.from({length:4},()=>Array(256).fill(0) as number[]),colors=new Map<number,number>();let low=0,high=0,n=0;const max=p.data instanceof Uint16Array?65535:255;for(let i=0;i<p.data.length;i+=p.channels){if(p.channels===4&&!p.data[i+3])continue;const rgb=[0,1,2].map(c=>Math.round(clamp(p.linear?srgb(p.data[i+c]/max):p.data[i+c]/max)*255));for(let c=0;c<3;c++)hist[c][rgb[c]]++;const l=Math.round(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722);hist[3][l]++;if(Math.min(...rgb)<=1)low++;if(Math.max(...rgb)>=254)high++;const k=(rgb[0]>>5)*64+(rgb[1]>>5)*8+(rgb[2]>>5);colors.set(k,(colors.get(k)||0)+1);n++;}return {histogram:hist,shadows:low/(n||1),highlights:high/(n||1),palette:[...colors].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>[Math.floor(k/64)*32+16,Math.floor(k/8)%8*32+16,k%8*32+16].map(v=>v.toString(16).padStart(2,'0')).join('')).map(c=>'#'+c),sampledPixels:n};}
