import {lutTreeOpen} from './lut-view.ts';
import type {LutView} from './lut-view.ts';
export const LUT_TREE_ROW_BUDGET=240;
export type LutTreeNode={path:string;name:string;count:number;children:LutTreeNode[]};
export function buildLutTree(name:string,groups:string[][]):LutTreeNode{
 type Draft={path:string;name:string;count:number;children:Map<string,Draft>};
 const root:Draft={path:'',name,count:0,children:new Map()};
 for(const group of groups){root.count++;let node=root;for(const part of group){let child=node.children.get(part);if(!child){child={name:part,path:node.path?node.path+'/'+part:part,count:0,children:new Map()};node.children.set(part,child);}child.count++;node=child;}}
 const finish=(node:Draft):LutTreeNode=>({...node,children:[...node.children.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(finish)});return finish(root);
}
export function lutTreeKey(id:string,path:string):`fold:${string}`{return `fold:${id}:${encodeURIComponent(path)}`;}
// Count the visible nodes without allocating or mounting the whole expanded tree.
export function lutTreePage(root:LutTreeNode,id:string,view:LutView,page:number,size:number){
 type Row={node:LutTreeNode;depth:number};const first:Row[]=[],rows:Row[]=[];let total=0;const start=Math.max(0,page)*size;
 function walk(node:LutTreeNode,depth:number){const index=total++;if(index<size)first.push({node,depth});if(index>=start&&index<start+size)rows.push({node,depth});if(lutTreeOpen(view,lutTreeKey(id,node.path)))for(const child of node.children)walk(child,depth+1);}
 if(lutTreeOpen(view,lutTreeKey(id,'')))for(const child of root.children)walk(child,1);
 const valid=page===0||start<total;return {rows:valid?rows:first,total,page:valid?page:0,pages:Math.max(1,Math.ceil(total/size))};
}
