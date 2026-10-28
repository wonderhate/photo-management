export const LUT_THUMBNAIL_BYTES=32*1024*1024;
export function lutThumbnailConcurrency(cores:number,memory?:number){
 if(!Number.isFinite(cores)||cores<4||memory!==undefined&&memory<4)return 1;
 return cores>=8&&memory!==undefined&&memory>=8?4:2;
}
type Reply={id:number;blob?:Blob;error?:string};
export type ThumbnailWorker=Pick<Worker,'onmessage'|'onmessageerror'|'onerror'|'postMessage'|'terminate'>;
type Slot={worker:ThumbnailWorker|null;busy:boolean;pending:((reply:Reply)=>void)|null};
// Queue admission controls both parallelism and source bytes. Each slot owns
// exactly one RPC, so one worker failure never rejects another slot's work.
export class LutThumbnailPool<A extends {id:string}>{
 private slots:Slot[]=[];private closed=false;private sequence=0;
 private create:()=>ThumbnailWorker;private read:(asset:A)=>Promise<File>;private base:Blob;private limit:number;private timeout:number;
 constructor(create:()=>ThumbnailWorker,read:(asset:A)=>Promise<File>,base:Blob,limit:number,timeout=30000){this.create=create;this.read=read;this.base=base;this.limit=limit;this.timeout=timeout;}
 private reset(slot:Slot,error='LUT preview unavailable.'){
  if(slot.worker){slot.worker.onmessage=null;slot.worker.onmessageerror=null;slot.worker.onerror=null;slot.worker.terminate();slot.worker=null;}
  slot.pending?.({id:0,error});slot.pending=null;
 }
 private send(slot:Slot,payload:object):Promise<Reply>{return new Promise((resolve,reject)=>{
  const id=++this.sequence,timer=setTimeout(()=>this.reset(slot,'LUT preview timed out.'),this.timeout);
  slot.pending=reply=>{clearTimeout(timer);slot.pending=null;reply.error?reject(new Error(reply.error)):resolve(reply);};
  if(!slot.worker){slot.pending({id,error:'LUT preview unavailable.'});return;}
  slot.worker.onmessage=({data})=>{if(data.id===id)slot.pending?.(data);};
  try{slot.worker.postMessage({id,...payload});}catch{this.reset(slot);}
 });}
 async render(asset:A){
  if(this.closed)throw new DOMException('Cancelled.','AbortError');
  let slot=this.slots.find(s=>!s.busy);if(!slot){if(this.slots.length>=this.limit)throw new Error('LUT preview unavailable.');slot={worker:null,busy:false,pending:null};this.slots.push(slot);}slot.busy=true;
  try{
   if(!slot.worker){slot.worker=this.create();slot.worker.onerror=event=>{event.preventDefault?.();this.reset(slot!);};slot.worker.onmessageerror=()=>this.reset(slot!);await this.send(slot,{base:this.base});}
   if(this.closed)throw new DOMException('Cancelled.','AbortError');const file=await this.read(asset);
   if(this.closed)throw new DOMException('Cancelled.','AbortError');const result=await this.send(slot,{file,hash:asset.id});
   if(this.closed)throw new DOMException('Cancelled.','AbortError');if(!(result.blob instanceof Blob))throw new Error('LUT preview unavailable.');return result.blob;
  }catch(error){this.reset(slot);throw error;}finally{slot.busy=false;}
 }
 close(){this.closed=true;for(const slot of this.slots)this.reset(slot);}
}
