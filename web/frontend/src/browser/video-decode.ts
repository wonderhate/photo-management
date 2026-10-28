import type {VideoMetadata} from '../core/video';
export const VIDEO_DECODE_ERROR='This browser cannot decode this video. Use the Windows desktop app to create a compatibility proxy.';

// A muted, paused media element delegates decode to the browser's media threads.
// It is never autoplayed or attached to the document.
export async function decodeVideoFrame(file:File,index:number,signal:AbortSignal):Promise<{metadata:VideoMetadata;cover:Blob}>{
  signal.throwIfAborted();
  const element=document.createElement('video'),url=URL.createObjectURL(file);element.muted=true;element.preload='auto';element.playsInline=true;
  const cancel=()=>{element.pause();element.removeAttribute('src');element.load();};
  const event=(name:'loadeddata'|'seeked')=>new Promise<void>((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);element.removeEventListener(name,ready);element.removeEventListener('error',error);signal.removeEventListener('abort',abort);};
    const ready=()=>{cleanup();resolve();},error=()=>{cleanup();reject(new Error(VIDEO_DECODE_ERROR));},abort=()=>{cleanup();reject(signal.reason||new DOMException('Aborted','AbortError'));};
    const timer=setTimeout(error,30000);element.addEventListener(name,ready,{once:true});element.addEventListener('error',error,{once:true});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
  signal.addEventListener('abort',cancel,{once:true});
  try{
    const loaded=event('loadeddata');element.src=url;await loaded;signal.throwIfAborted();
    const {videoWidth:width,videoHeight:height,duration}=element;
    if(!width||!height||width*height>100_000_000||!Number.isFinite(duration)||duration<=0||duration>7*86400)throw new Error('Invalid video dimensions or duration.');
    const second=Math.min(duration*.95,duration*index/8);
    if(second>0){const sought=event('seeked');element.currentTime=second;await sought;signal.throwIfAborted();}
    const scale=Math.min(1,640/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    canvas.getContext('2d')!.drawImage(element,0,0,canvas.width,canvas.height);
    const cover=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error(VIDEO_DECODE_ERROR)),'image/jpeg',.85));signal.throwIfAborted();
    return {metadata:{width,height,duration,fps:0,codec:'browser',date_taken:''},cover};
  }finally{signal.removeEventListener('abort',cancel);cancel();URL.revokeObjectURL(url);}
}
