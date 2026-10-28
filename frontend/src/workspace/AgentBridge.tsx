import {useEffect,useRef} from 'react';
import {api,message} from '../api';
import type {AgentRequest,AgentClaim,AgentResult} from '../core/agent';
import {IS_BROWSER} from '../runtime';
type Props={selected:ReadonlySet<string>;view:string;show:(ids:string[])=>Promise<AgentResult>;onChanged:()=>void;notify:(text:string)=>void};
export default function AgentBridge(props:Props){
 const latest=useRef(props);latest.current=props;
 const trigger=useRef<(()=>void)|undefined>(undefined);
 useEffect(()=>{trigger.current?.();},[props.selected,props.view]);
 useEffect(()=>{
  if(IS_BROWSER)return;
  const windowID=crypto.randomUUID();let stopped=false,polling=false,enabled=false,catalog='',timer:ReturnType<typeof setTimeout>|undefined,run:AbortController|undefined;
  const focused=()=>!document.hidden&&document.hasFocus();
  async function publish(){if(!catalog)return;const ids=[...latest.current.selected];await api('/agent/selection','POST',{catalog_id:catalog,window_id:windowID,photo_ids:ids.slice(0,100),total_count:ids.length,view:latest.current.view,focused:focused()});}
  async function execute(request:AgentRequest){
   const claim=await api<AgentClaim>('/agent/requests/'+request.id+'/claim','POST',{window_id:windowID});
   const controller=new AbortController();run=controller;let progress={processed:0,total:claim.review.arguments.photo_ids?.length||1},result:AgentResult={},error:string|null=null,beating=false;
   const heartbeat=setInterval(()=>{if(beating)return;beating=true;void api<{cancelled:boolean}>('/agent/requests/'+claim.id+'/progress','POST',{claim_token:claim.claim_token,...progress}).then(v=>{if(v.cancelled)controller.abort();},()=>controller.abort()).finally(()=>{beating=false;});},3000);
   try{
    controller.signal.throwIfAborted();
    if(claim.review.tool==='show_in_app')result=await latest.current.show(claim.review.arguments.photo_ids||[]);
    else result=await (await import('./agent-render')).renderAgent(claim.review,controller.signal,(processed,total,partial)=>{progress={processed,total};result=partial;});
   }catch(e){error=controller.signal.aborted?'Agent app task cancelled. Completed outputs are retained.':message(e);}
   finally{
    clearInterval(heartbeat);run=undefined;
    try{await api('/agent/requests/'+claim.id+'/finish','POST',{claim_token:claim.claim_token,result,error});}catch(e){if(!stopped)latest.current.notify(message(e));}
    if(!stopped)latest.current.onChanged();
   }
  }
  async function poll(){
   clearTimeout(timer);if(stopped||polling)return;polling=true;
   try{
    if(!catalog){await api('/health');}
    const state=await api<{enabled:boolean;catalog_id:string}>('/agent/settings');enabled=state.enabled;catalog=state.catalog_id;
    if(enabled){await publish();const inbox=await api<{items:AgentRequest[]}>('/agent/requests');
     const request=inbox.items.find(v=>v.status==='awaiting_app');if(request&&focused()&&!run&&!stopped)await execute(request);
    }
   }catch{/* Explicit failures remain in task history; a background poll never opens a dialog. */}
   finally{polling=false;if(!stopped)timer=setTimeout(()=>void poll(),enabled?3000:8000);}
  }
  const wake=()=>{if(enabled&&polling)void publish().catch(()=>{});else void poll();};
  trigger.current=wake;window.addEventListener('focus',wake);window.addEventListener('blur',wake);window.addEventListener('pc-agent-settings',wake);document.addEventListener('visibilitychange',wake);void poll();
  return()=>{stopped=true;clearTimeout(timer);run?.abort();trigger.current=undefined;window.removeEventListener('focus',wake);window.removeEventListener('blur',wake);window.removeEventListener('pc-agent-settings',wake);document.removeEventListener('visibilitychange',wake);};
 },[]);
 return null;
}
