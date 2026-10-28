import {useEffect,useRef,useState} from 'react';
import {Play,Plus,Trash2} from 'lucide-react';
import {api} from '../api';
import {IS_BROWSER} from '../runtime';
import {bt,browserError} from '../browser/text';
import {videoAccept,videoDuration} from '../core/video';
import type {VideoAsset} from '../core/video';
import type {Job} from '../types';
import {listVideos,importVideoFiles,removeVideo,videoURL,videoFrameLease,videoFrames} from '../media/video-resources';
import VideoPlayer from './VideoPlayer';
import './video.css';

function VideoCard({asset,onOpen,onRemove,notify}:{asset:VideoAsset;onOpen:()=>void;onRemove:()=>void;notify:(text:string)=>void}){
  const [cover,setCover]=useState(''),[preview,setPreview]=useState(''),[hover,setHover]=useState(false),[index,setIndex]=useState(0),[manual,setManual]=useState(0),[reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{const query=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(query.matches);query.addEventListener('change',change);return()=>query.removeEventListener('change',change);},[]);
  useEffect(()=>{let active=true,release=()=>{};void videoURL(asset,'cover').then(value=>{if(!active){value.release();return;}release=value.release;setCover(value.url);}).catch(()=>{});return()=>{active=false;release();};},[asset.id,asset.cover_url]);
  useEffect(()=>{
    setPreview('');if((!hover||reduced)&&!manual)return;let active=true,release=()=>{};
    const timer=setTimeout(()=>{void videoFrameLease(asset.id,index).then(lease=>{if(!active){lease.release();return;}release=lease.release;void lease.ready.then(url=>{if(active)setPreview(url);}).catch(error=>{if(active&&error?.name!=='AbortError'&&manual)notify(browserError(error));});}).catch(error=>{if(active&&manual)notify(browserError(error));});},manual?0:1000);
    return()=>{active=false;clearTimeout(timer);release();};
  },[asset.id,index,hover,reduced,manual]);
  return <article className="video-card" onPointerLeave={()=>{setHover(false);setManual(0);}}><button className="video-poster" onDoubleClick={onOpen} onClick={e=>{if(e.detail===0)onOpen();}} aria-label={bt('双击播放视频：','Double-click to play video: ')+asset.file_name} onPointerEnter={e=>{if(e.pointerType==='mouse')setHover(true);}} onPointerMove={e=>{if(e.pointerType==='mouse'&&!reduced){const r=e.currentTarget.getBoundingClientRect();setIndex(Math.max(0,Math.min(7,Math.floor((e.clientX-r.left)/r.width*8))));}}}>
    {cover&&<img src={preview||cover} loading="lazy" alt={asset.file_name}/>}<span>{videoDuration(asset.metadata.duration)}</span>
  </button><h3 title={asset.file_name}>{asset.file_name}</h3><p className="muted">{asset.metadata.width} × {asset.metadata.height} · {asset.metadata.codec} · {(asset.file_size/1024**2).toFixed(1)} MiB</p><div className="button-row"><button onClick={onOpen}><Play size={14}/>{bt('播放','Play')}</button><button onClick={()=>{setIndex(v=>(v+1)%8);setManual(v=>v+1);}}>{bt('预览下一关键帧','Preview next keyframe')}</button><button onClick={onRemove} aria-label={bt('移出视频记录，保留原片','Remove video record, retain original')}><Trash2 size={14}/></button></div></article>;
}

export default function VideoPage({notify}:{notify:(text:string)=>void}){
  const [items,setItems]=useState<VideoAsset[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[selected,setSelected]=useState<VideoAsset>(),[job,setJob]=useState<Job>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[cache,setCache]=useState<{frames:{bytes:number;budget_bytes:number};proxies:{bytes:number;budget_bytes:number}}>(),input=useRef<HTMLInputElement>(null);
  useEffect(()=>{let active=true;void listVideos(page).then(result=>{if(active){setItems(result.items);setTotal(result.total);}}).catch(e=>{if(active)setError(browserError(e));});return()=>{active=false;};},[page,revision]);
  useEffect(()=>{if(!job||!['queued','running'].includes(job.status))return;let active=true;const timer=setInterval(()=>{void api<Job>('/jobs/'+job.id).then(result=>{if(active){setJob(result);if(!['queued','running'].includes(result.status))setRevision(n=>n+1);}}).catch(e=>{if(active)setError(browserError(e));});},800);return()=>{active=false;clearInterval(timer);};},[job?.id,job?.status]);
  async function pick(){if(IS_BROWSER){input.current?.click();return;}setBusy(true);try{const result=await api<{paths:string[]}>('/dialog/videos','POST');if(result.paths.length)setJob(await api<Job>('/videos/import','POST',{paths:result.paths}));}catch(e){setError(browserError(e));}finally{setBusy(false);}}
  useEffect(()=>{if(IS_BROWSER)return;let alive=true;void api<NonNullable<typeof cache>>('/videos/cache').then(value=>{if(alive)setCache(value);}).catch(e=>{if(alive)setError(browserError(e));});return()=>{alive=false;};},[revision]);
  async function clearCache(){setBusy(true);try{videoFrames.reset();if(!IS_BROWSER){const result=await api<{removed:number;skipped:number;cache:NonNullable<typeof cache>}>('/videos/cache','DELETE');setCache(result.cache);notify(bt(`已清理 ${result.removed} 个缓存，${result.skipped} 个最近使用的文件暂时保留。`,`Cleared ${result.removed} cached files; retained ${result.skipped} recently used files.`));}else notify(bt('已清理视频预览内存缓存。','Video preview memory cache cleared.'));}catch(e){setError(browserError(e));}finally{setBusy(false);}}
  const activeJob=!!job&&['queued','running'].includes(job.status);
  return <section className="video-library"><header className="video-page-heading"><div><h1>{bt('视频','Videos')}</h1><p className="muted">{bt('视频独立计数，不影响照片、快门次数或摄影报告。','Videos are counted separately from photographs, captures and photography reports.')}</p></div><button className="primary" disabled={busy||activeJob} onClick={()=>void pick()}><Plus size={16}/>{bt('导入视频','Import videos')}</button><input ref={input} type="file" accept={videoAccept} multiple hidden onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(!files.length)return;setBusy(true);void importVideoFiles(files).then(setJob).catch(err=>setError(browserError(err))).finally(()=>setBusy(false));}}/></header>
    {IS_BROWSER&&<p className="muted">{bt('浏览器单文件上限 256 MiB；格式支持取决于浏览器。更大的文件与 HEVC 兼容转码可使用 Windows 桌面版。','Browser limit: 256 MiB per file; format support depends on the browser. Use Windows desktop for larger files and HEVC compatibility conversion.')}</p>}
    <details><summary>{bt('视频缓存','Video cache')}</summary>{cache&&<p>{bt('关键帧','Keyframes')} {(cache.frames.bytes/1024**2).toFixed(1)} / {cache.frames.budget_bytes/1024**2} MiB · {bt('代理','Proxies')} {(cache.proxies.bytes/1024**2).toFixed(1)} / {cache.proxies.budget_bytes/1024**2} MiB</p>}<p className="muted">{bt('只清理派生预览与兼容副本；保留原片和库封面。最近两分钟内使用的桌面缓存暂不清理。','Clears derived previews and compatibility copies; retains originals and library covers. Desktop cache used within the last two minutes is retained.')}</p><button disabled={busy||activeJob||!!selected} onClick={()=>void clearCache()}>{bt('清理未使用的视频缓存','Clear unused video cache')}</button></details>
    {error&&<p role="alert" className="error-box">{error}</p>}{job&&<div role="status"><p>{bt('视频导入：','Video import: ')}{job.processed}/{job.total} · {bt('成功','Imported')} {job.success} · {bt('跳过','Skipped')} {job.skipped} · {bt('失败','Failed')} {job.failed}</p>{activeJob&&<button onClick={()=>void api('/jobs/'+job.id+'/cancel','POST').catch(e=>setError(browserError(e)))}>{bt('取消导入','Cancel import')}</button>}{job.error&&<p>{browserError(job.error)}</p>}{job.errors?.length>0&&<details><summary>{bt('导入错误','Import errors')}</summary>{job.errors.map((text,i)=><p key={i}>{browserError(text)}</p>)}</details>}</div>}
    <div className="video-grid">{items.map(asset=><VideoCard key={asset.id} asset={asset} notify={notify} onOpen={()=>setSelected(asset)} onRemove={()=>{if(confirm(bt('移出此视频记录？原片和已生成的副本将保留。','Remove this video record? The original and generated copies will be retained.')))void removeVideo(asset.id).then(()=>setRevision(n=>n+1)).catch(e=>setError(browserError(e)));}}/>)}</div>
    {!items.length&&<p>{bt('暂无视频。导入后可双击播放，悬停查看关键帧。','No videos yet. Import videos, then double-click to play or hover to preview keyframes.')}</p>}
    <nav className="pager" aria-label={bt('视频分页','Video pages')}><span>{total} {bt('个视频','videos')}</span><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>{bt('上一页','Previous')}</button><span>{page}/{Math.max(1,Math.ceil(total/60))}</span><button disabled={page*60>=total} onClick={()=>setPage(p=>p+1)}>{bt('下一页','Next')}</button></nav>
    {selected&&<VideoPlayer key={selected.id} asset={selected} onClose={()=>setSelected(undefined)}/>}
  </section>;
}
