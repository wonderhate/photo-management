import {LUT_IMPORT_LIMIT} from './lut-library.ts';
export type LutDropEntry={name:string;isFile:boolean;isDirectory:boolean;file?:(ok:(file:File)=>void,fail:(error:DOMException)=>void)=>void;createReader?:()=>{readEntries:(ok:(entries:LutDropEntry[])=>void,fail:(error:DOMException)=>void)=>void}};
// Capture handles synchronously in the drop event; browsers clear DataTransfer afterwards.
export function lutDropSelection(transfer:DataTransfer){
 const entries=[...transfer.items].filter(i=>i.kind==='file').map(i=>i.webkitGetAsEntry?.()).filter(Boolean) as LutDropEntry[];
 return {entries,files:[...transfer.files]};
}
export async function collectLutDrop(selection:{entries:LutDropEntry[];files:File[]},active:()=>boolean=()=>true):Promise<File[]>{
 const files:File[]=[];let visited=0,cubes=0;
 const check=()=>{if(!active())throw new DOMException('Cancelled.','AbortError');};
 function add(file:File,parents:string[]){check();if(/\.cube$/i.test(file.name)&&++cubes>LUT_IMPORT_LIMIT)throw new Error('Too many dropped LUT files.');
  if(parents.length){const copy=new File([file],file.name,{type:file.type,lastModified:file.lastModified});Object.defineProperty(copy,'webkitRelativePath',{value:[...parents,file.name].join('/')});files.push(copy);}else files.push(file);
 }
 async function walk(entry:LutDropEntry,parents:string[]){check();if(++visited>20000)throw new Error('Dropped LUT directory is too large.');
  if(entry.isDirectory){if(parents.length>=9)throw new Error('Dropped LUT directory is too deep.');const reader=entry.createReader!();
   for(;;){check();const children=await new Promise<LutDropEntry[]>((ok,fail)=>reader.readEntries(ok,fail));check();if(!children.length)break;for(const child of children)await walk(child,[...parents,entry.name]);}
  }else if(entry.isFile){const file=await new Promise<File>((ok,fail)=>entry.file!(ok,fail));add(file,parents);}
 }
 if(selection.entries.length){for(const entry of selection.entries)await walk(entry,[]);}else{if(selection.files.length>20000)throw new Error('Dropped LUT directory is too large.');for(const file of selection.files)add(file,[]);}
 check();return files;
}
