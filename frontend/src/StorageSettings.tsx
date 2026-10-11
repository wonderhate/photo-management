import {useEffect,useState} from 'react';
import {Database,Download,FolderOpen} from 'lucide-react';
import {api,message} from './api';
import type {ExportResult} from './types';

interface Paths {data_dir:string;models_dir:string;exports_dir:string;scan_paths:string[]}
interface PathStatus {current:Paths;pending:Paths|null;locked_fields:string[];error:string|null}
const fields=[['data_dir','照片库（数据库与缓存）'],['models_dir','AI 模型缓存目录'],['exports_dir','水印导出目录']] as const;

export default function StorageSettings({notify,onScan}:{notify:(text:string)=>void;onScan:()=>void}){
  const [status,setStatus]=useState<PathStatus|null>(null),[paths,setPaths]=useState<Paths|null>(null);
  const [scans,setScans]=useState(''),[busy,setBusy]=useState(false),[backup,setBackup]=useState<ExportResult|null>(null);
  function load(value:PathStatus){setStatus(value);setPaths(value.pending||value.current);setScans((value.pending||value.current).scan_paths.join('\n'))}
  useEffect(()=>{api<PathStatus>('/library/paths').then(load).catch(e=>notify(message(e)))},[]);
  async function pick(key:keyof Paths){
    try{const result=await api<{paths:string[]}>('/dialog/directory','POST');const path=result.paths[0];if(!path)return;
      if(key==='scan_paths')setScans(value=>value.trim()?value.trim()+'\n'+path:path);
      else setPaths(value=>value?{...value,[key]:path}:value);
    }catch(e){notify(message(e))}
  }
  async function save(){
    if(!paths)return;setBusy(true);
    try{const result=await api<PathStatus>('/library/paths','PUT',{...paths,scan_paths:scans.split(/\r?\n/).map(value=>value.trim()).filter(Boolean)});load(result);notify(result.pending?'目录修改已保存，重启程序后生效':'目录设置已保存')}
    catch(e){notify(message(e))}finally{setBusy(false)}
  }
  async function cancel(){setBusy(true);try{load(await api<PathStatus>('/library/paths','DELETE'));notify('已取消待生效的目录修改')}catch(e){notify(message(e))}finally{setBusy(false)}}
  return <section className="settings-card"><header><Database size={20}/><div><h3 style={{color:'CanvasText'}}>照片库与存储</h3><p style={{color:'CanvasText'}}>自定义照片目录、照片库和导出位置，原始照片保留在原位置。</p></div></header>
    {!status||!paths?<p>正在读取目录设置…</p>:<>
      {status.error&&<p className="error-box">{status.error}</p>}
      {status.pending&&<p role="status">目录修改已保存，重启程序后生效。当前仍使用原目录。</p>}
      <fieldset disabled={busy} style={{border:0,padding:0,margin:0}}><div className="two-columns">
        {fields.map(([key,label])=><label key={key} style={{minWidth:0,color:'CanvasText'}}>{label}<div className="row"><input aria-label={label} value={paths[key]} disabled={status.locked_fields.includes(key)} onChange={e=>setPaths({...paths,[key]:e.target.value})} style={{minWidth:0,flex:1}}/><button aria-label={'选择'+label} disabled={status.locked_fields.includes(key)} onClick={()=>void pick(key)}><FolderOpen size={16}/>选择目录</button></div><small className="muted" style={{overflowWrap:'anywhere',color:'CanvasText'}}>当前使用：{status.current[key]}{status.locked_fields.includes(key)?'（由启动配置指定）':''}</small></label>)}
      </div><label style={{color:'CanvasText'}}>自动扫描照片目录（每行一个）<textarea aria-label="自动扫描照片目录" value={scans} rows={3} placeholder="填写照片所在文件夹的完整路径" onChange={e=>setScans(e.target.value)}/></label><button onClick={()=>void pick('scan_paths')}><FolderOpen size={16}/>添加扫描目录</button>
      <p className="muted" style={{color:'CanvasText'}}>请填写本机完整目录路径。新照片库须为空目录；下次启动时复制当前照片库、影集、草稿和派生缓存，旧库保留。重启前请关闭其他光影集实例。自动扫描目录可以设置多个，不会搬动原图。</p>
      <p className="muted" style={{color:'CanvasText'}}>导出目录用于后续导出，历史文件保留原位置。更改 AI 缓存目录后使用目标目录的模型；新目录为空时需要重新准备模型，原缓存保留。</p>
      <div className="button-row"><button className="primary" onClick={()=>void save()}>{busy?'正在保存…':'保存目录设置'}</button>{status.pending&&<button onClick={()=>void cancel()}>取消待生效修改</button>}</div></fieldset>
      {!!status.current.scan_paths.length&&<button onClick={onScan}><FolderOpen size={16}/>立即同步当前目录</button>}
    </>}
    <button onClick={async()=>{try{setBackup(await api<ExportResult>('/backup','POST'));notify('数据库一致性备份已生成')}catch(e){notify(message(e))}}}><Download size={16}/>备份数据库</button>{backup&&<a className="download-result" href={backup.url} download>{backup.file_name}</a>}
  </section>;
}
