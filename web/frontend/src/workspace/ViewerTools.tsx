import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import {Minus,Plus,Pin,Square} from 'lucide-react';
import {bt} from '../browser/text';
type Props={stage:RefObject<HTMLDivElement|null>;enabled:boolean;ready:boolean;scale:number;isFit:boolean;proof:boolean;pinned:boolean;onPin:(pinned:boolean)=>void;fit:()=>void;zoom:(scale:number)=>void;step:(direction:number)=>void;toggleProof:()=>void};
export default function ViewerTools(props:Props){
  const {stage,enabled,ready,scale,isFit,proof,pinned,onPin,fit,zoom,step,toggleProof}=props;
  const [visible,setVisible]=useState(true),[editing,setEditing]=useState(false),[value,setValue]=useState('100');
  const bar=useRef<HTMLDivElement|null>(null),wakeRef=useRef<(()=>void)|null>(null),percent=String(Math.round(scale*1000)/10);
  useEffect(()=>{if(!editing)setValue(percent);},[percent,editing]);
  useEffect(()=>{
    const node=stage.current;if(!node||!enabled)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');let timer:ReturnType<typeof setTimeout>|undefined;
    const wake=()=>{setVisible(true);clearTimeout(timer);if(!pinned&&!reduced.matches)timer=setTimeout(()=>{if(!bar.current?.contains(document.activeElement)&&!bar.current?.matches(':hover'))setVisible(false);},1800);};
    wakeRef.current=wake;
    wake();node.addEventListener('pointermove',wake);node.addEventListener('pointerleave',wake);node.addEventListener('focusin',wake);node.addEventListener('focusout',wake);reduced.addEventListener('change',wake);
    return()=>{wakeRef.current=null;clearTimeout(timer);node.removeEventListener('pointermove',wake);node.removeEventListener('pointerleave',wake);node.removeEventListener('focusin',wake);node.removeEventListener('focusout',wake);reduced.removeEventListener('change',wake);};
  },[stage,enabled,pinned]);
  useEffect(()=>wakeRef.current?.(),[scale,isFit,proof]);
  if(!enabled)return null;
  const commit=(text:string)=>{const amount=Number(text);if(text.trim()&&Number.isFinite(amount)&&amount>0)zoom(amount/100);setEditing(false);setValue(percent);};
  return <div ref={bar} className="viewer-tools" data-visible={visible||pinned} role="toolbar" aria-label={bt('照片查看工具','Photo view tools')} onFocusCapture={()=>setVisible(true)} onPointerLeave={()=>{const active=document.activeElement;if(active instanceof HTMLButtonElement&&bar.current?.contains(active)&&!active.matches(':focus-visible'))active.blur();}}>
    <button disabled={!ready||scale<=.01} aria-label={bt('缩小照片','Zoom out')} onClick={()=>step(-1)}><Minus size={16}/></button>
    <label className="viewer-percent"><input type="number" min={1} max={800} step={.1} aria-label={bt('查看缩放百分比','View zoom percent')} disabled={!ready} value={value} onFocus={()=>setEditing(true)} onChange={e=>setValue(e.target.value)} onBlur={e=>commit(e.currentTarget.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/><span>%</span></label>
    <button disabled={!ready||scale>=8} aria-label={bt('放大照片','Zoom in')} onClick={()=>step(1)}><Plus size={16}/></button>
    <button disabled={!ready} className={isFit?'active':''} aria-pressed={isFit} onClick={fit}>{bt('适应','Fit')}</button>
    <button disabled={!ready} aria-label={bt('预览实际像素','Actual preview pixels')} title={bt('100% 显示当前预览的实际像素；清晰度可在下方切换。','100% shows the current preview pixels. Change preview quality below.')} onClick={()=>zoom(1)}>100%</button>
    <button className={proof?'active':''} aria-label={bt('白底校样','White proof background')} aria-pressed={proof} title={bt('仅改变查看背景，暂时隐藏展映效果，不改变图像和导出。','Changes the view background and hides presentation effects without changing the image or export.')} onClick={toggleProof}><Square size={16} fill="#fff"/><span className="viewer-tool-label">{bt('白底','White')}</span></button>
    <button className={pinned?'active':''} aria-label={bt('固定查看工具','Pin view tools')} aria-pressed={pinned} onClick={()=>onPin(!pinned)}><Pin size={15}/></button>
  </div>;
}
