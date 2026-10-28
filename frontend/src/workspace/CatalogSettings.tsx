import {useEffect,useState} from 'react';
import {Database,FolderOpen,Plus,RefreshCw} from 'lucide-react';
import {api,message} from '../api';
import {t} from '../i18n';
import {flushPreferenceWrites} from '../core/preference-lifecycle';

type Catalog={path:string;name:string;library_id:string|null;photo_count:number;schema_version:number;selection_id?:string};
type Status={current:Catalog;recent:Catalog[];pending:Catalog|null;locked:boolean;migration_pending:boolean;managed_restart:boolean;switching:boolean;error:string|null};
function validCatalog(value:unknown):value is Catalog{
  if(!value||typeof value!=='object')return false;const item=value as Catalog;
  return typeof item.path==='string'&&typeof item.name==='string'&&(item.library_id===null||typeof item.library_id==='string')&&Number.isSafeInteger(item.photo_count)&&item.photo_count>=0&&Number.isSafeInteger(item.schema_version)&&item.schema_version>=0;
}
function readStatus(value:unknown):Status{
  const item=value as Status;
  if(!item||!validCatalog(item.current)||!item.current.library_id||!Array.isArray(item.recent)||item.recent.length>20||!item.recent.every(validCatalog)||item.pending!==null&&(!validCatalog(item.pending)||typeof item.pending.selection_id!=='string')||['locked','migration_pending','managed_restart','switching'].some(key=>typeof item[key as keyof Status]!=='boolean')||item.error!==null&&typeof item.error!=='string')throw new Error('图库状态格式不匹配，请刷新后重试');
  return item;
}
export default function CatalogSettings({notify}:{notify:(value:string)=>void}){
  const [status,setStatus]=useState<Status|null>(null),[path,setPath]=useState(''),[preview,setPreview]=useState<Catalog|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[restarting,setRestarting]=useState(false);
  useEffect(()=>{let alive=true;void api<Status>('/workspace/catalogs').then(value=>{const next=readStatus(value);if(alive)setStatus(next);}).catch(reason=>{if(alive)setError(message(reason));});return()=>{alive=false;};},[]);
  async function perform(run:()=>Promise<void>){setBusy(true);setError('');try{await run();}catch(reason){const text=message(reason);setError(text);notify(text);}finally{setBusy(false);}}
  async function choose(){await perform(async()=>{const selection=await api<{paths:string[]}>('/dialog/catalog','POST');if(selection.paths[0]){setPath(selection.paths[0]);setPreview(null);}});}
  async function refresh(){await perform(async()=>setStatus(readStatus(await api('/workspace/catalogs'))));}
  async function inspect(){if(!status)return;await perform(async()=>{const value=await api<Catalog>('/workspace/catalogs/inspect','POST',{library_id:status.current.library_id,path});if(!validCatalog(value))throw new Error('图库状态格式不匹配，请刷新后重试');setPreview(value);});}
  async function select(target=path,create=false){if(!status)return;await perform(async()=>{await flushPreferenceWrites();setStatus(readStatus(await api<Status>('/workspace/catalogs/select','POST',{library_id:status.current.library_id,path:target,create})));setPreview(null);notify(t('图库选择已保存'));});}
  async function cancel(){if(!status)return;await perform(async()=>setStatus(readStatus(await api<Status>('/workspace/catalogs/cancel','POST',{library_id:status.current.library_id}))));}
  async function activate(){if(!status?.pending)return;await perform(async()=>{await flushPreferenceWrites();await api('/workspace/catalogs/activate','POST',{library_id:status.current.library_id,selection_id:status.pending!.selection_id});setRestarting(true);});}
  return <section className="settings-card catalog-settings"><details><summary><Database size={20}/><span>{t('图库选择与最近图库')}</span></summary>
    {error&&<p className="error-box" role="alert">{error}</p>}{status?.error&&<p className="error-box">{message(status.error)}</p>}
    <button className="quiet" disabled={busy||restarting} onClick={()=>void refresh()}><RefreshCw size={15}/>{t('刷新图库列表')}</button>
    {!status?(error?null:<p role="status">{t('正在读取…')}</p>):<>
      <p>{t('当前图库')} · {status.current.name}</p><p className="muted catalog-path">{status.current.path}</p>
      <p className="muted">{t('打开已有图库或新建独立图库；影集、作品和原片保留在各自位置。切换前请保存当前编辑。')}</p>
      {status.locked&&<p>{t('图库由启动配置指定，不能在此切换')}</p>}{status.migration_pending&&<p>{t('请先取消待生效的目录迁移，再选择图库')}</p>}
      <fieldset disabled={busy||restarting||status.locked||status.migration_pending}>
        <label>{t('目标图库目录')}<div className="row"><input aria-label={t('目标图库目录')} value={path} onChange={event=>{setPath(event.target.value);setPreview(null);}}/><button onClick={()=>void choose()} aria-label={t('选择图库目录')}><FolderOpen size={16}/>{t('选择目录')}</button></div></label>
        <div className="button-row"><button disabled={!path.trim()} onClick={()=>void inspect()}>{t('检查已有图库')}</button><button disabled={!path.trim()} onClick={()=>void select(path,true)}><Plus size={16}/>{t('在空目录新建图库')}</button></div>
        {preview&&<div className="catalog-preview"><b>{preview.name}</b><p>{t('照片记录 {0}',{0:preview.photo_count})}</p><p className="muted">{preview.library_id||t('旧版图库，将在打开时安全升级')}</p><button className="primary" onClick={()=>void select(preview.path)}>{t('选择此图库')}</button></div>}
        {status.recent.length>0&&<div className="catalog-recent"><h4>{t('最近图库')}</h4>{status.recent.map(item=><div key={item.path}><span><b>{item.name}</b><small className="muted catalog-path">{item.path}</small></span><button disabled={item.path===status.current.path} onClick={()=>void select(item.path)}>{item.path===status.current.path?t('当前图库'):t('选择')}</button></div>)}</div>}
      </fieldset>
      {status.pending&&<div className="catalog-pending"><b>{t('待打开图库')} · {status.pending.name}</b><p className="muted catalog-path">{status.pending.path}</p><p>{t('当前仍使用原图库，切换不复制或删除原图库。')}</p><div className="button-row">{status.managed_restart?<button className="primary" disabled={busy||restarting} onClick={()=>void activate()}><RefreshCw size={16}/>{t('切换并重新打开')}</button>:<p>{t('请关闭并重新启动本机服务，图库选择将在下次启动生效。')}</p>}<button disabled={busy||restarting} onClick={()=>void cancel()}>{t('取消图库切换')}</button></div></div>}
      {restarting&&<p role="status">{t('正在切换图库，请等待重新打开')}</p>}
    </>}
  </details></section>;
}
