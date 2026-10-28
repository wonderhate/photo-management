import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointer,KeyboardEvent as ReactKeyboard} from 'react';
import type {EditRecipe} from '../browser/editing';
import type {EditSession} from '../browser/edit-session';
import {bt,browserError} from '../browser/text';
import {compositionBase} from '../core/composition-recipe';
import {compositionBasis,cropCenter,moveCrop,resizeCrop} from '../core/composition-geometry';
import type {CropHandle,Point,Size,CompositionView} from '../core/composition-geometry';

type Props={recipe:EditRecipe;source:Size;session:EditSession;onChange:(patch:Partial<EditRecipe>)=>void;onBegin:()=>void;onEnd:(commit:boolean)=>void;onDone:()=>void;gesturing:boolean;view:CompositionView;preview:string;previewMatches:boolean};
const handles:CropHandle[]=['nw','n','ne','e','se','s','sw','w'];
const names:Record<CropHandle,[string,string]>={nw:['左上','Top left'],n:['上边','Top'],ne:['右上','Top right'],e:['右边','Right'],se:['右下','Bottom right'],s:['下边','Bottom'],sw:['左下','Bottom left'],w:['左边','Left']};
const handlePoint=(handle:CropHandle,r:EditRecipe['crop']):Point=>({x:r.x+r.width*(handle.includes('w')?0:handle.includes('e')?1:.5),y:r.y+r.height*(handle.includes('n')?0:handle.includes('s')?1:.5)});

export default function CompositionCanvas({recipe,source,session,onChange,onBegin,onEnd,onDone,gesturing,view,preview,previewMatches}:Props){
  const svg=useRef<SVGSVGElement>(null),root=useRef<HTMLDivElement>(null),body=useRef<SVGRectElement>(null),mask=useId(),help=useId();
  const [frame,setFrame]=useState({width:800,height:500}),[image,setImage]=useState(''),[loadedKey,setLoadedKey]=useState(''),[error,setError]=useState('');
  const work=useRef<{serial:number;pending:{recipe:EditRecipe;serial:number;key:string}|null;running:boolean;alive:boolean;url:string}>({serial:0,pending:null,running:false,alive:true,url:''});
  const finish=useRef(onEnd);finish.current=onEnd;
  const drag=useRef<{id:number;mode:'move'|CropHandle;point:Point;recipe:EditRecipe}|null>(null);
  const size=compositionBasis(source,recipe.rotation),angle=recipe.version!==1?recipe.composition.angle:0,aspect=recipe.version!==1?recipe.composition.aspect:undefined;
  const base=compositionBase(recipe),key=JSON.stringify(base),valid=recipe.version===1||recipe.composition.source_width===source.width&&recipe.composition.source_height===source.height;
  const ready=!!image&&loadedKey===key&&valid;
  const detail=ready&&!gesturing&&previewMatches&&!!preview;
  useEffect(()=>{const state=work.current;state.alive=true;root.current?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});return()=>{state.alive=false;state.serial++;state.pending=null;if(state.url)URL.revokeObjectURL(state.url);if(drag.current){drag.current=null;finish.current(false);}};},[]);
  useLayoutEffect(()=>{const node=svg.current;if(!node)return;const measure=()=>setFrame({width:node.clientWidth,height:node.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    const state=work.current,serial=++state.serial;if(!valid){setError(browserError(new Error('Composition source dimensions changed. Reopen the photo.')));return;}
    const timer=setTimeout(()=>{
      state.pending={recipe:base,serial,key};if(state.running)return;state.running=true;
      void(async()=>{try{while(state.pending&&state.alive){const request=state.pending;state.pending=null;try{const result=await session.render(request.recipe);if(state.alive&&request.serial===state.serial){if(state.url)URL.revokeObjectURL(state.url);state.url=URL.createObjectURL(result.blob);setImage(state.url);setLoadedKey(request.key);setError('');}}catch(e){if(state.alive&&request.serial===state.serial)setError(browserError(e));}}}finally{state.running=false;}})();
    },140);return()=>clearTimeout(timer);
  },[session,key,valid]);
  const viewport={x:view.center.x*size.width-size.width*.74/view.scale,y:view.center.y*size.height-size.height*.74/view.scale,width:size.width*1.48/view.scale,height:size.height*1.48/view.scale},unit=1/Math.max(.000001,Math.min(frame.width/viewport.width,frame.height/viewport.height)),hit=36*unit,center=cropCenter(recipe.crop);
  function point(event:{clientX:number;clientY:number}):Point|null{const transform=svg.current?.getScreenCTM();if(!transform)return null;const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(transform.inverse());return {x:p.x/size.width,y:p.y/size.height};}
  function down(event:ReactPointer<SVGRectElement|HTMLButtonElement>,mode:'move'|CropHandle){
    if(event.button!==0||!ready||drag.current||gesturing)return;const p=point(event);if(!p)return;event.preventDefault();event.stopPropagation();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,mode,point:p,recipe};onBegin();
  }
  function move(event:ReactPointer<SVGRectElement|HTMLButtonElement>){
    const active=drag.current;if(!active||active.id!==event.pointerId)return;const p=point(event);if(!p)return;event.preventDefault();const r=active.recipe,theta=r.version!==1?r.composition.angle:0,ratio=r.version!==1?r.composition.aspect:undefined;
    const crop=active.mode==='move'?moveCrop(r.crop,size,theta,{x:p.x-active.point.x,y:p.y-active.point.y}):resizeCrop(r.crop,size,theta,active.mode,p,ratio);onChange({crop});
  }
  function end(event:ReactPointer<SVGRectElement|HTMLButtonElement>,commit=true){if(drag.current?.id!==event.pointerId)return;drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);onEnd(commit);}
  function keyboard(event:ReactKeyboard<SVGRectElement|HTMLButtonElement>,mode:'move'|CropHandle){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(drag.current){drag.current=null;onEnd(false);}else onDone();return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||!ready||gesturing)return;
    event.preventDefault();event.stopPropagation();const step=event.shiftKey?10:1,delta={x:(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0)/size.width,y:(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)/size.height};
    if(mode==='move')onChange({crop:moveCrop(recipe.crop,size,angle,delta)});else{const p=handlePoint(mode,recipe.crop);onChange({crop:resizeCrop(recipe.crop,size,angle,mode,{x:p.x+delta.x,y:p.y+delta.y},aspect)});}
  }
  const rectangle={x:recipe.crop.x*size.width,y:recipe.crop.y*size.height,width:recipe.crop.width*size.width,height:recipe.crop.height*size.height};
  return <div ref={root} className={'composition-canvas '+(gesturing?'dragging':'')} aria-label={bt('交互裁剪区域','Interactive crop area')}>
    <div className="composition-canvas-toolbar"><span>{bt('拖动边角调整，拖动框内移动','Drag a handle to resize; drag inside to move')}</span><button disabled={gesturing} onClick={onDone}>{bt('完成裁剪','Done cropping')}</button></div>
    <svg ref={svg} viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} aria-describedby={help}>
      <defs><mask id={mask} {...viewport} maskUnits="userSpaceOnUse"><rect {...viewport} fill="white"/><rect {...rectangle} fill="black"/></mask></defs>
      {image&&valid&&<g mask={detail?`url(#${mask})`:undefined}><image href={image} width={size.width} height={size.height} transform={`rotate(${angle} ${center.x*size.width} ${center.y*size.height})`}/></g>}
      {detail&&<image href={preview} {...rectangle} preserveAspectRatio="none" data-crop-detail/>}
      <rect {...viewport} mask={`url(#${mask})`} className="composition-shade"/>
      <rect ref={body} {...rectangle} data-crop-body role="button" aria-label={bt('移动裁剪框','Move crop frame')} tabIndex={ready?0:-1} className="composition-crop-frame" vectorEffect="non-scaling-stroke" onPointerDown={e=>down(e,'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={e=>end(e,false)} onLostPointerCapture={e=>{if(drag.current?.id===e.pointerId){drag.current=null;onEnd(false);}}} onKeyDown={e=>keyboard(e,'move')}/>
      <g className="composition-thirds" aria-hidden="true">{[1/3,2/3].map(k=><g key={k}><line x1={rectangle.x+rectangle.width*k} y1={rectangle.y} x2={rectangle.x+rectangle.width*k} y2={rectangle.y+rectangle.height} vectorEffect="non-scaling-stroke"/><line x1={rectangle.x} y1={rectangle.y+rectangle.height*k} x2={rectangle.x+rectangle.width} y2={rectangle.y+rectangle.height*k} vectorEffect="non-scaling-stroke"/></g>)}</g>
      {handles.map(handle=>{const p=handlePoint(handle,recipe.crop);return <foreignObject key={handle} x={p.x*size.width-hit/2} y={p.y*size.height-hit/2} width={hit} height={hit}><button className={'composition-handle handle-'+handle} data-crop-handle={handle} aria-label={bt('调整裁框：','Resize crop: ')+bt(...names[handle])} disabled={!ready} onPointerDown={e=>down(e,handle)} onPointerMove={move} onPointerUp={end} onPointerCancel={e=>end(e,false)} onLostPointerCapture={e=>{if(drag.current?.id===e.pointerId){drag.current=null;onEnd(false);}}} onKeyDown={e=>keyboard(e,handle)}><span/></button></foreignObject>;})}
    </svg>
    {(!ready||error)&&<p className="composition-preview-status" role={error?'alert':'status'}>{error||bt(image?'更新构图预览…':'正在准备构图预览…',image?'Updating composition preview…':'Preparing composition preview…')}</p>}
    <p id={help} className="sr-only">{bt('方向键微调，Shift 加速，Esc 退出或取消当前拖动。','Use arrow keys to adjust, Shift to move faster, and Escape to exit or cancel the current drag.')}</p>
  </div>;
}
