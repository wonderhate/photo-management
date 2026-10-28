import {validateTextLayers} from './text-layers.ts';
import type {TextLayer} from './text-layers.ts';
import {assetHash,validateDepthOcclusion} from './vision-assets.ts';
import type {DepthOcclusion} from './vision-assets.ts';
import {validateComposition} from './composition-geometry.ts';
import type {CropRect} from './composition-geometry.ts';
export type GradientStop={offset:number;color:string;opacity:number};
export type OverlayPaint={kind:'solid';color:string;opacity:number}|{kind:'linear';angle:number;stops:GradientStop[]};
export type OverlayLayer={id:string;kind:'overlay';visible:boolean;locked:boolean;opacity:number;edge:'top'|'bottom'|'left'|'right';coverage:number;paint:OverlayPaint};
export type LayerPlacement={scaleX?:number;scaleY?:number;depth?:DepthOcclusion};
export type PositionedText=TextLayer&LayerPlacement;
export type StickerLayer=LayerPlacement&{id:string;kind:'sticker';asset_hash:string;name:string;visible:boolean;locked:boolean;opacity:number;x:number;y:number;rotation:number;width:number;height:number;stroke:{enabled:boolean;color:string;width:number};shadow:TextLayer['shadow'];glow:TextLayer['glow']};
export type Layer=PositionedText|StickerLayer|OverlayLayer;
export type LayerFrame={source_width:number;source_height:number;crop:CropRect;rotation:0|90|180|270;angle:number;flipX:boolean;flipY:boolean};
export type LayerDocument={version:1;layers:Layer[]}|{version:2;frame:LayerFrame;layers:Layer[]};
export function legacyText(layer:PositionedText):TextLayer{const {scaleX:_,scaleY:__,depth:___,...text}=layer;return text;}
export function positionedLayer(layer:Layer):layer is PositionedText|StickerLayer{return layer.kind!=='overlay';}
function fail():never{throw new Error('Invalid layer stack.');}
function object(v:unknown,keys:string[]):asserts v is Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))fail();}
function number(v:unknown,min:number,max:number){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail();}
function color(v:unknown){if(typeof v!=='string'||!/^#[\da-f]{6}$/i.test(v))fail();}
export function validateLayerStack(v:unknown):asserts v is LayerDocument{
  const version=(v as LayerDocument)?.version;object(v,version===2?['version','frame','layers']:['version','layers']);if(![1,2].includes(version)||!Array.isArray(v.layers)||v.layers.length>32)fail();const ids=new Set<string>();
  if(version===2){const f=v.frame;object(f,['source_width','source_height','crop','rotation','angle','flipX','flipY']);if(![0,90,180,270].includes(f.rotation as number)||typeof f.flipX!=='boolean'||typeof f.flipY!=='boolean')fail();validateComposition({source_width:f.source_width,source_height:f.source_height,angle:f.angle} as never,f.crop as CropRect,f.rotation as 0|90|180|270);}
  validateTextLayers({version:1,layers:v.layers.filter(l=>l?.kind==='text').map(l=>version===2?legacyText(l):l)});
  for(const l of v.layers){if(!l||typeof l!=='object'||typeof l.id!=='string'||ids.has(l.id))fail();ids.add(l.id);if(l.kind==='text')continue;
    if(l.kind==='sticker'){
      if(version!==2)fail();const required=['id','kind','asset_hash','name','visible','locked','opacity','x','y','rotation','width','height','stroke','shadow','glow'];object(l,[...required,...['scaleX','scaleY','depth'].filter(k=>k in l)]);
      if(!/^sticker-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(l.id as string)||!assetHash(l.asset_hash)||typeof l.name!=='string'||!l.name.trim()||l.name.length>120||/[\u0000-\u001f\u007f]/.test(l.name)||typeof l.visible!=='boolean'||typeof l.locked!=='boolean')fail();
      number(l.x,-4,5);number(l.y,-4,5);number(l.rotation,-180,180);number(l.width,.01,7680);number(l.height,.01,7680);number(l.opacity,0,1);
      object(l.stroke,['enabled','color','width']);if(typeof l.stroke.enabled!=='boolean')fail();color(l.stroke.color);number(l.stroke.width,0,100);
      object(l.shadow,['enabled','color','opacity','x','y','blur']);if(typeof l.shadow.enabled!=='boolean')fail();color(l.shadow.color);number(l.shadow.opacity,0,1);number(l.shadow.x,-1000,1000);number(l.shadow.y,-1000,1000);number(l.shadow.blur,0,200);
      object(l.glow,['enabled','color','opacity','blur','passes']);if(typeof l.glow.enabled!=='boolean')fail();color(l.glow.color);number(l.glow.opacity,0,1);number(l.glow.blur,0,200);number(l.glow.passes,1,4);if(!Number.isInteger(l.glow.passes))fail();continue;
    }
    object(l,['id','kind','visible','locked','opacity','edge','coverage','paint']);if(l.kind!=='overlay'||!/^overlay-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(l.id as string)||typeof l.visible!=='boolean'||typeof l.locked!=='boolean'||!['top','bottom','left','right'].includes(l.edge as string))fail();number(l.opacity,0,1);number(l.coverage,.01,1);
    const p=l.paint;if((p as OverlayPaint)?.kind==='solid'){object(p,['kind','color','opacity']);color(p.color);number(p.opacity,0,1);}else{object(p,['kind','angle','stops']);if(p.kind!=='linear'||!Array.isArray(p.stops)||p.stops.length<2||p.stops.length>16)fail();number(p.angle,-360,360);let previous=-1;for(const stop of p.stops){object(stop,['offset','color','opacity']);number(stop.offset,0,1);color(stop.color);number(stop.opacity,0,1);if((stop.offset as number)<previous)fail();previous=stop.offset as number;}}
  }
  for(const l of v.layers.filter(l=>l.kind!=='overlay')){for(const k of ['scaleX','scaleY'])if(k in l){if(version!==2)fail();number(l[k],.01,32);}if('depth' in l){if(version!==2)fail();validateDepthOcclusion(l.depth);}}
}
export function newOverlay(id:string):OverlayLayer{return {id,kind:'overlay',visible:true,locked:false,opacity:1,edge:'bottom',coverage:.4,paint:{kind:'linear',angle:90,stops:[{offset:0,color:'#000000',opacity:0},{offset:1,color:'#000000',opacity:.65}]}};}
export function duplicateLayer(doc:LayerDocument,id:string,newId:string):LayerDocument{validateLayerStack(doc);const next=structuredClone(doc),i=next.layers.findIndex(l=>l.id===id);if(i<0)fail();const l=structuredClone(next.layers[i]);l.id=newId;if(l.kind!=='overlay'){l.x=Math.min(5,l.x+.02);l.y=Math.min(5,l.y+.02);}next.layers.splice(i+1,0,l);validateLayerStack(next);return next;}
export function reorderLayers(doc:LayerDocument,ids:readonly string[]):LayerDocument{validateLayerStack(doc);if(ids.length!==doc.layers.length||new Set(ids).size!==ids.length)fail();const map=new Map(doc.layers.map(l=>[l.id,l])),next={...doc,layers:ids.map(id=>{const l=map.get(id);if(!l)fail();return structuredClone(l);})};validateLayerStack(next);return next;}
export function newSticker(id:string,asset:{id:string;name:string;width:number;height:number}):StickerLayer{const scale=480/Math.max(asset.width,asset.height),width=asset.width*scale,height=asset.height*scale;return {id,kind:'sticker',asset_hash:asset.id,name:asset.name,visible:true,locked:false,opacity:1,x:.5,y:.5,rotation:0,width:Math.min(7680,width),height:Math.min(7680,height),stroke:{enabled:false,color:'#ffffff',width:8},shadow:{enabled:false,color:'#000000',opacity:.5,x:0,y:8,blur:16},glow:{enabled:false,color:'#ffd76a',opacity:.8,blur:24,passes:2}};}
export function layerAssetHashes(doc:LayerDocument){return [...new Set(doc.layers.flatMap(l=>[...(l.kind==='sticker'?[l.asset_hash]:[]),...(l.kind!=='overlay'&&l.depth?[l.depth.asset_hash]:[])]))];}
export function overlayRect(layer:OverlayLayer,width:number,height:number){const vertical=layer.edge==='top'||layer.edge==='bottom',w=vertical?width:width*layer.coverage,h=vertical?height*layer.coverage:height;return {x:layer.edge==='right'?width-w:0,y:layer.edge==='bottom'?height-h:0,width:w,height:h};}
