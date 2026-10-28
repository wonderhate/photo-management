import {publishKey,publishName,derivedPublishChoices} from './publish-sources';
import type {PublishKind,PublishChoice} from './publish-sources';
import MediaImage from '../media/MediaImage';
import {useEffect,useRef,useState} from 'react';
import {ChevronUp,ChevronDown,X} from 'lucide-react';
import {Modal} from '../components';
import {api} from '../api';
import type {Photo} from '../types';
import {current} from './storage';
import {albumMemberIds} from './album-members';
import {bt,browserError} from './text';
import {exportPortfolio} from './portfolio-export';
import type {PublishSelection} from './portfolio-export';

export default function PublishPortfolio({onClose}:{onClose:()=>void}){
  const [title,setTitle]=useState('光影集 / Lumina'),[intro,setIntro]=useState(bt('追光，也收藏时光。','Follow the light. Keep the moment.'));
  const [selected,setSelected]=useState<PublishSelection[]>([]),[albumIds,setAlbumIds]=useState<string[]>([]),[choices,setChoices]=useState<PublishChoice[]>([]),[search,setSearch]=useState(''),[page,setPage]=useState(1),[total,setTotal]=useState(0);
  const [edge,setEdge]=useState(2048),[quality,setQuality]=useState(85),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState(''),[result,setResult]=useState('');
  const [kind,setKind]=useState<PublishKind>('photo');
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>{
    let alive=true;setChoices([]);setError('');
    const timer=setTimeout(()=>{void(async()=>{
      const result=kind==='photo'?await api<{photos:Photo[];total:number}>('/photos?page_size=40&page='+page+'&search='+encodeURIComponent(search)):derivedPublishChoices(kind,search,page);
      if(!alive)return;
      setChoices('photos' in result?result.photos.map(v=>({id:v.id,kind:'photo',name:v.file_name,thumbnail_url:v.thumbnail_url,missing:v.missing})):result.items);setTotal(result.total);
    })().catch(e=>{if(alive)setError(browserError(e));});},150);
    return()=>{alive=false;clearTimeout(timer)};
  },[search,page,kind]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{if(!busy)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[busy]);
  function toggle(p:PublishChoice){setResult('');setSelected(s=>s.some(v=>publishKey(v)===publishKey(p))?s.filter(v=>publishKey(v)!==publishKey(p)):[...s,{id:p.id,kind:p.kind,title:bt('作品','Frame')+' '+(s.length+1),description:'',tags:[]}]);}
  function update(id:string,change:Partial<PublishSelection>){setResult('');setSelected(s=>s.map(p=>publishKey(p)===id?{...p,...change}:p));}
  function move(i:number,step:number){setSelected(s=>{const a=[...s];[a[i],a[i+step]]=[a[i+step],a[i]];return a;});}
  async function run(){setBusy(true);setError('');setResult('');setProgress(0);const c=new AbortController();controller.current=c;try{setResult(await exportPortfolio({title,intro,photos:selected.map(p=>({...p,tags:p.tags.map(t=>t.trim()).filter(Boolean)})),albumIds,edge,quality},c.signal,done=>setProgress(done)));}catch(e){setError(browserError(e));}finally{setBusy(false);controller.current=null;}}
  return <Modal title={bt('导出公开作品','Export public portfolio')} onClose={()=>{if(!busy)onClose()}} wide>
    <p>{bt('只导出勾选的照片或派生作品。你填写的标题、说明、标签与勾选的相册名称将公开。展示副本不携带原文件名、EXIF、GPS 或本地路径。','Only checked photographs or derived works are exported. Your captions, tags and selected collection names will be public. Display copies exclude original filenames, EXIF, GPS and local paths.')}</p>
    <fieldset disabled={busy} className="publish-fields"><legend>{bt('站点介绍','Site introduction')}</legend><label>{bt('网站名称','Site title')}<input maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>{bt('首页介绍','Homepage introduction')}<textarea maxLength={2000} value={intro} onChange={e=>setIntro(e.target.value)}/></label>
    <label>{bt('作品来源','Work source')}<select aria-label={bt('作品来源','Work source')} value={kind} onChange={e=>{setKind(e.target.value as PublishKind);setPage(1);}}><option value="photo">{bt('照片与暗房副本','Photos and edited copies')}</option><option value="watercolor">{bt('水彩作品','Watercolors')}</option><option value="collage-output">{bt('拼图成品','Collage outputs')}</option><option value="split-panel">{bt('切图面板','Split panels')}</option></select></label>
    <label>{bt('搜索待选照片','Search photographs to select')}<input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label>
    <div className="curation-choices">{choices.map(p=><button key={publishKey(p)} type="button" aria-pressed={selected.some(s=>publishKey(s)===publishKey(p))} disabled={!!p.missing||(!selected.some(s=>publishKey(s)===publishKey(p))&&selected.length>=2000)} onClick={()=>toggle(p)}><>{p.thumbnail_url&&<MediaImage src={p.thumbnail_url} alt=""/>}</><span>{p.name}{p.missing?' — '+bt('需要重新授权原片','Reconnect originals'):''}</span></button>)}</div>
    <div className="button-row"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>{bt('上一页','Previous page')}</button><span>{page} / {Math.max(1,Math.ceil(total/40))}</span><button disabled={page*40>=total} onClick={()=>setPage(p=>p+1)}>{bt('下一页','Next page')}</button></div>
    <h3>{bt('公开顺序与文字','Public order and captions')} · {selected.length}</h3><p>{bt('前 12 张用于首页封面及精选作品。','The first 12 photographs appear on the cover and selected frames.')}</p>
    <div className="publish-selection">{selected.map((p,i)=><section key={publishKey(p)}><header><strong>{i+1}. {publishName(p)}</strong><button aria-label={bt('上移作品','Move photograph up')} disabled={!i} onClick={()=>move(i,-1)}><ChevronUp size={16}/></button><button aria-label={bt('下移作品','Move photograph down')} disabled={i===selected.length-1} onClick={()=>move(i,1)}><ChevronDown size={16}/></button><button aria-label={bt('移除公开作品','Remove public photograph')} onClick={()=>setSelected(s=>s.filter(v=>publishKey(v)!==publishKey(p)))}><X size={16}/></button></header><label>{bt('作品标题','Photograph title')}<input maxLength={160} value={p.title} onChange={e=>update(publishKey(p),{title:e.target.value})}/></label><label>{bt('作品说明','Photograph description')}<textarea maxLength={2000} value={p.description} onChange={e=>update(publishKey(p),{description:e.target.value})}/></label><label>{bt('公开标签（逗号分隔）','Public tags (comma separated)')}<input value={p.tags.join(',')} onChange={e=>update(publishKey(p),{tags:e.target.value.split(/[,，]/)})}/></label></section>)}</div>
    <h3>{bt('公开相册（仅包含已勾选照片）','Public collections (checked photographs only)')}</h3>{current().albums.map(a=><label key={a.id} className="publish-album"><input type="checkbox" checked={albumIds.includes(a.id)} onChange={e=>setAlbumIds(s=>e.target.checked?[...s,a.id]:s.filter(id=>id!==a.id))}/>{a.name} · {albumMemberIds(a,current().photos).filter(id=>selected.some(p=>(!p.kind||p.kind==='photo')&&p.id===id)).length}</label>)}
    <div className="button-row"><label>{bt('展示图最长边','Display image long edge')}<select value={edge} onChange={e=>setEdge(Number(e.target.value))}>{[1600,2048,2560,3840].map(n=><option key={n} value={n}>{n} px</option>)}</select></label><label>{bt('JPG 质量','JPEG quality')}<input type="number" min={60} max={95} value={quality} onChange={e=>setQuality(Number(e.target.value))}/></label></div></fieldset>
    {error&&<p role="alert" className="error-box">{error}</p>}{busy&&<p role="status">{bt('正在生成展示副本','Preparing display copies')} {progress} / {selected.length}</p>}
    {result&&<div role="status"><strong>{bt('公开内容已导出：','Public content exported: ')}{result}</strong><p>{bt('将下面路径替换为导出文件夹的完整路径，在项目根目录运行。之后上传 frontend/dist-showcase 的内容。尚未发布到网络。','Replace the path below with the full exported folder path and run in the project root. Upload frontend/dist-showcase afterwards. Nothing has been published online.')}</p><code>npm run build:showcase -- --content "{result}"</code></div>}
    <div className="button-row"><button className="primary" disabled={busy||!selected.length||!title.trim()} onClick={()=>void run()}>{bt('选择目录并导出公开内容','Choose folder and export public content')}</button>{busy&&<button onClick={()=>controller.current?.abort()}>{bt('取消导出','Cancel export')}</button>}</div>
  </Modal>;
}
