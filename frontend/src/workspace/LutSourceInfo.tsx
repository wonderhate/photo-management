import {useEffect,useRef,useState} from 'react';
import type {LutAsset} from '../core/lut-contract';
import type {EditorLibrary} from '../core/editor-adapter';
import {bt,browserError} from '../browser/text';
import {downloadBlob} from '../browser/local-file-service';
export default function LutSourceInfo({asset,library,linked,onError}:{asset:LutAsset;library:EditorLibrary;linked:string[];onError:(error:string)=>void}){
 const [busy,setBusy]=useState(false),alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function action(reveal=false){setBusy(true);try{if(reveal)await library.revealLutSource!(asset.id);else{const source=await library.lutSource(asset.id);if(alive.current)await downloadBlob(source,asset.name);}}catch(e){if(alive.current)onError(browserError(e));}finally{if(alive.current)setBusy(false);}}
 return <section className="lut-source-info"><p>{asset.name} · {asset.size}³ · {(asset.bytes/1024).toLocaleString(undefined,{maximumFractionDigits:1})} KiB</p><p>{asset.context?.groups.join(' / ')||bt('已复制样式根目录','Copied styles root')}</p>{!!linked.length&&<p>{bt('关联来源：','Linked source: ')}{linked.join(' · ')}</p>}{!!asset.context?.comments.length&&<ul>{asset.context.comments.map((line,i)=><li key={i}>{line}</li>)}</ul>}<div className="button-row"><button disabled={busy} onClick={()=>void action()}>{bt('取出 CUBE 文件','Save CUBE file')}</button>{library.revealLutSource&&!!linked.length&&<button disabled={busy} onClick={()=>void action(true)}>{bt('定位关联源文件','Reveal linked source')}</button>}</div><small>{bt('取出的是当前样式原始字节，另存副本不改变样式或照片。','Saves the original bytes of this style as a separate copy. The style and photo stay unchanged.')}</small></section>;
}
