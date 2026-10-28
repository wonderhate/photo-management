import {current,commit,now,librarySession} from './storage';
import {changeLocation,locationChange,effectiveLocation} from '../core/photo-location';

export function locationFor(id:string){
  const library=current(),photo=library.photos.find(p=>p.id===id);if(!photo)throw new Error('Photo record no longer exists.');
  const record=library.photo_locations?.find(item=>item.photo_id===id)||null;
  return {photo_id:id,source_hash:photo.file_hash,record,effective:effectiveLocation(photo,record||undefined),original:{latitude:photo.gps_latitude,longitude:photo.gps_longitude}};
}
export async function updateLocation(id:string,value:unknown){
  const input=locationChange(value),libraryId=current().id,generation=librarySession();
  const check=()=>{if(current().id!==libraryId||librarySession()!==generation)throw new Error('Library changed. Reopen the current library.');};
  await commit(library=>{
    check();
    const photo=library.photos.find(p=>p.id===id);if(!photo)throw new Error('Photo record no longer exists.');
    const previous=library.photo_locations?.find(item=>item.photo_id===id),next=changeLocation(photo,previous,input,now());
    library.photo_locations=[...(library.photo_locations||[]).filter(item=>item.photo_id!==id),next];
  });check();return locationFor(id);
}
