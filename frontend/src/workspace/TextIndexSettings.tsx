import {useEffect,useRef,useState} from 'react';
import {Search} from 'lucide-react';
import {api,message} from '../api';
import {bt} from '../browser/text';
import type {Job} from '../types';
type State={available:boolean;total:number;pending:number;indexed:number;job_id:string|null;error:string|null};
export default function TextIndexSettings({notify}:{notify:(text:string)=>void}){
  const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),serial=useRef(0);
  async function refresh(){const ticket=++serial.current;try{const next=await api<State>('/search/index');if(ticket===serial.current){setState(next);setError('');}}catch(e){if(ticket===serial.current)setError(message(e));}}
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),2500);return()=>{serial.current++;clearInterval(timer);};},[]);
  async function rebuild(){setBusy(true);try{await api<Job>('/search/index/rebuild','POST');await refresh();notify(bt('正在本机重建文字索引，不读取原片。','Rebuilding the text index locally without reading originals.'));}catch(e){notify(message(e));}finally{setBusy(false);}}
  return <section className="settings-card text-index-settings"><header><Search size={20}/><div><h3>{bt('文字索引','Text search index')}</h3><p>{bt('用于描述、标签和识别文字，可随时重建。','For descriptions, tags and detected text. Rebuild it at any time.')}</p></div></header>{state&&<p role="status">{bt('已索引','Indexed')} {state.indexed} / {state.total} · {bt('待处理','Pending')} {state.pending}{state.job_id?' · '+bt('处理中','Working'):''}</p>}{state?.error&&<p className="muted">{message(state.error)}</p>}{error&&<p className="error-box">{error}</p>}<button disabled={busy||!!state?.job_id} onClick={()=>void rebuild()}>{bt('建立 / 修复文字索引','Build / repair text index')}</button><p className="muted">{bt('索引更新前仍按当前文字匹配，不改变描述、标签或照片。画面语义搜索继续使用独立的本地模型。','Current text remains searchable while the index updates. Descriptions, tags and photos stay unchanged. Visual search keeps using its separate local model.')}</p></section>;
}
