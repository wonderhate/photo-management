import {useEffect,useRef,useState} from 'react';
import {Modal} from '../components';
import {bt,browserError} from '../browser/text';
import type {EditRecipe} from '../browser/editing';
import type {EditSession} from '../browser/edit-session';
import type {EditorLibrary,EditRecord,EditSplitGroup} from '../core/editor-adapter';
import type {Size} from '../core/composition-geometry';
import {compositionBasis} from '../core/composition-geometry';
import {compositionBase} from '../core/composition-recipe';
import {createSplit,reshapeSplit,resetSplitRegion,resolveSplitCount,splitPlan,SPLIT_PRESETS,validateSplitAspect} from '../core/seamless-split';
import type {SplitAspect,SplitSpec} from '../core/seamless-split';
import {splitRecipe} from '../core/split-render';
import type {EncodedSplit,SplitProgress} from '../core/split-render';
import {toolDefaults} from '../core/preferences';
import useToolPreferences from './useToolPreferences';
import useSplitPreview from './useSplitPreview';
import SplitCanvas from './SplitCanvas';
import SplitExportPanel from './SplitExportPanel';

type Props={recipe:EditRecipe;source:Size;session:EditSession;library:EditorLibrary;name:string;documentId?:string;persist:()=>Promise<EditRecord>;onEditPanel:(groupId:string,panelId:string,requestId:string)=>Promise<void>;onClose:(restoreWorker:boolean)=>void;onBusy:(value:string)=>void;notify:(text:string)=>void};
type History={items:SplitSpec[];index:number};
type Phase=''|'prepare'|'encode'|'commit'|'export'|'child';
export default function SplitTool({recipe,source,session,library,name,documentId,persist,onEditPanel,onClose,onBusy,notify}:Props){
  const [preferences,savePreferences]=useToolPreferences('split',toolDefaults.split,notify),touched=useRef(false);
  const [history,setHistory]=useState<History>(()=>({items:[createSplit(compositionBasis(source,recipe.rotation),recipe.version!==1?recipe.composition.angle:0)],index:0})),spec=history.items[history.index];
  const snapshot=useRef<History|null>(null),[gesturing,setGesturing]=useState(false),[cancel,setCancel]=useState(0);
  const [width,setWidth]=useState('3'),[height,setHeight]=useState('4'),[format,setFormat]=useState<'png'|'jpg'>('png'),[quality,setQuality]=useState(95);
  const [phase,setPhase]=useState<Phase>(''),phaseRef=useRef<Phase>(''),[progress,setProgress]=useState<SplitProgress|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState<EditSplitGroup|null>(null);
  const candidate=useRef<{key:string;record:EditRecord;result:EncodedSplit;id:string}|null>(null),alive=useRef(true);
  const savedKey=useRef('');
  const childRequests=useRef(new Map<string,string>());
  const [groups,setGroups]=useState<EditSplitGroup[]>([]),[total,setTotal]=useState(0),[selected,setSelected]=useState<EditSplitGroup|null>(null),[reading,setReading]=useState(false),page=useRef(1),listSequence=useRef(0);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{const sequence=++listSequence.current;page.current=1;if(!documentId||!library.listSplits)return;void library.listSplits(documentId).then(result=>{if(alive.current&&sequence===listSequence.current){setGroups(result.items);setTotal(result.total);}}).catch(e=>{if(alive.current&&sequence===listSequence.current)setError(browserError(e));});return()=>{listSequence.current++;};},[documentId,library]);
  useEffect(()=>{if(touched.current)return;const value=createSplit(compositionBasis(source,recipe.rotation),spec.angle,preferences);setHistory({items:[value],index:0});setWidth(String(preferences.width));setHeight(String(preferences.height));},[preferences.width,preferences.height]);
  const base=useSplitPreview(session,compositionBase(recipe),!phase),detail=useSplitPreview(session,splitRecipe(recipe,source,spec),!phase,recipe);
  let plan:ReturnType<typeof splitPlan>|undefined,planError='';try{plan=splitPlan(spec);}catch(e){planError=browserError(e);}
  const busy=!!phase,count=resolveSplitCount(spec.basis,spec.aspect,spec.count),key=JSON.stringify({spec,format,quality,recipe});
  function change(value:SplitSpec){touched.current=true;setSaved(null);const transaction=snapshot.current;setHistory(h=>{if(JSON.stringify(h.items[h.index])===JSON.stringify(value))return h;const base=transaction||h;return {items:[...base.items.slice(0,base.index+1).slice(-99),value],index:Math.min(base.index+1,99)};});}
  function end(commit:boolean){const value=snapshot.current;if(!value)return;snapshot.current=null;setGesturing(false);setHistory(h=>!commit||JSON.stringify(h.items[h.index])===JSON.stringify(value.items[value.index])?value:h);}
  function step(direction:1|-1){touched.current=true;setSaved(null);setHistory(h=>({...h,index:Math.max(0,Math.min(h.items.length-1,h.index+direction))}));}
  useEffect(()=>{setWidth(String(spec.aspect.width));setHeight(String(spec.aspect.height));},[spec.aspect.width,spec.aspect.height]);
  function aspect(value:SplitAspect){try{validateSplitAspect(value);change(reshapeSplit(spec,value));savePreferences(value);setError('');}catch{setError(bt('比例宽高请输入 1–100 之间的数字。','Enter aspect sides between 1 and 100.'));}}
  function setOperation(value:Phase){phaseRef.current=value;setPhase(value);onBusy(value?'split':'');}
  function close(){if(snapshot.current){end(false);setCancel(v=>v+1);return;}if(phaseRef.current==='encode'){alive.current=false;onClose(true);}else if(!phaseRef.current){alive.current=false;onClose(false);}}
  async function save(){
    if(phaseRef.current||!plan||snapshot.current||!library.saveSplit)return;
    setError('');setSaved(null);setOperation('prepare');
    try{
      if(candidate.current?.key!==key){
        const record=await persist();if(!alive.current)return;setOperation('encode');setProgress({phase:'render',done:0,total:count+1});
        const result=await session.split(recipe,spec,format,quality,value=>{if(alive.current)setProgress(value);});if(!alive.current)return;
        candidate.current={key,record,result,id:crypto.randomUUID()};
      }
      // Retain the UUID and encoded pixels after an uncertain save outcome, so
      // an explicit retry asks for the same group instead of creating duplicates.
      const request=candidate.current!;setOperation('commit');
      const group=await library.saveSplit(request.record,request.result,name,request.id);if(!alive.current)return;savedKey.current=key;candidate.current=null;setSaved(group);setSelected(group);listSequence.current++;
      if(library.listSplits){const rows=await library.listSplits(group.document_id);if(!alive.current)return;page.current=1;setGroups(rows.items);setTotal(rows.total);}
      notify(bt('分图整组已保存，原片和普通裁剪保持不变。','Split group saved. Original and ordinary crop are unchanged.'));
    }catch(e){if(alive.current)setError(browserError(e));}finally{if(alive.current)setOperation('');}
  }
  const currentSaved=saved&&savedKey.current===key?saved:null;
  async function editPanel(groupId:string,panelId:string){
    if(phaseRef.current||reading||gesturing)return;
    const id=childRequests.current.get(panelId)||crypto.randomUUID();childRequests.current.set(panelId,id);setError('');setOperation('child');
    try{await onEditPanel(groupId,panelId,id);}catch(e){if(alive.current)setError(browserError(e));}finally{if(alive.current)setOperation('');}
  }
  return <Modal title={bt('无缝分图','Seamless split')} onClose={close} wide className="split-dialog">
    <div onKeyDown={e=>{if(busy||gesturing||e.target instanceof Element&&e.target.closest('input,select,textarea'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();step(e.shiftKey?1:-1);}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();e.stopPropagation();step(1);}}}>
      <p className="muted split-intro">{bt('选取横向画面，拆成连续组图。沿用当前调色和旋转，独立于普通裁剪。','Select a horizontal composition for a continuous series. Uses current color and rotation, independently of the ordinary crop.')}</p>
      <div className="split-layout"><section className="split-stage">
        <div className="split-toolbar"><span>{name}</span><div className="button-row"><button disabled={busy||gesturing||!history.index} onClick={()=>step(-1)}>{bt('撤销分图调整','Undo split')}</button><button disabled={busy||gesturing||history.index===history.items.length-1} onClick={()=>step(1)}>{bt('重做分图调整','Redo split')}</button><button disabled={busy||gesturing} onClick={()=>change(resetSplitRegion(spec))}>{bt('重置选区','Reset region')}</button></div></div>
        <SplitCanvas spec={spec} image={base.url} detail={detail.ready?detail.url:''} ready={base.ready} disabled={busy} gesturing={gesturing} cancel={cancel} onChange={change} onBegin={()=>{snapshot.current=history;touched.current=true;setGesturing(true);}} onEnd={end}/>
        <p role="status" className="muted split-preview-status">{!base.ready||!detail.ready?bt('正在更新分图预览…','Updating split preview…'):bt('拖动选区可调整构图','Drag the frame to adjust composition')}</p>
        {plan&&<ol className="split-strip" aria-label={bt('分片预览','Panel previews')}>{plan.panels.map((panel,i)=><li key={i}><svg viewBox={`${panel.x} 0 ${panel.width} ${plan.height}`} role="img" aria-label={bt('分片','Panel')+' '+(i+1)}>{detail.ready&&<image href={detail.url} width={plan!.width} height={plan!.height} preserveAspectRatio="none"/>}</svg><span>{String(i+1).padStart(2,'0')} · {panel.width} × {panel.height}</span></li>)}</ol>}
      </section><fieldset className="split-options" disabled={busy||gesturing}><legend className="sr-only">{bt('分图设置','Split settings')}</legend>
        <h3>{bt('单张比例','Panel aspect')}</h3><div className="split-presets">{SPLIT_PRESETS.map(p=><button key={p.width+':'+p.height} aria-pressed={spec.aspect.width===p.width&&spec.aspect.height===p.height} onClick={()=>aspect(p)}>{p.width}:{p.height}</button>)}</div>
        <div className="split-custom"><label>{bt('比例宽','Aspect width')}<input type="number" min={1} max={100} step="any" value={width} onChange={e=>{touched.current=true;setWidth(e.target.value);}}/></label><span>:</span><label>{bt('比例高','Aspect height')}<input type="number" min={1} max={100} step="any" value={height} onChange={e=>{touched.current=true;setHeight(e.target.value);}}/></label></div><button onClick={()=>aspect({width:Number(width),height:Number(height)})}>{bt('应用自定义比例','Apply custom aspect')}</button>
        <label>{bt('分图张数','Panel count')}<select value={spec.count??'auto'} onChange={e=>change(reshapeSplit(spec,spec.aspect,e.target.value==='auto'?null:Number(e.target.value)))}><option value="auto">{bt('自动','Automatic')} · {resolveSplitCount(spec.basis,spec.aspect)}</option>{Array.from({length:9},(_,i)=><option key={i+2} value={i+2}>{i+2}</option>)}</select></label>
        <label>{bt('分图格式','Panel format')}<select value={format} onChange={e=>{setFormat(e.target.value as 'png'|'jpg');setSaved(null);}}><option value="png">PNG · sRGB</option><option value="jpg">JPG · sRGB</option></select></label>
        {format==='jpg'&&<label>{bt('分图质量','Panel quality')} · {quality}<input type="range" min={1} max={100} value={quality} onChange={e=>{setQuality(Number(e.target.value));setSaved(null);}}/></label>}
        <p className="muted">{bt('按选区原始像素保存，先整体处理再分片，避免锐化和降噪在接缝处不一致。','Saves original-resolution pixels. Processing the whole region before slicing keeps sharpening and denoising consistent across seams.')}</p>
        {plan&&<p className="split-dimensions">{plan.width} × {plan.height} → {count} {bt('张','panels')}</p>}
        <button className="primary" disabled={!!planError||!!currentSaved} onClick={()=>void save()}>{bt(currentSaved?'已保存整组':'保存整组分图',currentSaved?'Group saved':'Save split group')}</button>
      </fieldset></div>
      {(error||planError||base.error||detail.error)&&<p className="error-box" role="alert">{error||planError||base.error||detail.error}</p>}
      {busy&&phase!=='export'&&<div className="split-progress" role="status"><span>{phase==='child'?bt('正在保存当前编辑并打开分片…','Saving current edits and opening the panel…'):phase==='prepare'?bt('正在保留编辑来源…','Preserving the edit source…'):phase==='commit'?bt('正在保存整组，请稍候…','Saving the complete group. Please wait…'):bt('正在生成分图…','Rendering panels…')}</span>{phase==='encode'&&<><progress max={progress?.total||count+1} value={progress?.done||0}/><button onClick={close}>{bt('取消生成并返回暗房','Cancel and return to darkroom')}</button></>}</div>}
      {!!groups.length&&<section className="split-groups"><h3>{bt('此照片的分图组','Split groups for this photo')}</h3><div className="button-row">{groups.map((group,i)=><button key={group.id} disabled={busy||reading} aria-pressed={selected?.id===group.id} onClick={async()=>{if(!library.splitGroup)return;setReading(true);try{const value=await library.splitGroup(group.id);if(alive.current)setSelected(value);}catch(e){if(alive.current)setError(browserError(e));}finally{if(alive.current)setReading(false);}}}>{bt('组','Group')} {i+1} · {group.plan.count} {bt('张','panels')} · {group.plan.width} × {group.plan.height} · {group.format.toUpperCase()}</button>)}</div>{groups.length<total&&<button disabled={busy||reading} onClick={async()=>{if(!library.listSplits||!documentId)return;setReading(true);try{const next=page.current+1,rows=await library.listSplits(documentId,next);if(alive.current){page.current=next;setGroups(old=>[...old,...rows.items]);setTotal(rows.total);}}catch(e){if(alive.current)setError(browserError(e));}finally{if(alive.current)setReading(false);}}}>{bt('更多分图组','More split groups')}</button>}</section>}
      {selected&&<section className="split-saved"><h3>{bt('已保存的分图','Saved panels')}</h3><p className="muted">{bt('显示保存时的版本；上方调整不会改变这些分片。','Showing the saved version; adjustments above do not change these panels.')}</p>{library.createSplitEdit&&<p className="muted">{bt('继续编辑前会保存当前暗房调整；分片作为独立工程打开。','Continuing saves current darkroom adjustments first, then opens the panel as an independent edit.')}</p>}<div>{selected.panels.map((panel,i)=><article key={panel.id}><img src={panel.preview_url} alt={bt('已保存分片','Saved panel')+' '+(i+1)}/><button onClick={async()=>{try{await(await import('../browser/local-file-service')).downloadFile(panel.preview_url,panel.name);}catch(e){if(alive.current)setError(browserError(e));}}}>{bt('下载分片','Download panel')} {i+1}</button>{library.createSplitEdit&&<button disabled={busy||reading||gesturing} onClick={()=>void editPanel(selected.id,panel.id)}>{bt('继续编辑分片','Edit panel')} {i+1}</button>}</article>)}</div></section>}
      {selected&&library.exportSplit&&<SplitExportPanel library={library} group={selected} disabled={busy||reading} onBusy={value=>setOperation(value?'export':'')}/>}
    </div>
  </Modal>;
}
