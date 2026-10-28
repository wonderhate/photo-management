import MediaImage from './media/MediaImage';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {api} from './api';
import {photoURL} from './runtime';
import {t} from './i18n';
import type {Photo} from './types';

export default function FilmTrain({ids,current,cache,playing,speed,onAdvance}:{ids:string[];current:Photo;cache:Record<string,Photo>;playing:boolean;speed:number;onAdvance:()=>Promise<boolean>}){
  const source=ids.includes(current.id)?ids:[current.id],index=source.indexOf(current.id);
  // ponytail: seven frames bound preview memory; expand only for unusually narrow scans.
  const count=Math.min(source.length,7),middle=Math.floor((count-1)/2);
  const frames=Array.from({length:count},(_,i)=>source[(index+i-middle+source.length)%source.length]);
  const frameKey=frames.join('|');
  const [nearby,setNearby]=useState<Record<string,Photo>>({});
  const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const stage=useRef<HTMLDivElement>(null),track=useRef<HTMLDivElement>(null),motion=useRef<Animation|null>(null);
  const align=useRef<()=>void>(()=>{}),advance=useRef(onAdvance),play=useRef(playing),rate=useRef(speed),reduce=useRef(reduced);
  advance.current=onAdvance;play.current=playing;rate.current=speed;reduce.current=reduced;
  const photos={...cache,...nearby,[current.id]:current};
  useEffect(()=>{
    let alive=true;
    const missing=frames.filter(id=>!photos[id]);
    if(missing.length)api<{photos:Photo[]}>('/photos/by-ids','POST',{ids:missing}).then(result=>{
      if(alive)setNearby(previous=>Object.fromEntries(frames.map(id=>[id,result.photos.find(p=>p.id===id)||previous[id]]).filter(([,photo])=>photo)));
    }).catch(()=>{});
    return()=>{alive=false};
  },[frameKey]);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(media.matches);
    media.addEventListener('change',change);return()=>media.removeEventListener('change',change);
  },[]);
  useLayoutEffect(()=>{
    const viewport=stage.current!,reel=track.current!;
    let alive=true,scheduled=0;
    function position(){
      const active=reel.children[middle] as HTMLElement,next=reel.children[middle+1] as HTMLElement|undefined;
      if(!active)return;
      motion.current?.cancel();motion.current=null;
      const start=viewport.clientWidth/2-active.offsetLeft-active.offsetWidth/2;
      reel.style.transform=`translate3d(${start}px,0,0)`;
      if(!play.current||reduce.current||!next||![...reel.querySelectorAll('img')].every(img=>img.complete))return;
      const end=viewport.clientWidth/2-next.offsetLeft-next.offsetWidth/2;
      const animation=reel.animate([{transform:`translate3d(${start}px,0,0)`},{transform:`translate3d(${end}px,0,0)`}],{duration:6000,easing:'linear',fill:'forwards'});
      animation.updatePlaybackRate(rate.current/75);motion.current=animation;
      animation.finished.then(async()=>{
        if(!alive)return;
        if(!await advance.current()&&alive){animation.cancel();reel.style.transform=`translate3d(${start}px,0,0)`;}
      }).catch(()=>{});
    }
    align.current=()=>{cancelAnimationFrame(scheduled);scheduled=requestAnimationFrame(position)};
    const observer=new ResizeObserver(()=>align.current());observer.observe(viewport);observer.observe(reel);
    position();
    return()=>{alive=false;observer.disconnect();cancelAnimationFrame(scheduled);motion.current?.cancel();motion.current=null;};
  },[frameKey,current.id]);
  useEffect(()=>{
    if(reduced){align.current();return;}
    const animation=motion.current;
    if(animation&&animation.playState!=='finished'){
      animation.updatePlaybackRate(speed/75);
      if(playing)animation.play();else animation.pause();
    }else if(playing)align.current();
  },[playing,speed,reduced]);
  return <div ref={stage} className="film-stage" data-photo-id={current.id} data-motion={playing&&!reduced?'playing':'paused'} tabIndex={-1} role="group" aria-label={t('胶片列车')}>
    <div ref={track} className="film-track">{frames.map((id,i)=>{
      const photo=photos[id];
      return <figure key={id} className={'film-frame'+(id===current.id?' active':'')} data-frame={String((source.indexOf(id)+1)).padStart(2,'0')} data-photo-id={id}>
        <MediaImage mediaPriority={1} src={photo?.preview_url||photoURL(id,'preview')} alt={photo?.file_name||t('照片')} width={photo?.width||1200} height={photo?.height||800} onLoad={()=>align.current()} onError={e=>{e.currentTarget.alt=photo?.preview_error?t(photo.preview_error):t('照片预览不可用');align.current();}} aria-current={i===middle?'true':undefined}/>
      </figure>;
    })}</div>
  </div>;
}
