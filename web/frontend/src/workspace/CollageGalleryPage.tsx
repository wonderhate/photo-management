import {useEffect,useRef,useState} from 'react';
import {Download,Grid2X2,ImageOff,Plus,Trash2} from 'lucide-react';
import {Empty,Modal} from '../components';
import {editorServices} from '../core/editor-adapter';
import {collageDocumentSources} from '../core/collage-project';
import type {CollageProject,CollageProjectQuery} from '../core/collage-project';
import {collageOutputName} from '../core/collage-output';
import type {CollageOutput} from '../core/collage-output';
import {downloadBlob} from '../browser/local-file-service';
import {bt,browserError} from '../browser/text';
import {getLocale} from '../i18n';
import CollageSourceDetails from './CollageSourceDetails';
import './collage-gallery.css';

type Props={revision:number;onCreate:()=>void;onOpenProject:(project:CollageProject)=>void;onOpenOutput:(output:CollageOutput)=>void};
type Listing={kind:'projects';items:CollageProject[];total:number}|{kind:'outputs';items:CollageOutput[];total:number};
const date=(value:string)=>new Date(value).toLocaleString(getLocale(),{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});

function OutputPicture({output}:{output:CollageOutput}){
  const element=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[url,setURL]=useState(''),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{if(!element.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});observer.observe(element.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    if(!visible)return;let alive=true,source='';setFailed(false);
    void editorServices().then(s=>s.library.collageOutputImage(output.id)).then(blob=>{if(alive){source=URL.createObjectURL(blob);setURL(source);}}).catch(()=>{if(alive)setFailed(true);});
    return()=>{alive=false;URL.revokeObjectURL(source);};
  },[output.id,visible,retry]);
  return <div className="collage-gallery-picture" ref={element}>{url?<img src={url} alt={output.project.name} loading="lazy"/>:failed?<div><ImageOff size={28} aria-hidden="true"/><p>{bt('作品预览不可用','Output preview unavailable')}</p><button onClick={()=>setRetry(n=>n+1)}>{bt('重试预览','Retry preview')}</button></div>:<span role="status">{bt('正在读取预览…','Loading preview…')}</span>}</div>;
}

export default function CollageGalleryPage({revision,onCreate,onOpenProject,onOpenOutput}:Props){
  const [tab,setTab]=useState<'projects'|'outputs'>('projects'),[page,setPage]=useState(1),[search,setSearch]=useState(''),[sort,setSort]=useState<CollageProjectQuery['sort']>('updated');
  const [listing,setListing]=useState<Listing>({kind:'projects',items:[],total:0}),[loading,setLoading]=useState(true),[working,setWorking]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[details,setDetails]=useState<CollageProject|null>(null);
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let current=true;setLoading(true);setError('');
    const timer=setTimeout(()=>{
      void editorServices().then(async s=>tab==='projects'?{kind:'projects' as const,...await s.library.listCollages(page,{search:search.trim(),sort,direction:'desc'})}:{kind:'outputs' as const,...await s.library.listCollageOutputs(page)})
        .then(result=>{if(current){const last=Math.max(1,Math.ceil(result.total/20));if(page>last)setPage(last);else setListing(result);}})
        .catch(e=>{if(current)setError(browserError(e));})
        .finally(()=>{if(current)setLoading(false);});
    },150);
    return()=>{current=false;clearTimeout(timer);};
  },[tab,page,search,sort,revision,refresh]);
  async function act(action:()=>Promise<void>){setWorking(true);setError('');try{await action();}catch(e){if(alive.current)setError(browserError(e));}finally{if(alive.current)setWorking(false);}}
  function changeTab(next:typeof tab){setLoading(true);setTab(next);setPage(1);}
  function removeProject(project:CollageProject){if(!confirm(bt('删除这条拼图工程记录？原照片和已保存的拼图作品会保留。','Delete this collage project record? Original photos and saved collage outputs are retained.')))return;void act(async()=>{await(await editorServices()).library.removeCollage(project);if(alive.current)setRefresh(n=>n+1);});}
  function removeOutput(output:CollageOutput){if(!confirm(bt('删除这条拼图作品记录？原照片、拼图工程和已下载文件会保留。','Delete this collage output record? Original photos, projects and downloaded files are retained.')))return;void act(async()=>{await(await editorServices()).library.removeCollageOutput(output.id);if(alive.current)setRefresh(n=>n+1);});}
  const busy=loading||working,valid=listing.kind===tab&&!loading&&!error,pages=Math.max(1,Math.ceil(listing.total/20));
  return <section className="collage-gallery-page">
    <div className="gallery-heading"><div><h1>{bt('拼图库','Collage library')}</h1><p>{bt('用已导入的照片创作拼图，在这里继续编辑工程、查看和下载作品。','Create collages from imported photos. Continue editing projects, view and download finished outputs here.')}</p></div><button className="primary" disabled={working} onClick={onCreate}><Plus size={16} aria-hidden="true"/>{bt('新建拼图','New collage')}</button></div>
    <div className="draft-status-tabs" role="group" aria-label={bt('拼图库内容','Collage library content')}><button className={tab==='projects'?'active':''} aria-pressed={tab==='projects'} disabled={working} onClick={()=>changeTab('projects')}>{bt('拼图工程','Collage projects')}</button><button className={tab==='outputs'?'active':''} aria-pressed={tab==='outputs'} disabled={working} onClick={()=>changeTab('outputs')}>{bt('已保存作品','Saved outputs')}</button></div>
    {tab==='projects'?<div className="library-toolbar collage-gallery-toolbar"><label>{bt('搜索拼图工程','Search collage projects')}<input type="search" maxLength={120} aria-label={bt('搜索拼图工程','Search collage projects')} placeholder={bt('输入工程名称','Enter a project name')} disabled={working} value={search} onChange={e=>{setLoading(true);setSearch(e.target.value);setPage(1);}}/></label><label>{bt('排序','Sort')}<select value={sort} disabled={working} aria-label={bt('拼图工程排序','Collage project sort')} onChange={e=>{setSort(e.target.value as typeof sort);setPage(1);}}><option value="updated">{bt('最近编辑','Recently edited')}</option><option value="name">{bt('工程名称','Project name')}</option></select></label></div>:<p className="muted">{bt('这里展示保存时的成片，按保存时间排列。恢复布局会新建副本，保留原作品。','These outputs show the saved version, ordered by save time. Restoring a layout creates a copy and preserves the saved output.')}</p>}
    {error&&<div className="error-box" role="alert">{error}<button onClick={()=>setRefresh(n=>n+1)}>{bt('重试','Retry')}</button></div>}
    {loading&&<p role="status">{bt('正在读取拼图库…','Loading the collage library…')}</p>}
    {valid&&listing.kind==='projects'&&<div className="collage-project-gallery" aria-busy={working}>{listing.items.map(project=><article key={project.id} className="draft-card collage-project-card"><div className="collage-project-summary"><Grid2X2 size={30} strokeWidth={1.4} aria-hidden="true"/><div><h2>{project.name}</h2><p>{project.document.kind==='batch'?bt(`批量 · ${project.document.value.pages.length} 页`,`Batch · ${project.document.value.pages.length} pages`):bt('单页拼图','Single collage')} · {collageDocumentSources(project.document).length} {bt('张照片',collageDocumentSources(project.document).length===1?'photo':'photos')} · {bt('版本','Revision')} {project.revision}</p><time dateTime={project.updated_at}>{date(project.updated_at)}</time></div></div><div className="button-row"><button disabled={working} className="primary" onClick={()=>onOpenProject(project)}>{bt('继续编辑','Continue editing')}</button><button disabled={working} onClick={()=>setDetails(project)}>{bt('查看来源','View sources')}</button><button className="icon danger" disabled={working} aria-label={bt('删除工程 ','Delete project ')+project.name} onClick={()=>removeProject(project)}><Trash2 size={16} aria-hidden="true"/></button></div></article>)}</div>}
    {valid&&listing.kind==='outputs'&&<div className="draft-grid" aria-busy={working}>{listing.items.map(output=><article className="draft-card collage-output-card" key={output.id}><OutputPicture output={output}/><div className="draft-card-info"><h2>{output.project.name}</h2><p className="draft-meta">{output.width} × {output.height} · {output.format.toUpperCase()} · {bt(`第 ${output.page+1} 页`,`Page ${output.page+1}`)}</p><time dateTime={output.created_at}>{date(output.created_at)}</time><div className="button-row"><button disabled={working} onClick={()=>onOpenOutput(output)}>{bt('恢复布局副本','Restore layout copy')}</button><button disabled={working} onClick={()=>void act(async()=>{const blob=await(await editorServices()).library.collageOutputImage(output.id);if(alive.current)await downloadBlob(blob,collageOutputName(output));})}><Download size={15} aria-hidden="true"/>{bt('下载作品','Download output')}</button><button disabled={working} className="icon danger" aria-label={bt('删除作品 ','Delete output ')+output.project.name} onClick={()=>removeOutput(output)}><Trash2 size={16} aria-hidden="true"/></button></div></div></article>)}</div>}
    {valid&&!listing.items.length&&<Empty title={tab==='projects'?(search.trim()?bt('没有匹配的拼图工程','No matching collage projects'):bt('还没有拼图工程','No collage projects yet')):bt('还没有保存的拼图作品','No saved collage outputs yet')} action={<button className="primary" onClick={search.trim()&&tab==='projects'?()=>{setSearch('');setPage(1);}:onCreate}>{search.trim()&&tab==='projects'?bt('清除搜索','Clear search'):bt('新建拼图','New collage')}</button>}>{tab==='projects'?bt('在照片拼图中点击“保存到图库”，工程就会出现在这里，可以随时继续编辑。','Choose “Save to library” in the collage editor to keep a project here and continue editing later.'):bt('保存工程后，再点击“保存拼图作品”，成片就会出现在这里。','After saving a project, choose “Save collage output” to keep the finished image here.')}</Empty>}
    {valid&&listing.total>0&&<div className="draft-pagination"><span role="status">{bt(`共 ${listing.total} 项 · 第 ${page} / ${pages} 页`,`${listing.total} items · Page ${page} / ${pages}`)}</span><button disabled={busy||page<=1} onClick={()=>setPage(n=>n-1)}>{bt('上一页','Previous')}</button><button disabled={busy||page>=pages} onClick={()=>setPage(n=>n+1)}>{bt('下一页','Next')}</button></div>}
    {details&&<Modal wide title={bt('拼图工程来源','Collage project sources')} onClose={()=>setDetails(null)}><CollageSourceDetails record={details}/></Modal>}
  </section>;
}
