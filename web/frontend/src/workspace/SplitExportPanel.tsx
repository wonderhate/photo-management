import {useEffect,useRef,useState} from 'react';
import {bt,browserError} from '../browser/text';
import type {EditorLibrary,EditSplitGroup,SplitExportResult,SplitOutputFolder} from '../core/editor-adapter';

export default function SplitExportPanel({library,group,disabled,onBusy}:{library:EditorLibrary;group:EditSplitGroup;disabled:boolean;onBusy:(busy:boolean)=>void}){
  const [folder,setFolder]=useState<SplitOutputFolder|null>(null),[subfolder,setSubfolder]=useState(true),[working,setWorking]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<SplitExportResult|null>(null);
  const pending=useRef<{key:string;id:string}|null>(null),running=useRef(false),alive=useRef(true),busy=useRef(onBusy);busy.current=onBusy;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{pending.current=null;setResult(null);setError('');},[group.id,folder?.id,subfolder]);
  function operation(value:boolean){running.current=value;setWorking(value);busy.current(value);}
  async function choose(){if(!library.chooseSplitFolder||running.current||disabled)return;operation(true);setError('');try{const value=await library.chooseSplitFolder();if(alive.current&&value)setFolder(value);}catch(e){if(alive.current)setError(browserError(e));}finally{if(alive.current)operation(false);}}
  async function exportGroup(fresh=false){
    if(!library.exportSplit||running.current||disabled)return;operation(true);setError('');setResult(null);
    const key=JSON.stringify({group:group.id,folder:folder?.id??null,subfolder});if(fresh||pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()};
    try{const output=await library.exportSplit(group.id,folder,subfolder,pending.current.id);if(alive.current){setResult(output);pending.current=null;}}catch(e){if(alive.current)setError(browserError(e));}finally{if(alive.current)operation(false);}
  }
  return <section className="split-export" aria-label={bt('整组目录输出','Export group to directory')}>
    <h4>{bt('导出整组','Export complete group')}</h4>
    <p className="muted">{bt('直接复制已保存的分片，保留原始尺寸和画质。同名文件自动避让。','Copies the saved panels at their original dimensions and quality. Existing files are kept.')}</p>
    <fieldset disabled={disabled||working}><legend className="sr-only">{bt('分图导出设置','Split export settings')}</legend>
      <div className="split-output-folder"><span title={folder?.label}>{folder?.label||bt('默认导出目录','Default export directory')}</span><button onClick={()=>void choose()}>{bt('选择分图目录','Choose split directory')}</button>{folder&&<button onClick={()=>setFolder(null)}>{bt('使用默认目录','Use default directory')}</button>}</div>
      <label className="check"><input type="checkbox" checked={subfolder} onChange={e=>setSubfolder(e.target.checked)}/>{bt('为整组创建子目录','Create a subfolder for the group')}</label>
      <div className="button-row"><button className="primary" onClick={()=>void exportGroup()}>{bt(error?'重试整组导出':'导出整组到目录',error?'Retry group export':'Export group to directory')}</button>{error&&<button onClick={()=>void exportGroup(true)}>{bt('另存一组','Export a new copy')}</button>}</div>
    </fieldset>
    {working&&<p role="status">{bt('正在处理目录输出，请稍候…','Preparing directory output. Please wait…')}</p>}
    {error&&<p className="error-box" role="alert">{error}</p>}
    {result&&<p className="split-export-result" role="status">{bt('已导出','Exported')} {result.files.length} {bt('张至','panels to')} <span>{result.directory}</span></p>}
  </section>;
}
