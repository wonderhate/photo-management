import {useEffect,useLayoutEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {Aperture,FolderOpen,Plus} from 'lucide-react';
import {openLibrary,restoreLibrary,selectDirectory,recoverLibrary,handleValue} from './storage';
import type {Directory} from './storage';
import {bt,browserError} from './text';
import {getLang,setStoredLang} from '../i18n';
import './browser.css';
export default function BrowserStart({children}:{children:ReactNode}){
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[lang,setLang]=useState(getLang());
  const [recent,setRecent]=useState<Directory|null>(null),[canRecover,setCanRecover]=useState(false);
  useLayoutEffect(()=>{const close=(event:Event)=>{setReady(false);setRecent((event as CustomEvent<Directory>).detail);setError('');setCanRecover(false);setBusy(false);history.replaceState(null,'','#/');};window.addEventListener('photocollection:close-library',close);return()=>window.removeEventListener('photocollection:close-library',close);},[]);
  function metadataError(e:unknown){return e instanceof SyntaxError||e instanceof Error&&/^(Unsupported or damaged browser library|Invalid |Library metadata exceeds)/.test(e.message);}
  useEffect(()=>{let alive=true;void(async()=>{try{const handle=await handleValue<Directory>('last-library');if(alive)setRecent(handle||null);const value=await restoreLibrary();if(alive)setReady(!!value);}catch(e){if(alive){setError(browserError(e));setCanRecover(metadataError(e));}}finally{if(alive)setBusy(false);}})();return()=>{alive=false};},[]);
  async function choose(create:boolean,recover=false,existing?:Directory){
    setBusy(true);setError('');setCanRecover(false);let selected=false;
    try{const handle=existing||await selectDirectory('readwrite');selected=true;if(recover)await recoverLibrary(handle);else await openLibrary(handle,create);setReady(true);}
    catch(e){
      if(!selected&&e instanceof DOMException&&e.name==='AbortError')setError(bt('未选择文件夹。如果没有出现选择窗口，请在创建图库时使用的桌面 Edge 或 Chrome 中打开当前地址。图库文件未改动。','No folder was selected. If no picker appeared, open this address in the desktop Edge or Chrome used to create the library. Library files were not changed.'));
      else if(selected&&!create&&e instanceof DOMException&&e.name==='NotFoundError')setError(bt('找不到 library.json。请选择上次保存图库的数据目录或备份目录，而不是原片文件夹。','Cannot find library.json. Select the saved library data directory or a backup, rather than the source photo folder.'));
      else setError(browserError(e));
      setCanRecover(selected&&metadataError(e));
    }finally{setBusy(false);}
  }
  if(ready)return children;
  const supported='showDirectoryPicker' in window&&!!navigator.locks&&isSecureContext;
  return <main className="browser-start"><section className="browser-start-card"><Aperture size={48}/><h1>{bt('光影集 · 浏览器本地图库','Lumina · Browser Local Library')}</h1><p>{bt('照片留在你的电脑，影集和作品保存在你选择的数据目录。','Photos stay on your computer. Albums and artworks live in your chosen data directory.')}</p><p className="muted">{bt('已有图库请选择包含 library.json 的数据目录；首次新建请选择空目录。不同浏览器、浏览器配置和网站地址不会共享目录授权，建议继续使用创建图库时的 Edge 或 Chrome。','For an existing library, select its data directory containing library.json; use an empty directory for a new library. Directory permissions are separate for each browser, profile and site address. Continue in the Edge or Chrome used to create it.')}</p><label>{bt('语言','Language')} <select value={lang} onChange={e=>{const l=e.target.value as 'zh'|'en';setStoredLang(l);setLang(l);document.documentElement.lang=l;}}><option value="zh">中文</option><option value="en">English</option></select></label>{supported&&recent&&<div className="button-row"><button disabled={busy} onClick={()=>void choose(false,false,recent)}><FolderOpen size={17}/>{bt('重新授权并打开上次图库','Reauthorize and open last library')} · {recent.name}</button></div>}{supported?<div className="button-row"><button className="primary" disabled={busy} onClick={()=>void choose(true)}><Plus size={17}/>{bt('新建本地图库','New local library')}</button><button disabled={busy} onClick={()=>void choose(false)}><FolderOpen size={17}/>{bt('打开本地图库或备份','Open local library or backup')}</button></div>:<p role="alert">{bt('请使用电脑上的新版 Chrome 或 Edge，并通过 HTTPS 打开。','Use the current desktop Chrome or Edge over HTTPS.')}</p>}{supported&&canRecover&&<button disabled={busy} onClick={()=>void choose(false,true)}>{bt('从上一份元数据恢复（保留损坏文件）','Recover previous metadata (keep damaged file)')}</button>}{busy&&<p role="status">{bt('正在读取…','Loading…')}</p>}{error&&<p className="error-box" role="alert">{error}</p>}<p className="muted">{bt('无需安装。日常整理不上传照片；云端 AI 仅在你确认后发送所选图片。','No installation. Organizing stays local; cloud AI sends the selected image only after your confirmation.')}</p></section></main>;
}
