import {useEffect,useRef,useState} from 'react';
import {Users} from 'lucide-react';
import {api,message} from '../api';
import {bt} from '../browser/text';

type Policy={enabled:boolean;available:boolean;reason:'ready'|'dependency_missing'|'models_unavailable'|'busy'};
export default function ImportFaceSettings({notify}:{notify:(text:string)=>void}){
  const [policy,setPolicy]=useState<Policy|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;const controller=new AbortController();void api<Policy>('/faces/import-policy','GET',undefined,controller.signal).then(setPolicy).catch(e=>{if(!controller.signal.aborted)setError(message(e));});return()=>{mounted.current=false;controller.abort();};},[]);
  async function change(enabled:boolean){
    setBusy(true);setError('');
    try{const next=await api<Policy>('/faces/import-policy','PUT',{enabled});if(mounted.current){setPolicy(next);notify(enabled?bt('已开启，仅分析以后导入的新增照片。','Enabled for new photos in future imports only.'):bt('已关闭，自动人物任务已停止。','Disabled. Automatic face tasks have been stopped.'));}}
    catch(e){if(mounted.current)setError(message(e));}finally{if(mounted.current)setBusy(false);}
  }
  return <section className="settings-card" aria-label={bt('导入后人物分析','Face analysis after import')}><header><Users size={20}/><div><h3>{bt('导入后人物分析','Face analysis after import')}</h3><p>{bt('默认关闭；手动分析入口保留。','Off by default. Manual analysis remains available.')}</p></div></header>
    <label className="check"><input type="checkbox" checked={policy?.enabled===true} disabled={!policy||busy} onChange={e=>void change(e.target.checked)}/>{bt('自动分析以后导入的新增照片','Automatically analyze new photos after import')}</label>
    <p className="muted">{bt('开关立即保存，只使用已准备好的本地模型；重复照片不分析，不自动下载、上传或补扫旧照片。关闭会停止排队中的自动任务，正在计算的结果在保存前再次检查。','Changes save immediately and use prepared local models only. Duplicates are skipped. Models are not downloaded, photos are not uploaded, and older photos are not scanned. Turning this off stops queued automatic tasks; running results are checked again before saving.')}</p>
    {policy&&!policy.available&&<p role="status">{policy.reason==='busy'?bt('人物模型正在使用中；新增照片将排队检查，不影响导入完成。','Face models are busy. New photos will wait in the queue; import can finish normally.'):bt('本地人物模型未就绪；导入和浏览照常，需到人物页手动准备模型。','Local face models are not ready. Import and browsing remain available. Prepare models manually on the People page.')}</p>}
    {error&&<p className="error-box" role="alert">{error}</p>}
  </section>;
}
