import {createCollage,validateCollage,sameCollageSource,collageCanvasStyle,upgradeCollage} from './collage.ts';
import type {CollageScene,CollageSource,CollageCell} from './collage.ts';
import {captureDate} from './metadata.ts';
export const COLLAGE_GROUP_SIZES=[2,3,4,6,9] as const;
export type CollageGroupSize=typeof COLLAGE_GROUP_SIZES[number];
export type CollageOrder='selection'|'filename'|'capture_time';
export type CollageRemainder='own'|'merge'|'drop';
export type CollageItem={source:CollageSource;capture_time:string|null};
export type CollageGrouping={size:CollageGroupSize;order:CollageOrder;remainder:CollageRemainder};
export type CollageBook=CollageGrouping&{version:1|2;items:CollageItem[];sequence:string[];pages:CollageScene[];omitted:string[];placements:CollageCell[]};
const exact=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
function settings(value:CollageGrouping){if(!COLLAGE_GROUP_SIZES.includes(value.size)||!['selection','filename','capture_time'].includes(value.order)||!['own','merge','drop'].includes(value.remainder))throw new Error('Invalid collage batch grouping.');}
export function collageGroups<T>(items:T[],size:CollageGroupSize,remainder:CollageRemainder){
 settings({size,remainder,order:'selection'});const groups:T[][]=[];let omitted:T[]=[];
 for(let i=0;i<items.length;i+=size)groups.push(items.slice(i,i+size));
 const last=groups.at(-1);if(last&&last.length<size){if(remainder==='drop')omitted=groups.pop()!;else if(remainder==='merge'&&groups.length>1&&groups.at(-2)!.length+last.length<=12){groups.pop();groups[groups.length-1].push(...last);}}
 return {groups,omitted};
}
export function collageOrderedItems(book:Pick<CollageBook,'items'|'sequence'|'order'>){
 const byId=new Map(book.items.map(i=>[i.source.id,i])),ordered=book.sequence.map(id=>byId.get(id)!);if(book.order==='selection')return ordered;
 const compare=(a:string,b:string)=>a<b?-1:a>b?1:0,name=(item:CollageItem)=>item.source.name.toLowerCase();
 return ordered.sort((a,b)=>book.order==='capture_time'?(a.capture_time&&b.capture_time?compare(a.capture_time,b.capture_time):a.capture_time?-1:b.capture_time?1:compare(name(a),name(b))):compare(name(a),name(b)));
}
function placements(book:Pick<CollageBook,'placements'|'pages'>){const values=new Map(book.placements.map(p=>[p.source_id,p]));for(const page of book.pages)for(const cell of page.cells)values.set(cell.source_id,cell);return values;}
export function regroupCollage(book:CollageBook,options:Partial<CollageGrouping>={}):CollageBook{
 const next={...structuredClone(book),version:2 as const,...options};settings(next);const state=placements(book),grouped=collageGroups(collageOrderedItems(next),next.size,next.remainder);
 next.pages=grouped.groups.map((items,i)=>{const page=createCollage(items.map(item=>item.source)),prior=book.pages[i]||book.pages[0];if(prior){Object.assign(page,collageCanvasStyle(prior));if(prior.cells.length===items.length)page.template=prior.template;}page.cells=page.cells.map(c=>structuredClone(state.get(c.source_id)||c));validateCollage(page);return page;});
 next.omitted=grouped.omitted.map(i=>i.source.id);next.placements=next.items.map(i=>structuredClone(state.get(i.source.id)||{source_id:i.source.id,pan:{x:0,y:0},zoom:1}));return next;
}
export function createCollageBook(items:CollageItem[],options:CollageGrouping={size:4,order:'selection',remainder:'own'}):CollageBook{
 const book:CollageBook={version:2,...options,items:structuredClone(items),sequence:items.map(i=>i.source.id),pages:[],omitted:[],placements:[]};const result=regroupCollage(book);validateCollageBook(result);return result;
}
export function applyCollagePage(book:CollageBook,index:number,page:CollageScene){
 validateCollage(page);const previous=book.pages[index];if(!previous||page.sources.length!==previous.sources.length||page.sources.some(s=>!sameCollageSource(previous.sources.find(p=>p.id===s.id),s)))throw new Error('Collage batch page sources changed.');
 const next=structuredClone(book);next.version=2;next.pages=next.pages.map(upgradeCollage);next.pages[index]=upgradeCollage(page);next.sequence=[...next.pages.flatMap(p=>p.cells.map(c=>c.source_id)),...next.omitted];next.order='selection';next.placements=[...placements(next).values()];validateCollageBook(next);return next;
}
export function swapCollagePages(book:CollageBook,a:{page:number;cell:number},b:{page:number;cell:number}){
 const first=book.pages[a.page]?.cells[a.cell],second=book.pages[b.page]?.cells[b.cell];if(!first||!second)throw new Error('Invalid collage batch cell.');
 const next=structuredClone(book);[next.pages[a.page].cells[a.cell],next.pages[b.page].cells[b.cell]]=[structuredClone(second),structuredClone(first)];
 const byId=new Map(next.items.map(i=>[i.source.id,i.source]));for(const index of new Set([a.page,b.page]))next.pages[index].sources=next.pages[index].cells.map(c=>structuredClone(byId.get(c.source_id)!));
 next.sequence=[...next.pages.flatMap(p=>p.cells.map(c=>c.source_id)),...next.omitted];next.order='selection';next.placements=[...placements(next).values()];validateCollageBook(next);return next;
}
export function validateCollageBook(value:unknown):asserts value is CollageBook{
 const book=value as CollageBook;
 if(!exact(book,['version','size','order','remainder','items','sequence','pages','omitted','placements'])||![1,2].includes(book.version)||!Array.isArray(book.items)||book.items.length<1||book.items.length>240||!Array.isArray(book.sequence)||!Array.isArray(book.pages)||!Array.isArray(book.omitted)||!Array.isArray(book.placements))throw new Error('Unsupported collage batch document.');settings(book);
 const ids=new Set<string>();for(const item of book.items){if(!exact(item,['source','capture_time'])||item.capture_time!==null&&(typeof item.capture_time!=='string'||captureDate(item.capture_time)!==item.capture_time))throw new Error('Invalid collage batch source.');createCollage([item.source]);if(ids.has(item.source.id))throw new Error('Duplicate collage source.');ids.add(item.source.id);}
 if(book.sequence.length!==ids.size||new Set(book.sequence).size!==ids.size||book.sequence.some(id=>!ids.has(id)))throw new Error('Invalid collage batch order.');
 const expected=collageGroups(collageOrderedItems(book),book.size,book.remainder),byId=new Map(book.items.map(i=>[i.source.id,i.source]));
 if(book.pages.length!==expected.groups.length||JSON.stringify(book.omitted)!==JSON.stringify(expected.omitted.map(i=>i.source.id)))throw new Error('Invalid collage batch grouping.');
 for(const [i,page] of book.pages.entries()){validateCollage(page);if(book.version===1&&page.version!==1)throw new Error('Unsupported collage batch document.');if(JSON.stringify(page.cells.map(c=>c.source_id))!==JSON.stringify(expected.groups[i].map(item=>item.source.id))||page.sources.some(s=>!sameCollageSource(byId.get(s.id),s)))throw new Error('Collage batch page sources changed.');}
 if(book.placements.length!==ids.size||new Set(book.placements.map(c=>c.source_id)).size!==ids.size)throw new Error('Invalid collage batch placement.');
 const active=new Map(book.pages.flatMap(p=>p.cells).map(c=>[c.source_id,c]));
 for(const cell of book.placements){const source=byId.get(cell.source_id);if(!source)throw new Error('Invalid collage batch placement.');const one=createCollage([source]);one.cells=[cell];validateCollage(one);const shown=active.get(cell.source_id);if(shown&&(shown.zoom!==cell.zoom||shown.pan.x!==cell.pan.x||shown.pan.y!==cell.pan.y))throw new Error('Invalid collage batch placement.');}
}

export function upgradeCollageBook(value:unknown):CollageBook{validateCollageBook(value);return {...structuredClone(value),version:2,pages:value.pages.map(upgradeCollage)};}
