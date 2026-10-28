export type TaskResource='io'|'render'|'cloud'|'local-ai';
export const browserResourceLimits:Record<TaskResource,number>={io:1,render:1,cloud:1,'local-ai':1};
type Entry={id:string;scope:string;resource:TaskResource;controller:AbortController;run:(signal:AbortSignal)=>Promise<unknown>;resolve:(value:unknown)=>void;reject:(reason:unknown)=>void;started:boolean;parentId?:string};
export class TaskQueue {
  private entries=new Map<string,Entry>();
  private waiting:Entry[]=[];
  readonly capacity:number;
  readonly limits:Readonly<Record<TaskResource,number>>;
  constructor(capacity=64,limits:Record<TaskResource,number>={...browserResourceLimits}){this.capacity=capacity;this.limits=Object.freeze({...limits});}
  schedule<T>(id:string,scope:string,resource:TaskResource,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    if(this.entries.has(id))throw new Error('Duplicate task identifier.');
    if([...this.entries.values()].filter(e=>!e.parentId).length>=this.capacity)throw new Error('The task queue is full. Wait for pending work or cancel it.');
    if(!Object.hasOwn(this.limits,resource))throw new Error('Unknown task resource.');
    let resolve!:(value:unknown)=>void,reject!:(reason:unknown)=>void;
    const promise=new Promise<T>((yes,no)=>{resolve=value=>yes(value as T);reject=no;});
    const entry:Entry={id,scope,resource,run,resolve,reject,controller:new AbortController(),started:false};
    this.entries.set(id,entry);this.waiting.push(entry);queueMicrotask(()=>this.dispatch());return promise;
  }
  // Only io -> render borrowing is allowed, so exports never wait on an io
  // holder. A lease joins the same FIFO and releases between imported photos.
  borrow<T>(parentId:string,id:string,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    const parent=this.entries.get(parentId);
    if(!parent?.started||parent.resource!=='io'||parent.parentId||this.entries.has(id)||[...this.entries.values()].some(e=>e.parentId===parentId))throw new Error('Invalid render lease.');
    parent.controller.signal.throwIfAborted();
    let resolve!:(value:unknown)=>void,reject!:(reason:unknown)=>void;
    const promise=new Promise<T>((yes,no)=>{resolve=value=>yes(value as T);reject=no;});
    const entry:Entry={id,scope:parent.scope,resource:'render',controller:new AbortController(),run,resolve,reject,started:false,parentId};
    this.entries.set(id,entry);this.waiting.push(entry);queueMicrotask(()=>this.dispatch());return promise;
  }
  cancel(id:string){
    const entry=this.entries.get(id);if(!entry)return false;entry.controller.abort();
    for(const child of [...this.entries.values()])if(child.parentId===id)this.cancel(child.id);
    if(!entry.started){this.waiting=this.waiting.filter(value=>value!==entry);this.entries.delete(id);entry.reject(new DOMException('Task cancelled.','AbortError'));this.dispatch();}
    return true;
  }
  cancelScope(scope:string){for(const entry of [...this.entries.values()])if(entry.scope===scope)this.cancel(entry.id);}
  has(id:string){return this.entries.has(id);}
  snapshot(scope?:string){const entries=[...this.entries.values()].filter(e=>scope===undefined||e.scope===scope);return {capacity:this.capacity,pending:entries.filter(e=>!e.parentId).length,items:(Object.entries(this.limits) as [TaskResource,number][]).map(([name,limit])=>({name,limit,running:entries.filter(e=>e.resource===name&&e.started).length,queued:entries.filter(e=>e.resource===name&&!e.started).length}))};}
  private dispatch(){
    for(const entry of [...this.waiting]){
      if(!this.entries.has(entry.id))continue;
      const running=[...this.entries.values()].filter(e=>e.started&&e.resource===entry.resource).length;
      if(running>=this.limits[entry.resource])continue;
      this.waiting=this.waiting.filter(value=>value!==entry);entry.started=true;
      const finish=(ok:boolean,value:unknown)=>{this.entries.delete(entry.id);this.dispatch();if(!ok)entry.reject(value);else if(entry.controller.signal.aborted)entry.reject(new DOMException('Task cancelled.','AbortError'));else entry.resolve(value);};
      void Promise.resolve().then(()=>{entry.controller.signal.throwIfAborted();return entry.run(entry.controller.signal);}).then(value=>finish(true,value),error=>finish(false,error));
    }
  }
}
