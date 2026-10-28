import {useEffect,useMemo,useRef,useState} from 'react';
import {api,message} from './api';
import {bt} from './browser/text';
import {Modal} from './components';
import type {Person} from './usePersonManagement';

interface IgnoredPage {people:Person[];total:number;has_more:boolean}
export default function FaceGroupDecisions({people,disabled,onChanged}:{people:Person[];disabled:boolean;onChanged:()=>Promise<void>}){
  const [mode,setMode]=useState<'ignore'|'restore'|null>(null),[query,setQuery]=useState(''),[page,setPage]=useState(1);
  const [chosen,setChosen]=useState<Record<string,Person>>({}),[prepared,setPrepared]=useState<Record<string,{revision:string;name:string}>|null>(null);
  const [result,setResult]=useState<IgnoredPage>({people:[],total:0,has_more:false}),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const mounted=useRef(true),pending=useRef(false),generation=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++}},[]);
  useEffect(()=>{
    if(mode!=='restore')return;
    let live=true;const controller=new AbortController();setLoading(true);setResult({people:[],total:0,has_more:false});
    const timer=setTimeout(()=>{void api<IgnoredPage>('/faces/ignored?'+new URLSearchParams({page:String(page),search:query}),'GET',undefined,controller.signal).then(value=>{if(live)setResult(value)}).catch(e=>{if(live&&e?.name!=='AbortError')setError(message(e))}).finally(()=>{if(live)setLoading(false)})},query?180:0);
    return()=>{live=false;clearTimeout(timer);controller.abort()};
  },[mode,page,query,reload]);
  const active=useMemo(()=>people.filter(p=>p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())),[people,query]);
  const rows=mode==='ignore'?active.slice((page-1)*40,page*40):result.people,total=mode==='ignore'?active.length:result.total,count=Object.keys(chosen).length;
  function open(next:'ignore'|'restore'){generation.current++;setMode(next);setQuery('');setPage(1);setChosen({});setPrepared(null);setError('');setLoading(false)}
  function select(person:Person){generation.current++;setPrepared(null);setChosen(value=>{const next={...value};if(next[person.id])delete next[person.id];else next[person.id]=person;return next})}
  async function run(work:(own:number)=>Promise<void>){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');const own=++generation.current;
    try{await work(own)}catch(e){if(mounted.current&&own===generation.current){setError(message(e));setPrepared(null)}}finally{pending.current=false;if(mounted.current)setBusy(false)}
  }
  async function prepare(){await run(async own=>{const entries=await Promise.all(Object.keys(chosen).map(async id=>[id,await api<{revision:string;name:string}>(`/faces/persons/${id}/revision?ignored=${mode==='restore'}`)] as const));if(mounted.current&&own===generation.current)setPrepared(Object.fromEntries(entries))})}
  async function save(){if(!prepared)return;await run(async own=>{await api('/faces/groups/'+mode,'POST',{revisions:Object.fromEntries(Object.entries(prepared).map(([id,p])=>[id,p.revision]))});if(!mounted.current||own!==generation.current)return;setMode(null);setChosen({});setPrepared(null);await onChanged()})}
  return <div className="face-group-decisions"><div className="row"><button disabled={disabled||busy||!people.length} onClick={()=>open('ignore')}>{bt('批量忽略分组','Ignore groups')}</button><button disabled={disabled||busy} onClick={()=>open('restore')}>{bt('已忽略分组','Ignored groups')}</button></div>
    {mode&&<Modal title={mode==='ignore'?bt('批量忽略分组','Ignore groups'):bt('恢复已忽略分组','Restore ignored groups')} onClose={()=>{if(!busy){generation.current++;setMode(null)}}}><div className="batch-edit-content face-group-dialog">
      <p>{mode==='ignore'?bt('忽略会隐藏所选分组，并保留成员、模型来源和旧影集。重扫同一原片时继续保留决定。','Ignore hides the selected groups while preserving members, model sources and existing albums. Decisions are retained when the same source is scanned again.'):bt('恢复仅重新显示已有分组记录，不重新分析照片。已有影集内容保持。','Restore only shows existing group records again. It does not reanalyze photos. Existing album contents are preserved.')}</p>
      <label>{bt('搜索人物分组','Search person groups')}<input aria-label={bt('搜索人物分组','Search person groups')} value={query} maxLength={256} disabled={busy} onChange={e=>{setQuery(e.target.value);setPage(1)}}/></label>
      <fieldset disabled={busy||loading}><legend>{bt('选择分组（每次最多 100 个）','Choose groups (up to 100 at a time)')}</legend>{loading?<p role="status">{bt('加载中…','Loading…')}</p>:rows.length?rows.map(person=><label className="person-choice" key={person.id}><input type="checkbox" checked={!!chosen[person.id]} disabled={!chosen[person.id]&&count>=100} onChange={()=>select(person)}/><span>{person.name} · {person.photo_count}</span></label>):<p>{bt('没有匹配的分组','No matching groups')}</p>}</fieldset>
      <div className="row face-group-pager"><button disabled={busy||loading||page<=1} onClick={()=>setPage(p=>p-1)}>{bt('上一页','Previous')}</button><span>{page} / {Math.max(1,Math.ceil(total/40))}</span><button disabled={busy||loading||page*40>=total} onClick={()=>setPage(p=>p+1)}>{bt('下一页','Next')}</button><span>{bt(`已选择 ${count} 个分组`,`Selected ${count} groups`)}</span><button disabled={busy||!count} onClick={()=>{generation.current++;setChosen({});setPrepared(null)}}>{bt('取消选择','Clear selection')}</button></div>
      {prepared&&<p className="face-group-preview">{Object.values(prepared).map(p=>p.name).join(' / ')}</p>}
      {error&&<div className="error-box" role="alert">{error}<button disabled={busy} onClick={()=>void run(async()=>{await onChanged();if(mounted.current){setPrepared(null);setReload(v=>v+1)}})}>{bt('刷新分组','Refresh groups')}</button></div>}
      <div className="row"><button disabled={busy||loading||!count} onClick={()=>void prepare()}>{bt('检查选择','Review selection')}</button><button className="primary" disabled={busy||!prepared} onClick={()=>void save()}>{mode==='ignore'?bt('忽略所选分组','Ignore selected groups'):bt('恢复所选分组','Restore selected groups')}</button></div>
    </div></Modal>}
  </div>;
}
