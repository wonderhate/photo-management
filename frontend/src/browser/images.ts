import {isRawFile} from './raw-file';
type Request={id:number;action:string;payload:unknown;resolve:(value:any)=>void;reject:(error:Error)=>void;signal?:AbortSignal;aborted:boolean;interruptible:boolean;abort:()=>void};
let worker:Worker|undefined,sequence=0,active:Request|undefined,timer:ReturnType<typeof setTimeout>|undefined;
const queue:Request[]=[];
function clean(request:Request){request.signal?.removeEventListener('abort',request.abort);}
function next(){
  if(active||!queue.length)return;const request=queue.shift()!;active=request;
  if(!worker){
    let own:Worker;try{own=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});}catch{active=undefined;clean(request);request.reject(new Error('The image worker stopped.'));queueMicrotask(next);return;}worker=own;
    own.onmessage=({data})=>{if(worker!==own||!active||data.id!==active.id)return;const request=active;active=undefined;clearTimeout(timer);clean(request);if(!request.aborted)data.error?request.reject(new Error(data.error)):request.resolve(data.result);next();};
    own.onerror=own.onmessageerror=()=>fail(own,'The image worker stopped.');
  }
  const own=worker;timer=setTimeout(()=>fail(own,'Image processing timed out. Try a smaller photo.'),180000);
  try{own.postMessage({id:request.id,action:request.action,payload:request.payload});}catch{fail(own,'The image worker stopped.');}
}
function fail(own:Worker,message:string){
  if(worker!==own)return;own.terminate();worker=undefined;clearTimeout(timer);
  const request=active;active=undefined;if(request){clean(request);if(!request.aborted)request.reject(new Error(message));}next();
}
export function processImage<T=Blob>(action:string,payload:unknown,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();if(queue.length+(active?1:0)>=64)return Promise.reject(new Error('The image queue is full. Wait for pending work or cancel it.'));
  return new Promise((resolve,reject)=>{
    const name=(payload as {file?:File})?.file?.name;
    const request:Request={id:++sequence,action,payload,resolve,reject,signal,aborted:false,interruptible:typeof name==='string'&&isRawFile(name),abort:()=>{}};
    request.abort=()=>{request.aborted=true;reject(new DOMException('Image operation cancelled.','AbortError'));if(active!==request){const index=queue.indexOf(request);if(index>=0)queue.splice(index,1);clean(request);}else if(request.interruptible&&worker)fail(worker,'Image operation cancelled.');};
    signal?.addEventListener('abort',request.abort,{once:true});queue.push(request);next();
  });
}
