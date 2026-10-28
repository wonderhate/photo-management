import {useEffect,useRef,useState} from 'react';
import {api,message} from '../api';
import {bt} from '../browser/text';
import {IS_BROWSER} from '../runtime';

export default function RelinkOriginal({id,notify,onRelinked}:{id:string;notify:(text:string)=>void;onRelinked?:()=>void}){
  const [busy,setBusy]=useState(false),active=useRef<AbortController|null>(null);
  useEffect(()=>()=>{active.current?.abort();},[id]);
  async function relink(){
    const controller=new AbortController();active.current=controller;setBusy(true);
    try{
      if(IS_BROWSER){const {selectDirectory}=await import('../browser/storage'),handle=await selectDirectory('read');controller.signal.throwIfAborted();await(await import('../browser/source-relink')).relinkSource(id,handle,controller.signal);}
      else{const result=await api<{paths:string[]}>('/dialog/files','POST',undefined,controller.signal);if(!result.paths.length)return;if(result.paths.length!==1)throw new Error('Choose one original file to relink.');await api('/sources/photos/'+encodeURIComponent(id)+'/relink','POST',{path:result.paths[0]},controller.signal);}
      if(!controller.signal.aborted){notify(bt('已按原片哈希重新关联，影集和编辑记录保留','Relinked by original hash; albums and edits retained'));onRelinked?.();}
    }catch(e){if(!controller.signal.aborted&&!(e instanceof DOMException&&e.name==='AbortError'))notify(message(e));}
    finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}
  }
  return <button disabled={busy} title={bt('只关联内容哈希完全相同的文件，不改变拍摄分组或原片','Relinks only an exact content hash; keeps capture groups and original files')} onClick={()=>void relink()}>{busy?bt('正在核验来源…','Checking source…'):IS_BROWSER?bt('选择目录重定位','Relink from folder'):bt('重新定位原片','Relink original')}</button>;
}
