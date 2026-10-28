import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointer,KeyboardEvent as ReactKeyboard} from 'react';
import {bt} from '../browser/text';
import {cropCenter} from '../core/composition-geometry';
import type {Point} from '../core/composition-geometry';
import {moveSplit,resizeSplit,splitPlan} from '../core/seamless-split';
import type {SplitSpec,SplitCorner} from '../core/seamless-split';

type Props={spec:SplitSpec;image:string;detail:string;ready:boolean;disabled:boolean;gesturing:boolean;cancel:number;onChange:(value:SplitSpec)=>void;onBegin:()=>void;onEnd:(commit:boolean)=>void};
const corners:SplitCorner[]=['nw','ne','se','sw'];
const names:Record<SplitCorner,[string,string]>={nw:['左上','Top left'],ne:['右上','Top right'],se:['右下','Bottom right'],sw:['左下','Bottom left']};
const cornerPoint=(corner:SplitCorner,spec:SplitSpec):Point=>({x:spec.region.x+(corner.includes('w')?0:spec.region.width),y:spec.region.y+(corner.includes('n')?0:spec.region.height)});
export default function SplitCanvas({spec,image,detail,ready,disabled,gesturing,cancel,onChange,onBegin,onEnd}:Props){
  const svg=useRef<SVGSVGElement>(null),mask=useId(),help=useId(),[frame,setFrame]=useState({width:800,height:500});
  const drag=useRef<{id:number;mode:'move'|SplitCorner;point:Point;spec:SplitSpec;target:SVGRectElement|HTMLButtonElement}|null>(null);
  function release(){const active=drag.current;drag.current=null;if(active?.target.hasPointerCapture(active.id))active.target.releasePointerCapture(active.id);}
  useEffect(()=>{release();},[cancel]);
  useEffect(()=>()=>release(),[]);
  useLayoutEffect(()=>{const node=svg.current;if(!node)return;const measure=()=>setFrame({width:node.clientWidth,height:node.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[]);
  const {basis:b,region:r}=spec,viewport={x:-.24*b.width,y:-.24*b.height,width:1.48*b.width,height:1.48*b.height},unit=1/Math.max(.000001,Math.min(frame.width/viewport.width,frame.height/viewport.height)),hit=36*unit,center=cropCenter(r),rectangle={x:r.x*b.width,y:r.y*b.height,width:r.width*b.width,height:r.height*b.height};
  let edges:number[]=[];try{const plan=splitPlan(spec);edges=plan.edges.slice(1,-1).map(x=>x/plan.width);}catch{/* A sub-pixel selection remains adjustable, but cannot be saved. */}
  function point(event:{clientX:number;clientY:number}){const transform=svg.current?.getScreenCTM();if(!transform)return null;const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(transform.inverse());return {x:p.x/b.width,y:p.y/b.height};}
  function down(event:ReactPointer<SVGRectElement|HTMLButtonElement>,mode:'move'|SplitCorner){if(event.button!==0||!ready||disabled||drag.current||gesturing)return;const p=point(event);if(!p)return;event.preventDefault();event.stopPropagation();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,mode,point:p,spec,target:event.currentTarget};onBegin();}
  function move(event:ReactPointer<SVGRectElement|HTMLButtonElement>){const active=drag.current;if(!active||active.id!==event.pointerId)return;const p=point(event);if(!p)return;event.preventDefault();onChange(active.mode==='move'?moveSplit(active.spec,{x:p.x-active.point.x,y:p.y-active.point.y}):resizeSplit(active.spec,active.mode,p));}
  function end(event:ReactPointer<SVGRectElement|HTMLButtonElement>,commit=true){if(drag.current?.id!==event.pointerId)return;release();onEnd(commit);}
  function keyboard(event:ReactKeyboard<SVGRectElement|HTMLButtonElement>,mode:'move'|SplitCorner){
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||!ready||disabled||gesturing)return;
    event.preventDefault();event.stopPropagation();const step=event.shiftKey?10:1,delta={x:(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0)/b.width,y:(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)/b.height};
    if(mode==='move')onChange(moveSplit(spec,delta));else{
      // An arrow moves along one screen axis; project its paired corner axis
      // onto the locked ratio so shrinking is not blocked by the old height.
      const p=cornerPoint(mode,spec),ratio=r.width*b.width/(r.height*b.height),sx=mode.includes('w')?-1:1,sy=mode.includes('n')?-1:1;
      if(delta.x)delta.y=delta.x*sx*sy*b.width/ratio/b.height;else delta.x=delta.y*sy*sx*b.height*ratio/b.width;
      onChange(resizeSplit(spec,mode,{x:p.x+delta.x,y:p.y+delta.y}));
    }
  }
  const events=(mode:'move'|SplitCorner)=>({onPointerDown:(e:ReactPointer<SVGRectElement|HTMLButtonElement>)=>down(e,mode),onPointerMove:move,onPointerUp:(e:ReactPointer<SVGRectElement|HTMLButtonElement>)=>end(e),onPointerCancel:(e:ReactPointer<SVGRectElement|HTMLButtonElement>)=>end(e,false),onLostPointerCapture:(e:ReactPointer<SVGRectElement|HTMLButtonElement>)=>{if(drag.current?.id===e.pointerId){drag.current=null;onEnd(false);}},onKeyDown:(e:ReactKeyboard<SVGRectElement|HTMLButtonElement>)=>keyboard(e,mode)});
  const sharp=!!detail&&!gesturing;
  return <div className={'composition-canvas split-canvas '+(gesturing?'dragging':'')}>
    <svg ref={svg} viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} aria-label={bt('交互分图区域','Interactive split area')} aria-describedby={help}>
      <defs><mask id={mask} {...viewport} maskUnits="userSpaceOnUse"><rect {...viewport} fill="white"/><rect {...rectangle} fill="black"/></mask></defs>
      {image&&<g mask={sharp?`url(#${mask})`:undefined}><image href={image} width={b.width} height={b.height} transform={`rotate(${spec.angle} ${center.x*b.width} ${center.y*b.height})`}/></g>}
      {sharp&&<image href={detail} {...rectangle} preserveAspectRatio="none"/>}
      <rect {...viewport} mask={`url(#${mask})`} className="composition-shade"/>
      <rect {...rectangle} data-split-body role="button" tabIndex={ready&&!disabled?0:-1} aria-label={bt('移动分图框','Move split frame')} className="composition-crop-frame" vectorEffect="non-scaling-stroke" {...events('move')}/>
      <g className="split-dividers" aria-hidden="true">{edges.map((edge,i)=><line key={i} x1={rectangle.x+rectangle.width*edge} x2={rectangle.x+rectangle.width*edge} y1={rectangle.y} y2={rectangle.y+rectangle.height} vectorEffect="non-scaling-stroke"/>)}</g>
      {corners.map(corner=>{const p=cornerPoint(corner,spec);return <foreignObject key={corner} x={p.x*b.width-hit/2} y={p.y*b.height-hit/2} width={hit} height={hit}><button className={'composition-handle handle-'+corner} data-split-handle={corner} aria-label={bt('调整分图框：','Resize split: ')+bt(...names[corner])} disabled={!ready||disabled} {...events(corner)}><span/></button></foreignObject>;})}
    </svg>
    <p className="muted" id={help}>{bt('拖动四角缩放，拖动框内移动。方向键微调，Shift 加速，Esc 取消本次拖动。','Drag corners to resize and the frame to move. Arrow keys adjust; Shift moves faster; Esc cancels a drag.')}</p>
  </div>;
}
