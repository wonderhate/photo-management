import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {CSSProperties,RefObject} from 'react';
import {boundedPan,boundedZoom,fitScale,zoomAt,zoomStep} from '../core/viewer-geometry';
import type {ViewPoint,ViewSize} from '../core/viewer-geometry';

type State={image:ViewSize;area:ViewSize;mode:'fit'|number;pan:ViewPoint};
const empty=():State=>({image:{width:0,height:0},area:{width:0,height:0},mode:'fit',pan:{x:0,y:0}});
const scaleOf=(state:State)=>state.mode==='fit'?fitScale(state.image,state.area):state.mode;
export default function useViewerZoom(stage:RefObject<HTMLDivElement|null>,id:string,enabled:boolean,onInteract:()=>void){
  const [state,setState]=useState<State>(empty),[proof,setProof]=useState(false),[dragging,setDragging]=useState(false);
  const current=useRef(state);current.current=state;const interact=useRef(onInteract);interact.current=onInteract;
  const drag=useRef<{id:number;start:ViewPoint;pan:ViewPoint;capture:Element}|null>(null);
  useLayoutEffect(()=>{setState(empty());drag.current=null;setDragging(false);if(!id)setProof(false);},[id,enabled]);
  useEffect(()=>{
    const node=stage.current;if(!node||!enabled)return;
    const measure=()=>{const style=getComputedStyle(node),area={width:Math.max(0,node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)),height:Math.max(0,node.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom))};
      setState(previous=>previous.area.width===area.width&&previous.area.height===area.height?previous:{...previous,area,pan:previous.mode==='fit'?{x:0,y:0}:boundedPan(previous.pan,previous.image,area,scaleOf(previous))});};
    measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();
  },[id,enabled,stage]);
  const fit=useCallback(()=>{interact.current();setState(previous=>({...previous,mode:'fit',pan:{x:0,y:0}}));},[]);
  const zoom=useCallback((value:number,anchor:ViewPoint={x:0,y:0})=>{
    interact.current();setState(previous=>{if(!previous.image.width)return previous;const scale=boundedZoom(value);return {...previous,mode:scale,pan:zoomAt(previous.pan,scaleOf(previous),scale,anchor,previous.image,previous.area)};});
  },[]);
  const step=useCallback((direction:number)=>{interact.current();setState(previous=>{if(!previous.image.width)return previous;const scale=zoomStep(scaleOf(previous),direction);return {...previous,mode:scale,pan:zoomAt(previous.pan,scaleOf(previous),scale,{x:0,y:0},previous.image,previous.area)};});},[]);
  const toggleProof=useCallback(()=>{interact.current();setProof(value=>!value);},[]);
  useEffect(()=>{
    const node=stage.current;if(!node||!enabled)return;
    const wheel=(event:WheelEvent)=>{
      if((event.target as Element).closest('button,input,select,a')||!current.current.image.width)return;
      event.preventDefault();const rect=node.getBoundingClientRect(),delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?rect.height:1);
      const anchor={x:event.clientX-rect.left-rect.width/2,y:event.clientY-rect.top-rect.height/2};interact.current();
      setState(previous=>{if(!previous.image.width)return previous;const scale=boundedZoom(scaleOf(previous)*Math.exp(-delta*.0015));return {...previous,mode:scale,pan:zoomAt(previous.pan,scaleOf(previous),scale,anchor,previous.image,previous.area)};});
    };
    node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
  },[id,enabled,stage]);
  const loaded=useCallback((image:HTMLImageElement)=>{
    if(!image.naturalWidth||!image.naturalHeight)return;
    const size={width:image.naturalWidth,height:image.naturalHeight};
    setState(previous=>{const pan=previous.mode==='fit'?{x:0,y:0}:{x:previous.pan.x*size.width/(previous.image.width||size.width),y:previous.pan.y*size.height/(previous.image.height||size.height)};return {...previous,image:size,pan:boundedPan(pan,size,previous.area,previous.mode==='fit'?fitScale(size,previous.area):previous.mode)};});
  },[]);
  const scale=scaleOf(state),ready=enabled&&state.image.width>0&&state.area.width>0&&state.area.height>0,canPan=ready&&(state.image.width*scale>state.area.width+.5||state.image.height*scale>state.area.height+.5);
  function down(event:PointerEvent){
    if(!canPan||event.button!==0||!event.isPrimary||(event.target as Element).closest('button,input,select,a'))return;
    const capture=event.target as Element;interact.current();drag.current={id:event.pointerId,start:{x:event.clientX,y:event.clientY},pan:current.current.pan,capture};capture.setPointerCapture(event.pointerId);setDragging(true);
  }
  function move(event:PointerEvent){const own=drag.current;if(!own||own.id!==event.pointerId)return;const point={x:own.pan.x+event.clientX-own.start.x,y:own.pan.y+event.clientY-own.start.y};setState(previous=>({...previous,pan:boundedPan(point,previous.image,previous.area,scaleOf(previous))}));}
  function up(event:PointerEvent){const own=drag.current;if(own?.id!==event.pointerId)return;drag.current=null;setDragging(false);if(own.capture.hasPointerCapture(event.pointerId))own.capture.releasePointerCapture(event.pointerId);}
  useEffect(()=>{
    const node=stage.current;if(!node||!enabled)return;
    node.addEventListener('pointerdown',down);node.addEventListener('pointermove',move);node.addEventListener('pointerup',up);node.addEventListener('pointercancel',up);node.addEventListener('lostpointercapture',up);
    return()=>{node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',up);node.removeEventListener('pointercancel',up);node.removeEventListener('lostpointercapture',up);};
  },[id,enabled,canPan,stage]);
  useLayoutEffect(()=>{const node=stage.current;if(!node)return;node.dataset.zoomMode=state.mode==='fit'?'fit':'manual';node.dataset.viewScale=String(scale);node.dataset.canPan=String(canPan);node.dataset.dragging=String(dragging);node.style.touchAction=canPan?'none':'pan-y';},[state.mode,state.area.width,state.area.height,state.image.width,state.image.height,scale,canPan,dragging,stage]);
  const imageStyle:CSSProperties|undefined=ready&&state.mode!=='fit'?{position:'absolute',left:'50%',top:'50%',width:state.image.width*scale,height:state.image.height*scale,maxWidth:'none',maxHeight:'none',transform:`translate(calc(-50% + ${state.pan.x}px),calc(-50% + ${state.pan.y}px))`,animation:'none',cursor:canPan?(dragging?'grabbing':'grab'):'default'}:undefined;
  return {ready,scale,isFit:state.mode==='fit',canPan,dragging,proof,fit,zoom,step,toggleProof,loaded,imageStyle};
}
