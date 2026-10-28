import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Download,ChevronDown} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {t,getLang} from '../i18n';
import {IS_BROWSER} from '../runtime';

export interface WorkspaceNavItem {id:string;label:string;icon:LucideIcon;active?:boolean;select:()=>void}
const groups=[
  {zh:'照片',en:'Photos',ids:['photos','locations','favorite','videos','timeline']},
  {zh:'整理',en:'Organize',ids:['albums','smart','faces','stats','reports']},
  {zh:'创作',en:'Create',ids:['tools','watermark','watermark-gallery','watercolor','ai-studio']},
  {zh:'偏好',en:'Preferences',ids:['settings']},
];
export default function WorkspaceNavigation({items}:{items:WorkspaceNavItem[]}){
  const nav=useRef<HTMLElement>(null),panel=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const [expanded,setExpanded]=useState(false);
  const [narrow,setNarrow]=useState(()=>matchMedia('(max-width: 760px)').matches);
  const english=getLang()==='en',bt=(zh:string,en:string)=>english?en:zh;
  const primary=new Set(narrow?['photos','albums','tools']:['photos','locations','favorite','albums','tools','watermark-gallery']);
  const selected=items.find(item=>item.active&&item.id==='favorite')||items.find(item=>item.active);
  const extras=items.filter(item=>!primary.has(item.id));
  const extraActive=extras.some(item=>item===selected);
  useEffect(()=>{const query=matchMedia('(max-width: 760px)');const change=()=>{setNarrow(query.matches);setExpanded(false);};query.addEventListener('change',change);return()=>query.removeEventListener('change',change);},[]);
  useEffect(()=>{
    const node=nav.current,topbar=node?.previousElementSibling as HTMLElement|null;if(!node)return;
    const measure=()=>{const shell=node.closest<HTMLElement>('.app-shell');shell?.style.setProperty('--workspace-nav-height',node.offsetHeight+'px');if(topbar)shell?.style.setProperty('--workspace-topbar-height',topbar.offsetHeight+'px');};
    measure();const observer=new ResizeObserver(measure);observer.observe(node);if(topbar)observer.observe(topbar);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!expanded)return;
    const pointer=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setExpanded(false);};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setExpanded(false);trigger.current?.focus();}};
    const focus=(event:FocusEvent)=>{if(!panel.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setExpanded(false);};
    document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);document.addEventListener('focusin',focus);
    return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);document.removeEventListener('focusin',focus);};
  },[expanded]);
  function button(item:WorkspaceNavItem){return <button key={item.id} type="button" className="workspace-nav-icon" aria-label={t(item.label)} aria-current={selected===item?'page':undefined} onClick={()=>{setExpanded(false);item.select();}}><item.icon size={18} aria-hidden="true"/><span>{t(item.label)}</span></button>;}
  return <nav ref={nav} className="workspace-subnav workspace-labeled-nav" aria-label={t('工作区导航')}>
    {groups.map(group=>{const choices=items.filter(item=>primary.has(item.id)&&group.ids.includes(item.id));return choices.length>0&&<div key={group.en} className="workspace-nav-group"><span className="workspace-nav-heading">{bt(group.zh,group.en)}</span><div>{choices.map(button)}</div></div>;})}
    <button ref={trigger} type="button" className="workspace-nav-icon workspace-more-trigger" aria-label={bt('更多功能','More features')} aria-expanded={expanded} aria-controls="workspace-more-panel" data-active={extraActive||undefined} onClick={()=>setExpanded(value=>!value)}><span>{extraActive?t(selected!.label):bt('更多','More')}</span><ChevronDown size={16} aria-hidden="true"/></button>
    {expanded&&<div ref={panel} id="workspace-more-panel" className="workspace-more-panel" data-liquid-glass="panel" aria-label={bt('更多功能','More features')}>
      {groups.map(group=>{const choices=extras.filter(item=>group.ids.includes(item.id));return choices.length>0&&<section key={group.en}><h2>{bt(group.zh,group.en)}</h2><div>{choices.map(button)}</div></section>;})}
      {IS_BROWSER&&<div className="workspace-site-links">
        {import.meta.env.VITE_PUBLIC_SHOWCASE==='true'&&<a className="workspace-nav-icon workspace-portfolio-link" href={english?'/en/':'/'}><ArrowLeft size={17}/>{bt('返回作品展示','Back to portfolio')}</a>}
        <a className="workspace-nav-icon windows-download-link" href="/windows.html?local=1" target="_blank" rel="noopener noreferrer" aria-label={bt('Windows 版下载（新窗口）','Download for Windows (new tab)')}><Download size={17}/>{bt('Windows 下载 ↗','Windows download ↗')}</a>
      </div>}
    </div>}
  </nav>;
}
