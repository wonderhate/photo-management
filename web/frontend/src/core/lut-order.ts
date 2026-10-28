import type {LutAsset} from './lut-contract.ts';
import type {LutView} from './lut-view.ts';
export type LutGroup='favorite'|'recent'|'other'|'hidden';
export function orderLuts(assets:LutAsset[],filter:LutView['filter'],recentIds:string[]){
 const ranks=new Map(recentIds.map((id,index)=>[id,index])),recent=new Set(recentIds.slice(0,12));
 const group=(a:LutAsset):LutGroup=>filter==='all'?(a.favorite?'favorite':recent.has(a.id)?'recent':'other'):filter==='favorite'?'favorite':filter==='recent'?'recent':filter==='hidden'?'hidden':'other';
 const groupRank={favorite:0,recent:1,other:2,hidden:3};
 const rows=[...assets].sort((a,b)=>groupRank[group(a)]-groupRank[group(b)]||(group(a)==='recent'?(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity):0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 return {rows,groups:rows.map(group)};
}
// Collapsed headers stay reachable, but their cells consume neither page slots
// nor arrow-key positions. Counts describe the filtered group, not this page.
export function lutVisiblePage(ordered:ReturnType<typeof orderLuts>,view:LutView,page:number,pageSize:number){
 const rows=ordered.rows.filter((_,i)=>!view[`collapse:${ordered.groups[i]}`]);
 const groupById=new Map(ordered.rows.map((a,i)=>[a.id,ordered.groups[i]]));
 const groups=rows.map(a=>groupById.get(a.id)!);
 const current=Math.max(0,Math.min(page,Math.max(0,Math.ceil(rows.length/pageSize)-1)));
 const cells=rows.slice(current*pageSize,(current+1)*pageSize);
 const sections=[...new Set(ordered.groups)].map(group=>({group,collapsed:!!view[`collapse:${group}`],count:ordered.groups.filter(g=>g===group).length,assets:cells.filter(a=>groupById.get(a.id)===group)})).filter(s=>s.collapsed||s.assets.length);
 return {rows,groups,page:current,sections};
}
// Headers start a new visual row. Page boundaries do too, even inside a group.
export function lutGroupedStep(index:number,groups:string[],columns:number,key:string,pageSize:number){
 if(!groups.length)return -1;if(index<0)return 0;
 if(key==='ArrowLeft')return Math.max(0,index-1);if(key==='ArrowRight')return Math.min(groups.length-1,index+1);
 const rows:number[][]=[];let current:number[]=[];
 for(let i=0;i<groups.length;i++){if(!i||groups[i]!==groups[i-1]||i%pageSize===0||current.length===columns){current=[];rows.push(current);}current.push(i);}
 const row=rows.findIndex(r=>r.includes(index)),column=rows[row].indexOf(index),next=rows[row+(key==='ArrowUp'?-1:1)];return next?next[Math.min(column,next.length-1)]:index;
}
