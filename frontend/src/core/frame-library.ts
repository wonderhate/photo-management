import {IS_BROWSER} from '../runtime';
import {api} from '../api';
import {validateLogo,validateUserFrame} from './frame-v2';
import type {LogoAsset,FrameUserTemplate} from './frame-v2';
export type FrameLibrary={templates:FrameUserTemplate[];logos:LogoAsset[]};
export async function createFrameLibrary(){
  if(IS_BROWSER){
    const {current,commit,directory,librarySession}=await import('../browser/storage'),id=current().id,base=directory(),generation=librarySession();
    const check=()=>{if(current().id!==id||directory()!==base||librarySession()!==generation)throw new Error('Library changed. Reopen the current library.');};
    return {async list():Promise<FrameLibrary>{check();return structuredClone({templates:current().frame_templates||[],logos:current().logos||[]});},
      async saveTemplate(value:FrameUserTemplate){validateUserFrame(value);check();await commit(s=>{check();if(s.frame_templates?.some(t=>t.id===value.id))throw new Error('This frame asset already exists. Save a new copy.');s.frame_templates=[...(s.frame_templates||[]),structuredClone(value)];});},
      async saveLogo(value:LogoAsset){validateLogo(value);check();await commit(s=>{check();if(s.logos?.some(t=>t.id===value.id))throw new Error('This frame asset already exists. Save a new copy.');s.logos=[...(s.logos||[]),structuredClone(value)];});},
      async remove(kind:'templates'|'logos',id:string){check();await commit(s=>{check();if(kind==='templates')s.frame_templates=(s.frame_templates||[]).filter(v=>v.id!==id);else s.logos=(s.logos||[]).filter(v=>v.id!==id);});}};
  }
  return {async list(){return api<FrameLibrary>('/frame-library');},async saveTemplate(value:FrameUserTemplate){validateUserFrame(value);await api('/frame-library/templates','POST',value);},async saveLogo(value:LogoAsset){validateLogo(value);await api('/frame-library/logos','POST',value);},async remove(kind:'templates'|'logos',id:string){await api('/frame-library/'+kind+'/'+encodeURIComponent(id),'DELETE');}};
}
