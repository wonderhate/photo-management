import {useContext,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {api,message,query} from '../api';
import {bt} from '../browser/text';
import {IS_BROWSER} from '../runtime';
import {Modal} from '../components';
import MediaImage from '../media/MediaImage';
import type {Job,Photo} from '../types';
import LutContextMenu from './LutContextMenu';
import './similarity.css';
import {PhotoSimilarityContext} from './PhotoSimilarityContext';
import type {SimilarityActions as Actions,SimilarityMode as Mode} from './PhotoSimilarityContext';

type Candidate=Photo&{appearance_distance?:number};
type Result={mode:Mode;candidates:Candidate[];low_information?:boolean;verified_with_clip?:boolean;model?:string;model_revision?:string};
type Analysis={indexed:boolean;palette:string[];contrast?:number;photo_id?:string};
const active=(job:Job|null)=>!!job&&['queued','running'].includes(job.status);

export function PhotoSimilarityProvider({children,scope,onOpenPhoto,onColor,onSettings}:{children:ReactNode;scope:string;onOpenPhoto:(photo:Photo)=>void;onColor:(value:string)=>void;onSettings:()=>void}){
  const [menu,setMenu]=useState<{photo:Photo;anchor:HTMLElement;x:number;y:number}|null>(null),[expanded,setExpanded]=useState<{photo:Photo;mode:Mode}|null>(null);
  const lastAnchor=useRef<HTMLElement|null>(null);
  useEffect(()=>{setMenu(null);setExpanded(null);},[scope]);
  function closeMenu(focus=false){setMenu(null);if(focus&&lastAnchor.current?.isConnected)lastAnchor.current.focus({preventScroll:true});}
  const actions:Actions={menu:(photo,anchor,x,y)=>{lastAnchor.current=anchor;setMenu({photo,anchor,x,y});},expand:(photo,mode)=>{setMenu(null);setExpanded({photo,mode});},open:photo=>{setExpanded(null);onOpenPhoto(photo);},color:value=>{setExpanded(null);onColor(value);},settings:()=>{setExpanded(null);onSettings();}};
  return <PhotoSimilarityContext.Provider value={actions}>{children}
    {menu&&<LutContextMenu label={bt('照片操作：','Photo actions: ')+menu.photo.file_name} {...menu} onClose={closeMenu} actions={[
      {id:'open',label:bt('打开照片','Open photo'),run:()=>actions.open(menu.photo)},
      {id:'appearance',label:bt('按外观查相似照片','Find photos with similar appearance'),run:()=>actions.expand(menu.photo,'appearance')},
      {id:'semantic',label:bt('按画面语义查相似照片','Find photos with similar meaning'),disabled:IS_BROWSER,run:()=>actions.expand(menu.photo,'semantic')},
    ]}/>}
    {expanded&&<Modal wide title={bt('相似照片 · ','Similar photos · ')+expanded.photo.file_name} onClose={()=>setExpanded(null)}><SimilarPhotos key={expanded.photo.id+expanded.mode} photo={expanded.photo} initialMode={expanded.mode} compact={false}/></Modal>}
  </PhotoSimilarityContext.Provider>;
}

export default function SimilarPhotos({photo,compact=true,initialMode='appearance'}:{photo:Photo;compact?:boolean;initialMode?:Mode}){
  const actions=useContext(PhotoSimilarityContext),[mode,setMode]=useState<Mode>(initialMode),[distance,setDistance]=useState(6),[threshold,setThreshold]=useState(.3),[verify,setVerify]=useState(false),[verificationThreshold,setVerificationThreshold]=useState(.9);
  const [result,setResult]=useState<Result|null>(null),[analysis,setAnalysis]=useState<Analysis|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0),[showGroups,setShowGroups]=useState(false);
  const [job,setJob]=useState<Job|null>(null),[submitting,setSubmitting]=useState(false),[taskError,setTaskError]=useState('');
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(mode==='appearance'&&(analysis?.photo_id!==photo.id||!analysis.indexed)){setResult(null);setError('');setLoading(false);return;}
    const controller=new AbortController();setResult(null);setError('');setLoading(true);
    void api<Result>('/similarity/photos/'+encodeURIComponent(photo.id)+'?'+query({mode,distance,limit:compact?8:60,semantic_threshold:threshold,verify:String(verify),verification_threshold:verificationThreshold}),'GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setResult(value);}).catch(e=>{if(!controller.signal.aborted)setError(message(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[photo.id,mode,distance,threshold,verify,verificationThreshold,compact,revision,analysis]);
  useEffect(()=>{const controller=new AbortController();setAnalysis(null);void api<Analysis>('/similarity/photos/'+encodeURIComponent(photo.id)+'/analysis','GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setAnalysis({...value,photo_id:photo.id});}).catch(e=>{if(!controller.signal.aborted)setError(message(e));});return()=>controller.abort();},[photo.id,revision]);
  useEffect(()=>{const controller=new AbortController();void api<Job[]>('/jobs','GET',undefined,controller.signal).then(jobs=>{const running=jobs.find(j=>j.kind==='appearance-index'&&active(j));if(running)setJob(running);}).catch(()=>{});return()=>controller.abort();},[]);
  useEffect(()=>{
    if(!active(job))return;const controller=new AbortController();let running=false;
    const poll=async()=>{if(running)return;running=true;try{const next=await api<Job>('/jobs/'+job!.id,'GET',undefined,controller.signal);if(!controller.signal.aborted){setJob(next);if(!active(next)){setRevision(value=>value+1);if(next.error)setTaskError(message(next.error));}}}catch(e){if(!controller.signal.aborted)setTaskError(message(e));}finally{running=false;}};
    const timer=setInterval(()=>void poll(),1000);return()=>{clearInterval(timer);controller.abort();};
  },[job?.id,job?.status]);
  async function build(){if(submitting||active(job))return;setSubmitting(true);setTaskError('');try{const next=await api<Job>('/similarity/index','POST');if(alive.current)setJob(next);}catch(e){if(alive.current)setTaskError(message(e));}finally{if(alive.current)setSubmitting(false);}}
  async function cancel(){try{const next=await api<Job>('/jobs/'+job!.id+'/cancel','POST');if(alive.current){setJob(next);setRevision(value=>value+1);}}catch(e){if(alive.current)setTaskError(message(e));}}
  return <section className={'photo-similarity '+(compact?'compact':'expanded')} aria-label={bt('相似照片','Similar photos')}>
    <header><h4>{bt('相似照片','Similar photos')}</h4>{compact&&<button className="quiet" onClick={()=>actions?.expand(photo,mode)}>{bt('展开','Expand')}</button>}</header>
    <div className="segmented"><button className={mode==='appearance'?'active':''} aria-pressed={mode==='appearance'} onClick={()=>setMode('appearance')}>{bt('外观','Appearance')}</button><button className={mode==='semantic'?'active':''} aria-pressed={mode==='semantic'} disabled={IS_BROWSER} title={IS_BROWSER?bt('浏览器尚未配置本地语义模型','A local semantic model is not configured in this browser'):undefined} onClick={()=>setMode('semantic')}>{bt('画面语义','Visual meaning')}</button></div>
    <details className="similarity-options"><summary>{bt('调整匹配条件','Adjust matching')}</summary>{mode==='appearance'?<><label>{bt('外观差异上限','Maximum appearance distance')} <output>{distance} / 64</output><input aria-label={bt('外观差异上限','Maximum appearance distance')} type="range" min={0} max={16} step={1} value={distance} onChange={e=>setDistance(Number(e.target.value))}/></label><label><input type="checkbox" checked={verify} disabled={IS_BROWSER} onChange={e=>setVerify(e.target.checked)}/>{bt('用本地 CLIP 再次复核','Verify with local CLIP')}</label>{verify&&<label>{bt('复核余弦阈值','Verification cosine threshold')}<input aria-label={bt('复核余弦阈值','Verification cosine threshold')} type="number" min={-1} max={1} step={.01} value={verificationThreshold} onChange={e=>setVerificationThreshold(Math.max(-1,Math.min(1,Number(e.target.value))))}/></label>}</>:<label>{bt('语义余弦阈值','Semantic cosine threshold')} <output>{threshold.toFixed(2)}</output><input aria-label={bt('语义余弦阈值','Semantic cosine threshold')} type="range" min={-.5} max={1} step={.01} value={threshold} onChange={e=>setThreshold(Number(e.target.value))}/></label>}</details>
    <p className="muted">{mode==='appearance'?bt('外观差异越小越接近。裁切可能漏检，候选仍需逐张判断。','Smaller appearance distances indicate closer matches. Crops may be missed; review each suggestion.'):bt('通过同一个本地模型比较画面含义。分数不是准确率，也不代表重复文件。','Compare visual meaning using the same local model. Scores are not accuracy or proof of duplicate files.')}</p>
    {IS_BROWSER&&<p className="muted">{bt('浏览器使用本地外观索引，未启用云端语义替代。','This browser uses a local appearance index. Cloud semantic search is not enabled.')}</p>}
    {loading&&<p role="status">{bt('查找相似照片…','Finding similar photos…')}</p>}{error&&<p role="status" className="muted">{error}</p>}
    {result?.low_information&&<p className="muted">{bt('此画面细节较少，外观相似可能仅来自大面积纯色。','This image has little detail; appearance matches may come from large flat areas.')}</p>}
    {result&&<div className={compact?'similar-strip':'similar-grid'}>{result.candidates.map(candidate=><button key={candidate.id} className="similar-candidate" aria-label={bt('打开相似照片：','Open similar photo: ')+candidate.file_name} onClick={()=>actions?.open(candidate)}><MediaImage src={candidate.thumbnail_url} alt={candidate.file_name} loading="lazy"/><span title={candidate.file_name}>{candidate.file_name}</span><small>{mode==='appearance'?bt('差异 ','Distance ')+(candidate.appearance_distance??'—'):(candidate.similarity_score??0).toFixed(3)}{result.verified_with_clip&&' · CLIP '+candidate.similarity_score?.toFixed(3)}</small></button>)}</div>}
    {result&&!result.candidates.length&&<p className="muted">{bt('当前条件下没有其他候选。','There are no other candidates at these settings.')}</p>}
    <div className="similarity-index-actions"><button disabled={submitting||active(job)} onClick={()=>void build()}>{submitting?bt('正在排队…','Queuing…'):bt('建立 / 更新外观索引','Build / update appearance index')}</button>{mode==='semantic'&&<button onClick={()=>actions?.settings()}>{bt('本地模型设置','Local model settings')}</button>}</div>
    {!compact&&<><button aria-expanded={showGroups} onClick={()=>setShowGroups(value=>!value)}>{bt('浏览全库近重复候选','Browse near-duplicate candidates across the library')}</button>{showGroups&&<NearDuplicateGroups key={revision+':'+distance} distance={distance}/>}</>}
    {job&&<div className="similarity-progress" role="status"><span>{job.processed} / {job.total} · {bt('成功 ','Indexed ')}{job.success} · {bt('失败 ','Failed ')}{job.failed}</span>{active(job)&&<><progress max={job.total||1} value={job.processed}/><button onClick={()=>void cancel()}>{bt('取消索引','Cancel indexing')}</button></>}</div>}{taskError&&<p role="alert" className="error-box">{taskError}</p>}
    <div className="indexed-palette"><h4>{bt('已索引画面色板','Indexed image palette')}</h4>{analysis?.indexed?<><div className="palette-swatches">{analysis.palette.map(color=><button key={color} style={{backgroundColor:color}} title={bt('筛选画面色板：','Filter image palette: ')+color} aria-label={bt('筛选画面色板：','Filter image palette: ')+color} onClick={()=>actions?.color(color)}/>)}</div><p className="muted">{bt('来自已索引预览，可点击筛选；与你手工设置的颜色标签分别保存。','Derived from indexed previews; click to filter. Stored separately from your manual color labels.')}</p></>:<p className="muted">{bt('建立外观索引后显示画面色板。','Build the appearance index to show the image palette.')}</p>}</div>
  </section>;
}

type Groups={indexed:number;next_cursor:string;has_more:boolean;groups:{source:Photo;candidates:Candidate[];candidate_count:number;low_information:boolean}[]};
function NearDuplicateGroups({distance}:{distance:number}){
  const actions=useContext(PhotoSimilarityContext),[after,setAfter]=useState(''),[history,setHistory]=useState<string[]>([]),[data,setData]=useState<Groups|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  useEffect(()=>{const controller=new AbortController();setData(null);setLoading(true);setError('');void api<Groups>('/similarity/groups?'+query({after,distance}),'GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted)setError(message(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[after,distance]);
  return <section className="near-duplicate-groups"><h4>{bt('全库近重复候选 · 按拍摄去重','Library near-duplicate candidates · one per capture')}</h4><p className="muted">{bt('每组都与首张照片比较，组员彼此不一定相似。同一对照片最多列出一次，每组展示最多八张候选；打开组可审阅最多六十张。不会自动合并或删除。','Each group compares candidates with its first photo; the candidates may differ from one another. Each pair appears at most once. Up to eight neighbors are shown per reference; open a group to review up to sixty. Nothing is merged or deleted automatically.')}</p>
    {loading&&<p role="status">{bt('正在读取候选组…','Loading candidate groups…')}</p>}{error&&<p role="alert">{error}</p>}
    {data?.groups.map(group=><article key={group.source.id}><header><button onClick={()=>actions?.open(group.source)}>{group.source.file_name}</button><button onClick={()=>actions?.expand(group.source,'appearance')}>{bt('审阅这一组','Review this group')}</button></header>{group.low_information&&<small>{bt('低细节画面，请谨慎判断。','Low-detail image; review carefully.')}</small>}<div className="similar-strip">{[group.source,...group.candidates].map((photo,i)=><button className="similar-candidate" key={photo.id} onClick={()=>actions?.open(photo)} aria-label={bt('打开照片：','Open photo: ')+photo.file_name}><MediaImage src={photo.thumbnail_url} alt={photo.file_name} loading="lazy"/><span>{photo.file_name}</span><small>{i===0?bt('参考图','Reference'):bt('差异 ','Distance ')+(photo as Candidate).appearance_distance}</small></button>)}</div></article>)}
    {data&&!data.groups.length&&<p className="muted">{data.has_more?bt('这一页没有候选，可继续查看下一页。','No candidates on this page; continue to the next page.'):bt('当前索引和差异范围下没有更多候选。','No more candidates at the current index and distance.')}</p>}
    <div className="row"><button disabled={loading||!history.length} onClick={()=>{setAfter(history.at(-1)!);setHistory(history.slice(0,-1));}}>{bt('上一页','Previous')}</button><button disabled={loading||!data?.has_more} onClick={()=>{setHistory([...history,after]);setAfter(data!.next_cursor);}}>{bt('下一页','Next')}</button></div>
  </section>;
}
