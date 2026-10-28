import {useCallback,useEffect,useRef,useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent} from 'react';
import {SHORTCUTS,SHORTCUT_CHANGE,getBindings,shortcutAction,displayKey,ariaShortcut} from '../shortcuts';
import type {ShortcutScope} from '../shortcuts';
import {t} from '../i18n';

export type Command={run:()=>unknown;enabled?:boolean;checked?:boolean;label?:string};
export type Commands=Record<string,Command>;
export function useShortcutBindings(){
  const [bindings,setBindings]=useState(getBindings);
  useEffect(()=>{const refresh=()=>setBindings(getBindings());const storage=(event:StorageEvent)=>{if(event.key==='shortcuts'||event.key===null)refresh();};window.addEventListener(SHORTCUT_CHANGE,refresh);window.addEventListener('storage',storage);return()=>{window.removeEventListener(SHORTCUT_CHANGE,refresh);window.removeEventListener('storage',storage);};},[]);
  return bindings;
}
type Options={active?:boolean;listen?:boolean;exclusive?:boolean;allowedModal?:()=>Element|null;onError:(error:unknown)=>void};
export function useCommands(scope:ShortcutScope,commands:Commands,options:Options){
  const bindings=useShortcutBindings(),[,refresh]=useState(0),pending=useRef(new Set<string>()),alive=useRef(true),current=useRef({scope,commands,options,bindings});current.current={scope,commands,options,bindings};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const enabled=useCallback((id:string)=>{const own=current.current,item=own.commands[id];return own.options.active!==false&&!!item&&item.enabled!==false&&!!SHORTCUTS[id]?.scopes.includes(own.scope)&&!pending.current.has(id)&&(!own.options.exclusive||pending.current.size===0);},[]);
  const modalBlocked=useCallback(()=>{const top=[...document.querySelectorAll('[aria-modal=true]')].at(-1);return !!top&&top!==current.current.options.allowedModal?.();},[]);
  const run=useCallback((id:string)=>{
    if(!enabled(id)||modalBlocked())return false;
    const error=(reason:unknown)=>{if(alive.current)current.current.options.onError(reason);};
    try{const result=current.current.commands[id].run();if(result&&typeof (result as PromiseLike<unknown>).then==='function'){
      pending.current.add(id);refresh(value=>value+1);void Promise.resolve(result).catch(error).finally(()=>{pending.current.delete(id);if(alive.current)refresh(value=>value+1);});
    }}catch(reason){error(reason);}return true;
  },[enabled,modalBlocked]);
  const dispatch=useCallback((event:KeyboardEvent|ReactKeyboardEvent)=>{
    const target=event.target instanceof Element?event.target:null,own=current.current,native='nativeEvent' in event?event.nativeEvent:event;
    if(own.options.active===false)return false;
    const action=shortcutAction(native,own.bindings,{scope:own.scope,typing:!!target?.closest('input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox]'),recording:!!target?.closest('[data-shortcut-recorder]'),modal:modalBlocked(),menu:!!document.querySelector('[data-command-menu]')});
    if(!action||!own.commands[action])return false;
    event.preventDefault();if(!native.repeat||SHORTCUTS[action].repeatable!==false)run(action);return true;
  },[run,modalBlocked]);
  useEffect(()=>{if(!options.listen)return;const key=(event:KeyboardEvent)=>{dispatch(event);};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[options.listen,dispatch]);
  const label=(id:string)=>commands[id]?.label||t(SHORTCUTS[id]?.label||id);
  const props=(id:string)=>({disabled:!enabled(id),onClick:()=>{run(id);},title:label(id)+(bindings[id]?' · '+displayKey(bindings[id]):''),'aria-keyshortcuts':bindings[id]?ariaShortcut(bindings[id]):undefined});
  return {scope,commands,bindings,enabled,run,dispatch,label,props};
}
export type CommandSurface=ReturnType<typeof useCommands>;
