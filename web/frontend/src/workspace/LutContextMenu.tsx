import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import './commands.css';
export type LutMenuAction={id:string;label:string;run:()=>void|Promise<void>;checked?:boolean;disabled?:boolean};
export default function LutContextMenu({label,anchor,x,y,actions,onClose}:{label:string;anchor:HTMLElement;x:number;y:number;actions:LutMenuAction[];onClose:(focus?:boolean)=>void}){
 const panel=useRef<HTMLDivElement>(null),[position,setPosition]=useState({left:x,top:y});
 useLayoutEffect(()=>{const menu=panel.current;if(!menu)return;setPosition({left:Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8)),top:Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))});menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();},[x,y]);
 useEffect(()=>{const outside=(e:PointerEvent)=>{if(e.target instanceof Node&&!panel.current?.contains(e.target)&&!anchor.contains(e.target))onClose();};const close=()=>onClose();document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',close);document.addEventListener('fullscreenchange',close);return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',close);document.removeEventListener('fullscreenchange',close);};},[anchor,onClose]);
 return createPortal(<div className="command-menu lut-context-menu" data-command-menu role="menu" aria-label={label} ref={panel} style={position} tabIndex={-1} onBlur={e=>{if(e.relatedTarget instanceof Node&&!e.currentTarget.contains(e.relatedTarget))onClose();}} onKeyDown={e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose(true);}else if(e.key==='Tab')onClose(true);
  else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();const items=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],at=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:e.key==='ArrowDown'?(at+1)%items.length:(at-1+items.length)%items.length]?.focus();}
 }}>{actions.map(action=><button key={action.id} role={action.checked===undefined?'menuitem':'menuitemradio'} aria-checked={action.checked} disabled={action.disabled} onClick={async()=>{onClose();try{await action.run();}finally{onClose(true);}}}><span className="command-check">{action.checked?'✓':''}</span><span>{action.label}</span></button>)}</div>,document.fullscreenElement||document.body);
}
