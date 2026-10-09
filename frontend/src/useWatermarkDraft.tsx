import {useEffect,useRef,useState} from 'react';
import {api,message} from './api';
import {Modal} from './components';
import type {WatermarkDraft,WatermarkOptions} from './types';

export type LeaveGuard={current:(()=>Promise<boolean>)|null};
export function useWatermarkDraft({active,options,setOptions,draftId,onSaved,guard,notify}: {
  active:string;options:WatermarkOptions;setOptions:(o:WatermarkOptions)=>void;draftId:string;
  onSaved:(id:string)=>void;guard:LeaveGuard;notify:(s:string)=>void;
}) {
  const [draft,setDraft]=useState<WatermarkDraft|null>(null);
  const [name,setName]=useState('');
  const [state,setState]=useState('');
  const [loading,setLoading]=useState(!!draftId);
  const [leave,setLeave]=useState<((ok:boolean)=>void)|null>(null);
  const saved=useRef('');
  const baseline=useRef(JSON.stringify(options));
  const current=useRef({active,options,name});current.current={active,options,name};
  const record=useRef<WatermarkDraft|null>(null);
  const pending=useRef<Promise<WatermarkDraft>|null>(null);
  const loaded=useRef('');
  const latest=()=>JSON.stringify({settings_json:current.current.options,name:current.current.name});
  const dirty=()=>record.current ? latest()!==saved.current : JSON.stringify(current.current.options)!==baseline.current || !!current.current.name;
  useEffect(()=>{
    if(!draftId || loaded.current===draftId)return;
    let alive=true;setLoading(true);
    api<WatermarkDraft>('/watermark/drafts/'+draftId).then(d=>{
      if(!alive)return;loaded.current=d.id;record.current=d;setDraft(d);setOptions(d.settings_json);setName(d.name);
      saved.current=JSON.stringify({settings_json:d.settings_json,name:d.name});setState('已保存');
    }).catch(e=>{if(alive){setState('加载失败：'+message(e));notify(message(e))}}).finally(()=>{if(alive)setLoading(false)});
    return()=>{alive=false};
  },[draftId]);
  useEffect(()=>{if(!draftId&&!record.current)baseline.current=JSON.stringify(current.current.options)},[active]);

  async function save():Promise<WatermarkDraft> {
    if(pending.current){await pending.current;if(record.current&&!dirty())return record.current;return save()}
    const c=current.current,existing=record.current;
    if(existing&&!dirty())return existing;
    if(!c.active&&!existing)throw new Error('请先选择照片');
    setState('正在保存…');
    const body=existing?{revision:existing.revision,name:c.name||existing.name,settings_json:c.options,template_id:c.options.template}:
      {photo_id:c.active,name:c.name,settings_json:c.options,template_id:c.options.template};
    const promise=api<WatermarkDraft>('/watermark/drafts'+(existing?'/'+existing.id:''),existing?'PUT':'POST',body);
    pending.current=promise;
    try {
      const d=await promise;record.current=d;loaded.current=d.id;setDraft(d);
      // Do not overwrite edits made while this request was in flight.
      if(current.current.name===c.name){current.current.name=d.name;setName(d.name)}
      saved.current=JSON.stringify({settings_json:c.options,name:d.name});
      onSaved(d.id);setState('已保存');return d;
    }catch(e){setState('保存失败：'+message(e));throw e}finally{pending.current=null}
  }
  async function flush():Promise<WatermarkDraft>{let d=await save();while(dirty())d=await save();return d}
  useEffect(()=>{
    if(loading||!record.current||!dirty())return;
    setState('等待自动保存…');
    const timer=setTimeout(()=>{save().catch(()=>{})},1500);
    return()=>clearTimeout(timer);
  },[options,name,loading,draft?.revision]);
  const requestLeave=async()=>{
    if(!dirty()&&!pending.current)return true;
    if(record.current){try{await flush();return true}catch{/* Retain editor and offer an explicit retry. */}}
    return new Promise<boolean>(resolve=>setLeave(()=>resolve));
  };
  guard.current=requestLeave;
  useEffect(()=>()=>{guard.current=null},[]);
  useEffect(()=>{
    const before=(event:BeforeUnloadEvent)=>{if(dirty()||pending.current){event.preventDefault();event.returnValue=''}};
    window.addEventListener('beforeunload',before);
    return()=>window.removeEventListener('beforeunload',before);
  });
  function defaults(values:Partial<WatermarkOptions>){if(!draftId&&!record.current&&!dirty()){const next={...current.current.options,...values};baseline.current=JSON.stringify(next);setOptions(next)}}
  async function ready(){const d=await flush();const next=await api<WatermarkDraft>('/watermark/drafts/'+d.id+'/status','PATCH',{status:'ready'});record.current=next;setDraft(next);notify('已标记为待导出')}
  function reset(){record.current=null;loaded.current='';setDraft(null);setName('');saved.current='';baseline.current=JSON.stringify(current.current.options);setState('')}
  const dialog=leave&&<Modal title="当前水印尚未保存" onClose={()=>{leave(false);setLeave(null)}}>
    <div className="draft-dialog"><p>将编辑保存到水印图库，下次可以继续修改。</p>{state.startsWith('保存失败')&&<p className="error-box">{state}</p>}
    <div className="button-row"><button onClick={()=>{leave(false);setLeave(null)}}>继续编辑</button>
    <button onClick={()=>{leave(true);setLeave(null)}}>放弃修改</button>
    <button className="primary" onClick={async()=>{try{await flush();leave(true);setLeave(null)}catch(e){notify(message(e))}}}>保存到水印图库</button></div></div></Modal>;
  return {draft,name,setName,state,loading,save:flush,ready,requestLeave,reset,defaults,dialog};
}
