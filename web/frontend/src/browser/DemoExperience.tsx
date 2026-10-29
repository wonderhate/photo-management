import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Download,FolderOpen,ImagePlus} from 'lucide-react';
import {bt,browserError} from './text';
import ToolsPage from './ToolsPage';
import WatermarkPage from '../WatermarkPage';
import MediaImage from '../media/MediaImage';
import DownloadLink from '../media/DownloadLink';
import {CameraNamesProvider} from '../workspace/CameraNames';
import {createTemporaryLibrary,importTemporaryPhoto} from './temporary-library';
import {publishedSample} from './published-sample';
import type {ExportResult,WatermarkOptions} from '../types';
import type {EditRecord,EditDestination} from '../core/editor-adapter';
import './demo-experience.css';

// Serialize StrictMode/remount cleanup before opening another temporary session.
let temporaryTail:Promise<unknown>=Promise.resolve();
export default function DemoExperience({onClose,onCreate}:{onClose:()=>void;onCreate:()=>void}){
  const [illustration,setIllustration]=useState(false);
  const [ready,setReady]=useState(false),[step,setStep]=useState<1|2|3>(1);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [photoId,setPhotoId]=useState(''),[watermarkId,setWatermarkId]=useState(''),[draftId,setDraftId]=useState('');
  const [result,setResult]=useState<ExportResult|null>(null),[hasSource,setHasSource]=useState(false);
  const session=useRef<Awaited<ReturnType<typeof createTemporaryLibrary>>|null>(null);
  const record=useRef<EditRecord|null>(null),watermarkOptions=useRef<WatermarkOptions|undefined>(undefined);
  const guard=useRef<(()=>Promise<boolean>)|null>(null),saveWatermark=useRef<(()=>Promise<boolean>)|null>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{
    let alive=true;let release!:()=>void;
    const released=new Promise<void>(resolve=>{release=resolve;});
    const opening=temporaryTail.then(()=>createTemporaryLibrary());
    temporaryTail=opening.then(async value=>{await released;await value.dispose();}).catch(()=>{});
    void opening.then(async value=>{if(!alive)return;session.current=value;const sample=await publishedSample();if(!alive||!value.active())return;const id=await importTemporaryPhoto(sample.file);if(alive&&value.active()){setIllustration(sample.illustration);setHasSource(true);setPhotoId(id);setReady(true);}}).catch(e=>{if(alive)setError(browserError(e));});
    return()=>{alive=false;session.current=null;release();};
  },[]);
  useEffect(()=>{if(ready)heading.current?.focus();},[step,ready]);
  function sourceChanged(){setPhotoId('');record.current=null;setHasSource(true);setResult(null);setDraftId('');setWatermarkId('');watermarkOptions.current=undefined;}
  function prepared(value:EditRecord){record.current=value;}
  function sent(destination:EditDestination){setWatermarkId(destination.id);setDraftId('');setResult(null);setNotice('');setStep(2);}
  async function sample(){
    if(busy||!session.current?.active())return;
    setBusy(true);setError('');
    try{if(guard.current&&!await guard.current())return;const sample=await publishedSample();if(!session.current?.active())return;const id=await importTemporaryPhoto(sample.file);sourceChanged();setIllustration(sample.illustration);setPhotoId(id);setReady(true);}
    catch(e){setError(browserError(e));}finally{setBusy(false);}
  }
  async function back(){
    if(busy)return;
    setBusy(true);setError('');
    try{if(step===2&&saveWatermark.current&&!await saveWatermark.current())return;setNotice('');setStep(step===3?2:1);setResult(null);}
    catch(e){setError(browserError(e));}finally{setBusy(false);}
  }
  async function exit(create=false){
    if(busy)return;
    if(step===2){if(saveWatermark.current&&!await saveWatermark.current())return;}else if(guard.current&&!await guard.current())return;
    if(hasSource&&!confirm(bt('退出会清空本次临时作品。需要保留请先在第 3 步下载，确定退出？','Leaving clears this temporary session. Download your image in step 3 to keep it. Leave now?')))return;
    setBusy(true);await session.current?.dispose();(create?onCreate:onClose)();
  }
  const titles=[bt('1. 光影暗房','1. Lumina Darkroom'),bt('2. 水印工坊','2. Watermark Workshop'),bt('3. 下载作品','3. Download your image')];
  return <main className="demo-experience demo-workflow"><header><button disabled={busy} onClick={()=>void exit()}><ArrowLeft size={17}/>{bt('返回开始页','Back to start')}</button><span className="demo-badge">{bt('本机体验 · 无需建库','LOCAL TRYOUT · NO LIBRARY NEEDED')}</span></header>
    <div className="demo-intro"><h1>{bt('从一张示例照片，完成一次创作。','Create a finished image from a sample photograph.')}</h1><p>{bt('使用这张公开示例，在完整暗房中调整，再到水印工坊装裱、署名，最后下载作品。不需要先选照片或建立图库；调整仅保留在本次页面内。','Use this published sample in the full darkroom, then frame and sign it in the Watermark Workshop before downloading. No photo selection or library setup is required. Edits stay in this page session.')}</p></div>
    <ol className="demo-steps" aria-label={bt('创作步骤','Creation steps')}>{titles.map((title,index)=><li key={index} aria-current={step===index+1?'step':undefined}><span>{title}</span><small>{index===0?bt('示例照片与完整调整','Sample photo and full editing'):index===1?bt('相框、信息与署名','Frames, metadata and signature'):bt('预览并另存成品','Preview and save a copy')}</small></li>)}</ol>
    <section className="demo-workspace" aria-labelledby="demo-step-title"><div className="demo-step-heading"><h2 id="demo-step-title" ref={heading} tabIndex={-1}>{titles[step-1]}</h2>{step>1&&<button disabled={busy} onClick={()=>void back()}><ArrowLeft size={16}/>{step===2?bt('返回光影暗房','Back to darkroom'):bt('返回水印工坊','Back to watermark')}</button>}{step===1&&!ready&&<button disabled={busy||!session.current?.active()} onClick={()=>void sample()}><ImagePlus size={16}/>{bt('重新载入示例','Reload sample')}</button>}</div>
      {!ready&&!error&&<p role="status">{bt('正在准备本机工作区…','Preparing the local workspace…')}</p>}
      {illustration&&ready&&<p className="muted">{bt('当前为程序绘制的插画示例，不是摄影作品。','The current sample is a program-drawn illustration, not a photograph.')}</p>}{error&&<p role="alert" className="error-box">{error}</p>}{notice&&<p role="status" className="demo-notice">{notice}</p>}
      {ready&&<CameraNamesProvider>{step===1?<ToolsPage mode="darkroom" photoId={photoId} guard={guard} notify={setNotice} onPage={()=>{}} onCollage={()=>{}} onSend={sent} workflow={{recordId:record.current?.id,onPrepared:prepared,onSourceChange:sourceChanged}}/>:step===2?<WatermarkPage ids={[watermarkId]} onChoose={()=>void back()} onJob={()=>{}} notify={setNotice} draftId={draftId} onSaved={setDraftId} guard={guard} workflow={{onExport:value=>{setResult(value);setNotice('');setStep(3);},saveRef:saveWatermark,initialOptions:watermarkOptions.current,onOptions:value=>{watermarkOptions.current=value;}}}/>:result&&<div className="demo-result demo-stage" data-liquid-glass="panel"><MediaImage data-glass-exclude src={result.url} alt={bt('最终导出作品','Final exported image')} mediaPriority={0}/><div><h3>{bt('作品准备好了','Your image is ready')}</h3><p>{result.width} × {result.height} · {result.format?.toUpperCase()}</p><p className="demo-result-name">{result.file_name}</p><DownloadLink className="primary demo-download" href={result.url} download={result.file_name}><Download size={17}/>{bt('下载作品','Download image')}</DownloadLink><p className="muted">{bt('下载与这里的预览使用同一份成品。原片保持只读，导出不携带原片 EXIF、GPS 或 XMP；相框中的可见文字仍会保留。','The download and this preview use the same finished file. Originals are read only. Exports omit source EXIF, GPS and XMP; visible text in the frame remains.')}</p></div></div>}</CameraNamesProvider>}
    </section><footer className="demo-privacy"><p>{bt('本次编辑、模板与导出仅暂存在页面内存中。水印工坊沿用完整本地功能，不提供云端 AI。退出前请下载需要保留的作品。','Edits, templates and exports stay in page memory. The Watermark Workshop provides its full local features without cloud AI. Download anything you want to keep before leaving.')}</p><button disabled={busy} onClick={()=>void exit(true)}><FolderOpen size={17}/>{bt('建立长期保存的图库','Set up a library for lasting storage')}</button></footer>
  </main>;
}
