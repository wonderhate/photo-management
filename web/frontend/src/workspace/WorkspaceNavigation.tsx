import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,Download} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {t,getLang} from '../i18n';
import {IS_BROWSER} from '../runtime';

export interface WorkspaceNavItem {id:string;label:string;icon:LucideIcon;active?:boolean;select:()=>void}
export default function WorkspaceNavigation({items}:{items:WorkspaceNavItem[]}){
  const nav=useRef<HTMLElement>(null);
  const [tip,setTip]=useState<{id:string;label:string;x:number;y:number}|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  function hide(){clearTimeout(timer.current);timer.current=undefined;setTip(null);}
  function reveal(button:HTMLElement,item:{id:string;label:string}){
    const rect=button.getBoundingClientRect();
    setTip({id:item.id,label:t(item.label),x:Math.max(80,Math.min(innerWidth-80,rect.left+rect.width/2)),y:rect.bottom+7});
  }
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>{
    const node=nav.current,topbar=node?.previousElementSibling as HTMLElement|null;if(!node)return;
    const measure=()=>{const shell=node.closest<HTMLElement>('.app-shell');shell?.style.setProperty('--workspace-nav-height',node.offsetHeight+'px');if(topbar)shell?.style.setProperty('--workspace-topbar-height',topbar.offsetHeight+'px');};
    measure();const observer=new ResizeObserver(measure);observer.observe(node);if(topbar)observer.observe(topbar);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{const hide=()=>{clearTimeout(timer.current);setTip(null);};const key=(event:KeyboardEvent)=>{if(event.key==='Escape')hide();};addEventListener('scroll',hide,true);addEventListener('resize',hide);document.addEventListener('visibilitychange',hide);document.addEventListener('keydown',key);return()=>{removeEventListener('scroll',hide,true);removeEventListener('resize',hide);document.removeEventListener('visibilitychange',hide);document.removeEventListener('keydown',key);};},[]);
  const english=getLang()==='en';
  const siteLinks=IS_BROWSER?[
    ...(import.meta.env.VITE_PUBLIC_SHOWCASE==='true'?[{id:'portfolio',label:english?'Back to portfolio':'返回作品展示',href:english?'/en/':'/',icon:ArrowLeft,newTab:false,className:'workspace-portfolio-link'}]:[]),
    {id:'download',label:english?'Download for Windows (new tab)':'Windows 版下载（新窗口）',href:'/windows.html?local=1',icon:Download,newTab:true,className:'windows-download-link'},
  ]:[];
  return <>
    <nav ref={nav} className="workspace-subnav" aria-label={t('工作区导航')}>
      {items.map(item=><button key={item.id} type="button" className="workspace-nav-icon" aria-label={t(item.label)} aria-current={item.active?'page':undefined} aria-describedby={tip?.id===item.id?'workspace-nav-tooltip':undefined}
        onPointerEnter={event=>{if(event.pointerType==='touch')return;hide();const button=event.currentTarget;timer.current=setTimeout(()=>reveal(button,item),1000);}}
        onPointerLeave={hide} onFocus={event=>{if(event.currentTarget.matches(':focus-visible'))reveal(event.currentTarget,item);}} onBlur={hide}
        onClick={()=>{hide();item.select();}}><item.icon size={18}/></button>)}
      {siteLinks.length>0&&<span className="workspace-site-links">{siteLinks.map(item=><a key={item.id} className={'workspace-nav-icon '+item.className} href={item.href} target={item.newTab?'_blank':undefined} rel={item.newTab?'noopener noreferrer':undefined} aria-label={item.label} aria-describedby={tip?.id===item.id?'workspace-nav-tooltip':undefined}
        onPointerEnter={event=>{if(event.pointerType==='touch')return;hide();const link=event.currentTarget;timer.current=setTimeout(()=>reveal(link,item),1000);}}
        onPointerLeave={hide} onFocus={event=>{if(event.currentTarget.matches(':focus-visible'))reveal(event.currentTarget,item);}} onBlur={hide} onClick={hide}><item.icon size={18}/></a>)}</span>}
    </nav>
    {tip&&createPortal(<span role="tooltip" id="workspace-nav-tooltip" className="workspace-nav-tooltip" style={{left:tip.x,top:tip.y}}>{tip.label}</span>,document.body)}
  </>;
}
