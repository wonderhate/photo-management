import {createPreferenceStore} from './preference-store';
export async function createAlbumPreferenceStore(){
  const store=await createPreferenceStore();
  return {libraryId:store.libraryId,value:store.albums,save:store.saveAlbums};
}
