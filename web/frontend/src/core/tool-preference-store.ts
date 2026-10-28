import {createPreferenceStore} from './preference-store';
import type {ToolId,ToolPreferences} from './preferences';

export async function createToolPreferenceStore<K extends ToolId>(kind:K){
  const store=await createPreferenceStore();
  return {libraryId:store.libraryId,value:(store.tools[kind]||{}) as Partial<ToolPreferences[K]>,save:(patch:Partial<ToolPreferences[K]>)=>store.saveTool(kind,patch)};
}
