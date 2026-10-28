import {useEffect,useRef,useState} from 'react';
import type {EditSession} from '../browser/edit-session';
import type {EditRecipe} from '../browser/editing';
import {browserError} from '../browser/text';

// One active preview and one replaceable pending request. Pointer movements
// never enqueue an unbounded stream behind a full-resolution worker operation.
export default function useSplitPreview(session:EditSession,recipe:EditRecipe,enabled=true,textRecipe?:EditRecipe){
  const key=JSON.stringify({recipe,textRecipe}),[preview,setPreview]=useState({url:'',key:''}),[error,setError]=useState('');
  const state=useRef({alive:true,serial:0,running:false,url:'',pending:null as {recipe:EditRecipe;textRecipe?:EditRecipe;key:string;serial:number}|null});
  useEffect(()=>{const s=state.current;s.alive=true;return()=>{s.alive=false;s.serial++;s.pending=null;if(s.url)URL.revokeObjectURL(s.url);};},[]);
  useEffect(()=>{
    const s=state.current,serial=++s.serial;s.pending=null;if(!enabled)return;
    const timer=setTimeout(()=>{
      s.pending={recipe:structuredClone(recipe),textRecipe:textRecipe?structuredClone(textRecipe):undefined,key,serial};if(s.running)return;s.running=true;
      void(async()=>{try{while(s.alive&&s.pending){const job=s.pending;s.pending=null;try{const result=await session.render(job.recipe,job.textRecipe);if(s.alive&&job.serial===s.serial){if(s.url)URL.revokeObjectURL(s.url);s.url=URL.createObjectURL(result.blob);setPreview({url:s.url,key:job.key});setError('');}}catch(e){if(s.alive&&job.serial===s.serial)setError(browserError(e));}}}finally{s.running=false;}})();
    },140);return()=>clearTimeout(timer);
  },[session,key,enabled]);
  return {...preview,ready:preview.key===key&&!!preview.url,error};
}
