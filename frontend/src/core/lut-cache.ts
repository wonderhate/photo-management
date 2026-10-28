import {MAX_CUBE_BYTES,parseCube,prepareLut} from './cube-lut.ts';
import type {PreparedLut} from './cube-lut.ts';
// Worker-local, content-addressed tables. Verify incoming bytes even on hits;
// metadata or a previously cached table must never conceal a changed source.
export class VerifiedLutCache{
 private tables=new Map<string,PreparedLut>();
 async load(file:Blob,id:string){
  if(!file.size||file.size>MAX_CUBE_BYTES)throw new Error('Invalid CUBE LUT: file_size');
  const bytes=await file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==id)throw new Error('LUT source changed. Restore a backup.');
  let table=this.tables.get(id);if(!table)table=prepareLut(parseCube(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  this.tables.delete(id);this.tables.set(id,table);
  while(this.tables.size>4)this.tables.delete(this.tables.keys().next().value!);
  return table;
 }
 clear(){this.tables.clear();}
}
