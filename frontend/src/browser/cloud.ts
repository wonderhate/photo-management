import {current} from './storage';
import {bt} from './text';
let key='';
const local=location.protocol==='http:'&&['127.0.0.1','localhost'].includes(location.hostname);
let relay=localStorage.getItem('photocollection-art-relay')??(import.meta.env.VITE_ART_RELAY_URL||(local?'ws://127.0.0.1:9000/cloud-art':''));
export function cloudSettings(){return {configured:!!key&&!!relay,key_configured:!!key,relay_configured:!!relay,relay_url:relay,key_error:false,can_save_key:true,key_source:key?'session':'none',endpoint:relay||bt('转发服务尚未配置','Cloud relay not configured')};}
export function setCloudSettings(value:{api_key?:string;clear_key?:boolean;relay_url?:string;image_model?:string;title_model?:string}){
  if(value.image_model&&!/^qwen-image-3\.0(?:-pro)?$/.test(value.image_model))throw new Error('Invalid Qwen image model.');
  if(value.title_model&&!/^qwen[\w.-]{1,95}$/.test(value.title_model))throw new Error('Invalid Qwen title model.');
  const nextKey=value.api_key===undefined?key:value.api_key.trim(),nextRelay=value.relay_url===undefined?relay:value.relay_url.trim();
  if(value.api_key!==undefined&&(!nextKey||nextKey.length>2048||/[^\x21-\x7e]/.test(nextKey)))throw new Error('Invalid API key.');
  if(nextRelay){let url:URL;try{url=new URL(nextRelay);}catch{throw new Error('The cloud relay must use WSS.');}if(url.username||url.password||url.search||url.hash||!(url.protocol==='wss:'||local&&url.protocol==='ws:'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='9000'))throw new Error('The cloud relay must use WSS.');}
  if(value.relay_url!==undefined)localStorage.setItem('photocollection-art-relay',nextRelay);
  relay=nextRelay;key=value.clear_key?'':nextKey;
}
const limit=8*1024*1024;
export async function cloudRequest(action:'generate'|'titles',image:Blob,options:Record<string,any>,signal?:AbortSignal,beforeSubmit?:()=>Promise<void>,onReceipt?:(id:string)=>Promise<void>):Promise<any>{
  signal?.throwIfAborted();
  if(!key||!relay)throw new Error('Configure your session key and the cloud relay first.');
  const url=new URL(relay,location.href);if(url.protocol!=='wss:'&&!(url.protocol==='ws:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw new Error('The cloud relay must use WSS.');
  if(image.size>limit)throw new Error('The sanitized AI input exceeds 8 MiB.');
  const model=options.model||(action==='titles'?current().art.title_model:current().art.image_model),requestKey=key;
  if(!confirm(bt(`将发送所选图片到 ${url.host}，再转发至 maas.qianwenaiapi.com。模型：${model}。已移除 EXIF/GPS，使用你自己的千问密钥，服务可能计费。生成期间请保持页面打开；断连后不会自动重试。继续？`,`Send this image to ${url.host}, then maas.qianwenaiapi.com? Model: ${model}. EXIF/GPS have been removed. Your own Qwen key is used and charges may apply. Keep this page open; disconnections are never retried automatically. Continue?`)))throw new Error(bt('已取消云端请求。','Cloud request cancelled.'));
  const buffer=await image.arrayBuffer();signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{const ws=new WebSocket(url);ws.binaryType='arraybuffer';let finished=false,submitted=false,bytes=0,meta:Record<string,any>={},chunks:ArrayBuffer[]=[];const timer=setTimeout(()=>fail(new Error('Cloud request timed out; its result and billing status are unknown. Do not retry automatically.')),880000);
    function cleanup(){clearTimeout(timer);signal?.removeEventListener('abort',aborted);ws.close();chunks=[];}
    function aborted(){fail(new Error(bt('已取消云端请求。已提交的生成仍可能计费。','Cloud request cancelled. A submitted generation may still be billed.')));}
    signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted){aborted();return;}
    function fail(e:Error){if(finished)return;finished=true;cleanup();reject(Object.assign(e,{request_id:meta.request_id||''}));}
    ws.onopen=()=>{void (async()=>{ws.send(JSON.stringify({action,api_key:requestKey,model,quality:options.quality||'medium',description:options.description||'',keywords:options.keywords||'',language:options.language||'zh',image_size:buffer.byteLength}));for(let offset=0;offset<buffer.byteLength;offset+=64*1024){if(finished)return;while(ws.bufferedAmount>128*1024&&!finished)await new Promise(r=>setTimeout(r,50));if(finished)return;ws.send(buffer.slice(offset,offset+64*1024));await new Promise(r=>setTimeout(r,700));}if(finished)return;await beforeSubmit?.();signal?.throwIfAborted();if(finished)return;submitted=true;ws.send(JSON.stringify({type:'submit'}));})().catch(e=>fail(e));};
    async function receive(data:any){if(finished)return;try{if(typeof data!=='string'){bytes+=data.byteLength;if(bytes>limit)throw new Error('AI result exceeds 8 MiB.');chunks.push(data);return;}const value=JSON.parse(data);if(typeof value.request_id==='string'&&/^[a-zA-Z0-9._:-]{1,200}$/.test(value.request_id)&&!value.request_id.includes(requestKey)){meta.request_id=value.request_id;await onReceipt?.(value.request_id);}if(value.type==='error')throw new Error(value.message||'Cloud request failed.');if(value.type==='result')meta={...value,request_id:meta.request_id||''};if(value.type==='done'){const result=action==='titles'?{suggestions:meta.suggestions,request_id:meta.request_id||''}:{request_id:meta.request_id||'',image:new Blob(chunks,{type:meta.mime||'image/png'}),seconds:meta.seconds};if(action==='generate'&&!bytes)throw new Error('The AI service returned no image.');finished=true;cleanup();resolve(result);}}catch(e){fail(e instanceof Error?e:new Error('Invalid cloud response.'));}}
    let incoming=Promise.resolve();ws.onmessage=({data})=>{incoming=incoming.then(()=>receive(data));};
    ws.onerror=()=>{void incoming.then(()=>fail(new Error(submitted?'Cloud connection failed; the result and billing status are unknown.':'Could not connect to the cloud relay.')));};
    ws.onclose=event=>{void incoming.then(()=>{if(!finished)fail(new Error(submitted?'Cloud connection closed; the result and billing status are unknown.':event.code===1009?'Cloud relay rejected an image chunk before submission. Update the relay WebSocket size limit.':'Cloud connection closed before submission.'));});};
  });
}
