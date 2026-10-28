import LutTree from './LutTree';
import {buildLutTree,LUT_TREE_ROW_BUDGET} from '../core/lut-tree';
import {lutTreeAll} from '../core/lut-view';
import type {LutAsset} from '../core/lut-contract';
import {useMemo} from 'react';
import {bt} from '../browser/text';
import type {LutFolder} from '../core/lut-folders';
import type {LutView} from '../core/lut-view';
export type LutFolderFilter={id:string;path:string}|null;
export default function LutFoldersPanel({folders,copied,scanning,view,onView,onFilter,filter,onLink,onRemove,onRefresh}:{folders:LutFolder[];copied:LutAsset[];scanning:boolean;view:LutView;onView:(patch:Partial<LutView>)=>void;onFilter:(filter:LutFolderFilter)=>void;filter:LutFolderFilter;onLink:(id?:string)=>void;onRemove:(id:string)=>void;onRefresh:()=>void}){
  const trees=useMemo(()=>new Map(folders.map(f=>[f.id,buildLutTree(f.name,f.entries.map(e=>e.path.split('/').slice(0,-1)))])),[folders]);
  const copiedTree=useMemo(()=>buildLutTree(bt('已复制样式','Copied styles'),copied.map(a=>a.context?.groups||[])),[copied]);
  const treeSize=Math.max(1,Math.floor(LUT_TREE_ROW_BUDGET/Math.max(1,folders.length+(copied.length?1:0))));
  const state=(f:LutFolder)=>f.state==='ready'?bt('可用','Available'):f.state==='permission'?bt('需要重新授权','Permission needed'):f.state==='missing'?bt('目录未连接','Directory unavailable'):bt('读取失败','Read failed');
  return <section className="lut-folders"><div className="button-row"><button disabled={scanning} onClick={()=>onLink()}>{bt('关联样式目录','Link LUT directory')}</button><button disabled={scanning} onClick={onRefresh}>{bt('扫描关联目录','Scan linked directories')}</button></div><p className="muted">{bt('关联目录只读扫描；预览不复制文件，应用时保留样式版本。断开关联不删除原文件或旧工程副本。','Linked directories are read-only. Previews do not copy files; applying a style keeps its version. Unlinking keeps originals and saved copies.')}</p>{scanning&&<p role="status">{bt('正在扫描样式目录…','Scanning LUT directories…')}</p>}{filter&&<p>{filter.id==='library'?bt('已复制样式','Copied styles'):folders.find(f=>f.id===filter.id)?.name} / {filter.path}<button onClick={()=>onFilter(null)}>{bt('显示全部来源','Show all sources')}</button></p>}
    {(!!copied.length||!!folders.length)&&<div className="button-row"><button onClick={()=>onView(lutTreeAll(view,true))}>{bt('展开全部目录','Expand all folders')}</button><button onClick={()=>onView(lutTreeAll(view,false))}>{bt('收起全部目录','Collapse all folders')}</button></div>}
    {!!copied.length&&<div className="lut-copied-tree"><LutTree size={treeSize} root={copiedTree} id="library" view={view} onView={onView} onFilter={onFilter}/></div>}
    {folders.map(f=><article key={f.id} data-folder={f.id}><p><strong>{f.name}</strong> · {state(f)}{f.truncated?bt('（达到扫描上限）',' (scan limit reached)'):''}</p><div className="button-row"><button disabled={scanning} onClick={()=>onLink(f.id)}>{bt('重新定位 / 授权','Relocate / authorize')}</button><button disabled={scanning} onClick={()=>onRemove(f.id)}>{bt('断开关联','Unlink')}</button></div><LutTree size={treeSize} root={trees.get(f.id)!} id={f.id} view={view} onView={onView} onFilter={onFilter}/>{f.entries.some(e=>e.error)&&<details><summary>{bt('无法读取的样式','Styles that cannot be read')} · {f.entries.filter(e=>e.error).length}</summary><ul>{f.entries.filter(e=>e.error).slice(0,30).map(e=><li key={e.path}>{e.path} — {e.error==='size'?bt('文件大小不受支持','Unsupported file size'):e.error==='header'?bt('CUBE 格式不受支持','Unsupported CUBE header'):e.error==='changed'?bt('扫描期间已改变','Changed during scan'):bt('无法读取','Unreadable')}</li>)}</ul></details>}</article>)}
  </section>;
}
