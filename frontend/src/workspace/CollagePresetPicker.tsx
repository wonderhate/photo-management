import {useId} from 'react';
import {Check} from 'lucide-react';
import {bt} from '../browser/text';
import {collageRects} from '../core/collage';
import {COLLAGE_PRESETS,collagePresetCanvas} from '../core/collage-presets';
import type {CollagePresetId} from '../core/collage-presets';

export default function CollagePresetPicker({count,selected,disabled=false,batch=false,onSelect}:{count?:number;selected:CollagePresetId|null;disabled?:boolean;batch?:boolean;onSelect:(id:CollagePresetId)=>void}){
 const uid=useId().replace(/[^a-zA-Z0-9_-]/g,'');
 return <section className="collage-presets" aria-label={bt('精选拼图预设','Curated collage presets')}>
  <div className="collage-presets-heading"><div><span className="collage-presets-eyebrow">SIX WAYS TO TELL YOUR STORY</span><h3>{bt('从一套预设开始','Start with a preset')}</h3></div><p>{batch?bt('一键应用到全部页面，每页按照片数适配。','Apply to all pages, adapted to each photo count.'):count?bt('布局、比例与纸面一并应用，保留照片与取景，可撤销。','Apply layout, ratio and paper together. Photos and framing stay; undo anytime.'):bt('先选喜欢的样式，再添加照片。6 套预设均适配 1–12 张。','Choose a style, then add photos. All six adapt to 1–12 photos.')}</p></div>
  <div className="collage-preset-grid">{COLLAGE_PRESETS.map(p=>{
   const canvas=collagePresetCanvas(p.id,count||p.sampleCount),rects=collageRects({...canvas,sources:[],cells:[]}),active=selected===p.id;
   return <button key={p.id} type="button" className="collage-preset-card" data-preset={p.id} aria-label={bt('应用预设：','Apply preset: ')+bt(p.name[0],p.name[1])} aria-pressed={active} disabled={disabled} onClick={()=>onSelect(p.id)}>
    <div className="collage-preset-art"><svg viewBox={`0 0 ${canvas.width} ${canvas.height}`} aria-hidden="true" focusable="false">
     <rect width={canvas.width} height={canvas.height} fill={canvas.background}/>
     {rects.map((r,i)=>{const id=`${uid}-${p.id}-${i}`,shade=['#637d78','#839aab','#baa98c','#8a8875'][i%4];return <g key={i}><defs><clipPath id={id}><rect x={r.x} y={r.y} width={r.width} height={r.height} rx={canvas.radius*Math.min(r.width,r.height)}/></clipPath></defs><g clipPath={`url(#${id})`}><rect x={r.x} y={r.y} width={r.width} height={r.height} fill={shade}/><circle cx={r.x+r.width*.73} cy={r.y+r.height*.28} r={Math.min(r.width,r.height)*.1} fill="#f1dec0"/><path d={`M${r.x},${r.y+r.height*.8} L${r.x+r.width*.42},${r.y+r.height*.35} L${r.x+r.width},${r.y+r.height} H${r.x}Z`} fill="#283c3a" opacity=".72"/><path d={`M${r.x},${r.y+r.height} L${r.x+r.width*.75},${r.y+r.height*.52} L${r.x+r.width},${r.y+r.height*.7} V${r.y+r.height}Z`} fill="#d2c4a9" opacity=".65"/></g></g>;})}
    </svg><span>{p.ratio[0]}:{p.ratio[1]}</span></div>
    <div className="collage-preset-title"><strong>{bt(p.name[0],p.name[1])}</strong>{active&&<Check size={16} aria-hidden="true"/>}</div><p>{bt(p.description[0],p.description[1])}</p>
   </button>;
  })}</div>
  {!count&&selected&&<p className="collage-preset-ready" role="status">{bt('样式已选好，添加照片后自动应用。','Style selected. Add photos to apply it automatically.')}</p>}
 </section>;
}
