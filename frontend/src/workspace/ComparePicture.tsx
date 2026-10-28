import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import MediaImage from '../media/MediaImage';
import {bt} from '../browser/text';
import {comparisonFrame,moveComparison,zoomComparison} from '../core/comparison-view';
import type {ComparisonPose} from '../core/comparison-view';
import type {ViewSize} from '../core/viewer-geometry';

type Props={id:string;name:string;source:string;pose:ComparisonPose;activate:()=>void;change:(update:(pose:ComparisonPose)=>ComparisonPose)=>void};
export default function ComparePicture({id,name,source,pose,activate,change}:Props){
  const stage=useRef<HTMLDivElement|null>(null),[image,setImage]=useState<ViewSize>({width:0,height:0}),[area,setArea]=useState<ViewSize>({width:0,height:0}),[failed,setFailed]=useState(false),[dragging,setDragging]=useState(false);
  const drag=useRef<{id:number;x:number;y:number;pose:ComparisonPose;capture:Element}|null>(null);
  const current=useRef({pose,image,area,activate,change});current.current={pose,image,area,activate,change};
  useEffect(()=>{const node=stage.current;if(!node)return;const measure=()=>setArea(previous=>previous.width===node.clientWidth&&previous.height===node.clientHeight?previous:{width:node.clientWidth,height:node.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[]);
  // Reset before a cached image can emit load; a passive reset can erase its dimensions.
  useLayoutEffect(()=>{setImage({width:0,height:0});setFailed(false);drag.current=null;setDragging(false);},[id,source]);
  useEffect(()=>{
    const node=stage.current;if(!node)return;
    const wheel=(event:WheelEvent)=>{const own=current.current;if(!own.image.width||!event.deltaY)return;event.preventDefault();own.activate();const box=node.getBoundingClientRect(),anchor={x:event.clientX-box.left-box.width/2,y:event.clientY-box.top-box.height/2},delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?box.height:1);own.change(previous=>zoomComparison(previous,previous.zoom*Math.exp(-delta*.0015),own.image,own.area,anchor));};
    node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
  },[]);
  const {scale,pan}=comparisonFrame(pose,image,area),ready=image.width>0&&area.width>0&&area.height>0,canPan=ready&&(image.width*scale>area.width+.5||image.height*scale>area.height+.5);
  function down(event:ReactPointerEvent){activate();if(!canPan||event.button!==0||!event.isPrimary)return;const capture=event.target as Element;capture.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,pose,capture};setDragging(true);}
  function move(event:ReactPointerEvent){const own=drag.current;if(!own||own.id!==event.pointerId)return;const delta={x:event.clientX-own.x,y:event.clientY-own.y};change(()=>moveComparison(own.pose,delta,image,area));}
  function up(event:ReactPointerEvent){const own=drag.current;if(!own||own.id!==event.pointerId)return;drag.current=null;setDragging(false);if(own.capture.hasPointerCapture(event.pointerId))own.capture.releasePointerCapture(event.pointerId);}
  return <div ref={stage} className="image-area compare-stage" tabIndex={0} role="group" aria-label={name+' · '+bt('对比视图','Comparison view')} data-zoom={pose.zoom} data-focus-x={pose.focus.x} data-focus-y={pose.focus.y} data-can-pan={canPan} data-dragging={dragging} onFocus={activate} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} style={{touchAction:canPan?'none':'pan-y'}} onKeyDown={event=>{
    const directions:Record<string,[number,number]>={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};const direction=directions[event.key];if(direction&&canPan&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();const step=event.shiftKey?3:1;change(previous=>moveComparison(previous,{x:direction[0]*step,y:direction[1]*step},image,area));}
  }}>
    <MediaImage key={source} src={source} alt={name} draggable={false} onLoad={event=>{setImage({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight});setFailed(false);}} onError={()=>setFailed(true)} style={ready?{position:'absolute',left:'50%',top:'50%',width:image.width*scale,height:image.height*scale,maxWidth:'none',maxHeight:'none',transform:`translate(calc(-50% + ${pan.x}px),calc(-50% + ${pan.y}px))`}:undefined}/>
    {failed&&<p className="compare-error" role="status">{bt('无法读取预览，请检查文件是否仍可访问。','Preview unavailable. Check that the file is still accessible.')}</p>}
  </div>;
}
