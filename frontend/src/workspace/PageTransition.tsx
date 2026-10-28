import {useEffect,useRef} from 'react';
import type {ReactNode} from 'react';

export default function PageTransition({page,children}:{page:string;children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null),previous=useRef(page),last=useRef(0),generation=useRef(0);
  useEffect(()=>{
    const node=ref.current;if(!node)return;
    const media=matchMedia('(prefers-reduced-motion: reduce)'),own=++generation.current;let animations:Animation[]=[];
    const stop=()=>{animations.forEach(a=>a.cancel());animations=[];if(generation.current===own)node.dataset.motion='idle';};
    if(previous.current!==page){
      previous.current=page;
      if(!media.matches&&!document.hidden){
        const time=Date.now(),duration=time-last.current<900?320:550;last.current=time;
        const frame=node.getBoundingClientRect(),top=Math.max(0,frame.top),bottom=Math.min(innerHeight,frame.bottom);
        const blades=node.querySelector<HTMLElement>('.workspace-route-blades')!;
        blades.style.top=(bottom>top?(top+bottom)/2-frame.top:Math.min(frame.height,innerHeight)/2)+'px';
        blades.style.width=Math.max(frame.width,Math.max(0,bottom-top))*1.8+'px';
        node.dataset.motion='running';const options={duration,easing:'cubic-bezier(.87,0,.13,1)',fill:'both' as const};
        animations=[node.querySelector('.workspace-route-curtain')!.animate([{opacity:1},{opacity:1,offset:.32},{opacity:0,offset:.72},{opacity:0}],options),
          blades.animate([{transform:'scale(.24) rotate(0deg)',opacity:1},{transform:'scale(1.7) rotate(15deg)',opacity:1,offset:.6},{transform:'scale(8) rotate(30deg)',opacity:0}],options),
          node.querySelector('.workspace-route-content')!.animate([{transform:'scale(1.025)',opacity:.7},{transform:'none',opacity:1}],options)];
        void Promise.all(animations.map(a=>a.finished.catch(()=>{}))).then(stop);
      }
    }
    const changed=()=>{if(media.matches||document.hidden)stop();};media.addEventListener('change',changed);document.addEventListener('visibilitychange',changed);
    return()=>{stop();media.removeEventListener('change',changed);document.removeEventListener('visibilitychange',changed);};
  },[page]);
  return <div className="workspace-transition" ref={ref} data-motion="idle"><div className="workspace-route-content">{children}</div><div className="workspace-route-overlay" aria-hidden="true"><div className="workspace-route-curtain"/><div className="workspace-route-blades">{Array.from({length:8},(_,i)=><i key={i} style={{transform:`rotate(${i*45}deg)`}}/>)}</div></div></div>;
}
