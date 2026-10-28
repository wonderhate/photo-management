import {useEffect,useState} from 'react';
import {api,message} from '../api';
import {bt} from '../browser/text';
import {IS_BROWSER} from '../runtime';
import type {Job} from '../types';
import type {SourceScanState} from '../browser/source-monitor';

type Status={paths:string[];sources?:SourceScanState[];available?:{id:string;name:string}[];job:Job|null;interval_seconds?:number;event_hints?:boolean};
export default function SourceScanSettings({notify}:{notify:(text:string)=>void}){
  const [open,setOpen]=useState(false),[status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!open)return;const abort=new AbortController();const load=()=>void api<Status>('/library/scan','GET',undefined,abort.signal).then(setStatus).catch(e=>{if(!abort.signal.aborted)notify(message(e));});load();const timer=setInterval(load,3000);return()=>{clearInterval(timer);abort.abort();};},[open]);
  async function change(method:string,value?:unknown){setBusy(true);try{await api('/library/scan'+(method==='POST'?'?force=true':''),method,value);setStatus(await api<Status>('/library/scan'));}catch(e){notify(message(e));}finally{setBusy(false);}}
  const label=(value:string)=>({connected:bt('已连接','Connected'),disconnected:bt('目录断开，记录保留','Disconnected; records retained'),permission:bt('需要重新授权','Permission required'),partial:bt('部分目录暂不可读','Partially unavailable'),excluded:bt('托管目录不扫描','Managed directory excluded')}[value]||value);
  return <section className="settings-card"><details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{bt('原片增量扫描与状态','Original source scans and status')}</summary>{open&&<>
    <p className="muted">{IS_BROWSER?bt('仅在此页面活跃且目录已授权时每五分钟扫描。关闭页面后不在后台监听；不会自动申请权限。RAW 来源登记不会自动加入扫描。','Scans every five minutes while this page is active and access is granted. No background monitoring after closing, or automatic permission prompts. RAW registration does not enable scanning.'):bt('合并 Windows 目录变化通知，并每五分钟补扫。新文件按内容哈希登记；断盘不会删除记录。','Coalesces Windows directory change notifications and checks every five minutes. New files are indexed by content hash; disconnecting a drive never deletes records.')}</p>
    <p className="muted">{bt('已移出记录的内容与路径不会自动导回。原路径内容改变时保留旧记录，请明确移出后再导入；重新同步会完整核验内容。','Removed content and paths are not automatically reimported. Changed bytes at an existing path retain the old record; explicitly remove it before importing a replacement. Sync now performs full content checks.')}</p>
    {IS_BROWSER&&status?.available?.map(source=><label key={source.id} className="row"><input type="checkbox" checked={status.paths.includes('source:'+source.id)} disabled={busy} onChange={e=>void change('PUT',{source_id:source.id,enabled:e.target.checked})}/>{source.name}</label>)}
    {(status?.sources||[]).map(source=><div className="plugin-row" key={source.source_id||source.path}><div style={{overflowWrap:'anywhere'}}><b>{source.path}</b><p>{label(source.state)}</p><small>{bt(`文件 ${source.files} · 缺失 ${source.missing} · 内容变化 ${source.changed} · 已移出 ${source.removed}`,`Files ${source.files} · Missing ${source.missing} · Changed ${source.changed} · Removed ${source.removed}`)}</small></div></div>)}
    {!!status?.job&&<p role="status">{bt('最近扫描：','Latest scan: ')}{bt(({queued:'等待',running:'进行中',completed:'完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'} as Record<string,string>)[status.job.status]||status.job.status,status.job.status)} · {status.job.processed}/{status.job.total}</p>}
    <button disabled={busy||!status?.paths?.length||!!status.job&&['queued','running'].includes(status.job.status)} onClick={()=>void change('POST')}>{bt('立即同步并核验原片','Sync and verify originals now')}</button>
  </>}</details></section>;
}
