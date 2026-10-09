import {Star} from 'lucide-react';

export function RatingStars({rating,onChange,readonly,size=16}:{rating:number|null;onChange?:(r:number|null)=>void;readonly?:boolean;size?:number}){
  return <span className="rating-stars">{[1,2,3,4,5].map(star=><button key={star} type="button" disabled={readonly} onClick={()=>onChange?.(rating===star?null:star)} aria-label={`${star} 星`}><Star size={size} className={star<=(rating||0)?'star-on':''} fill={star<=(rating||0)?'currentColor':'none'}/></button>)}</span>;
}

export function ColorLabelPicker({color,onChange,readonly}:{color:string|null;onChange?:(c:string|null)=>void;readonly?:boolean}){
  return <span className="color-dots">{(['red','yellow','green','blue'] as const).map(key=><button key={key} type="button" disabled={readonly} onClick={()=>onChange?.(color===key?null:key)} title={{red:'红色',yellow:'黄色',green:'绿色',blue:'蓝色'}[key]} className={`color-dot-${key} ${color===key?'active':''}`}/>)}</span>;
}

export function PhotoBadge({rating,colorLabel}:{rating:number|null;colorLabel:string|null}){
  if(!rating&&!colorLabel)return null;
  return <span className="photo-badges">{colorLabel&&<span className={`badge-color color-dot-${colorLabel}`}/>}{rating?<span className="badge-rating"><Star size={9} fill="currentColor"/>{rating}</span>:null}</span>;
}
