import {Fragment,lazy,Suspense,useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {Aperture,ArrowRight,FolderOpen,Plus} from 'lucide-react';
import {openLibrary,restoreLibrary,selectDirectory,recoverLibrary,handleValue,beginBrowsing,LIBRARY_REQUIRED} from './storage';
import type {Directory} from './storage';
import {bt,browserError} from './text';
import {getLang,setStoredLang} from '../i18n';
import {Modal} from '../components';
import {BrowserLibraryContext,type LibraryIntent} from './LibraryContext';
import './browser.css';
const DemoExperience=lazy(()=>import('./DemoExperience'));
export default function BrowserStart({children}:{children:ReactNode}){
  const [demoRequested]=useState(()=>new URLSearchParams(location.search).get('demo')==='1');
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[lang,setLang]=useState(getLang());
  const [recent,setRecent]=useState<Directory|null>(null),[canRecover,setCanRecover]=useState(false);
  const [browsing,setBrowsing]=useState(false),[prompt,setPrompt]=useState<LibraryIntent|null>(null),[resumeImport,setResumeImport]=useState(false);
  const [demo,setDemo]=useState(demoRequested),[pendingAfterOpen,setPendingAfterOpen]=useState<LibraryIntent|null>(null);
  function metadataError(e:unknown){return e instanceof SyntaxError||e instanceof Error&&/^(Unsupported or damaged browser library|Invalid |Library metadata exceeds)/.test(e.message);}
  useEffect(()=>{if(demoRequested){setBusy(false);return;}let alive=true;void(async()=>{try{const handle=await handleValue<Directory>('last-library');if(alive)setRecent(handle||null);const value=await restoreLibrary();if(alive)setReady(!!value);}catch(e){if(alive){setError(browserError(e));setCanRecover(metadataError(e));}}finally{if(alive)setBusy(false);}})();return()=>{alive=false};},[demoRequested]);
  useEffect(()=>{const request=()=>{if(browsing&&!ready)setPrompt(previous=>previous||'save');};window.addEventListener(LIBRARY_REQUIRED,request);return()=>window.removeEventListener(LIBRARY_REQUIRED,request);},[browsing,ready]);
  useEffect(()=>{const closed=(event:Event)=>{history.replaceState(null,'','#/');setReady(false);setBrowsing(false);setPrompt(null);setResumeImport(false);setPendingAfterOpen(null);setDemo(false);setError('');setCanRecover(false);setBusy(false);setRecent((event as CustomEvent<Directory>).detail||null);setLang(getLang());};window.addEventListener('photocollection:close-library',closed);return()=>window.removeEventListener('photocollection:close-library',closed);},[]);
  function requestLibrary(intent:LibraryIntent){setError('');setCanRecover(false);setPrompt(intent);}
  function skip(){beginBrowsing();setBrowsing(true);}
  async function choose(create:boolean,recover=false,existing?:Directory){
    setBusy(true);setError('');setCanRecover(false);let selected=false;
    try{const handle=existing||await selectDirectory('readwrite');selected=true;if(recover)await recoverLibrary(handle);else await openLibrary(handle,create);setResumeImport(prompt==='import');setPendingAfterOpen(prompt);setPrompt(null);setReady(true);}
    catch(e){
      if(!selected&&e instanceof DOMException&&e.name==='AbortError')setError(bt('未选择文件夹。如果没有出现选择窗口，请在创建图库时使用的桌面 Edge 或 Chrome 中打开当前地址。图库文件未改动。','No folder was selected. If no picker appeared, open this address in the desktop Edge or Chrome used to create the library. Library files were not changed.'));
      else if(selected&&!create&&e instanceof DOMException&&e.name==='NotFoundError')setError(bt('找不到 library.json。请选择上次保存图库的数据目录或备份目录，而不是原片文件夹。','Cannot find library.json. Select the saved library data directory or a backup, rather than the source photo folder.'));
      else setError(browserError(e));
      setCanRecover(selected&&metadataError(e));
    }finally{setBusy(false);}
  }
  const supported='showDirectoryPicker' in window&&!!navigator.locks&&isSecureContext;
  function closeDemo(){setDemo(false);const url=new URL(location.href);url.searchParams.delete('demo');history.replaceState(null,'',url);}
  const choices=(dialog=false)=><section className={'browser-start-card'+(dialog?' browser-library-choice':'')}>
    <Aperture size={48}/>
    {!dialog&&<h1>{bt('光影集 · 浏览器本地图库','Lumina · Browser Local Library')}</h1>}
    {dialog&&<p className="browser-library-intent">{prompt==='import'?bt('选好图库保存位置后，会继续导入照片。','After choosing a library location, you will continue importing photos.'):prompt==='editor-open'?bt('先设置图库保存位置，随后回到暗房，继续打开照片。','Choose a library location, then return to the darkroom to open your photo.'):bt('此操作需要图库保存位置。选好后会回到当前页面；请继续完成刚才的操作。','This action needs a library location. You will return to this page to continue the action.')}</p>}
    <p>{bt('先用网站示例体验完整创作流程，或建立长期保存的图库。也可在体验中换用自己的照片。','Try the full creative workflow with the website sample, or set up a library for lasting storage. You can also choose your own photo in the tryout.')}</p>
    {!dialog&&<div className="browser-demo-entry"><button className="primary" disabled={busy} onClick={()=>setDemo(true)}>{bt('用示例体验','Try a sample')}<ArrowRight size={17}/></button><span>{bt('光影暗房 → 水印工坊 → 下载 · 无需建库，可自行换图','Darkroom → Watermark Workshop → Download · No library needed; choose your own photo anytime')}</span></div>}
    <ol className="browser-start-steps"><li><b>{bt('图库保存位置','Library location')}</b><span>{bt('选一个空文件夹，保存影集、编辑记录和导出作品，例如“我的光影集”。这一步不选择原片。','Choose an empty folder for collections, edits and exports, such as “My Lumina Library”. This is not your photo folder.')}</span></li><li><b>{bt('原片文件夹','Original photo folder')}</b><span>{bt('进入图库后，再选相机照片所在的文件夹，或添加几张照片。原片不会被覆盖。','Once inside, select the folder containing your photographs or add individual files. Originals are never overwritten.')}</span></li></ol>
    <details className="browser-start-details"><summary>{bt('已有图库、备份与浏览器授权说明','Existing libraries, backups and browser permissions')}</summary><p className="muted">{bt('已有图库请选择包含 library.json 的数据目录或备份目录。不同浏览器、浏览器配置和网站地址不会共享目录授权，建议继续使用创建图库时的 Edge 或 Chrome。','For an existing library, select its data directory or backup containing library.json. Directory permissions are separate for each browser, profile and site address. Continue in the Edge or Chrome used to create it.')}</p></details>
    {!dialog&&<label>{bt('语言','Language')} <select value={lang} onChange={e=>{const l=e.target.value as 'zh'|'en';setStoredLang(l);setLang(l);document.documentElement.lang=l;}}><option value="zh">中文</option><option value="en">English</option></select></label>}
    {supported&&recent&&<div className="button-row"><button disabled={busy} onClick={()=>void choose(false,false,recent)}><FolderOpen size={17}/>{bt('重新授权并打开上次图库','Reauthorize and open last library')} · {recent.name}</button></div>}
    {supported?<div className="button-row"><button className={dialog?'primary':''} disabled={busy} onClick={()=>void choose(true)}><Plus size={17}/>{bt('新建本地图库','New local library')}</button><button disabled={busy} onClick={()=>void choose(false)}><FolderOpen size={17}/>{bt('打开本地图库或备份','Open local library or backup')}</button></div>:<p role="alert">{bt('管理自己的图库需要电脑上的新版 Chrome 或 Edge，并通过 HTTPS 打开。你仍可体验示例。','Managing your own library requires current desktop Chrome or Edge over HTTPS. You can still try the sample.')}</p>}
    {supported&&canRecover&&<button disabled={busy} onClick={()=>void choose(false,true)}>{bt('从上一份元数据恢复（保留损坏文件）','Recover previous metadata (keep damaged file)')}</button>}
    {busy&&<p role="status">{bt('正在读取…','Loading…')}</p>}{error&&<p className="error-box" role="alert">{error}</p>}
    <div className="browser-start-skip"><button disabled={busy} onClick={dialog?()=>setPrompt(null):skip}>{bt(dialog?'继续浏览':'跳过，先浏览',dialog?'Continue browsing':'Skip for now')}<ArrowRight size={16}/></button><p className="muted">{bt('导入照片时再选择图库。','Choose a library when you import photos.')}</p></div>
    <p className="muted">{bt('无需安装。日常整理不上传照片；云端 AI 仅在你确认后发送所选图片。','No installation. Organizing stays local; cloud AI sends the selected image only after your confirmation.')}</p>
    {!dialog&&<a className="browser-windows-link" href="/windows.html?local=1" target="_blank" rel="noopener noreferrer">{bt('下载 Windows 版 · 安装包 / ZIP（新窗口）','Download for Windows · Installer / ZIP (new tab)')}</a>}
  </section>;
  if(demo)return <Suspense fallback={<main className="browser-start"><p role="status">{bt('正在准备示例…','Preparing the demo…')}</p></main>}><DemoExperience onClose={closeDemo} onCreate={()=>{closeDemo();if(supported)void choose(true);}}/></Suspense>;
  if(ready||browsing)return <BrowserLibraryContext.Provider value={{preview:!ready,importAfterOpen:resumeImport,pendingAfterOpen,finishPendingAction:()=>setPendingAfterOpen(null),requestLibrary}}>
    <Fragment key={ready?'library':'browse'}>{children}</Fragment>
    {prompt&&<Modal className="browser-library-prompt" title={bt(prompt==='import'?'导入照片前，选择本地图库':'选择本地图库',prompt==='import'?'Choose a library before importing':'Choose a local library')} onClose={()=>{if(!busy)setPrompt(null);}}>{choices(true)}</Modal>}
  </BrowserLibraryContext.Provider>;
  return <main className="browser-start">{choices()}</main>;
}
