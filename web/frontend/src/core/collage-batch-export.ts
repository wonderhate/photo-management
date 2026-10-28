import {sameCollageSource} from './collage.ts';
import type {CollageScene,CollageSource} from './collage.ts';
export type CollagePageResult={status:'pending'|'running'|'completed'|'failed'|'cancelled';blob?:Blob;error?:string};
export const COLLAGE_ARCHIVE_BUDGET=250*1024*1024;
/** Sequential, resumable only on explicit invocation. Completed outputs are never replayed. */
export async function exportCollagePages(pages:CollageScene[],previous:CollagePageResult[],render:(scene:CollageScene,index:number)=>Promise<Blob>,signal:AbortSignal,update:(results:CollagePageResult[])=>void,budget=COLLAGE_ARCHIVE_BUDGET){
 const results=pages.map((_,i)=>previous[i]?.status==='completed'?{...previous[i]}:{status:'pending'} as CollagePageResult);
 let bytes=results.reduce((sum,r)=>sum+(r.blob?.size||0),0);update([...results]);
 for(let i=0;i<pages.length;i++){
  if(results[i].status==='completed')continue;if(signal.aborted)break;
  results[i]={status:'running'};update([...results]);
  try{const blob=await render(pages[i],i);if(signal.aborted)throw new DOMException('Cancelled','AbortError');if(bytes+blob.size>budget)throw new Error('Collage archive exceeds the size limit.');bytes+=blob.size;results[i]={status:'completed',blob};}
  catch(error){results[i]={status:signal.aborted?'cancelled':'failed',error:signal.aborted?undefined:error instanceof Error?error.message:'Collage processing failed.'};}
  update([...results]);
 }
 return results;
}
export function assertCollageSources(scene:CollageScene,sources:CollageSource[]){if(sources.length!==scene.sources.length||scene.sources.some(s=>!sameCollageSource(sources.find(candidate=>candidate.id===s.id),s)))throw new Error('Collage sources changed. Reopen the photos.');}
