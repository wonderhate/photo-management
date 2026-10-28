import DownloadLink from '../media/DownloadLink';
import AgentApproval from './AgentApproval';
import type {AgentReview} from '../core/agent';
import {agentLabels} from '../core/agent';
import {useEffect,useRef,useState} from 'react';
import {Activity,RefreshCw} from 'lucide-react';
import {Modal} from '../components';
import {api,message} from '../api';
import {t} from '../i18n';
import type {Job} from '../types';
import {taskActive,taskKind,taskStatus,taskResource,taskProgress} from './task-summary';
import type {TaskSummary} from './task-summary';
import {bt} from '../browser/text';
import CloudReceipt from './CloudReceipt';

const automaticFaceNotes:Record<string,[string,string]>={
  scheduled:['本次新增照片已安排本地人物分析。','Local face analysis has been scheduled for new photos from this import.'],
  no_new_photos:['本次没有新增照片，未安排人物分析。','This import added no new photos. No face analysis was scheduled.'],
  disabled:['自动人物分析已关闭，照片已正常导入。','Automatic face analysis is off. Photos were imported normally.'],
  models_unavailable:['本地人脸模型未就绪；照片已导入，可稍后手动分析。','Local face models are not ready. Photos were imported; you can analyze them manually later.'],
  unavailable:['自动人物分析暂不可用，照片已导入；可稍后手动分析。','Automatic face analysis is unavailable. Photos were imported; you can analyze them manually later.'],
};

export default function ActivityCenter({notify,onAnnotateImport}:{notify:(text:string)=>void;onAnnotateImport?:(id:string)=>void}){
  const [open,setOpen]=useState(false),[items,setItems]=useState<TaskSummary[]>([]),[selected,setSelected]=useState('');
  const [detail,setDetail]=useState<(Job&{cancelled?:boolean;actor?:string;tool?:string;review?:AgentReview;review_digest?:string;agent_result?:unknown;linked_job_id?:string})|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
  const [stages,setStages]=useState<TaskSummary[]>([]),[parentID,setParentID]=useState(''),[queuesOpen,setQueuesOpen]=useState(false);
  const [queues,setQueues]=useState<{capacity:number;pending:number;items:{name:string;limit:number;running:number;queued:number}[]}|null>(null);
  const selectedID=useRef('');
  function selectTask(id:string,parent=''){if(selectedID.current===id)return;selectedID.current=id;setDetail(null);setStages([]);setParentID(parent);setSelected(id);}
  useEffect(()=>{
    let stopped=false,generation=0,timer:ReturnType<typeof setTimeout>|undefined,request:AbortController|undefined;
    const poll=async()=>{
      clearTimeout(timer);if(stopped||document.hidden)return;
      const own=++generation;request?.abort();const controller=new AbortController();request=controller;
      try{
        const jobs=await api<TaskSummary[]>('/jobs?summary=true','GET',undefined,controller.signal);
        if(stopped||generation!==own)return;setItems(jobs.slice(0,100));setError('');
        if(open&&selected){const next=await api<Job>('/jobs/'+selected,'GET',undefined,controller.signal);if(!stopped&&generation===own)setDetail(next);
          if(next.child_count||next.parent_id){const tree=await api<{items:TaskSummary[]}>('/jobs/'+(next.parent_id||next.id)+'/children','GET',undefined,controller.signal);if(!stopped&&generation===own)setStages(tree.items);}}
        if(open&&queuesOpen){const next=await api<NonNullable<typeof queues>>('/tasks/resources','GET',undefined,controller.signal);if(!stopped&&generation===own)setQueues(next);}
      }catch(reason){if(!stopped&&generation===own&&!controller.signal.aborted)setError(message(reason));}
      finally{if(!stopped&&generation===own&&!document.hidden)timer=setTimeout(()=>void poll(),open?1500:5000);}
    };
    const visibility=()=>{clearTimeout(timer);generation++;request?.abort();if(!document.hidden)void poll();};
    document.addEventListener('visibilitychange',visibility);void poll();
    return()=>{stopped=true;generation++;clearTimeout(timer);request?.abort();document.removeEventListener('visibilitychange',visibility);};
  },[open,selected,revision,queuesOpen]);
  async function cancel(){
    if(!detail||busy)return;setBusy(true);
    try{const next=await api<Job>('/jobs/'+detail.id+'/cancel','POST');if(selectedID.current===detail.id)setDetail(next);setRevision(value=>value+1);}
    catch(reason){notify(message(reason));}finally{setBusy(false);}
  }
  const active=items.filter(taskActive).length,ordered=[...items].sort((a,b)=>Number(taskActive(b))-Number(taskActive(a)));
  return <>
    <button className="icon activity-button" aria-label={t('活动中心')} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><Activity size={16}/>{active>0&&<span aria-hidden="true">{active}</span>}</button>
    {open&&<Modal title={t('活动中心')} wide onClose={()=>setOpen(false)}><div className="activity-center">
      <div className="activity-toolbar"><p>{t('进行中 {0} · 最近 {1}',{0:active,1:items.length})}</p><button className="quiet" aria-label={t('刷新任务')} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={15}/></button></div>
      {error&&<p className="error-box" role="alert">{error}</p>}
      <details className="activity-resources" open={queuesOpen} onToggle={e=>setQueuesOpen(e.currentTarget.open)}><summary>{t('资源队列')}</summary>{queues&&<div className="activity-resource-grid">{queues.items.map(item=><p key={item.name}><b>{t(taskResource(item.name))}</b><span>{t('运行 {0}/{1} · 等待 {2}',{0:item.running,1:item.limit,2:item.queued})}</span></p>)}</div>}</details>
      {!ordered.length?<p className="muted">{t('暂无任务')}</p>:<div className="activity-columns"><div className="activity-list" aria-label={t('任务列表')}>{ordered.map(task=><button key={task.id} data-task-id={task.id} aria-pressed={(parentID||selected)===task.id} className={task.parent_id?'activity-child':''} onClick={()=>selectTask(task.id)}><span><b>{t(taskKind(task.kind))}</b><small>{t(taskStatus(task.status))}</small></span><progress value={taskProgress(task).indeterminate?undefined:taskProgress(task).processed} max={taskProgress(task).total||1}/><span><small>{task.phase==='previews'?t('生成预览')+' · ':''}{taskProgress(task).processed} / {taskProgress(task).total}</small><small>{task.cancelled&&taskActive(task)?t('取消中…'):''}</small></span></button>)}</div>
      <section className="activity-detail" aria-label={t('任务详情')}>
        {!selected?<p className="muted">{t('选择任务查看详情')}</p>:!detail?<p role="status">{t('正在读取…')}</p>:<>
          <h3>{t(taskKind(detail.kind))} · {t(taskStatus(detail.status))}</h3><p>{t('成功')} {detail.success} · {t('跳过')} {detail.skipped} · {t('失败')} {detail.failed}</p>
          {detail.actor==='agent'&&<p>{bt('发起者：本机外部Agent','Requested by: external local Agent')} · {bt(...(agentLabels[detail.tool||'']||[detail.tool||'',detail.tool||'']))}</p>}
          {detail.actor==='agent'&&<><AgentApproval id={detail.id} status={detail.status} review={detail.review} digest={detail.review_digest} notify={notify} onChanged={()=>setRevision(v=>v+1)}/>{detail.linked_job_id&&<button onClick={()=>selectTask(detail.linked_job_id!)}>{bt('查看执行任务与计费状态','View execution and billing status')}</button>}{detail.agent_result!==undefined&&<details><summary>{bt('Agent执行结果','Agent result')}</summary><pre className="agent-result">{JSON.stringify(detail.agent_result,null,2)}</pre></details>}</>}
          {detail.parent_id&&<><button className="quiet" onClick={()=>selectTask(detail.parent_id!)}>{t('返回整体任务')}</button><p className="muted">{t('取消必要阶段也会停止整体任务的后续阶段。')}</p></>}
          {detail.resource&&<p className="muted">{t('执行资源')} · {t(taskResource(detail.resource))}</p>}
          {onAnnotateImport&&detail.new_photo_ids?.length&&!['queued','running'].includes(detail.status)&&<div><p>{bt('可为本次新增照片添加AI描述、标签或文字识别。需先选择范围并确认，才会发送照片。','Add AI captions, tags or OCR for newly imported photos. Review and confirm the scope before sending any photos.')}</p><button onClick={()=>{setOpen(false);onAnnotateImport(detail.id)}}>{bt('查看本次新增照片的AI分析范围','Review AI analysis for this import')}</button></div>}
          {detail.auto_face_analysis&&<div className="activity-auto-faces"><p role="status">{bt(...(automaticFaceNotes[detail.auto_face_analysis.status]||automaticFaceNotes.unavailable))}</p>{detail.auto_face_analysis.job_id&&<button className="quiet" onClick={()=>selectTask(detail.auto_face_analysis!.job_id!)}>{bt('查看本次人物分析任务','View this import’s face analysis task')}</button>}</div>}
          {(detail.billing_uncertain||detail.billing_state==='submitted'||detail.billing_state==='unknown')&&<p className="error-box">{t('存在已提交或结果待确认的云请求，可能已计费；不会自动重发。')}</p>}
          {detail.billable&&<CloudReceipt value={detail}/>}
          {detail.current&&<p className="muted">{t(detail.current)}</p>}{detail.error&&<p className="error-box">{message(detail.error)}</p>}
          {(detail.errors||[]).length>0&&<details><summary>{t('查看错误')}</summary>{detail.errors.slice(0,100).map((entry,index)=><p key={index}>{message(entry)}</p>)}</details>}
          {(detail.results||[]).filter(result=>result.url).length>0&&<div className="activity-results">{detail.results.filter(result=>result.url).map((result,index)=><DownloadLink key={index} href={result.url} download={result.file_name||true}>{result.file_name||t('下载')}</DownloadLink>)}</div>}
          {stages.length>0&&<div className="activity-stages" aria-label={t('工作阶段')}><h4>{t('工作阶段')}</h4>{stages.map(child=><button className="quiet" key={child.id} data-task-id={child.id} aria-pressed={selected===child.id} onClick={()=>selectTask(child.id,child.parent_id||'')}><span>{t(taskKind(child.kind))}</span><small>{t(taskStatus(child.status))} · {child.processed}/{child.total}</small></button>)}</div>}
          {['queued','running','awaiting_approval','awaiting_app','paused'].includes(detail.status)&&<><button className="danger" disabled={busy||detail.cancelled} onClick={()=>void cancel()}>{detail.cancelled?t('取消中…'):t('取消任务')}</button>{(detail.kind.startsWith('watercolor')||detail.billable)&&<p className="muted">{t('已提交的云请求可能已计费，取消不会自动重发。')}</p>}</>}
        </>}
      </section></div>}
    </div></Modal>}
  </>;
}
