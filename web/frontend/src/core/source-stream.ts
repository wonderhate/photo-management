// Bounded original/snapshot reads. The body is cancelled before an oversized input can accumulate.
export async function sourceBlob(response:Response,signal?:AbortSignal,limit=256*1024*1024){
  const tooLarge=()=>new Error('Photo exceeds the 256 MiB browser import limit.');
  signal?.throwIfAborted();
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw tooLarge();}
  if(!response.body){const blob=await response.blob();signal?.throwIfAborted();if(blob.size>limit)throw tooLarge();return blob;}
  const reader=response.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]= [];let size=0;
  const abort=()=>{void reader.cancel(signal?.reason).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{
    for(;;){signal?.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw tooLarge();chunks.push(value);}
    signal?.throwIfAborted();return new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'});
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
}
