import {Flag,FlagOff,Minus} from 'lucide-react';
import {t} from './i18n';
import {photoFlag} from './core/photo-flag';
import type {PhotoFlag} from './core/photo-flag';
import {useShortcutBindings} from './workspace/useCommands';
import {displayKey,ariaShortcut} from './shortcuts';
export const flagLabel=(value:PhotoFlag)=>({picked:'留用',rejected:'排除',unmarked:'未标记'}[value]);
export default function PhotoFlagControls({value,disabled,onChange}:{value?:PhotoFlag;disabled?:boolean;onChange:(value:PhotoFlag)=>void}){
  const bindings=useShortcutBindings();
  return <div className="photo-flag-actions" role="group" aria-label={t('选片标记')}>{(['picked','rejected','unmarked'] as const).map((flag,i)=>{const binding=bindings[['flagPick','flagReject','flagClear'][i]];return <button key={flag} disabled={disabled} aria-pressed={photoFlag(value)===flag} aria-keyshortcuts={binding?ariaShortcut(binding):undefined} onClick={()=>onChange(flag)} title={t(flagLabel(flag))+(binding?' · '+displayKey(binding):'')}>{flag==='picked'?<Flag size={14}/>:flag==='rejected'?<FlagOff size={14}/>:<Minus size={14}/>}<span>{t(flag==='unmarked'?'清除标记':flagLabel(flag))}</span></button>;})}</div>;
}
export function PhotoFlagBadge({value}:{value?:PhotoFlag}){
  if(!value||value==='unmarked')return null;
  return <span className="badge-flag" title={t(flagLabel(value))} aria-label={t(flagLabel(value))}>{value==='picked'?<Flag size={12}/>:<FlagOff size={12}/>}</span>;
}
