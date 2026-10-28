import {useEffect,useRef,useState} from 'react';
import {api,message} from '../api';
import {IS_BROWSER} from '../runtime';
import {bt} from '../browser/text';

export default function OriginalFileActions({id,path,onDownload,notify}:{id:string;path:string;onDownload:()=>Promise<void>;notify:(text:string)=>void}){
  const [cap,setCap]=useState({copy:false,drag:false}),[busy,setBusy]=useState(false),start=useRef<{x:number;y:number}|undefined>(undefined);
  useEffect(()=>{if(IS_BROWSER)return;let alive=true;void api<{copy:boolean;drag:boolean}>('/file-actions/capabilities').then(c=>{if(alive)setCap(c);}).catch(()=>{});return()=>{alive=false;};},[]);
  async function act(action:'copy'|'drag'){
    start.current=undefined;setBusy(true);
    try{const result=await api<{status:string}>('/file-actions','POST',{photo_ids:[id],action});if(result.status==='copied')notify(bt('已复制文件，原片保留','File copied; original retained'));}
    catch(e){notify(message(e));}finally{setBusy(false);}
  }
  async function copyPath(){try{await navigator.clipboard.writeText(path);notify(IS_BROWSER?bt('已复制图库内来源路径（浏览器不提供系统绝对路径）','Library source path copied (the browser does not expose an absolute system path)'):bt('已复制原片路径','Original path copied'));}catch(e){notify(message(e));}}
  async function share(){
    setBusy(true);try{const {current,original}=await import('../browser/storage'),photo=current().photos.find(p=>p.id===id);if(!photo)throw new Error('Record not found.');const file=await original(photo);if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file]});else await onDownload();}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))notify(message(e));}finally{setBusy(false);}
  }
  return <span className="original-file-actions">
    <button disabled={busy} onClick={()=>void copyPath()}>{IS_BROWSER?bt('复制来源路径','Copy source path'):bt('复制路径','Copy path')}</button>
    {cap.copy&&<button disabled={busy} onClick={()=>void act('copy')}>{bt('复制文件','Copy file')}</button>}
    {cap.drag&&<button disabled={busy} aria-label={bt('按住并拖出原片副本','Hold and drag out an original copy')} title={bt('按住鼠标拖到文件夹，仅复制。键盘操作请用复制文件。','Hold and drag to a folder; copies only. For keyboard access, use Copy file.')} onPointerDown={e=>{if(e.button===0&&e.pointerType==='mouse'){e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);start.current={x:e.clientX,y:e.clientY};}}} onPointerMove={e=>{if(start.current&&e.buttons===1&&Math.hypot(e.clientX-start.current.x,e.clientY-start.current.y)>6){e.currentTarget.releasePointerCapture(e.pointerId);void act('drag');}}} onPointerUp={()=>{start.current=undefined;}} onPointerCancel={()=>{start.current=undefined;}} onDragStart={e=>e.preventDefault()}>{bt('拖出副本','Drag copy')}</button>}
    {IS_BROWSER&&<button disabled={busy} onClick={()=>void share()}>{bt('分享文件 / 下载','Share file / download')}</button>}
  </span>;
}
