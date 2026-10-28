import {IS_BROWSER} from '../runtime';
import {api} from '../api';

export async function displayLibraryId(){
  if(IS_BROWSER)return (await import('../browser/storage')).current().id;
  return (await api<{library_id:string}>('/workspace')).library_id;
}
