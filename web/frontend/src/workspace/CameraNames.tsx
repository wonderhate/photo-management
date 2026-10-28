import {trackPreferenceWrite} from '../core/preference-lifecycle';
import {createContext,useContext,useEffect,useState,useRef} from 'react';
import type {ReactNode} from 'react';
import type {createToolPreferenceStore} from '../core/tool-preference-store';
import {cameraDisplayName,validCameraAliases} from '../core/camera-names';
import type {CameraAlias} from '../core/camera-names';
import {registerResourceReset} from '../core/resource-lifecycle';

type Store=Awaited<ReturnType<typeof createToolPreferenceStore<'cameraNames'>>>;
type Names={aliases:CameraAlias[];ready:boolean;error:string;save:(values:CameraAlias[])=>Promise<void>};
const Context=createContext<Names>({aliases:[],ready:false,error:'',save:async()=>{throw new Error('Library not ready.');}});
export function CameraNamesProvider({children}:{children:ReactNode}){
  const [store,setStore]=useState<Store>(),[aliases,setAliases]=useState<CameraAlias[]>([]),[error,setError]=useState(''),[revision,setRevision]=useState(0),generation=useRef(0);
  useEffect(()=>()=>{generation.current++;},[]);
  useEffect(()=>registerResourceReset(()=>{generation.current++;setStore(undefined);setAliases([]);setRevision(n=>n+1);}),[]);
  useEffect(()=>{let alive=true;setStore(undefined);setAliases([]);setError('');void import('../core/tool-preference-store').then(m=>m.createToolPreferenceStore('cameraNames')).then(s=>{if(alive){setStore(s);setAliases(s.value.aliases||[]);}}).catch(e=>{if(alive)setError(String(e.message||e));});return()=>{alive=false;};},[revision]);
  async function save(values:CameraAlias[]){
    if(!store||!validCameraAliases(values))throw new Error('Invalid camera name mappings.');
    const ticket=generation.current,snapshot=values.map(v=>({...v}));await trackPreferenceWrite(store.save({aliases:snapshot}));if(ticket===generation.current)setAliases(snapshot);
  }
  return <Context.Provider value={{aliases,ready:!!store,error,save}}>{children}</Context.Provider>;
}
export const useCameraNames=()=>useContext(Context);
export function useCameraName(make:string|null|undefined,model:string|null|undefined){return cameraDisplayName(make,model,useCameraNames().aliases);}
