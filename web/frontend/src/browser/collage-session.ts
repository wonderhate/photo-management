import type {CollageItem} from '../core/collage-book';
import type {CollageScene,CollageSource} from '../core/collage';
import type {CollageOutput} from './collage-render';
export type CollageInput={id:string;file:File;profile:CollageSource['profile'];photo_id?:string};
export class CollageSession{
 private worker=new Worker(new URL('./collage-worker.ts',import.meta.url),{type:'module'});
 private next=0;private closed=false;
 private requests=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;progress?:(done:number,total:number)=>void}>();
 constructor(){this.worker.onmessage=({data})=>{const request=this.requests.get(data.id);if(!request)return;if(data.progress){request.progress?.(data.progress.done,data.progress.total);return;}clearTimeout(request.timer);this.requests.delete(data.id);data.error?request.reject(new Error(data.error)):request.resolve(data.result);};this.worker.onerror=()=>this.close();this.worker.onmessageerror=()=>this.close();}
 private request<T>(action:string,payload:object,progress?:(done:number,total:number)=>void){return new Promise<T>((resolve,reject)=>{if(this.closed){reject(new Error('Collage processing cancelled.'));return;}const id=++this.next,timer=setTimeout(()=>this.close(),180000);this.requests.set(id,{resolve,reject,timer,progress});try{this.worker.postMessage({id,action,...payload});}catch{this.close();}});}
 inspect(input:CollageInput){return this.request<CollageItem>('inspect',{inputs:[input]});}
 open(inputs:CollageInput[],progress?:(done:number,total:number)=>void){return this.request<CollageSource[]>('open',{inputs},progress);}
 render(scene:CollageScene,showGuides=true){return this.request<{blob:Blob;width:number;height:number}>('render',{scene:structuredClone(scene),options:{format:'png',quality:95,showGuides}});}
 export(scene:CollageScene,options:CollageOutput={format:'png',quality:95}){return this.request<{blob:Blob;width:number;height:number}>('export',{scene:structuredClone(scene),options:{...options}});}
 close(){if(this.closed)return;this.closed=true;this.worker.terminate();for(const r of this.requests.values()){clearTimeout(r.timer);r.reject(new Error('Collage processing cancelled.'));}this.requests.clear();}
}
