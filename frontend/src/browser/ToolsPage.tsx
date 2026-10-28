import LutPanel from '../workspace/LutPanel';
import {withLut} from '../core/lut-recipe';
import {recipeLayers,withLayerStack,keepLayerFormat} from '../core/layer-recipe';
import type {LayerDocument} from '../core/layer-stack';
import TextPanel from '../workspace/TextPanel';
import LayerCanvas from '../workspace/LayerCanvas';
import VisionPanel from '../workspace/VisionPanel';
import LocalVisionPanel from '../workspace/LocalVisionPanel';
import {upgradeLayerDocument} from '../core/layer-geometry';
import {withTextLayers} from '../core/text-recipe';
import type {TextRenderResult} from './text-render';
import {dimensions} from './editing';
import {useEffect,useRef,useState} from 'react';
import type {MutableRefObject} from 'react';
import {ArrowUpRight,Aperture,Frame,Paintbrush,Sparkles,Upload,Undo2,Redo2,Download,Save,RotateCw,X} from 'lucide-react';
import {bt,browserError} from './text';
import {api} from '../api';
import type {Photo} from '../types';
import type {Page} from '../routes';
import type {EditSession} from './edit-session';
import {editorServices} from '../core/editor-adapter';
import type {EditorServices,EditRecord,EditVariant,EditDestination} from '../core/editor-adapter';
import {message} from '../api';
import {createPreferenceStore} from '../core/preference-store';
import type {PreferenceStore,DocumentPreferences} from '../core/preferences';
import {trackPreferenceWrite} from '../core/preference-lifecycle';
import '../workspace/editor.css';
import type {OpenedImage,Analysis} from './edit-session';
import {neutralRecipe,validateRecipe,validateRecipeSource} from './editing';
import CompositionCanvas from '../workspace/CompositionCanvas';
import CompositionPanel from '../workspace/CompositionPanel';
import SplitTool from '../workspace/SplitTool';
import {compositionView} from '../core/composition-recipe';
import type {CompositionView} from '../core/composition-geometry';
import type {EditRecipe} from './editing';
import {useCommands} from '../workspace/useCommands';
import CommandMenu from '../workspace/CommandMenu';
import useToolPreferences from '../workspace/useToolPreferences';
import {toolDefaults} from '../core/preferences';
import {sourceDecodeProfile,legacySourceDecode} from '../core/source-decode-profile';
import type {SourceDecodeProfile} from '../core/source-decode-profile';
import {newSourceDecodeProfile} from './source-profile';

type Mode='tools'|'darkroom';
type ToolsProps={onCollage:()=>void;mode:Mode;onPage:(page:Page)=>void;onSend:(destination:EditDestination)=>void;photoId:string;guard:MutableRefObject<(()=>Promise<boolean>)|null>;notify:(s:string)=>void};
type EditHistory={items:EditRecipe[];index:number};
export default function ToolsPage(props:ToolsProps){
  const [services,setServices]=useState<EditorServices>(),[error,setError]=useState('');
  useEffect(()=>{let alive=true;editorServices().then(value=>{if(alive)setServices(value)}).catch(e=>{if(alive)setError(message(e))});return()=>{alive=false};},[]);
  return services?<EditorWorkspace {...props} services={services}/>:<p role={error?'alert':'status'}>{error||bt('正在读取…','Loading…')}</p>;
}
function EditorWorkspace({mode,onPage,onSend,photoId,guard,notify,onCollage,services}:ToolsProps&{services:EditorServices}){const {library,render}=services;
  const [opened,setOpened]=useState<OpenedImage|null>(null),[name,setName]=useState(''),[busy,setBusy]=useState(''),[rendering,setRendering]=useState(false),[error,setError]=useState('');
  const [history,setHistory]=useState<EditHistory>({items:[neutralRecipe()],index:0}),recipe=history.items[history.index];
  const [visionRevision,setVisionRevision]=useState(0);
  const [layerPreferences,saveLayerPreferences]=useToolPreferences('layers',toolDefaults.layers,notify);
  const [textEditing,setTextEditing]=useState(false),[selectedText,setSelectedText]=useState(''),[textLayouts,setTextLayouts]=useState<TextRenderResult>([]);
  const layerDocument=opened?upgradeLayerDocument(recipeLayers(recipe),recipe,opened):recipeLayers(recipe);
  useEffect(()=>{if(!layerDocument.layers.some(l=>l.id===selectedText))setSelectedText(layerDocument.layers.at(-1)?.id||'');},[recipe,selectedText]);
  function changeLayers(document:LayerDocument){if(opened)change(withLayerStack(recipe,opened,upgradeLayerDocument(document,recipe,opened)));}
  function editText(){setCropping(false);setCompare(false);changeZoom(1);setTextEditing(true);}
  const [splitting,setSplitting]=useState(false),[returnEdits,setReturnEdits]=useState<{parent:string;child:string}[]>([]);
  const latestRecipe=useRef(recipe);latestRecipe.current=recipe;
  const [cropView,setCropView]=useState<CompositionView>({scale:1,center:{x:.5,y:.5}});
  const [cropping,setCropping]=useState(false),[cropGesture,setCropGesture]=useState(false),cropSnapshot=useRef<EditHistory|null>(null),cropTrigger=useRef<HTMLButtonElement>(null);
  const [saved,setSaved]=useState(JSON.stringify(neutralRecipe())),[records,setRecords]=useState<EditRecord[]>([]),[variants,setVariants]=useState<EditVariant[]>([]);
  const [previewRecipe,setPreviewRecipe]=useState('');
  const [lutComparing,setLutComparing]=useState(false);
  const [preview,setPreview]=useState(''),[before,setBefore]=useState(''),[reference,setReference]=useState(''),[analysis,setAnalysis]=useState<Analysis|null>(null),[compare,setCompare]=useState(false),[zoom,setZoom]=useState(1);
  const [photos,setPhotos]=useState<Photo[]>([]),[search,setSearch]=useState(''),[selection,setSelection]=useState('');
  const [exportDefaults,setExportDefaults]=useState(toolDefaults.darkroom);
  const [exportPreferences,saveExportPreferences]=useToolPreferences('darkroom',exportDefaults,notify);
  const [edgeDraft,setEdgeDraft]=useState<string|null>(null);
  const {format,quality}=exportPreferences,edge=edgeDraft===null?exportPreferences.edge:Number(edgeDraft);
  function setFormat(format:'jpg'|'png'|'webp'){saveExportPreferences({format});}
  function setQuality(quality:number){saveExportPreferences({quality});}
  function setEdge(value:string){setEdgeDraft(value);const next=Number(value);if(value.trim()&&Number.isInteger(next)&&next>=0&&next<=16000)saveExportPreferences({edge:next});}
  const record=useRef<EditRecord|undefined>(undefined),read=useRef<AbortController|null>(null),readSequence=useRef(0);
  const decodeProfile=useRef<SourceDecodeProfile>({...legacySourceDecode});
  const viewSequence=useRef(0),viewStore=useRef<Promise<PreferenceStore>|null>(null),currentZoom=useRef<1|1.5|2>(1);
  function views(){return viewStore.current??=createPreferenceStore().catch(e=>{viewStore.current=null;throw e;});}
  function viewError(e:unknown){notify(bt('作品视图未保存：','Document view was not saved: ')+message(e));}
  function changeZoom(value:DocumentPreferences['zoom']){viewSequence.current++;currentZoom.current=value;setZoom(value);const id=record.current?.id;if(id)void trackPreferenceWrite(views().then(store=>store.saveDocument(id,{zoom:value}))).catch(viewError);}
  const [recordsTotal,setRecordsTotal]=useState(0),[variantsTotal,setVariantsTotal]=useState(0),recordPage=useRef(1),variantPage=useRef(1);
  function firstRecords(rows:{items:EditRecord[];total:number}){recordPage.current=1;setRecords(rows.items);setRecordsTotal(rows.total)}
  function firstVariants(rows:{items:EditVariant[];total:number}){variantPage.current=1;setVariants(rows.items);setVariantsTotal(rows.total)}
  async function more(kind:'records'|'variants'){setBusy('list');try{if(kind==='records'){const next=recordPage.current+1,result=await library.listRecords(next);recordPage.current=next;setRecords(rows=>[...rows,...result.items]);setRecordsTotal(result.total)}else{const next=variantPage.current+1,result=await library.listVariants!(next);variantPage.current=next;setVariants(rows=>[...rows,...result.items]);setVariantsTotal(result.total)}}catch(e){setError(message(e))}finally{setBusy('')}}
  useEffect(()=>{let alive=true;void Promise.allSettled([library.preferences().then(p=>{if(alive)setExportDefaults({format:p.export_format,edge:p.export_long_edge,quality:p.export_quality});}),library.listRecords().then(rows=>{if(alive)firstRecords(rows)}),library.listVariants?.().then(rows=>{if(alive)firstVariants(rows)})]).then(results=>{if(alive){const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')setError(message(failure.reason));}});return()=>{alive=false};},[library]);
  const session=useRef<EditSession|null>(null),source=useRef<File|null>(null),sourceId=useRef<string|null>(null),generation=useRef(0),urls=useRef<string[]>([]),pending=useRef<{recipe:EditRecipe;token:number}|null>(null),running=useRef(false);
  const fileInput=useRef<HTMLInputElement>(null),referenceInput=useRef<HTMLInputElement>(null);
  const dirty=!!opened&&JSON.stringify(recipe)!==saved;
  function url(blob:Blob){const v=URL.createObjectURL(blob);urls.current.push(v);return v;}
  function replaceURL(set:(v:string)=>void,old:string,blob:Blob){if(old){URL.revokeObjectURL(old);urls.current=urls.current.filter(v=>v!==old);}set(url(blob));}
  const previewRef=useRef(''),renderError=useRef('');
  function beginCrop(){if(!cropSnapshot.current){cropSnapshot.current=history;setCropGesture(true);}}
  function endCrop(commit:boolean){const base=cropSnapshot.current;if(!base)return;cropSnapshot.current=null;setCropGesture(false);setHistory(h=>!commit||JSON.stringify(h.items[h.index])===JSON.stringify(base.items[base.index])?base:h);}
  function closeCrop(){setCropping(false);requestAnimationFrame(()=>cropTrigger.current?.focus());}
  function stepHistory(direction:1|-1){if(cropping&&opened){const index=Math.max(0,Math.min(history.items.length-1,history.index+direction));setCropView(compositionView(history.items[index],opened));}setHistory(h=>({...h,index:Math.max(0,Math.min(h.items.length-1,h.index+direction))}));}
  function change(patch:Partial<EditRecipe>){const transaction=cropSnapshot.current;setHistory(h=>{const next:Record<string,unknown>={...h.items[h.index],...patch};if(h.items[h.index].version===4&&Number(next.version)<4&&opened){next.version=4;next.composition=next.composition||{source_width:opened.width,source_height:opened.height,angle:0};next.layer_stack=(h.items[h.index] as import('./editing').EditRecipeV4).layer_stack;delete next.text_layers;}if(h.items[h.index].version===3&&Number(next.version)<3&&opened){next.version=3;next.composition=next.composition||{source_width:opened.width,source_height:opened.height,angle:0};next.text_layers=(h.items[h.index] as import('./editing').EditRecipeV3).text_layers;}if(h.items[h.index].version===5&&Number(next.version)<5&&opened){next.version=5;next.composition=next.composition||{source_width:opened.width,source_height:opened.height,angle:0};next.layer_stack=(h.items[h.index] as import('./editing').EditRecipeV5).layer_stack;}if(next.version===5&&patch.version===5&&!('lut' in patch))delete next.lut;if(Number(next.version)>=4)delete next.text_layers;if(next.version===3)delete next.layer_stack;if(next.version===1){delete next.composition;delete next.text_layers;delete next.layer_stack;}validateRecipe(next);if(JSON.stringify(next)===JSON.stringify(h.items[h.index]))return h;const base=transaction||h;return {items:[...base.items.slice(0,base.index+1).slice(-99),next],index:Math.min(base.index+1,99)};});}
  useEffect(()=>{let alive=true;const timer=setTimeout(()=>{api<{photos:Photo[]}>('/photos?page_size=200&search='+encodeURIComponent(search)).then(p=>{if(alive)setPhotos(p.photos)}).catch(e=>{if(alive)setError(browserError(e))});},150);return()=>{alive=false;clearTimeout(timer)};},[search]);
  useEffect(()=>()=>{viewSequence.current++;readSequence.current++;read.current?.abort();generation.current++;session.current?.dispose();session.current=null;for(const u of urls.current)URL.revokeObjectURL(u);},[]);
  useEffect(()=>{const check=async()=>{if(cropSnapshot.current){notify(bt('请先完成或取消当前调整。','Finish or cancel the current adjustment first.'));return false;}if(busy){notify(bt('请等待处理完成，或先取消解码。','Wait for the operation, or cancel decoding first.'));return false;}return !dirty||confirm(bt('编辑参数尚未保存，离开此页面？','Edits are not saved. Leave this page?'));};guard.current=check;const unload=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{if(guard.current===check)guard.current=null;window.removeEventListener('beforeunload',unload);};},[dirty,busy,guard,notify]);
  async function openFile(file:File,id:string|null=null,savedRecord?:EditRecord,catalogProfile?:SourceDecodeProfile,preservedRecipe?:string){
    if(dirty&&preservedRecipe!==JSON.stringify(latestRecipe.current)&&!confirm(bt('放弃未保存的编辑？','Discard unsaved edits?')))return;
    endCrop(false);setCropping(false);setTextEditing(false);setTextLayouts([]);const viewToken=++viewSequence.current;currentZoom.current=1;setZoom(1);
    const token=++generation.current;session.current?.dispose();const worker=render.session();session.current=worker;pending.current=null;running.current=false;setRendering(false);setBusy('open');setError('');setOpened(null);source.current=file;sourceId.current=id;setName(file.name);setReference('');setPreview('');setPreviewRecipe('');setBefore('');for(const u of urls.current)URL.revokeObjectURL(u);urls.current=[];previewRef.current='';
    try{const profile=savedRecord?sourceDecodeProfile(savedRecord.decode_profile):catalogProfile?sourceDecodeProfile(catalogProfile):await newSourceDecodeProfile(file);if(token!==generation.current)return;const info=await worker.open(file,profile);if(token!==generation.current)return;decodeProfile.current=profile;const r=savedRecord?.recipe||neutralRecipe();setHistory({items:[r],index:0});setSaved(JSON.stringify(r));record.current=savedRecord;setOpened(info);setBefore(url(info.original));const next=url(info.original);setPreview(next);previewRef.current=next;setAnalysis(info.analysis);setCompare(false);
      if(savedRecord)void views().then(store=>store.document(savedRecord.id)).then(view=>{if(viewToken===viewSequence.current&&session.current===worker){currentZoom.current=view.zoom||1;setZoom(view.zoom||1);}}).catch(e=>{if(viewToken===viewSequence.current)notify(message(e));});
    }catch(e){if(token===generation.current){setError(browserError(e));source.current=null;}}finally{if(token===generation.current)setBusy('');}
  }
  async function readSource(id:string,savedRecord?:EditRecord){
    read.current?.abort();const controller=new AbortController(),sequence=++readSequence.current;read.current=controller;setBusy('open');setError('');
    try{const source=savedRecord?{file:await library.source(savedRecord,controller.signal),profile:undefined}:await library.photo(id,controller.signal).then(value=>({file:value.file,profile:value.photo.decode_profile}));if(sequence===readSequence.current)await openFile(source.file,savedRecord?savedRecord.photo_id:id,savedRecord,source.profile);}
    catch(e){if(!controller.signal.aborted&&sequence===readSequence.current)setError(message(e));}
    finally{if(sequence===readSequence.current)setBusy('');}
  }
  useEffect(()=>{if(photoId)void readSource(photoId);},[photoId]);
  useEffect(()=>{
    if(!opened||!session.current)return;const token=++generation.current,worker=session.current;
    const timer=setTimeout(()=>{
      pending.current={recipe:lutComparing&&recipe.version===5&&recipe.lut?withLut(recipe,opened):recipe,token};
      if(running.current)return;running.current=true;setRendering(true);
      void(async()=>{try{
        while(pending.current&&session.current===worker){
          const job=pending.current;pending.current=null;let next='';
          try{
            const result=await worker.render(job.recipe);if(job.token!==generation.current)continue;
            next=url(result.blob);const image=new Image();image.src=next;await image.decode();
            // Keep the previous decoded picture until the latest result can be
            // painted. A superseded result must not replace it or show an error.
            if(job.token!==generation.current||session.current!==worker)continue;
            const old=previewRef.current;setPreview(next);previewRef.current=next;next='';
            if(old){URL.revokeObjectURL(old);urls.current=urls.current.filter(v=>v!==old);}
            setAnalysis(result.analysis);setTextLayouts(result.textLayouts||[]);setPreviewRecipe(JSON.stringify(job.recipe));
            if(renderError.current){const resolved=renderError.current;renderError.current='';setError(previous=>previous===resolved?'':previous);}
          }catch(e){if(session.current===worker&&job.token===generation.current){renderError.current=browserError(e);setError(renderError.current);}}
          finally{if(next){URL.revokeObjectURL(next);urls.current=urls.current.filter(v=>v!==next);}}
        }
      }finally{if(session.current===worker){running.current=false;setRendering(false);}}})();
    },140);return()=>clearTimeout(timer);
  },[recipe,opened,lutComparing]);
  async function pickReference(file:File){const worker=session.current;if(!worker)return;setBusy('reference');setError('');try{const profile=await newSourceDecodeProfile(file);if(session.current!==worker)return;const result=await worker.reference(file,profile);if(session.current===worker){replaceURL(setReference,reference,result.preview);change({reference:result.stats,match:75});}}catch(e){if(session.current===worker)setError(browserError(e));}finally{if(session.current===worker)setBusy('');}}
  function cancel(){viewSequence.current++;readSequence.current++;read.current?.abort();generation.current++;session.current?.dispose();session.current=null;source.current=null;pending.current=null;running.current=false;setOpened(null);setBusy('');setRendering(false);setError(bt('处理已取消，可重新打开照片。','Processing cancelled. Open a photo to continue.'));}
  async function closeSplit(restoreWorker:boolean){
    setSplitting(false);
    if(!restoreWorker){setBusy('');return;}
    const file=source.current;if(!file)return;
    generation.current++;session.current?.dispose();const worker=render.session();session.current=worker;
    pending.current=null;running.current=false;setRendering(false);setBusy('restore');setError('');setOpened(null);
    try{const info=await worker.open(file,decodeProfile.current);if(session.current!==worker)return;
      replaceURL(setBefore,before,info.original);setOpened(info);
    }catch(e){if(session.current===worker)setError(browserError(e));}finally{if(session.current===worker)setBusy('');}
  }
  async function persist(){
    if(!source.current)throw new Error('Record not found.');
    if(!opened)throw new Error('Record not found.');validateRecipeSource(recipe,opened);
    const savedRecord=await library.save(source.current,recipe,sourceId.current,record.current,decodeProfile.current);
    record.current=savedRecord;setHistory(h=>({...h,items:h.items.map(item=>keepLayerFormat(item,opened,savedRecord.recipe.version))}));setSaved(JSON.stringify(recipe));try{await (await views()).saveDocument(savedRecord.id,{zoom:currentZoom.current});}catch(e){viewError(e);}firstRecords(await library.listRecords());return savedRecord;
  }
  async function openPreservingCurrent(load:()=>Promise<EditRecord>,after?:()=>void){
    const sequence=++readSequence.current;read.current?.abort();const controller=new AbortController();read.current=controller;
    const preserved=JSON.stringify(recipe);setBusy('navigate');
    if(dirty)await persist();
    if(sequence!==readSequence.current)return;
    const next=await load();if(sequence!==readSequence.current)return;
    const file=await library.source(next,controller.signal);if(sequence!==readSequence.current)return;
    if(JSON.stringify(latestRecipe.current)!==preserved)throw new Error('This work changed in another window. Reopen it before editing.');
    firstRecords(await library.listRecords());if(sequence!==readSequence.current)return;
    setSplitting(false);after?.();await openFile(file,next.photo_id,next,undefined,preserved);
  }
  async function editPanel(groupId:string,panelId:string,requestId:string){
    if(!library.createSplitEdit)return;
    await openPreservingCurrent(()=>library.createSplitEdit!(groupId,panelId,requestId));
  }
  async function relatedEdit(id:string,direction:'parent'|'child'){
    if(busy||cropGesture)return;setError('');const child=record.current?.id;
    try{await openPreservingCurrent(()=>library.getRecord(id),()=>setReturnEdits(rows=>direction==='parent'&&child?[...rows,{parent:id,child}]:rows.slice(0,-1)));}
    catch(e){setError(message(e));}finally{setBusy('');}
  }
  async function save(){setBusy('save');setError('');try{await persist();notify(bt('编辑参数已保存，原图保持不变。','Edits saved. Original unchanged.'));}catch(e){setError(message(e));}finally{setBusy('');}}
  async function output(target?:'watermark'|'watercolor'){
    if(!session.current)return;
    if(target&&!services.capabilities[target])return;
    if(edgeDraft!==null&&!edgeDraft.trim()||!Number.isFinite(edge)||edge<0||edge>16000||!Number.isInteger(edge)){setError(bt('长边请输入 0–16000 的整数，0 表示原尺寸。','Enter an integer from 0 to 16000; 0 means original dimensions.'));return;}
    setBusy('export');setError('');try{
      const result=await session.current.export(recipe,edge,format,quality);
      if(target){const savedRecord=await persist(),next=await render.send(result.blob,name,sourceId.current,savedRecord,target);setDestination(next);}
      else{const resultFile=await render.export(result.blob,name.replace(/\.[^.]+$/,'')+'-edited.'+format);await (await import('./local-file-service')).downloadFile(resultFile.url,resultFile.file_name);notify(bt('已保存到图库 exports 目录。','Saved in the library exports directory.'));}
    }catch(e){setError(message(e));}finally{setBusy('');}
  }
  const [destination,setDestination]=useState<EditDestination|null>(null);
  useEffect(()=>{if(destination&&!busy){onSend(destination);setDestination(null);}},[destination,busy]);
  const title=bt('光影暗房','Lumina Darkroom');
  const range=(key:keyof EditRecipe,zh:string,en:string,min=-100,max=100,step=1)=><label className="edit-slider" key={key}><span>{bt(zh,en)}<output>{Number(recipe[key]).toFixed(step<1?1:0)}</output></span><input aria-label={bt(zh,en)} type="range" min={min} max={max} step={step} value={Number(recipe[key])} onChange={e=>change({[key]:Number(e.target.value)})}/></label>;
  const commandBusy=!!busy||cropGesture||splitting||lutComparing;
  const commands=useCommands('editor',{
    editorOpen:{label:bt('打开照片 / RAW','Open photo / RAW'),enabled:!commandBusy,run:()=>fileInput.current?.click()},
    editorReference:{label:bt('打开参考图','Open reference'),enabled:!!opened&&!commandBusy,run:()=>referenceInput.current?.click()},
    editorUndo:{label:bt('撤销编辑','Undo edit'),enabled:!!opened&&!commandBusy&&history.index>0,run:()=>stepHistory(-1)},
    editorRedo:{label:bt('重做编辑','Redo edit'),enabled:!!opened&&!commandBusy&&history.index<history.items.length-1,run:()=>stepHistory(1)},
    editorReset:{label:bt('重置','Reset'),enabled:!!opened&&!commandBusy,run:()=>{setCropView({scale:1,center:{x:.5,y:.5}});change(recipe.version===5&&opened?withLut(withLayerStack(neutralRecipe(),opened,{version:1,layers:[]}),opened):recipe.version===4&&opened?withLayerStack(neutralRecipe(),opened,{version:1,layers:[]}):recipe.version===3&&opened?withTextLayers(neutralRecipe(),opened,{version:1,layers:[]}):neutralRecipe());}},
    editorSave:{label:bt('保存编辑','Save edits'),enabled:!!opened&&!commandBusy,run:save},
    editorExport:{label:bt('另存并下载','Save & download'),enabled:!!opened&&!commandBusy,run:()=>output()},
    editorOriginal:{label:bt(compare?'显示编辑效果':'查看原图',compare?'Show edits':'Show original'),checked:compare,enabled:!!opened&&!commandBusy&&!cropping&&!textEditing,run:()=>setCompare(value=>!value)},
    editorFit:{label:bt('适应窗口','Fit'),enabled:!!opened&&!commandBusy,run:()=>cropping&&opened?setCropView(compositionView(recipe,opened)):changeZoom(1)},
    editorZoomIn:{enabled:!!opened&&!commandBusy&&!textEditing&&(cropping?cropView.scale<10000:zoom<2),run:()=>cropping?setCropView(v=>({...v,scale:Math.min(10000,v.scale*1.5)})):changeZoom(zoom<1.5?1.5:2)},
    editorZoomOut:{enabled:!!opened&&!commandBusy&&!textEditing&&(cropping?cropView.scale>.1:zoom>1),run:()=>cropping?setCropView(v=>({...v,scale:Math.max(.1,v.scale/1.5)})):changeZoom(zoom>1.5?1.5:1)},
    editorWatermark:{label:bt('送入水印','Send to watermark'),enabled:!!opened&&!commandBusy,run:()=>output('watermark')},
    editorWatercolor:{label:bt('送入水彩','Send to watercolor'),enabled:!!opened&&!commandBusy&&services.capabilities.watercolor,run:()=>output('watercolor')},
    editorCancel:{label:bt(cropGesture?'取消调整':'取消处理',cropGesture?'Cancel adjustment':'Cancel processing'),enabled:cropGesture||busy==='open'||busy==='reference'||(!commandBusy&&rendering),run:()=>cropSnapshot.current?endCrop(false):cancel()},
  },{active:mode==='darkroom',listen:mode==='darkroom',exclusive:true,onError:error=>setError(message(error))});
  if(mode==='tools')return <div className="tools-page"><header className="studio-heading"><span className="eyebrow">THE DIGITAL DARKROOM</span><h1>{bt('从光影，到作品。','From light to a finished frame.')}</h1><p>{bt('在自己的设备上，寻找照片的另一种表达。','Find another expression for your photographs, on your device.')}</p></header><div className="studio-tools">{[
    {id:'darkroom',icon:Aperture,title:bt('光影暗房','Lumina Darkroom'),text:bt('照片分析与仿色、RAW 显影和摄影后期，在同一处完成。','Analyze and match color, develop RAW and finish your photographs in one place.'),tag:'01 / DARKROOM'},
    {id:'watermark',icon:Frame,title:bt('水印工坊','Watermark workshop'),text:bt('为作品装裱，留下自己的署名。','Frame your photograph and leave your signature.'),tag:'02 / FRAME'},
    {id:'collage',icon:Frame,title:bt('照片拼图','Photo collage'),text:bt('从 6 套精选预设开始，用 80 种布局组织照片，从完整源图导出。','Start with 6 curated presets and 80 layouts, then export from full source images.'),tag:'03 / COLLAGE'},
    {id:'watercolor',icon:Paintbrush,title:bt('水彩转绘','Watercolor'),text:bt('让照片成为纸上的故事。需配置云端服务。','Turn a photograph into a story on paper. Requires cloud setup.'),tag:'04 / WATERCOLOR'},
    {id:'ai-studio',icon:Sparkles,title:bt('AI创作与标注','AI creation & annotation'),text:bt('选择服务与图片后，进行 AI 创作或生成照片标注。云端处理前需确认。','Choose a service and image to create with AI or generate annotations. Cloud processing requires your confirmation.'),tag:'05 / AI'}
  ].map(tool=><button key={tool.id} className="studio-tool" onClick={()=>tool.id==='collage'?onCollage():onPage(tool.id as Page)}><span className="eyebrow">{tool.tag}</span><tool.icon size={42} strokeWidth={1}/><h2>{tool.title}</h2><p>{tool.text}</p><ArrowUpRight className="tool-arrow" size={24}/></button>)}</div><p className="studio-footnote">{bt('分析、RAW 和修图在本机完成；水彩仅在确认后发送选定图片。','Analysis, RAW and editing run locally. Watercolor sends only the image you confirm.')}</p></div>;
  return <div className="editor-page"><header className="studio-heading compact"><button className="quiet" onClick={()=>onPage('tools')}>← {bt('全部工具','All tools')}</button><span className="eyebrow">LUMINA / DIGITAL DARKROOM</span><h1>{title}</h1><p>{bt('原图只读 · 本机处理 · 自由创作','Read-only originals · Local processing · Your creative space')}</p></header>
    <div className="editor-toolbar"><input ref={fileInput} hidden type="file" accept="image/*,.dng,.cr2,.cr3,.nef,.nrw,.arw,.raf,.rw2,.orf,.pef,.srw,.raw" onChange={e=>{const f=e.target.files?.[0];if(f)void openFile(f);e.target.value='';}}/><button className="primary" {...commands.props('editorOpen')}><Upload size={16}/>{bt('打开照片 / RAW','Open photo / RAW')}</button><label className="library-picker"><span>{bt('从图库选择','From library')}</span><input aria-label={bt('查找图库照片','Find library photo')} placeholder={bt('搜索文件名','Search filename')} value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label={bt('图库照片','Library photo')} disabled={commandBusy} value={selection} onChange={e=>{const id=e.target.value;setSelection(id);if(id)void readSource(id);}}><option value="">{bt('选择照片','Select a photo')}</option>{photos.map(p=><option value={p.id} key={p.id}>{p.file_name}</option>)}</select></label><span className="toolbar-spacer"/><CommandMenu surface={commands} ids={['editorOpen','editorReference','editorUndo','editorRedo','editorReset','editorSave','editorExport','editorOriginal','editorFit','editorZoomIn','editorZoomOut','editorWatermark','editorWatercolor','editorCancel']} label={bt('编辑操作菜单','Edit actions')}/>{opened&&<><button {...commands.props('editorUndo')} aria-label={bt('撤销编辑','Undo edit')}><Undo2 size={16}/></button><button {...commands.props('editorRedo')} aria-label={bt('重做编辑','Redo edit')}><Redo2 size={16}/></button><button {...commands.props('editorReset')}>{bt('重置','Reset')}</button><button disabled={commandBusy||!library.saveSplit} onClick={()=>{setCropping(false);setTextEditing(false);setSplitting(true);}}>{bt('无缝分图','Seamless split')}</button><button {...commands.props('editorSave')}><Save size={16}/>{bt('保存编辑','Save edits')}{dirty?' •':''}</button></>}{(cropGesture||busy==='open'||busy==='reference'||(!busy&&rendering))&&<button {...commands.props('editorCancel')}><X size={16}/>{bt(cropGesture?'取消调整':'取消处理',cropGesture?'Cancel adjustment':'Cancel processing')}</button>}</div>
    {error&&<p className="error-box" role="alert">{error}</p>}{busy&&<p role="status">{bt('正在处理，请稍候…','Processing, please wait…')}</p>}
    {opened&&<nav className="edit-lineage" aria-label={bt('编辑来源与版本','Edit source and versions')}>
      {record.current?.derived_from&&<><span>{bt('分片','Panel')} {record.current.derived_from.panel_index+1} · {bt('来源父版本','Parent source version')} {record.current.derived_from.document_revision} · {bt('当前编辑版本','Current edit version')} {record.current.revision}</span><button disabled={!!busy||cropGesture||splitting} onClick={()=>void relatedEdit(record.current!.derived_from!.document_id,'parent')}>{bt('返回父工程（当前版本）','Open parent (current version)')}</button></>}
      {returnEdits.length>0&&returnEdits.at(-1)?.parent===record.current?.id&&<button disabled={!!busy||cropGesture||splitting} onClick={()=>void relatedEdit(returnEdits.at(-1)!.child,'child')}>{bt('返回分片编辑','Return to panel edit')}</button>}
    </nav>}
    {!opened?<div className="editor-welcome"><Aperture size={72} strokeWidth={.7}/><h2>{bt('每一张照片，都有新的可能。','Every photograph has another possibility.')}</h2><p>{bt('打开本机照片或 RAW。所有调整另存，不覆盖原片。','Open a local photo or RAW file. Adjustments never overwrite the original.')}</p><p className="muted">JPG / PNG / WebP / AVIF · DNG / CR2 / NEF / ARW</p>{records.length>0&&<div className="edit-records"><h3>{bt('继续编辑','Continue editing')}</h3>{records.map(r=><div key={r.id}><button disabled={!!busy} onClick={()=>void readSource(r.id,r)}>{r.source_name}<small>{new Date(r.updated_at).toLocaleString()}</small></button><button disabled={!!busy} aria-label={bt('删除编辑记录','Delete edit record')+' '+r.source_name} onClick={async()=>{if(confirm(bt('删除这份编辑记录？原图不会删除。','Delete this edit record? The original is kept.'))){try{await library.remove(r);firstRecords(await library.listRecords());}catch(e){setError(browserError(e));}}}}><X size={16}/></button></div>)}{records.length<recordsTotal&&<button disabled={!!busy} onClick={()=>void more('records')}>{bt('更多编辑记录','More saved edits')}</button>}</div>}</div>:<div className="editor-layout"><section className={"edit-stage "+(cropping?"composition-active":"")}><div className="edit-stage-top"><span>{name} · {opened.width} × {opened.height} · {opened.bits}-bit</span><span role="status">{rendering?bt('更新预览…','Updating preview…'):bt('本机预览','Local preview')}</span></div><div className={'edit-image '+(zoom>1&&!cropping?'zoomed':'')}>{cropping&&session.current?<CompositionCanvas recipe={recipe} source={opened} session={session.current} onChange={change} onBegin={beginCrop} onEnd={endCrop} onDone={closeCrop} gesturing={cropGesture} view={cropView} preview={preview} previewMatches={previewRecipe===JSON.stringify(recipe)}/>:textEditing&&recipe.version>=3?<LayerCanvas snap={layerPreferences.snap} source={opened} recipe={recipe} preview={preview} name={name} {...dimensions({...opened,channels:4,data:new Uint8Array(0)},recipe,2048)} document={layerDocument} layouts={textLayouts} selected={selectedText} ready={!busy&&previewRecipe===JSON.stringify(recipe)} onSelect={setSelectedText} onChange={changeLayers} onBegin={beginCrop} onEnd={endCrop} onDone={()=>{endCrop(true);setTextEditing(false);}}/>:<img style={{width:zoom>1?`${zoom*100}%`:undefined,maxWidth:zoom>1?'none':undefined}} src={compare?before:preview} alt={name}/>}</div><div className="edit-stage-controls"><button aria-pressed={compare} {...commands.props('editorOriginal')}>{bt(compare?'显示编辑效果':'查看原图',compare?'Show edits':'Show original')}</button><label>{bt('缩放','Zoom')} <select aria-label={bt('预览缩放','Preview zoom')} disabled={cropping||cropGesture||textEditing} value={zoom} onChange={e=>changeZoom(Number(e.target.value) as DocumentPreferences['zoom'])}><option value={1}>{bt('适应窗口','Fit')}</option><option value={1.5}>150%</option><option value={2}>200%</option></select></label></div>{analysis&&<section className="image-analysis"><h3>{bt('曝光与色彩','Exposure & color')}</h3><svg viewBox="0 0 256 92" role="img" aria-label={bt('RGB 与亮度直方图','RGB and luminance histogram')}>{analysis.histogram.map((bins,c)=>{const max=Math.max(1,...bins);return <polyline key={c} points={bins.map((n,x)=>`${x},${90-88*Math.sqrt(n/max)}`).join(' ')} fill="none" stroke={['#ef7c70','#8eb59a','#88b2dc','#d8caa7'][c]} strokeWidth={.8}/>})}</svg><div className="analysis-numbers"><span>{bt('暗部裁切','Shadow clipping')} <b>{(analysis.shadows*100).toFixed(2)}%</b></span><span>{bt('高光裁切','Highlight clipping')} <b>{(analysis.highlights*100).toFixed(2)}%</b></span></div><div className="color-palette">{analysis.palette.map(c=><span key={c} style={{background:c}} title={c}/>)}</div><small>{bt('基于预览像素；任一 RGB 通道达到边界计为裁切。','Measured from preview pixels; clipping means any RGB channel reaches a boundary.')}</small></section>}
    <details className="editor-exif"><summary>EXIF / {bt('解码信息','Decode information')}</summary><dl>{Object.entries(opened.metadata).filter(([,v])=>['string','number'].includes(typeof v)||v instanceof Date).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl></details></section>
    <fieldset className="edit-controls" disabled={!!busy}><legend className="sr-only">{bt('编辑控制','Editing controls')}</legend><details open><summary>{bt('参考图仿色','Reference color match')}</summary><input ref={referenceInput} type="file" hidden accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)void pickReference(f);e.target.value='';}}/><button {...commands.props('editorReference')}>{bt('打开参考图','Open reference')}</button>{reference&&<img className="reference-preview" src={reference} alt={bt('参考照片','Reference photo')}/>}<p className="muted">{bt('统计色彩迁移，不改变照片内容。保存的编辑保留参考色彩参数。','Statistical color transfer preserves image content. Saved edits retain reference color statistics.')}</p>{range('match','仿色强度','Match strength',0,100)}<label className="check"><input type="checkbox" checked={recipe.preserveLuminance} onChange={e=>change({preserveLuminance:e.target.checked})}/>{bt('保留亮度','Preserve luminance')}</label></details>
    <details open><summary>{bt('光线与白平衡','Light & white balance')}</summary>{range('exposure','曝光 EV','Exposure EV',-5,5,.1)}{range('contrast','对比度','Contrast')}{range('highlights','高光','Highlights')}{range('shadows','阴影','Shadows')}{range('temperature','色温（相对）','Temperature (relative)')}{range('tint','色调','Tint')}{range('saturation','饱和度','Saturation')}</details>
    <details><summary>{bt('曲线与 HSL','Curves & HSL')}</summary><svg className="curve-preview" viewBox="0 0 100 100" aria-label={bt('色调曲线','Tone curve')}><path d="M0 100 L100 0" stroke="var(--line)"/><polyline points={recipe.curve.map((v,i)=>`${i*25},${100-v*100}`).join(' ')} fill="none" stroke="var(--accent)"/></svg>{recipe.curve.map((v,i)=><label className="edit-slider" key={i}><span>{bt('曲线','Curve')} {i*25}%<output>{Math.round(v*100)}%</output></span><input aria-label={bt('曲线节点','Curve point')+' '+i} type="range" min={0} max={100} value={v*100} onChange={e=>change({curve:recipe.curve.map((v,j)=>j===i?Number(e.target.value)/100:v)})}/></label>)}{range('hue','色相','Hue',-180,180)}{range('hslSaturation','HSL 饱和度','HSL saturation')}{range('lightness','HSL 明度','HSL lightness')}</details>
    <LutPanel library={library} selected={recipe.version===5?recipe.lut:undefined} base={opened.original} disabled={!!busy||cropping||textEditing} onCompare={active=>{setLutComparing(active);if(active)setCompare(false);}} onChange={value=>{if(opened)change(withLut(recipe,opened,value));}} onBegin={beginCrop} onEnd={endCrop} onError={setError}/>
    {source.current&&<LocalVisionPanel preferences={layerPreferences} savePreferences={saveLayerPreferences} file={source.current} image={opened.original} photoId={sourceId.current} source={opened} recipe={recipe} document={layerDocument} selected={selectedText} disabled={!!busy||cropping} onChange={changeLayers} onSelect={setSelectedText} onAssets={()=>setVisionRevision(n=>n+1)} onError={setError}/>}
    <VisionPanel preferences={layerPreferences} savePreferences={saveLayerPreferences} refreshToken={visionRevision} document={layerDocument} recipe={recipe} source={opened} selected={selectedText} disabled={!!busy||cropping} onChange={changeLayers} onSelect={setSelectedText} onEdit={editText} onError={setError}/>
    <TextPanel open={layerPreferences.textOpen} onOpen={textOpen=>saveLayerPreferences({textOpen})} document={layerDocument} selected={selectedText} onSelect={setSelectedText} onChange={changeLayers} onEdit={editText} onError={setError} disabled={!!busy||cropping}/>
    <CompositionPanel recipe={recipe} source={opened} active={cropping} gesturing={cropGesture} trigger={cropTrigger} onToggle={()=>{if(cropping)closeCrop();else{setCompare(false);setTextEditing(false);setCropView(compositionView(recipe,opened));setCropping(true);}}} onChange={change} onBegin={beginCrop} onEnd={endCrop} view={cropView} onView={setCropView}/>
    <details><summary>{bt('细节','Detail')}</summary>{range('sharpen','锐化','Sharpening',0,100)}{range('denoise','基础降噪','Basic denoise',0,100)}<small>{bt('局部平滑降噪，不是 AI 降噪。','Local smoothing, not AI denoising.')}</small></details>
    <details open><summary>{bt('导出作品','Export')}</summary><label>{bt('格式','Format')}<select value={format} onChange={e=>setFormat(e.target.value as 'jpg'|'png'|'webp')}><option value="jpg">JPG · sRGB</option><option value="png">PNG · sRGB</option><option value="webp">WebP · sRGB</option></select></label><label>{bt('最长边（0 为原尺寸）','Long edge (0 = original)')}<input aria-label={bt('导出最长边','Export long edge')} type="number" min={0} max={16000} value={edgeDraft??edge} onChange={e=>setEdge(e.target.value)}/></label>{format!=='png'&&<label>{bt('质量','Quality')}<input type="range" min={1} max={100} value={quality} onChange={e=>setQuality(Number(e.target.value))}/></label>}<button className="primary" {...commands.props('editorExport')}><Download size={16}/>{bt('另存并下载','Save & download')}</button><p className="muted">{bt('工坊接收另存的编辑副本；原图保持不变。','Workshops receive a saved edited copy; the original stays unchanged.')} {bt('导出采用 sRGB，不包含原片 EXIF、GPS 或 XMP。','Exports use sRGB and omit original EXIF, GPS and XMP.')}</p><div className="button-row"><button {...commands.props('editorWatermark')}><Frame size={15}/>{bt('送入水印','Send to watermark')}</button><button {...commands.props('editorWatercolor')}><Paintbrush size={15}/>{bt('送入水彩','Send to watercolor')}</button></div>{!services.capabilities.watercolor&&<p className="muted">{bt('桌面编辑副本送入水彩正在适配；可先另存导出。','Sending desktop edited copies to watercolor is being added. Save and export the image for now.')}</p>}</details></fieldset></div>}
    {splitting&&opened&&session.current&&<SplitTool recipe={recipe} source={opened} session={session.current} library={library} name={name} documentId={record.current?.id} persist={persist} onEditPanel={editPanel} onClose={restore=>void closeSplit(restore)} onBusy={setBusy} notify={notify}/>}
    {!opened&&variants.length>0&&<section className="edit-variants"><h2>{bt('编辑副本','Edited copies')}</h2><div>{variants.map(v=><article key={v.id}><img src={v.preview_url} alt={v.name} loading="lazy"/><h3>{v.name}</h3><small>{v.width} × {v.height}</small><button disabled={!!busy} onClick={async()=>{setBusy('send');try{setDestination(await library.watermarkVariant!(v.id))}catch(e){setError(message(e))}finally{setBusy('')}}}>{bt('送入水印','Send to watermark')}</button></article>)}</div>{variants.length<variantsTotal&&<button disabled={!!busy} onClick={()=>void more('variants')}>{bt('更多编辑副本','More edited copies')}</button>}</section>}
  </div>;
}
