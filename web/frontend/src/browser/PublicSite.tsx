import {useEffect,useMemo,useRef,useState} from 'react';
import {Aperture,ArrowDown,ArrowLeft,ArrowRight,ArrowUpRight,Check,Copy,Info,Moon,Pause,Play,Search,Sun,X,ZoomIn,ZoomOut} from 'lucide-react';
import {getLang,setStoredLang,type Lang} from '../i18n';
import {loadPortfolio,type Portfolio,type PublicPhoto} from './portfolio';
import {publicProfile} from './public-profile';
import release from './windows-release.json';
import ProductWalkthrough from './ProductWalkthrough';
import './public-site.css';
import './public-home.css';

type Translate=(zh:string,en:string)=>string;
function readRoute(){
  const hash=location.hash.slice(1)||'/',index=hash.indexOf('?');
  const path=index<0?hash:hash.slice(0,index),anchor=path.replace(/^\/#/,'');
  const section=['works','lumina','about','gallery'].includes(anchor)?anchor:'';
  return {path:section?'/':path,section,photo:new URLSearchParams(index<0?'':hash.slice(index+1)).get('photo')||new URLSearchParams(location.search).get('photo')||''};
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

/* Homepage layout from the approved redesign: hero photograph, 12-column selection,
   project block, about close. Photographs, routes, lightbox and i18n stay manifest-driven. */
const SPANS=['w7','w5','','','',''];

export default function PublicSite(){
  const [portfolio,setPortfolio]=useState<Portfolio|null>(null),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[revision,setRevision]=useState(0);
  const [route,setRoute]=useState(readRoute),[search,setSearch]=useState(''),[active,setActive]=useState(0),[playing,setPlaying]=useState(()=>!matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [lang,setLang]=useState<Lang>(()=>{try{return getLang();}catch{return 'zh';}});
  const [theme,setTheme]=useState<'light'|'dark'>(()=>{try{return localStorage.getItem('theme')==='light'?'light':'dark';}catch{return 'dark';}});
  const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [stuck,setStuck]=useState(false),[copied,setCopied]=useState(false);
  const main=useRef<HTMLElement>(null),openedHere=useRef(false),previousPath=useRef(route.path);
  const t:Translate=(zh,en)=>lang==='en'?en:zh;
  const profile=publicProfile[lang],creator=release.developer;
  const aboutHref=lang==='en'?'/en/about/':'/about/',projectHref=lang==='en'?'/en/lumina/':'/lumina/';
  const localHref=(path='/')=>'/?local=1&lang='+lang+'#'+path;
  const demoHref='/?local=1&demo=1&lang='+lang+'#/';
  useEffect(()=>{let alive=true;setStatus('loading');loadPortfolio().then(value=>{if(alive){setPortfolio(value);setStatus('ready');setActive(0);}}).catch(()=>{if(alive)setStatus('error');});return()=>{alive=false};},[revision]);
  useEffect(()=>{const change=()=>setRoute(readRoute());window.addEventListener('hashchange',change);window.addEventListener('popstate',change);return()=>{window.removeEventListener('hashchange',change);window.removeEventListener('popstate',change);};},[]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('theme',theme);}catch{}},[theme]);
  useEffect(()=>{document.documentElement.lang=lang;setStoredLang(lang);document.title=profile.title;for(const [selector,value]of [['meta[name="description"]',profile.description],['meta[property="og:title"]',profile.title],['meta[property="og:description"]',profile.description]])document.querySelector(selector)?.setAttribute('content',value);document.querySelector('link[rel="canonical"]')?.setAttribute('href','https://photomanagement.online'+(lang==='en'?'/en/':'/'));},[lang]);
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>{setReduced(media.matches);if(media.matches)setPlaying(false);};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{if(previousPath.current!==route.path){previousPath.current=route.path;setSearch('');openedHere.current=false;window.scrollTo({top:0,behavior:'instant'});main.current?.focus({preventScroll:true});}},[route.path]);
  useEffect(()=>{const onScroll=()=>setStuck(window.scrollY>8);onScroll();window.addEventListener('scroll',onScroll,{passive:true});return()=>window.removeEventListener('scroll',onScroll);},[]);
  useEffect(()=>{if(status!=='ready'||!route.section)return;const frame=requestAnimationFrame(()=>document.getElementById(route.section)?.scrollIntoView({block:'start',behavior:reduced?'instant':'smooth'}));return()=>cancelAnimationFrame(frame);},[status,route.section,reduced]);
  useEffect(()=>{if(status!=='ready')return;const nodes=Array.from(document.querySelectorAll<HTMLElement>('.public-home .rv'));if(!nodes.length)return;
    if(reduced||!('IntersectionObserver'in window)){nodes.forEach(node=>node.classList.add('in'));return;}
    const io=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('in');io.unobserve(entry.target);}},{rootMargin:'0px 0px -8% 0px',threshold:.12});
    nodes.forEach((node,index)=>{node.style.transitionDelay=`${Math.min(index,5)*60}ms`;io.observe(node);});
    return()=>io.disconnect();},[status,reduced,route.path]);
  const photos=portfolio?.photos||[];
  const byId=useMemo(()=>new Map(photos.map(p=>[p.id,p])),[portfolio]);
  const featured=useMemo(()=>{const selected=(portfolio?.featuredIds||[]).flatMap(id=>byId.get(id)?[byId.get(id)!]:[]);return selected.length||portfolio?.coverIds!==undefined?selected:photos.slice(0,12);},[portfolio,byId]);
  const covers=portfolio?.coverIds?.flatMap(id=>byId.get(id)?[byId.get(id)!]:[])??featured.slice(0,6),hero=covers[active%Math.max(covers.length,1)];
  useEffect(()=>{if(!playing||reduced||covers.length<2||route.path!=='/'||route.photo)return;const timer=setInterval(()=>{if(!document.hidden)setActive(n=>(n+1)%covers.length);},6500);return()=>clearInterval(timer);},[playing,reduced,covers.length,route.path,route.photo]);
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
  function switchLanguage(){const next=lang==='zh'?'en':'zh';setLang(next);const url=new URL(location.href);url.pathname=next==='en'?'/en/':'/';history.replaceState(null,'',url);}
  function openPhoto(id:string){openedHere.current=true;navigatePhoto(id);}
  function closePhoto(){if(openedHere.current){openedHere.current=false;history.back();}else navigatePhoto('',true);}
  function pageHref(path:string){const url=new URL(location.href);url.searchParams.delete('photo');url.hash=path;return url.pathname+url.search+url.hash;}
  function sectionHref(id:string){const url=new URL(location.href);url.searchParams.delete('photo');url.hash=id;return url.pathname+url.search+url.hash;}
  async function copyQQ(){
    try{await navigator.clipboard.writeText(creator.qq);}
    catch{const field=document.createElement('textarea');field.value=creator.qq;document.body.appendChild(field);field.select();try{document.execCommand('copy');}catch{}field.remove();}
    setCopied(true);setTimeout(()=>setCopied(false),2000);
  }
  function gallery(items:PublicPhoto[]){return items.length?<div className="public-gallery">{items.map((photo,i)=><button className="public-photo" key={photo.id} onClick={()=>openPhoto(photo.id)} aria-label={`${t('查看照片','View photograph')}: ${photoTitle(photo,t)}`}><Picture key={`${photo.id}-${revision}`} photo={photo} t={t}/><span className="public-photo-caption"><span><strong>{photoTitle(photo,t)}</strong>{photo.tags.length>0&&<small>{photo.tags.join(' / ')}</small>}</span><span className="public-photo-number">{String(i+1).padStart(2,'0')} <ArrowUpRight size={16}/></span></span></button>)}</div>:<div className="public-empty"><Aperture size={36}/><h3>{query?t('没有匹配的作品','No matching photographs'):t('静候下一束光。','Waiting for the next light.')}</h3><p>{query?t('试试其他标题、描述或标签。','Try another title, description or tag.'):t('这里还没有发布照片。欢迎稍后再来。','No photographs have been published here yet. Come back soon.')}</p>{query&&<button onClick={()=>setSearch('')}>{t('清除搜索','Clear search')}</button>}</div>;}
  function collections(){const albums=portfolio?.albums||[];return albums.length?<div className="public-collections">{(home?albums.slice(0,6):albums).map((a,i)=>{const cover=a.photoIds.map(id=>byId.get(id)).find(Boolean);return <a className="public-collection" key={a.id} href={pageHref('/albums/'+encodeURIComponent(a.id))}>{cover?<Picture photo={cover} t={t}/>:<div className="public-collection-placeholder"><Aperture size={64}/></div>}<span className="public-collection-index">{String(i+1).padStart(2,'0')}</span><div className="public-collection-copy"><h3>{a.title||t('未命名影集','Untitled collection')}</h3>{a.description&&<p>{a.description}</p>}<small>{a.photoIds.filter(id=>byId.has(id)).length} {t('张照片','photographs')}</small></div><ArrowUpRight className="public-collection-arrow"/></a>;})}</div>:<div className="public-empty"><p>{t('影集正在酝酿中，先去看看作品吧。','Collections are on their way. Explore the photographs meanwhile.')}</p><a href={pageHref('/photos')}>{t('浏览作品','Explore photographs')} <ArrowUpRight size={16}/></a></div>;}
  const pieces=featured.slice(0,6);
  return <div className={'public-site'+(home?' public-home':'')} data-theme={theme} lang={lang}>
    <a className="public-skip" href="#public-main" onClick={e=>{e.preventDefault();main.current?.focus();main.current?.scrollIntoView();}}>{t('跳到主要内容','Skip to content')}</a>
    <header className="hdr" data-stuck={stuck||undefined}>
      <div className="wrap hdr-in">
        <a className="home-brand" href={pageHref('/')} aria-label={t('Wonder · 光影集 — 回到首页','Wonder · Lumina — back to the homepage')}><b>Wonder</b><span>{t('光影集 / Lumina','Lumina')}</span></a>
        <nav className="nav" aria-label={t('主导航','Main navigation')}>
          <a href={home?sectionHref('works'):pageHref('/photos')} aria-current={home?'page':undefined}>{t('摄影作品','Photographs')}</a>
          <a href={aboutHref}>{t('关于我','About')}</a>
          <a href="/windows.html">{t('Windows 下载','Windows download')}</a>
        </nav>
        <div className="tools">
          <button className="icon-btn" type="button" onClick={()=>setTheme(theme==='dark'?'light':'dark')} aria-label={t(theme==='dark'?'切换到亮色主题':'切换到暗色主题',theme==='dark'?'Switch to light theme':'Switch to dark theme')}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button>
          <button className="lang" type="button" onClick={switchLanguage} aria-label={t('切换到英文','Switch to English')}>{lang==='zh'?'EN':'中文'}</button>
        </div>
      </div>
    </header>
    <main id="public-main" ref={main} tabIndex={-1}>
      {status==='loading'?<section className="public-state" role="status" aria-live="polite"><Aperture size={44}/><h1>{t('正在展开光影…','Opening the journal…')}</h1><p>{t('作品即将呈现。','The photographs will be here in a moment.')}</p></section>:status==='error'?<section className="public-state" role="alert"><Aperture size={44}/><h1>{t('暂时无法读取作品','Unable to load the photographs')}</h1><p>{t('请检查网络连接，或稍后重试。','Check your connection or try again in a moment.')}</p><button onClick={()=>setRevision(n=>n+1)}>{t('重试','Try again')}</button></section>:<>
        {home&&<>
          <section className="hero" aria-labelledby="hero-title">
            {hero?<img src={hero.src} alt={photoTitle(hero,t)} width={hero.width} height={hero.height} fetchPriority="high" decoding="async"/>:<span className="hero-placeholder" aria-hidden="true"><Aperture size={200} strokeWidth={.4}/></span>}
            <div className="wrap hero-in">
              <p className="eyebrow">Wonder / Photography &amp; Personal Projects</p>
              <h1 id="hero-title">{t('追光，也收藏','Chasing light, ')}<em>{t('时光','keeping time')}</em>{t('。','.')}</h1>
              <p className="lede">{profile.bio}</p>
              <div className="cta-row">
                <a className="btn btn-primary" href={sectionHref('works')}>{t('浏览摄影作品','Explore photographs')}<ArrowDown size={16}/></a>
                <a className="btn btn-ghost" href={localHref()}>{t('打开浏览器工具','Open browser tools')}<ArrowUpRight size={16}/></a>
              </div>
              <p className="entry-support">{t('管理自己的照片：电脑 Chrome / Edge · 本地处理 · 首次需选择数据目录。','For your own photos: desktop Chrome / Edge · local processing · choose a data folder to begin.')} <a href={demoHref}>{t('用示例体验','Try the sample')}<ArrowUpRight size={14}/></a></p>
              <div className="hero-foot">
                {hero?<button className="credit" type="button" onClick={()=>openPhoto(hero.id)}>{t('封面 · ','Cover · ')}{photoTitle(hero,t)}</button>:<span className="credit">{t('光影集 / Lumina','Lumina')}</span>}
                <span className="scroll-cue"><i aria-hidden="true"/>{t('下滑，看光影','Scroll for the light')}</span>
              </div>
            </div>
          </section>

          <section className="sec" id="works" aria-labelledby="works-title">
            <div className="wrap">
              <div className="sec-head rv"><div>
                <p className="eyebrow">01 / {t('精选作品','Selected work')}</p>
                <h2 id="works-title">{t('精选摄影作品','Selected photographs')}</h2>
                <p>{t('金色玻璃、砖石立面、晚霞中的船，与水边的人影和灯火。点开一张，慢慢看。','Golden glass, stone façades, a boat against the evening sky, and people and lights beside the water. Open a photograph and take a closer look.')}</p>
              </div><a className="link-arrow" href={pageHref('/photos')}>{t('全部作品','All photographs')}<ArrowUpRight size={15}/></a></div>
              <div className="works" id="gallery">
                {pieces.map((photo,index)=><button className={'piece rv '+(SPANS[index]||'')} key={photo.id} type="button" onClick={()=>openPhoto(photo.id)} aria-label={`${t('查看作品','View photograph')}: ${photoTitle(photo,t)}`}>
                  <img src={photo.thumbnail||photo.src} alt={`${photoTitle(photo,t)}${photo.description?' — '+photo.description:''}`} width={photo.width} height={photo.height} loading={index<2?'eager':'lazy'} decoding="async"/>
                  <span className="idx">{String(index+1).padStart(2,'0')}</span>
                  <span className="open" aria-hidden="true"/>
                  <span className="cap"><b>{photoTitle(photo,t)}</b><span>{photo.tags[0]||t('摄影作品','Photograph')}</span></span>
                </button>)}
                <a className="tile-more rv" href={pageHref('/photos')}>
                  <p className="eyebrow">{t('全部作品','All photographs')}</p>
                  <h3>{t('继续看摄影作品。','More photographs to explore.')}</h3>
                  <p>{t('按标题、描述或标签搜索已发布的作品，打开照片查看大图与作品说明。','Search published photographs by title, description or tag, then open an image to read its description and see it larger.')}</p>
                  <span className="link-arrow" aria-hidden="true">{t('浏览全部摄影作品','Browse all photographs')}<ArrowUpRight size={15}/></span>
                </a>
              </div>
            </div>
          </section>

          {!!portfolio?.albums.length&&<section className="public-section public-albums" aria-labelledby="home-collections-title"><header className="public-section-heading"><div><span className="public-eyebrow">{t('沿着一个主题，看下去','FOLLOW A THEME')}</span><h2 id="home-collections-title">{t('主题系列','Photo series')}</h2></div><a className="link-arrow" href={pageHref('/albums')}>{t('全部系列','All series')}<ArrowUpRight size={15}/></a></header>{collections()}</section>}

          <section className="sec lumina" id="lumina" aria-labelledby="lumina-title">
            <div className="wrap lumina-grid">
              <div className="rv">
                <p className="eyebrow">02 / {t('个人项目','Personal project')}</p>
                <h2 id="lumina-title">{t('从一组照片，到一张可以分享的作品。','From a folder of photos to an image ready to share.')}</h2>
                <p className="lede">{t('光影集 / Lumina 是管理自己照片的本地工具。整理影集、调整画面、添加署名，再导出新文件；原片留在原处。先用示例看看调整与导出的结果。','Lumina is a local tool for your own photographs. Organize albums, adjust an image, add a signature and export a new file, keeping the original in place. Try the sample to see an edit and export for yourself.')}</p>
                <ul className="chips">{[t('浏览器目录授权','Browser folder access'),t('原片只读','Originals read-only'),t('导出另存新文件','Exports are new files'),t('中英界面 · 深浅主题','Bilingual · light & dark')].map(label=><li key={label}>{label}</li>)}</ul>
                <p className="notes">{t('日常图库和本地图像工具在浏览器内处理；可选的水彩与标题建议使用自行配置的云端服务，仅在确认后发送所选图片。','Everyday library and local image tools run in the browser; optional watercolor and title suggestions use a cloud service you configure and only send selected images after confirmation.')}</p>
                <div className="cta-row">
                  <a className="btn btn-primary" href={demoHref}>{t('用示例体验','Try the sample')}<ArrowUpRight size={16}/></a>
                  <a className="btn btn-line" href={localHref()}>{t('打开浏览器工具','Open browser tools')}</a>
                </div>
                <p className="entry-support">{t('电脑 Chrome / Edge · 本地处理。示例不读取自己的照片；使用个人图库时需选择数据目录。','Desktop Chrome / Edge · local processing. The sample does not read your photos; a personal library needs a data folder.')} <a href={projectHref}>{t('了解项目与使用边界','Project details and limits')}</a></p>
              </div>
              <div className="feat rv">
                {[
                  ['LIBRARY',t('整理自己的照片','Organize your photographs'),t('导入照片，整理影集，按拍摄信息浏览和筛选。图库记录与作品保存在你授权的本地数据目录。','Import photographs, organize collections and browse or filter by shooting details. Records and creations live in the local folder you authorize.')],
                  ['DARKROOM',t('在光影暗房里继续创作','Keep creating in the darkroom'),t('查看照片分析，调整画面，尝试参考图仿色或受支持的 RAW 文件。兼容性受格式、设备和浏览器资源影响。','Analyze a photograph, adjust it, try color matching or work with supported RAW files. Compatibility depends on format, device and browser resources.')],
                  ['WATERMARK',t('为作品制作参数水印','Camera-settings watermarks'),t('选图、调整版式和署名，再导出一份新文件。拍摄参数取自照片可用的 EXIF，缺失的字段不会凭空补齐。','Pick a photograph, adjust the layout and signature, then export a new file. Shooting settings come from available EXIF; missing fields are not invented.')]
                ].map(([no,title,body],index)=><article key={no}><span className="no">{String(index+1).padStart(2,'0')}<br/>{no}</span><div><h3>{title}</h3><p>{body}</p></div></article>)}
              </div>
            </div>
          </section>

          <section className="sec product-section" aria-labelledby="product-preview-title"><div className="wrap"><ProductWalkthrough lang={lang} demoHref={demoHref}/></div></section>

          <section className="sec" id="about" aria-labelledby="about-title">
            <div className="wrap about-grid">
              <div className="rv">
                <p className="eyebrow">03 / {t('关于','About')}</p>
                <h2 id="about-title">{t('先用作品认识我，也可以从一款小工具开始交流。','Meet me through the photographs, or start with a small tool.')}</h2>
                <p className="about-copy">{t('这个网站是我的个人空间：分享喜欢的画面，也记录把想法做成实际项目的过程。开发过程中结合 AI 辅助完成实现，重点记录需求判断、功能整合、测试与上线维护的实际过程。','This is a personal space: photographs I like, and the process of turning ideas into working projects. AI assistance is used during implementation, while decisions, integration, testing and maintenance are documented here.')}</p>
                <p className="quote">{t('一个清楚的反馈，往往比一个很大的数字更有用。','A clear piece of feedback is often more useful than a large number.')}</p>
              </div>
              <div className="contact rv">
                <h3>{t('认识一下，从一句你好开始。','Say hello.')}</h3>
                <p>{t('摄影、工具体验、个人项目，或一个具体的改进建议，都欢迎聊聊。添加时可以备注「来自光影集」。','Photographs, tool feedback, personal projects or a concrete improvement idea — all welcome. Mention Lumina when you add me.')}</p>
                <div className="qq">
                  <div><span>{t('QQ','QQ')}</span><br/><b>{creator.qq}</b></div>
                  <button className="copy" type="button" onClick={()=>void copyQQ()} data-done={copied||undefined}>{copied?<Check size={14}/>:<Copy size={14}/>}<span>{copied?t('已复制','Copied'):t('复制号码','Copy number')}</span></button>
                </div>
                <p className="contact-note">{t('请先描述问题，不必发送私人原图、文件路径或任何 API Key。','Describe the issue first; private originals, file paths and API keys are never needed.')}</p>
              </div>
            </div>
          </section>
        </>}
        {!validPage?<section className="public-state"><h1>{t('没有找到这个页面','Page not found')}</h1><a href={pageHref('/')}>{t('回到首页','Back to home')}</a></section>:<>
          {(route.path==='/photos'||album)&&<section className="public-section" id="public-selected">{album&&<a className="public-back" href={pageHref('/albums')}><ArrowLeft size={16}/>{t('全部影集','All collections')}</a>}<header className="public-section-heading"><div><span className="public-eyebrow">{album?t('影集 / 作品','COLLECTION / PHOTOGRAPHS'):t('光影 / 作品','LIGHT / PHOTOGRAPHS')}</span>{album?<h1>{album.title}</h1>:<h1>{t('全部作品','All photographs')}</h1>}{album?.description&&<p>{album.description}</p>}</div></header><div className="public-search-row"><label className="public-search"><Search size={18}/><input type="search" value={search} onChange={e=>setSearch(e.target.value)} aria-label={t('搜索标题、描述或标签','Search titles, descriptions or tags')} placeholder={t('搜索标题、描述或标签','Search titles, descriptions or tags')}/>{search&&<button onClick={()=>setSearch('')} aria-label={t('清除搜索','Clear search')}><X size={16}/></button>}</label><span role="status">{visible.length} {t('张照片','photographs')}</span></div>{gallery(visible)}</section>}
          {isAlbums&&<section className="public-section public-albums"><header className="public-section-heading"><div><span className="public-eyebrow">{t('故事 / 影集','STORIES / COLLECTIONS')}</span><h1>{t('影集','Collections')}</h1></div></header>{collections()}</section>}
        </>}
        {route.photo&&!selected&&<section className="public-empty" role="status"><p>{t('这张照片尚未发布或已移除。','This photograph is unpublished or no longer available.')}</p><button onClick={()=>navigatePhoto('',true)}>{t('继续浏览','Continue browsing')}</button></section>}
      </>}
    </main>
    {!home&&<section className="public-lumina" id="public-lumina" tabIndex={-1} aria-labelledby="public-lumina-title"><div><span className="public-eyebrow">LUMINA / YOUR OWN PHOTOGRAPHS</span><h2 id="public-lumina-title">{t('也为自己的照片，留一处创作空间。','A creative space for your own photographs.')}</h2><p>{t('浏览器工具用于整理自己的本地照片、调整画面和导出水印作品。电脑 Chrome / Edge · 本地处理 · 首次需选择数据目录。','Use the browser tools to organize your local photos, make adjustments and export watermarked images. Desktop Chrome / Edge · local processing · choose a data folder to begin.')}</p></div><div className="public-lumina-actions"><a className="public-primary" href={localHref()}><Aperture size={21}/>{t('打开浏览器工具','Open browser tools')}<ArrowUpRight size={20}/></a><a className="public-lumina-windows" href={demoHref}>{t('用示例体验','Try the sample')}<ArrowUpRight size={16}/></a><a className="public-lumina-windows" href="/windows.html">{t('下载 Windows 版','Download for Windows')}<ArrowUpRight size={16}/></a></div><Aperture className="public-lumina-mark" size={260} strokeWidth={.35} aria-hidden="true"/></section>}
    <footer className="ftr"><div className="wrap ftr-in">
      <span className="fine">Wonder · {t('光影集 / Lumina','Lumina')}</span>
      <nav aria-label={t('页脚导航','Footer navigation')}>
        <a href={pageHref('/photos')}>{t('摄影作品','Photographs')}</a>
        <a href={aboutHref}>{t('关于我','About')}</a>
        <a href={projectHref}>{t('光影集项目','Lumina project')}</a>
        <a href="/windows.html">{t('Windows 下载','Windows download')}</a>
      </nav>
      <span className="fine">© {new Date().getFullYear()} Wonder</span>
    </div></footer>
    {status==='ready'&&selected&&<Lightbox photo={selected} photos={lightboxPhotos} t={t} onSelect={id=>navigatePhoto(id,true)} onClose={closePhoto}/>}
  </div>;
}
