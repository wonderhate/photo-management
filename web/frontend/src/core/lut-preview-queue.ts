type Job<A>={item:A;refs:number;state:'queued'|'running'|'ready';value?:string;promise:Promise<string>;resolve:(url:string)=>void;reject:(error:unknown)=>void};
const cancelled=()=>new DOMException('Cancelled.','AbortError');
// References protect visible images. Leaving the viewport cancels queued IO;
// an already active read finishes, but its unused result is released immediately.
export class LutPreviewQueue<A extends {id:string}>{
 private jobs=new Map<string,Job<A>>();private running=0;private runningWeight=0;private closed=false;
 private run:(item:A)=>Promise<string>;private revoke:(url:string)=>void;private capacity:number;
 private concurrency:number;private weight:(item:A)=>number;private maxWeight:number;
 constructor(run:(item:A)=>Promise<string>,revoke:(url:string)=>void,capacity=64,options:{concurrency?:number;weight?:(item:A)=>number;maxWeight?:number}={}){this.run=run;this.revoke=revoke;this.capacity=capacity;this.concurrency=Math.max(1,Math.min(4,Math.floor(options.concurrency||1)));this.weight=options.weight||(()=>1);this.maxWeight=options.maxWeight||Infinity;}
 acquire(item:A){
  if(this.closed)throw cancelled();let job=this.jobs.get(item.id);
  if(!job){let resolve!:(url:string)=>void,reject!:(error:unknown)=>void;const promise=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});job={item,refs:0,state:'queued',promise,resolve,reject};this.jobs.set(item.id,job);}
  job.refs++;const current=job;this.jobs.delete(item.id);this.jobs.set(item.id,job);queueMicrotask(()=>void this.pump());let released=false;
  return {promise:job.promise,release:()=>{if(released)return;released=true;current.refs--;if(!current.refs&&current.state==='queued'){this.jobs.delete(item.id);current.reject(cancelled());}this.trim();}};
 }
 private trim(){let ready=[...this.jobs.values()].filter(j=>j.state==='ready').length;
  for(const [id,job] of this.jobs){if(ready<=this.capacity)break;if(job.state==='ready'&&!job.refs){this.revoke(job.value!);this.jobs.delete(id);ready--;}}
 }
 private pump(){if(this.closed)return;while(this.running<this.concurrency){const job=[...this.jobs.values()].find(j=>j.state==='queued'&&j.refs);if(!job)return;const weight=Math.max(1,this.weight(job.item));if(this.running&&this.runningWeight+weight>this.maxWeight)return;this.running++;this.runningWeight+=weight;job.state='running';void this.execute(job,weight);}}
 private async execute(job:Job<A>,weight:number){
  try{const url=await this.run(job.item);if(this.closed||!job.refs){this.revoke(url);this.jobs.delete(job.item.id);job.reject(cancelled());}else{job.value=url;job.state='ready';job.resolve(url);this.trim();}}
  catch(error){this.jobs.delete(job.item.id);job.reject(error);}finally{this.running--;this.runningWeight-=weight;this.pump();}
 }
 close(){this.closed=true;for(const job of this.jobs.values()){if(job.value)this.revoke(job.value);else job.reject(cancelled());}this.jobs.clear();}
}
