import Discover from './workspace/Discover';
import LibraryCover from './LibraryCover';
import MediaImage from './media/MediaImage';
import {photoURL} from './runtime';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Images,Frame,ChartNoAxesColumnIncreasing,FolderHeart} from 'lucide-react';
import {api,message} from './api';
import {t} from './i18n';
import type {Album,Filters,Photo} from './types';
import type {Page} from './routes';

export default function HomePage({onBrowse,onPage,onImport,onOpen,notify,libraryRevision=0}:{libraryRevision?:number;onBrowse:(filters:Filters)=>void;onPage:(page:Page)=>void;onImport:()=>void;onOpen:(photo:Photo)=>void;notify:(text:string)=>void}){
  const [photos,setPhotos]=useState<Photo[]>([]),[albums,setAlbums]=useState<Album[]>([]),[total,setTotal]=useState(0);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{let alive=true;Promise.all([api<{photos:Photo[];total:number}>('/photos?'+new URLSearchParams({page:'1',page_size:'5',sort:'date_taken',direction:'desc'})),api<Album[]>('/albums')]).then(([p,a])=>{if(alive){setPhotos(p.photos);setTotal(p.total);setAlbums(a)}}).catch(e=>notify(message(e))).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[libraryRevision]);
  useEffect(()=>{const regions=document.querySelectorAll('.home-page [data-reveal]');if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('revealed');observer.unobserve(entry.target)}}),{threshold:.08});regions.forEach(el=>{el.classList.add('reveal-pending');observer.observe(el)});return()=>{observer.disconnect();regions.forEach(el=>el.classList.remove('reveal-pending'))}},[loading]);
  const featured=albums.filter(a=>a.count>0).slice(0,5);
  return <div className="home-page">
    <section className="archive-hero" aria-label={t('摄影空间封面')}>
      <LibraryCover revision={libraryRevision} onOpen={onOpen} notify={notify} onExplore={()=>document.getElementById('home-collections')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}/>
      <div className="hero-shade"/><div className="hero-copy"><span className="eyebrow">THE PHOTO ARCHIVE / {new Date().getFullYear()}</span><h1>{t('把看见的光，')}<br/><em>{t('留在自己的世界。')}</em></h1><p>{t('每一次按下快门，都是值得留下的瞬间。')}</p><div className="hero-actions"><button className="hero-primary" onClick={()=>onBrowse({})}>{t('进入照片库')}<ArrowUpRight size={19}/></button><button className="hero-secondary" data-glass-exclude onClick={onImport}>{t('导入照片')}</button></div></div>
    </section>
    <section className="home-collections" id="home-collections" data-reveal><div className="home-section-heading"><div><span className="eyebrow">COLLECTIONS / STORIES IN FRAMES</span><h2>{t('让瞬间，成为故事。')}</h2></div><button className="quiet" onClick={()=>onPage('albums')}>{t('全部影集')}<ArrowUpRight size={18}/></button></div>
      {featured.length?<div className="featured-collections">{featured.map((album,i)=><button key={album.id} className={'collection-tile '+(!i?'featured':'')} onClick={()=>onBrowse({album_id:album.id})}>{album.cover_id?<MediaImage loading="lazy" src={photoURL(album.cover_id,'preview')} alt={album.name}/>:<FolderHeart size={60}/>}<div className="collection-shade"/><span className="collection-number">{String(i+1).padStart(2,'0')} / COLLECTION</span><div className="collection-copy"><div><h3>{album.name}</h3><p>{album.count.toLocaleString()} {t('次拍摄')}</p></div><ArrowUpRight size={26}/></div></button>)}</div>:<div className="home-empty"><FolderHeart size={30}/><h3>{t('你的故事，从第一张照片开始。')}</h3><p>{t('先在图库选择照片，再来整理你的作品。')}</p><button onClick={()=>onPage('albums')}>{t('新建影集')}<ArrowUpRight size={16}/></button></div>}
    </section>
    <section className="home-workflow" data-reveal><span className="eyebrow">A SPACE FOR YOUR PHOTOGRAPHY</span><div className="home-section-heading"><h2>{t('收藏，也创作。')}</h2><p>{total.toLocaleString()} {t('次拍摄')} / {albums.length} {t('影集')}</p></div><div className="workflow-grid">{([{page:'photos',icon:Images,title:'整理照片',description:'完整构图，清晰参数，找回每一次拍摄。'},{page:'watermark-gallery',icon:Frame,title:'水印作品',description:'从草稿到导出，为照片留下自己的署名。'},{page:'reports',icon:ChartNoAxesColumnIncreasing,title:'摄影报告',description:'从时间与镜头，读懂自己的摄影语言。'}] as const).map((item,i)=><button key={item.page} onClick={()=>onPage(item.page)}><span className="workflow-number">0{i+1}</span><item.icon size={26}/><h3>{t(item.title)}</h3><p>{t(item.description)}</p><ArrowUpRight className="card-arrow" size={22}/></button>)}</div></section>
    {!!photos.length&&<section className="home-film" data-reveal><span className="eyebrow">RECENT FRAMES</span><div className="home-filmstrip">{photos.map(photo=><button key={photo.id} onClick={()=>onOpen(photo)} aria-label={t('查看 ')+photo.file_name}><MediaImage loading="lazy" src={photo.thumbnail_url} alt={photo.file_name}/></button>)}</div></section>}
    <Discover onBrowse={onBrowse} onPage={onPage} notify={notify}/>
  </div>;
}
