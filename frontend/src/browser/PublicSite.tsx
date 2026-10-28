import {useEffect,useMemo,useRef,useState} from 'react';
import {Aperture,ArrowDown,ArrowLeft,ArrowRight,ArrowUpRight,Check,Info,Moon,Pause,Play,Search,Sun,X,ZoomIn,ZoomOut} from 'lucide-react';
import {getLang,setStoredLang,type Lang} from '../i18n';
import {loadPortfolio,type Portfolio,type PublicPhoto} from './portfolio';
import './public-site.css';

type Translate=(zh:string,en:string)=>string;
function readRoute(){
  const hash=location.hash.slice(1)||'/',index=hash.indexOf('?');
  return {path:index<0?hash:hash.slice(0,index),photo:new URLSearchParams(index<0?'':hash.slice(index+1)).get('photo')||new URLSearchParams(location.search).get('photo')||''};
}
function photoTitle(photo:PublicPhoto,t:Translate){return photo.title||t('未命名作品','Untitled photograph');}

function Picture({photo,t,full=false,eager=false}:{photo:PublicPhoto;t:Translate;full?:boolean;eager?:boolean}){
  const [failed,setFailed]=useState(0);
  const first=full?photo.src:photo.thumbnail,second=full?photo.thumbnail:photo.src;
  return <span className="public-image" style={{aspectRatio:`${photo.width} / ${photo.height}`}}>
    {failed<2?<img src={failed?second:first} width={photo.width} height={photo.height} alt={photoTitle(photo,t)} loading={eager?'eager':'lazy'} fetchPriority={eager?'high':'auto'} decoding="async" onError={()=>setFailed(n=>first===second?2:n+1)}/>:<span className="public-image-error" role="img" aria-label={`${photoTitle(photo,t)} — ${t('图片暂不可用','Image unavailable')}`}><Aperture size={32}/><span>{t('图片暂不可用','Image unavailable')}</span></span>}
  </span>;
}

function Lightbox({photo,photos,t,onSelect,onClose}:{photo:PublicPhoto;photos:PublicPhoto[];t:Translate;onSelect:(id:string)=>void;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null),strip=useRef<HTMLDivElement>(null);
  const [zoom,setZoom]=useState(false),[info,setInfo]=useState(false),[revision,setRevision]=useState(0);
  const index=photos.findIndex(p=>p.id===photo.id);
  const step=(delta:number)=>onSelect(photos[(index+delta+photos.length)%photos.length].id);
  useEffect(()=>{
    const node=dialog.current!,previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
    node.showModal();closeButton.current?.focus();document.body.style.overflow='hidden';
    return()=>{node.close();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  useEffect(()=>{setZoom(false);setRevision(0);strip.current?.querySelector('[aria-current="true"]')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});},[photo.id]);
  return <dialog ref={dialog} className="public-lightbox" aria-labelledby="public-photo-title" aria-describedby="public-lightbox-help" onCancel={e=>{e.preventDefault();onClose();}} onKeyDown={e=>{
    if(e.key==='Tab'){
      const controls=Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')).filter(node=>node.getClientRects().length>0);
      const first=controls[0],last=controls[controls.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
    if(!e.altKey&&!e.ctrlKey&&!e.metaKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();if(photos.length>1)step(e.key==='ArrowLeft'?-1:1);}
  }}>
    <header className="public-lightbox-bar"><div><h2 id="public-photo-title">{photoTitle(photo,t)}</h2><span aria-live="polite">{index+1} / {photos.length}</span></div><div className="public-actions">
      <button onClick={()=>setZoom(v=>!v)} aria-pressed={zoom} aria-label={t(zoom?'缩小至适合窗口':'放大照片',zoom?'Fit photograph':'Zoom photograph')}>{zoom?<ZoomOut/>:<ZoomIn/>}</button>
      <button onClick={()=>setInfo(v=>!v)} aria-expanded={info} aria-controls="public-photo-info" aria-label={t('照片信息','Photo information')}><Info/></button>
      <button ref={closeButton} onClick={onClose} aria-label={t('关闭照片','Close photograph')}><X/></button>
    </div></header>
    <p id="public-lightbox-help" className="public-sr-only">{t('左右方向键切换照片，Escape 关闭。放大后可滚动查看。','Use left and right arrows to change photographs, Escape to close. Scroll to explore when zoomed.')}</p>
    <div className={'public-lightbox-body'+(info?' has-info':'')}>
      <div className={'public-lightbox-stage'+(zoom?' is-zoomed':'')} tabIndex={0} aria-label={t('照片画布','Photograph canvas')}><Picture key={`${photo.id}-${revision}`} photo={photo} t={t} full eager/></div>
      {info&&<aside id="public-photo-info" className="public-photo-info"><h3>{photoTitle(photo,t)}</h3>{photo.description&&<p>{photo.description}</p>}<dl><dt>{t('尺寸','Dimensions')}</dt><dd>{photo.width} × {photo.height}</dd></dl>{photo.tags.length>0&&<ul aria-label={t('标签','Tags')}>{photo.tags.map((tag,i)=><li key={i}>{tag}</li>)}</ul>}<button onClick={()=>setRevision(n=>n+1)}>{t('重新加载图片','Reload image')}</button></aside>}
    </div>
    <div className="public-lightbox-navigation"><button disabled={photos.length<2} onClick={()=>step(-1)} aria-label={t('上一张照片','Previous photograph')}><ArrowLeft/></button><span>{t('左右方向键浏览 · Esc 关闭','Arrow keys to browse · Esc to close')}</span><button disabled={photos.length<2} onClick={()=>step(1)} aria-label={t('下一张照片','Next photograph')}><ArrowRight/></button></div>
    <div ref={strip} className="public-thumbnails" aria-label={t('照片缩略图','Photo thumbnails')}>{photos.map((p,i)=><button key={p.id} aria-label={`${i+1}. ${photoTitle(p,t)}`} aria-current={p.id===photo.id?'true':undefined} onClick={()=>onSelect(p.id)}><Picture photo={p} t={t}/>{p.id===photo.id&&<Check size={14}/>}</button>)}</div>
  </dialog>;
}

export default function PublicSite(){
  const [portfolio,setPortfolio]=useState<Portfolio|null>(null),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[revision,setRevision]=useState(0);
  const [route,setRoute]=useState(readRoute),[search,setSearch]=useState(''),[active,setActive]=useState(0),[playing,setPlaying]=useState(false);
  const [lang,setLang]=useState<Lang>(()=>{try{return getLang();}catch{return 'zh';}});
  const [theme,setTheme]=useState<'light'|'dark'>(()=>{try{return localStorage.getItem('theme')==='light'?'light':'dark';}catch{return 'dark';}});
  const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const main=useRef<HTMLElement>(null),openedHere=useRef(false),previousPath=useRef(route.path);
  const t:Translate=(zh,en)=>lang==='en'?en:zh;
  useEffect(()=>{let alive=true;setStatus('loading');loadPortfolio().then(value=>{if(alive){setPortfolio(value);setStatus('ready');setActive(0);}}).catch(()=>{if(alive)setStatus('error');});return()=>{alive=false};},[revision]);
  useEffect(()=>{const change=()=>setRoute(readRoute());window.addEventListener('hashchange',change);window.addEventListener('popstate',change);return()=>{window.removeEventListener('hashchange',change);window.removeEventListener('popstate',change);};},[]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('theme',theme);}catch{}},[theme]);
  useEffect(()=>{document.documentElement.lang=lang;setStoredLang(lang);},[lang]);
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>{setReduced(media.matches);if(media.matches)setPlaying(false);};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{if(previousPath.current!==route.path){previousPath.current=route.path;setSearch('');openedHere.current=false;window.scrollTo({top:0,behavior:'instant'});main.current?.focus({preventScroll:true});}},[route.path]);
  const photos=portfolio?.photos||[];
  const byId=useMemo(()=>new Map(photos.map(p=>[p.id,p])),[portfolio]);
  const featured=useMemo(()=>{const selected=(portfolio?.featuredIds||[]).flatMap(id=>byId.get(id)?[byId.get(id)!]:[]);return selected.length?selected:photos.slice(0,12);},[portfolio,byId]);
  const hero=featured[active%Math.max(featured.length,1)];
  useEffect(()=>{if(!playing||reduced||featured.length<2||route.path!=='/'||route.photo)return;const timer=setInterval(()=>{if(!document.hidden)setActive(n=>(n+1)%featured.length);},6500);return()=>clearInterval(timer);},[playing,reduced,featured.length,route.path,route.photo]);
  const album=portfolio?.albums.find(a=>route.path===`/albums/${encodeURIComponent(a.id)}`);
  const home=route.path==='/',isAlbums=route.path==='/albums',validPage=home||route.path==='/photos'||isAlbums||!!album;
  const source=album?album.photoIds.flatMap(id=>byId.get(id)?[byId.get(id)!]:[]):home?featured:photos;
  const query=search.trim().toLocaleLowerCase(),visible=source.filter(p=>[p.title,p.description,...p.tags].some(value=>value.toLocaleLowerCase().includes(query)));
  const selected=byId.get(route.photo),lightboxPhotos=selected&&visible.some(p=>p.id===selected.id)?visible:photos;
  function navigatePhoto(id:string,replace=false){
    const url=new URL(location.href);url.searchParams.delete('photo');url.hash=route.path+(id?'?'+new URLSearchParams({photo:id}).toString():'');
    if(replace)history.replaceState(null,'',url);else history.pushState(null,'',url);
    setRoute(readRoute());
  }
  function openPhoto(id:string){openedHere.current=true;navigatePhoto(id);}
  function closePhoto(){if(openedHere.current){openedHere.current=false;history.back();}else navigatePhoto('',true);}
  function pageHref(path:string){const url=new URL(location.href);url.searchParams.delete('photo');url.hash=path;return url.pathname+url.search+url.hash;}
  function gallery(items:PublicPhoto[]){return items.length?<div className="public-gallery">{items.map((photo,i)=><button className="public-photo" key={photo.id} onClick={()=>openPhoto(photo.id)} aria-label={`${t('查看照片','View photograph')}: ${photoTitle(photo,t)}`}><Picture key={`${photo.id}-${revision}`} photo={photo} t={t}/><span className="public-photo-caption"><span><strong>{photoTitle(photo,t)}</strong>{photo.tags.length>0&&<small>{photo.tags.join(' / ')}</small>}</span><span className="public-photo-number">{String(i+1).padStart(2,'0')} <ArrowUpRight size={16}/></span></span></button>)}</div>:<div className="public-empty"><Aperture size={36}/><h3>{query?t('没有匹配的作品','No matching photographs'):t('静候下一束光。','Waiting for the next light.')}</h3><p>{query?t('试试其他标题、描述或标签。','Try another title, description or tag.'):t('这里还没有发布照片。欢迎稍后再来。','No photographs have been published here yet. Come back soon.')}</p>{query&&<button onClick={()=>setSearch('')}>{t('清除搜索','Clear search')}</button>}</div>;}
  function collections(){const albums=portfolio?.albums||[];return albums.length?<div className="public-collections">{(home?albums.slice(0,6):albums).map((a,i)=>{const cover=a.photoIds.map(id=>byId.get(id)).find(Boolean);return <a className="public-collection" key={a.id} href={pageHref('/albums/'+encodeURIComponent(a.id))}>{cover?<Picture photo={cover} t={t}/>:<div className="public-collection-placeholder"><Aperture size={64}/></div>}<span className="public-collection-index">{String(i+1).padStart(2,'0')}</span><div className="public-collection-copy"><h3>{a.title||t('未命名影集','Untitled collection')}</h3>{a.description&&<p>{a.description}</p>}<small>{a.photoIds.filter(id=>byId.has(id)).length} {t('张照片','photographs')}</small></div><ArrowUpRight className="public-collection-arrow"/></a>;})}</div>:<div className="public-empty"><p>{t('影集正在酝酿中，先去看看作品吧。','Collections are on their way. Explore the photographs meanwhile.')}</p><a href={pageHref('/photos')}>{t('浏览作品','Explore photographs')} <ArrowUpRight size={16}/></a></div>;}
  return <div className={'public-site'+(home?' public-home':'')} data-theme={theme} lang={lang}>
    <a className="public-skip" href="#public-main" onClick={e=>{e.preventDefault();main.current?.focus();main.current?.scrollIntoView();}}>{t('跳到主要内容','Skip to content')}</a>
    <header className="public-header"><a className="public-brand" href={pageHref('/')}><Aperture size={28}/><span>{portfolio?.title||t('光影集','Photo journal')}</span></a><nav aria-label={t('主导航','Main navigation')}>{[['/',t('首页','Home')],['/photos',t('作品','Photographs')],['/albums',t('影集','Collections')]].map(([path,label])=><a key={path} href={pageHref(path)} aria-current={route.path===path||(path==='/albums'&&album)?'page':undefined}>{label}</a>)}</nav><div className="public-actions"><button onClick={()=>setLang(lang==='zh'?'en':'zh')} aria-label={t('切换到英文','Switch to Chinese')}>{lang==='zh'?'EN':'中文'}</button><button onClick={()=>setTheme(theme==='dark'?'light':'dark')} aria-label={t(theme==='dark'?'切换到亮色主题':'切换到暗色主题',theme==='dark'?'Switch to light theme':'Switch to dark theme')}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button></div></header>
    <main id="public-main" ref={main} tabIndex={-1}>
      {status==='loading'?<section className="public-state" role="status" aria-live="polite"><Aperture size={44}/><h1>{t('正在展开光影…','Opening the journal…')}</h1><p>{t('作品即将呈现。','The photographs will be here in a moment.')}</p></section>:status==='error'?<section className="public-state" role="alert"><Aperture size={44}/><h1>{t('暂时无法读取作品','Unable to load the photographs')}</h1><p>{t('请检查网络连接，或稍后重试。','Check your connection or try again in a moment.')}</p><button onClick={()=>setRevision(n=>n+1)}>{t('重试','Try again')}</button></section>:<>
        {home&&<section className="public-hero" aria-label={t('摄影空间封面','Photography cover')}><div className="public-hero-image">{hero?<Picture key={`${hero.id}-${revision}`} photo={hero} t={t} full eager/>:<Aperture className="public-hero-mark" size={220} strokeWidth={.4}/>}</div><div className="public-hero-copy"><span className="public-eyebrow">{t('一个摄影者的视觉日记','A PHOTOGRAPHER’S VISUAL JOURNAL')}</span><h1>{portfolio?.title||t('在光影之间。','Between light and time.')}</h1><p>{portfolio?.intro||t('行走、凝望、记录。把值得记住的瞬间，留在这里。','Wander, observe, remember. A place for moments worth keeping.')}</p><a className="public-primary" href={pageHref('/photos')}>{t('浏览作品','Explore photographs')}<ArrowUpRight size={18}/></a></div><div className="public-hero-bottom"><button onClick={()=>document.getElementById('public-selected')?.scrollIntoView({behavior:reduced?'instant':'smooth'})}><ArrowDown size={16}/>{t('向下探索','Explore below')}</button>{hero&&<button className="public-cover-title" onClick={()=>openPhoto(hero.id)}>{photoTitle(hero,t)}<ArrowUpRight size={16}/></button>}{featured.length>1&&<div className="public-cover-controls"><button aria-label={t('上一张封面','Previous cover')} onClick={()=>setActive(n=>(n-1+featured.length)%featured.length)}><ArrowLeft size={18}/></button><span aria-live={playing?'off':'polite'}>{String(active%featured.length+1).padStart(2,'0')} / {String(featured.length).padStart(2,'0')}</span><button aria-label={t('下一张封面','Next cover')} onClick={()=>setActive(n=>(n+1)%featured.length)}><ArrowRight size={18}/></button>{!reduced&&<button aria-label={t(playing?'暂停封面轮播':'播放封面轮播',playing?'Pause cover slideshow':'Play cover slideshow')} aria-pressed={playing} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={16}/>:<Play size={16}/>}</button>}</div>}</div></section>}
        {!validPage?<section className="public-state"><h1>{t('没有找到这个页面','Page not found')}</h1><a href={pageHref('/')}>{t('回到首页','Back to home')}</a></section>:<>
          {(home||route.path==='/photos'||album)&&<section className="public-section" id="public-selected">{album&&<a className="public-back" href={pageHref('/albums')}><ArrowLeft size={16}/>{t('全部影集','All collections')}</a>}<header className="public-section-heading"><div><span className="public-eyebrow">{home?t('01 / 精选作品','01 / SELECTED PHOTOGRAPHS'):album?t('影集 / 作品','COLLECTION / PHOTOGRAPHS'):t('光影 / 作品','LIGHT / PHOTOGRAPHS')}</span>{home?<h2>{t('把瞬间，留成永恒。','Moments worth keeping.')}</h2>:<h1>{album?.title||t('全部作品','All photographs')}</h1>}{album?.description&&<p>{album.description}</p>}</div>{home&&<a href={pageHref('/photos')}>{t('全部作品','All photographs')}<ArrowUpRight size={16}/></a>}</header><div className="public-search-row"><label className="public-search"><Search size={18}/><input type="search" value={search} onChange={e=>setSearch(e.target.value)} aria-label={t('搜索标题、描述或标签','Search titles, descriptions or tags')} placeholder={t('搜索标题、描述或标签','Search titles, descriptions or tags')}/>{search&&<button onClick={()=>setSearch('')} aria-label={t('清除搜索','Clear search')}><X size={16}/></button>}</label><span role="status">{visible.length} {t('张照片','photographs')}</span></div>{gallery(visible)}</section>}
          {(home||isAlbums)&&<section className="public-section public-albums"><header className="public-section-heading"><div><span className="public-eyebrow">{home?t('02 / 影集','02 / COLLECTIONS'):t('故事 / 影集','STORIES / COLLECTIONS')}</span>{home?<h2>{t('每一程，都有回响。','Every journey leaves a story.')}</h2>:<h1>{t('影集','Collections')}</h1>}</div>{home&&<a href={pageHref('/albums')}>{t('全部影集','All collections')}<ArrowUpRight size={16}/></a>}</header>{collections()}</section>}
        </>}
        {route.photo&&!selected&&<section className="public-empty" role="status"><p>{t('这张照片尚未发布或已移除。','This photograph is unpublished or no longer available.')}</p><button onClick={()=>navigatePhoto('',true)}>{t('继续浏览','Continue browsing')}</button></section>}
      </>}
    </main>
    <footer className="public-footer"><div><Aperture size={20}/><span>{portfolio?.title||t('光影集','Photo journal')}</span></div><p>{t('以照片，记录所见。','A record of what we see.')}</p><nav aria-label={t('创作入口','Creator links')}><a href="?local=1#/tools">{t('创作工具','Creative tools')}<ArrowUpRight size={14}/></a><a href="?local=1#/">{t('本地图库','Local library')}<ArrowUpRight size={14}/></a></nav></footer>
    {status==='ready'&&selected&&<Lightbox photo={selected} photos={lightboxPhotos} t={t} onSelect={id=>navigatePhoto(id,true)} onClose={closePhoto}/>}
  </div>;
}
