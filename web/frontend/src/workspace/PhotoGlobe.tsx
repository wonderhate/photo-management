import {useEffect,useMemo,useRef,useState} from 'react';
import {Pause,Play} from 'lucide-react';
import {bt} from '../browser/text';
import type {MapCluster} from '../core/photo-map';
import {createEarthGlobe} from './earth-globe-texture';

const rad=Math.PI/180;
export default function PhotoGlobe({land,clusters,onSelect}:{land:string[]|null;clusters:MapCluster[];onSelect:(p:MapCluster)=>void}){
  const canvas=useRef<HTMLCanvasElement>(null),drag=useRef<{x:number;y:number;lon:number;lat:number}|null>(null);
  const [pose,setPose]=useState({lon:105,lat:20}),[paused,setPaused]=useState(false),[reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const texture=useRef<ReturnType<typeof createEarthGlobe>>(null),[textureState,setTextureState]=useState('loading');
  useEffect(()=>{let alive=true;const image=new Image();image.onload=()=>{if(!alive)return;texture.current=createEarthGlobe(image);setTextureState(texture.current?'ready':'fallback');};image.onerror=()=>{if(alive)setTextureState('fallback');};image.src='/maps/earth/globe.jpg';return()=>{alive=false;texture.current?.dispose();texture.current=null;};},[]);
  const lines=useMemo(()=>land?.flatMap(path=>path.split('M').filter(Boolean).map(line=>(line.match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g)||[]).map(pair=>{const [x,y]=pair.split(',').map(Number);return [x-180,90-y];})))||[],[land]);
  const project=(lon:number,lat:number)=>{const a=(lon-pose.lon)*rad,b=lat*rad,c=pose.lat*rad;return {x:Math.cos(b)*Math.sin(a),y:Math.sin(b)*Math.cos(c)-Math.cos(b)*Math.cos(a)*Math.sin(c),z:Math.sin(b)*Math.sin(c)+Math.cos(b)*Math.cos(a)*Math.cos(c)};};
  useEffect(()=>{const q=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(q.matches);q.addEventListener('change',change);return()=>q.removeEventListener('change',change);},[]);
  useEffect(()=>{if(paused||reduced)return;let timer:ReturnType<typeof setInterval>|undefined;const el=canvas.current;if(!el)return;const observer=new IntersectionObserver(entries=>{clearInterval(timer);if(entries[0]?.isIntersecting)timer=setInterval(()=>{if(!document.hidden&&!drag.current)setPose(p=>({...p,lon:(p.lon+.12)%360}));},50);});observer.observe(el);return()=>{observer.disconnect();clearInterval(timer);};},[paused,reduced]);
  useEffect(()=>{
    const el=canvas.current,ctx=el?.getContext('2d');if(!el||!ctx)return;
    const size=720,r=310,cx=360,cy=360;el.width=size;el.height=size;ctx.clearRect(0,0,size,size);
    const ocean=ctx.createRadialGradient(245,175,20,cx,cy,r);ocean.addColorStop(0,'#263f48');ocean.addColorStop(.65,'#101d27');ocean.addColorStop(1,'#040a11');ctx.fillStyle=ocean;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();texture.current?.draw(ctx,pose.lon,pose.lat);
    function stroke(points:number[][],color:string,width:number){ctx!.beginPath();let drawing=false;for(const [lon,lat]of points){const p=project(lon,lat);if(p.z<0){drawing=false;continue;}const x=cx+p.x*r,y=cy-p.y*r;if(drawing)ctx!.lineTo(x,y);else ctx!.moveTo(x,y);drawing=true;}ctx!.strokeStyle=color;ctx!.lineWidth=width;ctx!.stroke();}
    for(let lon=-180;lon<180;lon+=30)stroke(Array.from({length:91},(_,i)=>[lon,i*2-90]),'rgba(164,191,201,.12)',.8);
    for(let lat=-60;lat<=60;lat+=30)stroke(Array.from({length:181},(_,i)=>[i*2-180,lat]),'rgba(164,191,201,.12)',.8);
    for(const line of lines)stroke(line,texture.current?'rgba(218,194,133,.24)':'rgba(218,194,133,.7)',.85);
    const halo=ctx.createRadialGradient(cx,cy,r-4,cx,cy,r+20);halo.addColorStop(0,'rgba(133,204,229,.22)');halo.addColorStop(.2,'rgba(133,204,229,.09)');halo.addColorStop(1,'rgba(133,204,229,0)');ctx.strokeStyle=halo;ctx.lineWidth=24;ctx.beginPath();ctx.arc(cx,cy,r+7,0,Math.PI*2);ctx.stroke();
  },[pose,lines,textureState]);
  return <div className="photo-globe" data-texture={textureState} role="region" aria-label={bt('地球总览：拖动或使用方向键旋转','Globe overview: drag or use arrow keys to rotate')} tabIndex={0} onFocus={e=>{if(!(e.target as Element).closest('.globe-pause'))setPaused(true);}}
    onKeyDown={e=>{if(e.target!==e.currentTarget)return;const d:Record<string,[number,number]>={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,10],ArrowDown:[0,-10]};if(d[e.key]){e.preventDefault();setPaused(true);setPose(p=>({lon:p.lon+d[e.key][0],lat:Math.max(-70,Math.min(70,p.lat+d[e.key][1]))}));}}}
    onPointerDown={e=>{if(e.button!==0||(e.target as Element).closest('button'))return;setPaused(true);drag.current={x:e.clientX,y:e.clientY,lon:pose.lon,lat:pose.lat};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const p=drag.current;if(p)setPose({lon:p.lon-(e.clientX-p.x)*.35,lat:Math.max(-70,Math.min(70,p.lat+(e.clientY-p.y)*.25))});}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}>
    <div className="photo-globe-disc"><canvas ref={canvas} aria-hidden="true"/>{clusters.map(p=>{const v=project(p.longitude,p.latitude);return v.z>.08&&<button key={p.photo_id} className="globe-pin" style={{left:`${50+v.x*310/720*100}%`,top:`${50-v.y*310/720*100}%`}} onClick={()=>onSelect(p)} aria-label={bt(`${p.count} 张照片，查看这个地点`,`${p.count} photos, explore this location`)}>{p.count>1?p.count:<span/>}</button>;})}</div>
    <span className="globe-caption">{bt('每一帧，都有它的经纬。','Every frame has a place.')}</span>
    <button className="globe-pause" disabled={reduced} aria-pressed={paused||reduced} onClick={()=>setPaused(v=>!v)}>{paused||reduced?<Play size={14}/>:<Pause size={14}/>} {paused||reduced?bt('旋转地球','Rotate globe'):bt('暂停旋转','Pause rotation')}</button>
  </div>;
}
