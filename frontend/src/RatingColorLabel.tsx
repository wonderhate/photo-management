import {t} from './i18n';
import {Star} from 'lucide-react';

export function RatingStars({rating,onChange,readonly,size=16}:{rating:number|null;onChange?:(r:number|null)=>void;readonly?:boolean;size?:number}){
  return <span className="rating-stars">{[1,2,3,4,5].map(star=><button key={star} type="button" disabled={readonly} onClick={()=>onChange?.(rating===star?null:star)} aria-label={t("{0} 星",{0:star})}><Star size={size} className={star<=(rating||0)?'star-on':''} fill={star<=(rating||0)?'currentColor':'none'}/></button>)}</span>;
}

export function ColorLabelPicker({color,onChange,readonly}:{color:string|null;onChange?:(c:string|null)=>void;readonly?:boolean}){
  return <span className="color-dots">{(['red','yellow','green','blue'] as const).map(key=><button key={key} type="button" disabled={readonly} onClick={()=>onChange?.(color===key?null:key)} aria-label={{red:t("红色"),yellow:t("黄色"),green:t("绿色"),blue:t("蓝色")}[key]} aria-pressed={color===key} title={{red:t("红色"),yellow:t("黄色"),green:t("绿色"),blue:t("蓝色")}[key]} className={`color-dot-${key} ${color===key?'active':''}`}><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="var(--label-color)" strokeWidth={color===key?3.5:2.5}/>{color===key&&<circle cx="12" cy="12" r="2.5" fill="var(--label-color)"/>}</svg></button>)}</span>;
}

export function PhotoBadge({rating,colorLabel}:{rating:number|null;colorLabel:string|null}){
  if(!rating&&!colorLabel)return null;
  return <span className="photo-badges">{colorLabel&&<span className={`badge-color color-dot-${colorLabel}`}/>}{rating?<span className="badge-rating"><Star size={9} fill="currentColor"/>{rating}</span>:null}</span>;
}
