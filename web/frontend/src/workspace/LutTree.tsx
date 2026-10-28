import {useEffect,useMemo,useState} from 'react';
import {bt} from '../browser/text';
import {lutTreeOpen} from '../core/lut-view';
import type {LutView} from '../core/lut-view';
import {lutTreeKey,lutTreePage} from '../core/lut-tree';
import type {LutTreeNode} from '../core/lut-tree';
import type {LutFolderFilter} from './LutFoldersPanel';
export default function LutTree({root,id,view,size,onView,onFilter}:{root:LutTreeNode;id:string;view:LutView;size:number;onView:(patch:Partial<LutView>)=>void;onFilter:(value:LutFolderFilter)=>void}){
 const [page,setPage]=useState(0),result=useMemo(()=>lutTreePage(root,id,view,page,size),[root,id,view,page,size]);
 useEffect(()=>setPage(0),[view.treeExpanded,size]);
 function row(node:LutTreeNode,depth=0){const key=lutTreeKey(id,node.path),open=lutTreeOpen(view,key);return <div className="lut-tree-node" key={node.path} data-tree-path={node.path} style={{paddingLeft:depth*6}}><div><button title={node.path||node.name} aria-expanded={open} aria-label={bt('展开或收起目录 ','Expand or collapse folder ')+node.name} onClick={()=>{setPage(0);const patch:Partial<LutView>={};patch[key]=!open;onView(patch);}}>{open?'▾':'▸'} {node.name}</button><button onClick={()=>onFilter({id,path:node.path})}>{bt('查看','View')} · {node.count}</button></div></div>;}
 return <div className="lut-tree-window" data-tree={id}>{row(root)}{result.rows.map(({node,depth})=>row(node,depth))}{result.pages>1&&<div className="lut-tree-pages"><button disabled={result.page===0} onClick={()=>setPage(result.page-1)}>{bt('上一页目录','Previous folders')}</button><small>{result.page+1} / {result.pages} · {result.total} {bt('个目录','folders')}</small><button disabled={result.page+1>=result.pages} onClick={()=>setPage(result.page+1)}>{bt('下一页目录','Next folders')}</button></div>}</div>;
}
