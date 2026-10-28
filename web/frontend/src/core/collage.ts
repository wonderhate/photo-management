// Layout coordinates adapted from AfterFrame (MIT), commit
// 26e19935469e696133088b798f23b5b3654d910f, collageTemplates.js.
// License: public/licenses/AfterFrame-MIT.txt. Rendering/state are local.
import layouts from './collage-templates.json' with {type:'json'};
import {sourceDecodeProfile} from './source-decode-profile.ts';
import type {SourceDecodeProfile} from './source-decode-profile.ts';
export type CollageTemplate={id:string;name:string;cells:{x:number;y:number;w:number;h:number}[]};
export const COLLAGE_TEMPLATES:CollageTemplate[]=layouts;
export type CollageSource={id:string;name:string;sha256:string;width:number;height:number;bits:8|16;profile:SourceDecodeProfile;photo_id?:string};
export type CollageCell={source_id:string;pan:{x:number;y:number};zoom:number};
export type CollageScene={version:1|2;edge_blend?:number;template:string;width:number;height:number;gap:number;padding:number;radius:number;background:string;sources:CollageSource[];cells:CollageCell[]};
export type CollageRect={x:number;y:number;width:number;height:number};
export function sameCollageSource(a:CollageSource|undefined,b:CollageSource){return !!a&&a.id===b.id&&a.name===b.name&&a.sha256===b.sha256&&a.width===b.width&&a.height===b.height&&a.bits===b.bits&&a.photo_id===b.photo_id&&a.profile.version===b.profile.version&&a.profile.extra_orientation===b.profile.extra_orientation;}
const finite=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const exact=(o:unknown,keys:string[])=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
export function collageTemplate(id:string){const template=COLLAGE_TEMPLATES.find(t=>t.id===id);if(!template)throw new Error('Unknown collage layout.');return template;}
export function validateCollage(value:unknown):asserts value is CollageScene{
 const v=value as CollageScene;
 if(!exact(v,['version','template','width','height','gap','padding','radius','background','sources','cells',...(v?.version===2?['edge_blend']:[])])||![1,2].includes(v.version)||v.version===2&&!finite(v.edge_blend,0,10000))throw new Error('Unsupported collage document.');
 if(!Number.isInteger(v.width)||!Number.isInteger(v.height)||!finite(v.width,100,12000)||!finite(v.height,100,12000)||v.width*v.height>100_000_000||!finite(v.gap,0,.08)||!finite(v.padding,0,.2)||!finite(v.radius,0,.2)||!/^#[0-9a-f]{6}$/i.test(v.background))throw new Error('Invalid collage dimensions or style.');
 const template=collageTemplate(v.template);
 if(!Array.isArray(v.sources)||v.sources.length<1||v.sources.length>12||!Array.isArray(v.cells)||v.cells.length!==template.cells.length)throw new Error('A collage needs 1–12 photos and a matching layout.');
 const ids=new Set<string>();
 for(const source of v.sources){
  if(!exact(source,['id','name','sha256','width','height','bits','profile','photo_id'])||typeof source.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(source.id)||ids.has(source.id)||typeof source.name!=='string'||!source.name||source.name.length>255||/[\\/\x00-\x1f]/.test(source.name)||!(/^[a-f0-9]{64}$/.test(source.sha256))||!Number.isInteger(source.width)||!Number.isInteger(source.height)||!finite(source.width,1,100000)||!finite(source.height,1,100000)||source.width*source.height>100_000_000||![8,16].includes(source.bits)||source.photo_id!==undefined&&(typeof source.photo_id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(source.photo_id)))throw new Error('Invalid collage source.');
  if(!source.profile)throw new Error('Invalid collage source.');sourceDecodeProfile(source.profile);ids.add(source.id);
 }
 const used=new Set<string>();
 for(const cell of v.cells){if(!exact(cell,['source_id','pan','zoom'])||!ids.has(cell.source_id)||used.has(cell.source_id)||!exact(cell.pan,['x','y'])||!finite(cell.pan.x,-2,2)||!finite(cell.pan.y,-2,2)||!finite(cell.zoom,.25,5))throw new Error('Invalid collage placement.');used.add(cell.source_id);}
 if(used.size!==ids.size)throw new Error('Every collage source must have a cell.');
 collageRects(v);
}
export function createCollage(sources:CollageSource[]):CollageScene{
 const template=COLLAGE_TEMPLATES.find(t=>t.cells.length===sources.length);if(!template)throw new Error('A collage needs 1–12 photos and a matching layout.');
 const scene:CollageScene={version:2,edge_blend:0,template:template.id,width:2400,height:2400,gap:.008,padding:.02,radius:0,background:'#f7f3eb',sources:structuredClone(sources),cells:sources.map(s=>({source_id:s.id,pan:{x:0,y:0},zoom:1}))};validateCollage(scene);return scene;
}
export function collageRects(scene:CollageScene):CollageRect[]{
 const base=Math.min(scene.width,scene.height),padding=scene.padding*base,gap=scene.gap*base,w=scene.width-2*padding,h=scene.height-2*padding;
 return collageTemplate(scene.template).cells.map(c=>{
  const left=Math.round(padding+c.x*w+(c.x>1e-8?gap/2:0)),top=Math.round(padding+c.y*h+(c.y>1e-8?gap/2:0));
  const right=Math.round(padding+(c.x+c.w)*w-(c.x+c.w<1-1e-8?gap/2:0)),bottom=Math.round(padding+(c.y+c.h)*h-(c.y+c.h<1-1e-8?gap/2:0));
  if(right<=left||bottom<=top)throw new Error('Spacing leaves no room for a collage cell. Reduce the gap or padding.');
  return {x:left,y:top,width:right-left,height:bottom-top};
 });
}
export function collageImageRect(source:Pick<CollageSource,'width'|'height'>,rect:CollageRect,cell:CollageCell):CollageRect{
 const scale=Math.max(rect.width/source.width,rect.height/source.height)*cell.zoom,width=source.width*scale,height=source.height*scale;
 return {x:rect.x+(rect.width-width)/2+cell.pan.x*rect.width,y:rect.y+(rect.height-height)/2+cell.pan.y*rect.height,width,height};
}
export function collageHasGap(source:CollageSource,rect:CollageRect,cell:CollageCell){const image=collageImageRect(source,rect,cell);return image.x>rect.x+.5||image.y>rect.y+.5||image.x+image.width<rect.x+rect.width-.5||image.y+image.height<rect.y+rect.height-.5;}
export function swapCollage(scene:CollageScene,a:number,b:number){const next=structuredClone(scene);if(!next.cells[a]||!next.cells[b])return next;[next.cells[a],next.cells[b]]=[next.cells[b],next.cells[a]];return next;}

/** Upgrade by copying; v1 remains renderable without changing any old pixels. */
export function upgradeCollage(value:unknown):CollageScene{validateCollage(value);return {...structuredClone(value),version:2,edge_blend:value.version===1?0:value.edge_blend!};}
export function collageBlend(scene:CollageScene){return scene.version===2?scene.edge_blend!:0;}
export function collageCanvasStyle(scene:CollageScene){return {version:2 as const,edge_blend:collageBlend(scene),width:scene.width,height:scene.height,gap:scene.gap,padding:scene.padding,radius:scene.radius,background:scene.background};}
export function resetCollageCanvas(scene:CollageScene){return {...scene,...collageCanvasStyle(createCollage(scene.sources))};}
