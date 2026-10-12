import {t} from './i18n';
import {useState,useEffect,useRef} from 'react';
import {api,message} from './api';
import {Empty,PhotoCard,Pager,Modal} from './components';
import type {Photo,Job,Album,Filters} from './types';
interface PersonAlbum {id:string;name:string;linked?:boolean}
interface Person {id:string;name:string;photo_count:number;pending:number;albums?:PersonAlbum[]}
interface Face {id:string;photo_id:string;person_id:string|null;confirmed:boolean;thumbnail_url:string}
interface Status {available:boolean;dependency:boolean;cached:boolean}
export default function FacesPage({notify,onOpenPhoto,onBrowse}:{notify:(msg:string)=>void;onOpenPhoto?:(photo:Photo)=>void;onBrowse:(filters:Filters)=>void}){
  const [people,setPeople]=useState<Person[]>([]),[status,setStatus]=useState<Status|null>(null),[selected,setSelected]=useState('');
  const [faces,setFaces]=useState<Face[]>([]),[photos,setPhotos]=useState<Photo[]>([]),[page,setPage]=useState(1),[total,setTotal]=useState(0),[faceTotal,setFaceTotal]=useState(0),[reviewPage,setReviewPage]=useState(1);
  const [job,setJob]=useState<Job|null>(null),[threshold,setThreshold]=useState(.45),[name,setName]=useState('');const generation=useRef(0);
  const [creatingAlbum,setCreatingAlbum]=useState(false);
  const [choosingAlbum,setChoosingAlbum]=useState<Person|null>(null);
  async function refresh(){try{const [s,p]=await Promise.all([api<Status>('/faces/status'),api<Person[]>('/faces/persons')]);setStatus(s);setPeople(p)}catch(e){notify(message(e))}}
  useEffect(()=>{void refresh();api<Job[]>('/jobs').then(items=>setJob(items.find(j=>['faces','face-models'].includes(j.kind)&&['running','queued'].includes(j.status))||null)).catch(()=>{})},[]);
  useEffect(()=>{if(!job||!['running','queued'].includes(job.status))return;const timer=setInterval(()=>{api<Job>('/jobs/'+job.id).then(next=>{setJob(next);if(!['running','queued'].includes(next.status)){void refresh();notify(next.error||t("人物任务完成：{0} 成功，{1} 跳过，{2} 失败",{0:next.success,1:next.skipped,2:next.failed}))}}).catch(e=>notify(message(e)))},1000);return()=>clearInterval(timer)},[job?.id,job?.status]);
  useEffect(()=>{const token=++generation.current;setFaces([]);setPhotos([]);if(!selected)return;const filter=selected==='pending'?'':`person_id=${encodeURIComponent(selected)}&`;api<{faces:Face[];total:number}>(`/faces/review?${filter}page=${reviewPage}`).then(r=>{if(token===generation.current){setFaces(r.faces);setFaceTotal(r.total)}}).catch(e=>notify(message(e)));if(selected!=='pending')api<{photos:Photo[];total:number}>(`/faces/persons/${selected}/photos?page=${page}`).then(r=>{if(token===generation.current){setPhotos(r.photos);setTotal(r.total)}}).catch(e=>notify(message(e)));return()=>{generation.current++}},[selected,page,reviewPage,people]);
  async function run(path:string){try{setJob(await api<Job>(path,'POST',path.endsWith('analyze')?{threshold}:{}))}catch(e){notify(message(e))}}
  async function create(){if(!name.trim())return;try{await api('/faces/persons','POST',{name});setName('');await refresh()}catch(e){notify(message(e))}}
  async function rename(person:Person){const next=prompt(t("人物名称"),person.name);if(!next)return;try{await api('/faces/persons/'+person.id,'PATCH',{name:next});await refresh()}catch(e){notify(message(e))}}
  async function createAlbum(person:Person){
    const next=prompt(t("人物影集名称（收录当前已确认分组的全部照片）"),person.name);
    if(next===null)return;
    if(!next.trim()){notify(t("请填写影集名称"));return}
    setCreatingAlbum(true);
    try{const album=await api<Album>('/albums','POST',{name:next.trim(),person_id:person.id});notify(t("已创建人物影集「{0}」· {1} 次拍摄",{0:album.name,1:album.count}));onBrowse({album_id:album.id})}catch(e){notify(message(e))}finally{setCreatingAlbum(false)}
  }
  async function browseAlbum(person:Person,album:PersonAlbum){setCreatingAlbum(true);try{if(!album.linked)await api('/albums/'+album.id,'PATCH',{person_id:person.id});setChoosingAlbum(null);onBrowse({album_id:album.id})}catch(e){notify(message(e))}finally{setCreatingAlbum(false)}}
  function openAlbum(person:Person){if(person.albums?.length===1)void browseAlbum(person,person.albums[0]);else setChoosingAlbum(person)}
  async function remove(person:Person){if(!confirm(t("删除人物“{0}”？保留原始照片，人脸回到待确认列表。",{0:person.name})))return;try{await api('/faces/persons/'+person.id,'DELETE');setSelected('pending');await refresh()}catch(e){notify(message(e))}}
  return <div className="faces-page"><h2>{t("人物相册")}</h2><p className="muted">{t("本机 YuNet / SFace 分析。自动分组是建议，请检查后确认；不会上传照片。")}</p>
    {!status?<p>{t("加载中…")}</p>:!status.dependency?<div className="error-box">{t("安装可选依赖并重启：")}<code>.\.venv\Scripts\python.exe -m pip install -r backend/requirements-faces.txt</code></div>:!status.cached?<button onClick={()=>void run('/faces/models')} disabled={!!job&&['queued','running'].includes(job.status)}>{t("下载本地人脸模型")}</button>:<div className="row"><label>{t("分组相似度")}<input aria-label={t("人脸分组相似度")} type="number" min={.3} max={.95} step={.01} value={threshold} onChange={e=>setThreshold(Number(e.target.value))}/></label><button className="primary" disabled={!!job&&['queued','running'].includes(job.status)} onClick={()=>void run('/faces/analyze')}>{t("分析照片库（跳过已分析）")}</button></div>}
    {job&&<div className="settings-card"><p>{job.status} · {t(job.current)} · {job.processed}/{job.total}</p><progress max={job.total||1} value={job.processed}/>{job.error&&<p className="error-box">{message(job.error)}</p>}{job.errors?.length>0&&<p className="error-box">{message(job.errors[0])}</p>}{['queued','running'].includes(job.status)&&<button onClick={()=>void api('/jobs/'+job.id+'/cancel','POST')}>{t("取消任务")}</button>}</div>}
    <div className="row"><input placeholder={t("新人物名称")} value={name} onChange={e=>setName(e.target.value)}/><button onClick={()=>void create()}>{t("添加人物")}</button><button onClick={()=>{setSelected('pending');setReviewPage(1);setPage(1)}}>{t("查看待确认人脸")}</button></div>
    <div className="faces-grid">{people.map(person=><article className="face-card" key={person.id}><h3>{person.name}</h3><p>{person.photo_count}{t(" 次拍摄 · ")}{person.pending}{t(" 待确认")}</p><div className="row"><button onClick={()=>{setSelected(person.id);setPage(1);setReviewPage(1)}}>{t("查看照片")}</button><button onClick={()=>void rename(person)}>{t("命名")}</button><button onClick={()=>void remove(person)}>{t("删除人物")}</button><button disabled={!person.pending} onClick={async()=>{try{await api('/faces/persons/'+person.id+'/confirm','POST');await refresh()}catch(e){notify(message(e))}}}>{t("确认分组")}</button>{person.albums?.length?<button disabled={creatingAlbum} onClick={()=>openAlbum(person)}>{t("打开人物影集")}</button>:<button disabled={creatingAlbum||!!person.pending||!person.photo_count} title={person.pending?t("请先确认人物分组"):!person.photo_count?t("该人物还没有照片"):t("将当前分组的全部照片保存为普通影集")} onClick={()=>void createAlbum(person)}>{t("新建人物影集")}</button>}</div></article>)}</div>
    {choosingAlbum&&<Modal title={t("选择人物影集")} onClose={()=>setChoosingAlbum(null)}><div className="batch-edit-content"><div className="button-row">{choosingAlbum.albums?.map(album=><button key={album.id} disabled={creatingAlbum} onClick={()=>void browseAlbum(choosingAlbum,album)}>{album.name}</button>)}</div></div></Modal>}
    {selected&&<section className="settings-card"><h3>{t("人脸分组检查")}</h3>{faces.length?<div className="faces-grid">{faces.map(face=><article key={face.id}><img src={face.thumbnail_url} alt={t("待确认人脸")} width={120} height={120} style={{objectFit:'contain'}} loading="lazy"/><select aria-label={t("关联人物")} value={face.person_id||''} onChange={async e=>{try{await api('/faces/detections/'+face.id,'PATCH',{person_id:e.target.value||null});await refresh()}catch(error){notify(message(error))}}}><option value="">{t("未关联")}</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><small>{face.confirmed?t("已确认"):t("待确认")}</small></article>)}</div>:<Empty title={t("没有待显示的人脸")}/>}<Pager page={reviewPage} total={faceTotal} size={40} onChange={setReviewPage}/></section>}
    {selected&&selected!=='pending'&&<section><h3>{t("人物照片")}</h3><div className="gallery compact">{photos.map(photo=><PhotoCard key={photo.id} photo={photo} selected={false} onToggle={()=>{}} onOpen={()=>onOpenPhoto?.(photo)}/>)}</div><Pager page={page} total={total} onChange={setPage}/></section>}
  </div>;
}
