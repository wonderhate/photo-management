import {flushPreferenceWrites} from '../core/preference-lifecycle';
import {stopTasks} from './task-service';
import {setCloudSettings} from './cloud';
import {directory,handleValue,closeLibrary} from './storage';
export async function closeLocalLibrary(){
  await flushPreferenceWrites();await stopTasks();const previous=directory();
  try{await handleValue('last-library',null);}catch{/* The optional handle cache must not block closing. */}setCloudSettings({clear_key:true});closeLibrary();
  window.dispatchEvent(new CustomEvent('photocollection:close-library',{detail:previous}));
}
