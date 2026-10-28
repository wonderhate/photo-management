import {useEffect,useRef,useState} from 'react';
import type {PointerEvent} from 'react';
import {bt} from '../browser/text';
import type {TextLayer,TextLayerDocument} from '../core/text-layers';
import {textLayerTransform} from '../core/text-layout';
import type {TextRenderResult} from '../browser/text-render';
type Props={preview:string;name:string;width:number;height:number;document:TextLayerDocument;layouts:TextRenderResult;selected:string;ready:boolean;onSelect:(id:string)=>void;onChange:(doc:TextLayerDocument)=>void;onBegin:()=>void;onEnd:(commit:boolean)=>void;onDone:()=>void};
type Drag={pointer:number;layer:TextLayer;start:{x:number;y:number};document:TextLayerDocument;mode:'move'|'size'|'rotate'};
export default function TextCanvas({preview,name,width,height,document,layouts,selected,ready,onSelect,onChange,onBegin,onEnd,onDone}:Props){
  const svg=useRef<SVGSVGElement>(null),drag=useRef<Drag|null>(null),finish=useRef(onEnd);finish.current=onEnd;const [guides,setGuides]=useState({x:false,y:false}),[scale,setScale]=useState(1);
  useEffect(()=>{const node=svg.current;if(!node)return;const resize=new ResizeObserver(()=>{const box=node.getBoundingClientRect();setScale(Math.max(.001,Math.min(box.width/width,box.height/height)));});resize.observe(node);return()=>resize.disconnect();},[width,height]);
  useEffect(()=>()=>{if(drag.current){drag.current=null;finish.current(false);}},[]);
  function point(event:PointerEvent){const matrix=svg.current?.getScreenCTM();if(!matrix)return null;const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return {x:p.x/width,y:p.y/height};}
  function end(commit:boolean){if(!drag.current)return;drag.current=null;setGuides({x:false,y:false});onEnd(commit);}
  function start(event:PointerEvent,layer:TextLayer,mode:Drag['mode']){
    if(event.button!==0||drag.current)return;event.preventDefault();event.stopPropagation();onSelect(layer.id);if(layer.locked||!ready)return;const p=point(event);if(!p)return;
    svg.current?.focus({preventScroll:true});onBegin();drag.current={pointer:event.pointerId,layer:structuredClone(layer),start:p,document:structuredClone(document),mode};svg.current?.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent){const d=drag.current;if(!d||d.pointer!==event.pointerId)return;const p=point(event);if(!p)return;event.preventDefault();let patch:Partial<TextLayer>={};
    if(d.mode==='move'){
      let x=d.layer.x+p.x-d.start.x,y=d.layer.y+p.y-d.start.y;const box=svg.current!.getBoundingClientRect(),thresholdX=6/Math.max(1,box.width),thresholdY=6/Math.max(1,box.height);
      if(!event.altKey){for(const candidate of [.5,...document.layers.filter(l=>l.id!==d.layer.id&&l.visible).map(l=>l.x)])if(Math.abs(x-candidate)<thresholdX){x=candidate;break;}for(const candidate of [.5,...document.layers.filter(l=>l.id!==d.layer.id&&l.visible).map(l=>l.y)])if(Math.abs(y-candidate)<thresholdY){y=candidate;break;}}
      patch={x:Math.max(-4,Math.min(5,x)),y:Math.max(-4,Math.min(5,y))};setGuides({x:x===.5,y:y===.5});
    }else if(d.mode==='size'){
      const old=Math.hypot((d.start.x-d.layer.x)*width,(d.start.y-d.layer.y)*height),next=Math.hypot((p.x-d.layer.x)*width,(p.y-d.layer.y)*height);patch={size:Math.max(1,Math.min(1000,d.layer.size*next/Math.max(1,old)))};
    }else{const a=Math.atan2((d.start.y-d.layer.y)*height,(d.start.x-d.layer.x)*width),b=Math.atan2((p.y-d.layer.y)*height,(p.x-d.layer.x)*width);let rotation=((d.layer.rotation+(b-a)*180/Math.PI+540)%360)-180;if(event.shiftKey)rotation=Math.round(rotation/15)*15;patch={rotation};}
    onChange({...d.document,layers:d.document.layers.map(l=>l.id===d.layer.id?{...l,...patch}:l)});
  }
  return <div className="text-canvas"><img src={preview} alt={name}/><svg ref={svg} tabIndex={0} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label={bt('文字交互画布','Interactive text canvas')} onPointerMove={move} onPointerUp={()=>end(true)} onPointerCancel={()=>end(false)} onLostPointerCapture={()=>end(true)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(drag.current)end(false);else onDone();}}}>
    {document.layers.filter(l=>l.visible).map(layer=>{const found=layouts.find(row=>row.id===layer.id),box=found?.layout.background??{x:-60,y:-50,width:120,height:100},transform=textLayerTransform(layer,width,height),active=layer.id===selected;
      // Controls stay finger-sized and reachable when long text extends beyond
      // the photograph. Their coordinates are in the image, not font units.
      const control=(x:number,y:number)=>({x:Math.max(12/scale,Math.min(width-12/scale,transform[0]*x+transform[2]*y+transform[4])),y:Math.max(12/scale,Math.min(height-12/scale,transform[1]*x+transform[3]*y+transform[5]))}),size=control(box.x+box.width,box.y+box.height),rotate=control(box.x+box.width/2,box.y-30);
      return <g key={layer.id}><g transform={`matrix(${transform.join(' ')})`} className={active?'text-selected':''}>
        <rect data-text-layer={layer.id} tabIndex={0} role="button" aria-label={bt('移动文字：','Move text: ')+layer.text} aria-disabled={layer.locked||!ready} x={box.x} y={box.y} width={box.width} height={box.height} className="text-hit" vectorEffect="non-scaling-stroke" onFocus={()=>onSelect(layer.id)} onPointerDown={e=>start(e,layer,'move')} onKeyDown={e=>{if(layer.locked||!ready||drag.current)return;const step=(e.shiftKey?10:1);if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;onChange({...document,layers:document.layers.map(l=>l.id===layer.id?{...l,x:Math.max(-4,Math.min(5,l.x+dx/width)),y:Math.max(-4,Math.min(5,l.y+dy/height))}:l)});}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();onChange({...document,layers:document.layers.filter(l=>l.id!==layer.id)});}}}/>
        </g>{active&&!layer.locked&&<><rect data-text-handle="size" x={size.x-10/scale} y={size.y-10/scale} width={20/scale} height={20/scale} className="text-handle" vectorEffect="non-scaling-stroke" onPointerDown={e=>start(e,layer,'size')}/><circle data-text-handle="rotate" cx={rotate.x} cy={rotate.y} r={10/scale} className="text-handle" vectorEffect="non-scaling-stroke" onPointerDown={e=>start(e,layer,'rotate')}/></>}
      </g>;})}
    {guides.x&&<line x1={width/2} x2={width/2} y1={0} y2={height} className="text-guide" vectorEffect="non-scaling-stroke"/>}{guides.y&&<line x1={0} x2={width} y1={height/2} y2={height/2} className="text-guide" vectorEffect="non-scaling-stroke"/>}
  </svg><button className="text-canvas-done" onClick={onDone}>{bt('完成文字编辑','Done editing text')}</button><span className="text-canvas-help">{bt('拖动移动 · 方块缩放 · 圆点旋转 · Alt 暂停吸附 · Esc 取消','Drag to move · Square to resize · Circle to rotate · Alt disables snapping · Esc cancels')}</span></div>;
}
