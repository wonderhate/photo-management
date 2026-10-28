import {useEffect,useRef,useState} from 'react';
import type {PointerEvent} from 'react';
import {bt} from '../browser/text';
import type {EditRecipe} from '../core/editing';
import type {Size} from '../core/composition-geometry';
import type {LayerDocument,PositionedText,StickerLayer} from '../core/layer-stack';
import {positionedLayer} from '../core/layer-stack';
import {handlePoint,LAYER_HANDLES,layerRenderView,positionedTransform,stickerBounds,inverseLayerTransform,transformPoint} from '../core/layer-geometry';
import type {LayerHandle} from '../core/layer-geometry';
import type {TextRenderResult} from '../browser/text-render';
import type {TextRect} from '../core/text-layout';
import {multiplyTextTransforms} from '../core/text-recipe';
type Positioned=PositionedText|StickerLayer;
type Props={snap:boolean;preview:string;name:string;width:number;height:number;source:Size;recipe:EditRecipe;document:LayerDocument;layouts:TextRenderResult;selected:string;ready:boolean;onSelect:(id:string)=>void;onChange:(doc:LayerDocument)=>void;onBegin:()=>void;onEnd:(commit:boolean)=>void;onDone:()=>void};
type Drag={pointer:number;layer:Positioned;document:LayerDocument;start:{x:number;y:number};mode:'move'|'rotate'|LayerHandle;box:TextRect};
export default function LayerCanvas({snap,preview,name,width,height,source,recipe,document,layouts,selected,ready,onSelect,onChange,onBegin,onEnd,onDone}:Props){
  const svg=useRef<SVGSVGElement>(null),drag=useRef<Drag|null>(null),finish=useRef(onEnd);finish.current=onEnd;const [scale,setScale]=useState(1),[guides,setGuides]=useState({x:false,y:false});
  const view=layerRenderView(document,recipe,recipe,source,{width,height}),reference=view.reference;
  useEffect(()=>{const node=svg.current;if(!node)return;const resize=new ResizeObserver(()=>{const box=node.getBoundingClientRect();setScale(Math.max(.001,Math.min(box.width/width,box.height/height)));});resize.observe(node);return()=>resize.disconnect();},[width,height]);
  useEffect(()=>()=>{if(drag.current){drag.current=null;finish.current(false);}},[]);
  function point(event:PointerEvent){const matrix=svg.current?.getScreenCTM();if(!matrix)return null;const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return transformPoint(inverseLayerTransform(view.transform),p.x,p.y);}
  function end(commit:boolean){if(!drag.current)return;drag.current=null;setGuides({x:false,y:false});onEnd(commit);}
  function start(event:PointerEvent,layer:Positioned,mode:Drag['mode'],box:TextRect){if(event.button!==0||drag.current)return;event.preventDefault();event.stopPropagation();onSelect(layer.id);if(layer.locked||!ready)return;const p=point(event);if(!p)return;svg.current?.focus({preventScroll:true});onBegin();drag.current={pointer:event.pointerId,layer:structuredClone(layer),document:structuredClone(document),start:p,mode,box};svg.current?.setPointerCapture(event.pointerId);}
  function move(event:PointerEvent){const d=drag.current;if(!d||d.pointer!==event.pointerId)return;const p=point(event);if(!p)return;event.preventDefault();let patch:Partial<Positioned>={};
    if(d.mode==='move'){
      let x=d.layer.x+(p.x-d.start.x)/reference.width,y=d.layer.y+(p.y-d.start.y)/reference.height;
      if(snap&&!event.altKey){const threshold=6/scale,tx=threshold/Math.max(1,Math.hypot(view.transform[0],view.transform[1])*reference.width),ty=threshold/Math.max(1,Math.hypot(view.transform[2],view.transform[3])*reference.height);for(const c of [.5,...document.layers.filter(positionedLayer).filter(l=>l.id!==d.layer.id&&l.visible).map(l=>l.x)])if(Math.abs(x-c)<tx){x=c;break;}for(const c of [.5,...document.layers.filter(positionedLayer).filter(l=>l.id!==d.layer.id&&l.visible).map(l=>l.y)])if(Math.abs(y-c)<ty){y=c;break;}}
      patch={x:Math.max(-4,Math.min(5,x)),y:Math.max(-4,Math.min(5,y))};setGuides({x:x===.5,y:y===.5});
    }else if(d.mode==='rotate'){
      const x=d.layer.x*reference.width,y=d.layer.y*reference.height,a=Math.atan2(d.start.y-y,d.start.x-x),b=Math.atan2(p.y-y,p.x-x);let rotation=((d.layer.rotation+(b-a)*180/Math.PI+540)%360)-180;const angleSnap=Math.round(rotation/15)*15;if(event.shiftKey||snap&&!event.altKey&&Math.abs(angleSnap-rotation)<3)rotation=angleSnap;patch={rotation};
    }else{
      const original=positionedTransform(d.layer,reference.width,reference.height),inverse=inverseLayerTransform(original),start=transformPoint(inverse,d.start.x,d.start.y),next=transformPoint(inverse,p.x,p.y),handle=handlePoint(d.box,d.mode),anchor=handlePoint(d.box,({nw:'se',n:'s',ne:'sw',e:'w',se:'nw',s:'n',sw:'ne',w:'e'} as const)[d.mode]);
      let sx=d.mode==='n'||d.mode==='s'?1:(handle.x-anchor.x+next.x-start.x)/(handle.x-anchor.x),sy=d.mode==='e'||d.mode==='w'?1:(handle.y-anchor.y+next.y-start.y)/(handle.y-anchor.y);
      if(event.shiftKey&&d.mode.length===2)sx=sy=Math.max(sx,sy);
      const scaleX=Math.max(.01,Math.min(32,(d.layer.scaleX??1)*sx)),scaleY=Math.max(.01,Math.min(32,(d.layer.scaleY??1)*sy));
      const before=transformPoint(original,anchor.x,anchor.y),after=transformPoint(positionedTransform({...d.layer,scaleX,scaleY},reference.width,reference.height),anchor.x,anchor.y);
      patch={scaleX,scaleY,x:Math.max(-4,Math.min(5,d.layer.x+(before.x-after.x)/reference.width)),y:Math.max(-4,Math.min(5,d.layer.y+(before.y-after.y)/reference.height))};
    }
    onChange({...d.document,layers:d.document.layers.map(l=>l.id===d.layer.id?{...l,...patch} as Positioned:l)});
  }
  const edge=(p:{x:number;y:number})=>({x:Math.max(12/scale,Math.min(width-12/scale,p.x)),y:Math.max(12/scale,Math.min(height-12/scale,p.y))});
  return <div className="text-canvas"><img src={preview} alt={name}/><svg ref={svg} tabIndex={0} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label={bt('图层交互画布','Interactive layer canvas')} onPointerMove={move} onPointerUp={()=>end(true)} onPointerCancel={()=>end(false)} onLostPointerCapture={()=>end(true)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(drag.current)end(false);else onDone();}}}>
    {document.layers.filter(positionedLayer).filter(l=>l.visible).map(layer=>{
      const box=layer.kind==='sticker'?stickerBounds(layer):layouts.find(l=>l.id===layer.id)?.layout.background??{x:-60,y:-50,width:120,height:100},m=multiplyTextTransforms(view.transform,positionedTransform(layer,reference.width,reference.height)),active=layer.id===selected,top=transformPoint(m,box.x+box.width/2,box.y),normal=Math.max(.0001,Math.hypot(m[2],m[3])),rotate=edge({x:top.x-m[2]/normal*34/scale,y:top.y-m[3]/normal*34/scale});
      return <g key={layer.id}><g transform={`matrix(${m.join(' ')})`} className={active?'text-selected':''}><rect data-layer={layer.id} data-text-layer={layer.kind==='text'?layer.id:undefined} tabIndex={0} role="button" aria-label={bt('移动图层：','Move layer: ')+(layer.kind==='text'?layer.text:layer.name)} aria-disabled={layer.locked||!ready} {...box} className="text-hit" vectorEffect="non-scaling-stroke" onFocus={()=>onSelect(layer.id)} onPointerDown={e=>start(e,layer,'move',box)} onKeyDown={e=>{if(layer.locked||!ready||drag.current)return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const step=e.shiftKey?10:1,dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0,inverse=inverseLayerTransform(view.transform);onChange({...document,layers:document.layers.map(l=>l.id===layer.id&&positionedLayer(l)?{...l,x:Math.max(-4,Math.min(5,l.x+(inverse[0]*dx+inverse[2]*dy)/reference.width)),y:Math.max(-4,Math.min(5,l.y+(inverse[1]*dx+inverse[3]*dy)/reference.height))}:l)});}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();onChange({...document,layers:document.layers.filter(l=>l.id!==layer.id)});}}}/></g>
      {active&&!layer.locked&&<>{LAYER_HANDLES.map(h=>{const p=handlePoint(box,h),at=edge(transformPoint(m,p.x,p.y));return <rect key={h} data-layer-handle={h} data-text-handle={h==='se'?'size':undefined} aria-label={bt('缩放图层 ','Resize layer ')+h} x={at.x-8/scale} y={at.y-8/scale} width={16/scale} height={16/scale} className="text-handle" vectorEffect="non-scaling-stroke" onPointerDown={e=>start(e,layer,h,box)}/>;})}<circle data-text-handle="rotate" cx={rotate.x} cy={rotate.y} r={10/scale} className="text-handle" vectorEffect="non-scaling-stroke" onPointerDown={e=>start(e,layer,'rotate',box)}/></>}
      </g>;
    })}
    {guides.x&&(()=>{const a=transformPoint(view.transform,reference.width/2,0),b=transformPoint(view.transform,reference.width/2,reference.height);return <line x1={a.x} x2={b.x} y1={a.y} y2={b.y} className="text-guide"/>;})()}{guides.y&&(()=>{const a=transformPoint(view.transform,0,reference.height/2),b=transformPoint(view.transform,reference.width,reference.height/2);return <line x1={a.x} x2={b.x} y1={a.y} y2={b.y} className="text-guide"/>;})()}
  </svg><button className="text-canvas-done" onClick={onDone}>{bt('完成图层编辑','Done editing layers')}</button><span className="text-canvas-help">{bt('八向缩放 · 圆点旋转 · Shift 锁定比例 · Alt 暂停吸附 · Esc 取消','Eight resize handles · Circle rotates · Shift keeps ratio · Alt disables snapping · Esc cancels')}</span></div>;
}
