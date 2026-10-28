export interface ResourceLease {ready:Promise<string>;release:()=>void}
type Entry={key:string;refs:number;priority:number;order:number;stamp:number;state:'queued'|'loading'|'ready'|'error';controller:AbortController;url?:string;bytes:number;resolve:(url:string)=>void;reject:(reason:unknown)=>void;promise:Promise<string>};
interface Options {concurrency?:number;maxEntries?:number;maxBytes?:number;createURL?:(blob:Blob)=>string;revokeURL?:(url:string)=>void}

// Referenced resources are never evicted. Only unreferenced ready entries use the idle cache budget.
export class ResourcePool {
  private entries=new Map<string,Entry>();private running=0;private serial=0;private scheduled=false;private bytes=0;
  private readonly concurrency:number;private readonly maxEntries:number;private readonly maxBytes:number;
  private readonly createURL:(blob:Blob)=>string;private readonly revokeURL:(url:string)=>void;
  private readonly load:(key:string,signal:AbortSignal)=>Promise<Blob>;
  constructor(load:(key:string,signal:AbortSignal)=>Promise<Blob>,options:Options={}){
    this.load=load;
    this.concurrency=options.concurrency??2;this.maxEntries=options.maxEntries??256;this.maxBytes=options.maxBytes??96*1024*1024;
    this.createURL=options.createURL??(blob=>URL.createObjectURL(blob));this.revokeURL=options.revokeURL??(url=>URL.revokeObjectURL(url));
  }
  acquire(key:string,priority=10):ResourceLease{
    let entry=this.entries.get(key);
    if(entry?.controller.signal.aborted||entry?.state==='error'){this.remove(entry);entry=undefined;}
    if(!entry){
      let resolve!:(url:string)=>void,reject!:(reason:unknown)=>void;
      const promise=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});
      entry={key,refs:0,priority,order:++this.serial,stamp:this.serial,state:'queued',controller:new AbortController(),bytes:0,resolve,reject,promise};this.entries.set(key,entry);
    }
    const own=entry;own.refs++;own.priority=Math.min(own.priority,priority);own.stamp=++this.serial;this.schedule();let released=false;
    return {ready:own.promise,release:()=>{
      if(released)return;released=true;own.refs=Math.max(0,own.refs-1);own.stamp=++this.serial;
      if(!own.refs&&(own.state==='queued'||own.state==='loading')){own.controller.abort();if(own.state==='queued'){own.reject(new DOMException('Resource released','AbortError'));this.remove(own);}}
      if(!own.refs&&own.state==='error')this.remove(own);this.trim();
    }};
  }
  private schedule(){if(this.scheduled)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;this.pump();});}
  private pump(){
    while(this.running<this.concurrency){
      const entry=[...this.entries.values()].filter(item=>item.state==='queued'&&item.refs>0).sort((a,b)=>a.priority-b.priority||a.order-b.order)[0];if(!entry)return;
      entry.state='loading';this.running++;
      void Promise.resolve().then(()=>this.load(entry.key,entry.controller.signal)).then(blob=>{
        if(entry.controller.signal.aborted||this.entries.get(entry.key)!==entry||!entry.refs)throw new DOMException('Resource released','AbortError');
        entry.url=this.createURL(blob);entry.bytes=blob.size;this.bytes+=blob.size;entry.state='ready';entry.stamp=++this.serial;entry.resolve(entry.url);this.trim();
      }).catch(reason=>{entry.state='error';entry.reject(reason);if(!entry.refs||this.entries.get(entry.key)!==entry)this.remove(entry);}).finally(()=>{this.running--;this.schedule();});
    }
  }
  private remove(entry:Entry){
    if(this.entries.get(entry.key)===entry)this.entries.delete(entry.key);
    if(entry.url){this.revokeURL(entry.url);this.bytes-=entry.bytes;entry.url=undefined;entry.bytes=0;}
  }
  private trim(){
    const idle=[...this.entries.values()].filter(entry=>entry.state==='ready'&&!entry.refs).sort((a,b)=>a.stamp-b.stamp);
    for(const entry of idle){if(this.entries.size<=this.maxEntries&&this.bytes<=this.maxBytes)break;this.remove(entry);}
  }
  reset(){
    for(const entry of [...this.entries.values()]){entry.controller.abort();if(entry.state==='queued')entry.reject(new DOMException('Library changed','AbortError'));this.remove(entry);}
  }
  snapshot(){return {entries:this.entries.size,bytes:this.bytes,running:this.running,queued:[...this.entries.values()].filter(entry=>entry.state==='queued').length,pinned:[...this.entries.values()].filter(entry=>entry.refs>0).length};}
}
