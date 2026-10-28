import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {MoreHorizontal,Check} from 'lucide-react';
import {displayKey,ariaShortcut,SHORTCUTS} from '../shortcuts';
import type {CommandSurface} from './useCommands';
import './commands.css';

export default function CommandMenu({surface,ids,label}:{surface:CommandSurface;ids:string[];label:string}){
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:8,top:8}),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),id=useId();
  const visible=ids.filter(id=>surface.commands[id]&&SHORTCUTS[id]?.scopes.includes(surface.scope));
  function close(focus=false){setOpen(false);if(focus)trigger.current?.focus();}
  useEffect(()=>{setOpen(false);},[surface.scope]);
  useLayoutEffect(()=>{
    if(!open)return;const place=()=>{const button=trigger.current?.getBoundingClientRect(),menu=panel.current;if(!button||!menu)return;const top=button.bottom+menu.offsetHeight+6<=innerHeight?button.bottom+6:Math.max(8,button.top-menu.offsetHeight-6),left=Math.max(8,Math.min(button.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8));setPosition(previous=>previous.top===top&&previous.left===left?previous:{top,left});};
    place();(panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')||panel.current)?.focus();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!panel.current?.contains(event.target)&&!trigger.current?.contains(event.target))close();};document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);},[open]);
  useEffect(()=>{if(!open)return;const changed=()=>close(true);document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed);},[open]);
  if(!visible.length)return null;
  return <><button ref={trigger} className="icon command-menu-trigger" type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);}}}><MoreHorizontal size={18}/></button>{open&&createPortal(<div ref={panel} id={id} role="menu" aria-label={label} tabIndex={-1} data-command-menu className="command-menu" style={position} onBlur={event=>{const next=event.relatedTarget;if(next instanceof Node&&!event.currentTarget.contains(next)&&!trigger.current?.contains(next))close();}} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
    if(event.key==='Tab'){close(true);return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=items.indexOf(document.activeElement as HTMLButtonElement);const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;items[next]?.focus();}
  }}>{visible.map(command=><button key={command} type="button" role={surface.commands[command].checked===undefined?'menuitem':'menuitemcheckbox'} aria-label={surface.label(command)} aria-keyshortcuts={surface.bindings[command]?ariaShortcut(surface.bindings[command]):undefined} aria-checked={surface.commands[command].checked} disabled={!surface.enabled(command)} onClick={()=>{close(true);surface.run(command);}}><span className="command-check">{surface.commands[command].checked&&<Check size={14}/>}</span><span>{surface.label(command)}</span><kbd>{surface.bindings[command]?displayKey(surface.bindings[command]):''}</kbd></button>)}</div>,document.fullscreenElement||document.body)}</>;
}
