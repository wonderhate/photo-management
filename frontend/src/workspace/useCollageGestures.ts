import {useEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent,RefObject} from 'react';
import {swapCollage} from '../core/collage';
import {collageFrameRect} from '../core/collage-blend';
import type {CollageScene} from '../core/collage';
import {collageHit,collagePan,collageWheelFactor,collageZoom} from '../core/collage-interaction';
type Point={x:number;y:number};
type Gesture={before:CollageScene;base:CollageScene;index:number;start:Point;points:Map<number,Point>;moved:boolean;distance?:number;target:number};
type Options={scene:CollageScene|null;busy:boolean;selected:number;stage:RefObject<HTMLDivElement|null>;select:(index:number)=>void;preview:(scene:CollageScene)=>void;commit:(before:CollageScene,after:CollageScene)=>void};
export function useCollageGestures(options:Options){
 const current=useRef(options);current.current=options;const sceneRef=useRef(options.scene);sceneRef.current=options.scene;
 const gesture=useRef<Gesture|null>(null),wheel=useRef<{before:CollageScene;timer:ReturnType<typeof setTimeout>}|null>(null);
 const [feedback,setFeedback]=useState({target:-1,x:false,y:false});
 function preview(scene:CollageScene){sceneRef.current=scene;current.current.preview(scene);}
 function finishWheel(){const pending=wheel.current;if(!pending)return;clearTimeout(pending.timer);wheel.current=null;}
 function clear(){gesture.current=null;setFeedback({target:-1,x:false,y:false});}
 function finish(cancel=false){finishWheel();const g=gesture.current;if(!g)return;clear();if(cancel)preview(g.before);else if(sceneRef.current)current.current.commit(g.before,sceneRef.current);}
 function location(x:number,y:number,scene:CollageScene){const box=current.current.stage.current!.getBoundingClientRect();return {x:(x-box.left)/box.width*scene.width,y:(y-box.top)/box.height*scene.height,scale:box.width/scene.width};}
 function down(e:ReactPointerEvent<HTMLButtonElement>,index:number){
  const scene=sceneRef.current;if(!scene||current.current.busy||e.button!==0)return;finishWheel();e.preventDefault();e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);
  const g=gesture.current,point={x:e.clientX,y:e.clientY};
  if(g){if(e.pointerType==='touch'&&g.points.size===1){current.current.select(g.index);g.points.set(e.pointerId,point);const [a,b]=[...g.points.values()];g.distance=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y));g.base=structuredClone(scene);g.target=-1;setFeedback({target:-1,x:false,y:false});}return;}
  current.current.select(index);gesture.current={before:scene,base:scene,index,start:point,points:new Map([[e.pointerId,point]]),moved:false,target:-1};
 }
 function move(e:ReactPointerEvent<HTMLButtonElement>){
  const g=gesture.current;if(!g||!g.points.has(e.pointerId))return;g.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const next=structuredClone(g.base);
  if(g.distance){const [a,b]=[...g.points.values()];if(!a||!b)return;next.cells[g.index].zoom=collageZoom(g.base.cells[g.index].zoom,Math.hypot(a.x-b.x,a.y-b.y)/g.distance);g.moved=true;preview(next);return;}
  const dx=e.clientX-g.start.x,dy=e.clientY-g.start.y;if(!g.moved&&Math.abs(dx)+Math.abs(dy)<=4)return;g.moved=true;
  const at=location(e.clientX,e.clientY,g.before),hit=collageHit(g.before,at.x,at.y);g.target=hit>=0&&hit!==g.index?hit:-1;
  if(g.target>=0){preview(g.before);setFeedback({target:g.target,x:false,y:false});return;}
  const value=collagePan(g.base.cells[g.index],collageFrameRect(g.base,g.index),dx,dy,at.scale,e.shiftKey);next.cells[g.index].pan=value.pan;preview(next);setFeedback({target:-1,...value.guides});
 }
 function end(e:ReactPointerEvent<HTMLButtonElement>,cancel=false){
  const g=gesture.current;if(!g||!g.points.has(e.pointerId))return;
  if(!cancel&&g.moved&&!g.distance){const at=location(e.clientX,e.clientY,g.before),hit=collageHit(g.before,at.x,at.y);if(hit>=0&&hit!==g.index){const swapped=swapCollage(g.before,g.index,hit);clear();preview(swapped);current.current.select(hit);current.current.commit(g.before,swapped);return;}}
  finish(cancel);
 }
 useEffect(()=>{
  const element=options.stage.current;if(!element)return;
  const onWheel=(e:WheelEvent)=>{
   const o=current.current,scene=sceneRef.current;if(!scene||o.busy||gesture.current||e.deltaY===0)return;
   e.preventDefault();const at=location(e.clientX,e.clientY,scene),index=scene.cells[o.selected]?o.selected:collageHit(scene,at.x,at.y);if(index<0)return;
   const next=structuredClone(scene);next.cells[index].zoom=collageZoom(scene.cells[index].zoom,collageWheelFactor(e.deltaY,e.ctrlKey,e.shiftKey));
   if(wheel.current)clearTimeout(wheel.current.timer);else o.commit(scene,next);const before=wheel.current?.before||scene;wheel.current={before,timer:setTimeout(finishWheel,220)};preview(next);o.select(index);
  };
  element.addEventListener('wheel',onWheel,{passive:false});return()=>element.removeEventListener('wheel',onWheel);
 },[!!options.scene]);
 useEffect(()=>()=>{if(wheel.current)clearTimeout(wheel.current.timer);},[]);
 return {down,move,end,finish,feedback};
}
