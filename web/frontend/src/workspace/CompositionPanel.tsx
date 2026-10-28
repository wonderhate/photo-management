import {useRef} from 'react';
import type {RefObject} from 'react';
import {RotateCw,RotateCcw} from 'lucide-react';
import {bt} from '../browser/text';
import type {EditRecipe} from '../browser/editing';
import {aspectRecipe,straightenRecipe,turnRecipe,flipRecipe,compositionZoom,compositionView,zoomRecipe,compositionBase,trackCompositionView} from '../core/composition-recipe';
import {compositionBasis,cropCenter,fitCrop,moveCrop} from '../core/composition-geometry';
import type {Size,CompositionView} from '../core/composition-geometry';

type Props={recipe:EditRecipe;source:Size;active:boolean;gesturing:boolean;trigger:RefObject<HTMLButtonElement|null>;onToggle:()=>void;onChange:(patch:Partial<EditRecipe>)=>void;onBegin:()=>void;onEnd:(commit:boolean)=>void;onView:(view:CompositionView)=>void;view:CompositionView};
export default function CompositionPanel({recipe,source,active,gesturing,trigger,onToggle,onChange,onBegin,onEnd,onView,view}:Props){
  type Baseline={recipe:EditRecipe;view:CompositionView};const rulerBase=useRef<Baseline|null>(null),zoomBase=useRef<Baseline|null>(null),zoom=compositionZoom(recipe,source);
  const size=compositionBasis(source,recipe.rotation),angle=recipe.version!==1?recipe.composition.angle:0,aspect=recipe.version!==1?recipe.composition.aspect:undefined;
  const ratios=[{label:bt('自由','Free'),value:''},{label:bt('原始比例','Original ratio'),value:String(size.width/size.height)},...[[1,1],[3,2],[2,3],[4,3],[3,4],[16,9],[9,16],[4,5],[5,4],[2.35,1],[1,2.35]].map(([w,h])=>({label:`${w} : ${h}`,value:String(w/h)}))];
  if(aspect&&!ratios.some(r=>Math.abs(Number(r.value)/aspect-1)<1e-6))ratios.push({label:bt('当前比例','Current ratio')+` · ${aspect.toFixed(4)}`,value:String(aspect)});
  const selected=aspect?ratios.find(r=>r.value&&Math.abs(Number(r.value)/aspect-1)<1e-6)?.value||String(aspect):'';
  function beginAngle(){if(!rulerBase.current){rulerBase.current={recipe,view};onBegin();}}
  function endAngle(commit:boolean){if(!commit&&rulerBase.current)onView(rulerBase.current.view);rulerBase.current=null;onEnd(commit);}
  function setAngle(angle:number){if(!rulerBase.current&&angle===(recipe.version!==1?recipe.composition.angle:0))return;const base=rulerBase.current||{recipe,view},next=straightenRecipe(base.recipe,source,angle);onChange({version:next.version,crop:next.crop,composition:next.composition});onView(trackCompositionView(base.recipe,next,base.view));}
  function commit(next:EditRecipe){onChange(next);onView(compositionView(next,source));}
  function beginZoom(){if(!zoomBase.current){zoomBase.current={recipe,view};onBegin();}}
  function endZoom(commit:boolean){if(!commit&&zoomBase.current)onView(zoomBase.current.view);zoomBase.current=null;onEnd(commit);}
  function setZoom(value:number){const base=zoomBase.current||{recipe,view},next=zoomRecipe(base.recipe,source,value);onChange({version:next.version,crop:next.crop,composition:next.composition});onView(trackCompositionView(base.recipe,next,base.view));}
  function cropValue(key:'x'|'y'|'width'|'height',value:number){
    const crop={...recipe.crop,[key]:value};
    if(recipe.version===1){crop.width=Math.min(crop.width,1-crop.x);crop.height=Math.min(crop.height,1-crop.y);onChange({crop});return;}
    if(key==='x'||key==='y'){onChange({crop:moveCrop(recipe.crop,size,angle,{x:key==='x'?value-recipe.crop.x:0,y:key==='y'?value-recipe.crop.y:0})});return;}
    if(aspect){if(key==='width')crop.height=crop.width*size.width/aspect/size.height;else crop.width=crop.height*size.height*aspect/size.width;}
    const center=cropCenter(recipe.crop);crop.x=center.x-crop.width/2;crop.y=center.y-crop.height/2;onChange({crop:fitCrop(crop,size,angle)});
  }
  return <details className="composition-panel"><summary>{bt('构图','Composition')}</summary>
    <button ref={trigger} className="interactive-crop-trigger" aria-pressed={active} disabled={gesturing} onClick={onToggle}>{bt(active?'退出交互裁剪':'交互裁剪',active?'Exit interactive crop':'Interactive crop')}</button>
    <p className="muted">{bt('八个边角、三分线和方向键微调。调整另存为参数，原片保持不变。','Eight handles, thirds guides and arrow-key adjustments. Changes are saved as parameters; the original stays unchanged.')}</p>
    <div className="button-row"><button disabled={gesturing} onClick={()=>commit(turnRecipe(recipe,-1))}><RotateCcw size={16}/>{bt('左转 90°','Rotate left 90°')}</button><button disabled={gesturing} onClick={()=>commit(turnRecipe(recipe))}><RotateCw size={16}/>90°</button><button disabled={gesturing} aria-pressed={recipe.flipX} onClick={()=>commit(flipRecipe(recipe,'x'))}>{bt('水平翻转','Flip horizontal')}</button><button disabled={gesturing} aria-pressed={recipe.flipY} onClick={()=>commit(flipRecipe(recipe,'y'))}>{bt('垂直翻转','Flip vertical')}</button></div>
    <label>{bt('裁剪比例','Crop ratio')}<select aria-label={bt('裁剪比例','Crop ratio')} disabled={gesturing} value={selected} onChange={e=>commit(aspectRecipe(recipe,source,e.target.value?Number(e.target.value):undefined))}>{ratios.map((r,i)=><option key={i} value={r.value}>{r.label}</option>)}</select></label>
    <label className="edit-slider"><span>{bt('取景缩放','Crop zoom')}<output>{zoom.toFixed(2)}×</output></span><input aria-label={bt('取景缩放','Crop zoom')} type="range" disabled={gesturing&&!zoomBase.current} min={1} max={Math.max(20,Math.ceil(zoom))} step={.01} value={zoom} onPointerDown={beginZoom} onPointerUp={()=>endZoom(true)} onPointerCancel={()=>endZoom(false)} onBlur={()=>endZoom(true)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();endZoom(false);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)){e.stopPropagation();beginZoom();}}} onKeyUp={()=>endZoom(true)} onChange={e=>setZoom(Number(e.target.value))}/></label>
    <label className="edit-slider composition-angle"><span>{bt('校正角度','Straighten angle')}<output>{angle.toFixed(1)}°</output></span><input aria-label={bt('校正角度','Straighten angle')} type="range" disabled={gesturing&&!rulerBase.current} min={-45} max={45} step={.1} value={angle} onPointerDown={beginAngle} onPointerUp={()=>endAngle(true)} onPointerCancel={()=>endAngle(false)} onBlur={()=>endAngle(true)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();endAngle(false);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key)){e.stopPropagation();beginAngle();}}} onKeyUp={()=>endAngle(true)} onChange={e=>setAngle(Number(e.target.value))}/><span className="composition-ruler" aria-hidden="true">{[-45,-30,-15,0,15,30,45].map(v=><i key={v}>{v}°</i>)}</span></label>
    {(['x','y','width','height'] as const).map((key,i)=><label className="edit-slider" key={key}><span>{[bt('左边距','Left'),bt('上边距','Top'),bt('裁剪宽度','Crop width'),bt('裁剪高度','Crop height')][i]}<output>{(recipe.crop[key]*100).toFixed(1)}%</output></span><input aria-label={['Crop X','Crop Y','Crop width','Crop height'][i]} type="range" disabled={gesturing} min={i<2?(recipe.version===1?0:-21):1} max={i<2?99:recipe.version===1?100:142} step={1} value={recipe.crop[key]*100} onChange={e=>cropValue(key,Number(e.target.value)/100)}/></label>)}
    <button disabled={gesturing} onClick={()=>commit({...compositionBase(recipe),rotation:0,flipX:false,flipY:false})}>{bt('重置构图','Reset composition')}</button>
  </details>;
}
