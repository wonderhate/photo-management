import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Download,FolderOpen,RotateCcw} from 'lucide-react';
import {bt,browserError} from './text';
import {EditSession} from './edit-session';
import {renderFrameV2} from './frame-v2-render';
import {createDemoImage,demoRecipe,demoFrame} from './demo-image';
import type {DemoFrame} from './demo-image';
import './demo-experience.css';

export default function DemoExperience({onClose,onCreate}:{onClose:()=>void;onCreate:()=>void}){
  const [exposure,setExposure]=useState(0),[saturation,setSaturation]=useState(0),[frame,setFrame]=useState<DemoFrame>('paper');
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[attempt,setAttempt]=useState(0);
  const [preview,setPreview]=useState(''),[size,setSize]=useState('');
  const session=useRef<EditSession|null>(null),output=useRef<Blob|null>(null),url=useRef('');
  useEffect(()=>{
    let alive=true;setReady(false);setBusy(true);setError('');setPreview('');output.current=null;
    const editor=new EditSession();session.current=editor;
    void createDemoImage().then(file=>editor.open(file)).then(()=>{if(alive)setReady(true);}).catch(e=>{if(alive){setError(browserError(e));setBusy(false);}});
    return()=>{alive=false;editor.dispose();session.current=null;URL.revokeObjectURL(url.current);url.current='';};
  },[attempt]);
  useEffect(()=>{
    if(!ready||!session.current)return;
    let alive=true;const editor=session.current;setBusy(true);setError('');setNotice('');output.current=null;
    const timer=setTimeout(()=>{void(async()=>{
      const rendered=await editor.export(demoRecipe(exposure,saturation),0,'png',100);
      const blob=frame==='none'?rendered.blob:await renderFrameV2(rendered.blob,demoFrame(frame),undefined,0,'png',100);
      if(!alive)return;
      const bitmap=await createImageBitmap(blob);const dimensions=`${bitmap.width} × ${bitmap.height}`;bitmap.close();if(!alive)return;
      URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(blob);output.current=blob;setPreview(url.current);setSize(dimensions);setBusy(false);
    })().catch(e=>{if(alive){setError(browserError(e));setBusy(false);}});},100);
    return()=>{alive=false;clearTimeout(timer);};
  },[ready,exposure,saturation,frame,attempt]);
  function download(){
    if(busy||!output.current||!url.current)return;
    const link=document.createElement('a');link.href=url.current;link.download='lumina-demo-edited.png';document.body.append(link);link.click();link.remove();
    setNotice(bt('已请求下载示例 PNG，请在浏览器下载记录中查看。示例未保存到任何图库。','Demo PNG download requested. Check your browser downloads. Nothing was saved to a library.'));
  }
  function change(action:()=>void){setBusy(true);setNotice('');action();}
  return <main className="demo-experience"><header><button onClick={onClose}><ArrowLeft size={17}/>{bt('返回开始页','Back to start')}</button><span className="demo-badge">{bt('示例体验 · 不需要图库','DEMO · NO LIBRARY NEEDED')}</span></header>
    <div className="demo-intro"><h1>{bt('先做出一张自己的作品。','Make your first finished image.')}</h1><p>{bt('用这张程序绘制的山景插画试试调色和装裱，再下载真实 PNG。它不是摄影作品，也不是你的照片。','Try color adjustments and framing on this generated mountain illustration, then download a real PNG. This is an illustration, not a photograph or one of your files.')}</p></div>
    <div className="demo-layout"><section className="demo-stage" data-liquid-glass="panel" aria-label={bt('示例作品预览','Demo image preview')} aria-busy={busy}>{preview?<img data-glass-exclude src={preview} alt={bt('程序绘制的山景示例，带 GENERATED DEMO 标识','Generated mountain illustration marked GENERATED DEMO')}/>:<p role="status">{bt('正在准备示例…','Preparing the demo…')}</p>}<p role="status">{busy?bt('正在更新预览…','Updating preview…'):preview?`${size} · PNG`:''}</p></section>
      <section className="demo-controls" data-liquid-glass="panel" aria-label={bt('示例调整','Demo adjustments')}><h2>{bt('1. 调整与装裱','1. Adjust and frame')}</h2><label>{bt('亮度','Exposure')} <output>{exposure>0?'+':''}{exposure.toFixed(1)} EV</output><input aria-label={bt('示例亮度','Demo exposure')} type="range" min={-1.5} max={1.5} step={.1} value={exposure} disabled={!ready} onChange={e=>change(()=>setExposure(Number(e.target.value)))}/></label><label>{bt('饱和度','Saturation')} <output>{saturation>0?'+':''}{saturation}</output><input aria-label={bt('示例饱和度','Demo saturation')} type="range" min={-100} max={60} value={saturation} disabled={!ready} onChange={e=>change(()=>setSaturation(Number(e.target.value)))}/></label><label>{bt('边框','Frame')}<select aria-label={bt('示例边框','Demo frame')} value={frame} disabled={!ready} onChange={e=>change(()=>setFrame(e.target.value as DemoFrame))}><option value="paper">{bt('米白相框','Paper frame')}</option><option value="dark">{bt('深色相框','Dark frame')}</option><option value="none">{bt('无边框','No frame')}</option></select></label><button disabled={!ready||exposure===0&&saturation===0&&frame==='paper'} onClick={()=>change(()=>{setExposure(0);setSaturation(0);setFrame('paper');})}><RotateCcw size={16}/>{bt('重置示例','Reset demo')}</button>
      <h2>{bt('2. 下载作品','2. Download your image')}</h2><button className="primary" disabled={busy||!preview||!!error} onClick={download}><Download size={17}/>{bt('下载示例 PNG','Download demo PNG')}</button><p className="muted">{bt('预览与下载使用同一张生成图片。文件由浏览器下载；不会写入图库或改动原片。','The download is the same image as the preview. Your browser downloads the file; no library or original is changed.')}</p>{notice&&<p role="status" className="demo-notice">{notice}</p>}{error&&<div role="alert" className="error-box"><p>{error}</p><button onClick={()=>setAttempt(v=>v+1)}>{bt('重新准备示例','Reload demo')}</button></div>}
      <hr/><h2>{bt('想用自己的照片？','Ready for your own photographs?')}</h2><p>{bt('创建图库保存位置，再选择原片。退出后示例调整会清空；想保留请先下载。','Choose a library location, then your photos. Demo edits reset when you leave; download first to keep them.')}</p><button onClick={onCreate}><FolderOpen size={17}/>{bt('建立我的图库','Set up my library')}</button></section></div>
    <p className="demo-privacy">{bt('示例由光影集在本机绘制，沿用暗房调色与相框渲染。无需目录授权，不使用云端 AI。','Lumina draws this illustration locally using the darkroom color engine and frame renderer. No directory permission or cloud AI is needed.')}</p>
  </main>;
}
