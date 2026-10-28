import {isLocalFileURL,parseLocalFileURL} from './local-file-reference.ts';
const PREFIX='pc-local-media:';
const PHOTO_PATH=/^photos\/[a-zA-Z0-9-]{1,80}-(thumb|preview)\.jpg$/;
export function localPhotoSource(libraryID:string,path:string):string{
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(libraryID)||!PHOTO_PATH.test(path))throw new Error('Invalid photo media reference.');
  return PREFIX+libraryID+'/'+path;
}
export function isLocalPhotoSource(source:string){return source.startsWith(PREFIX);}
export function isLocalMediaSource(source:string){return isLocalPhotoSource(source)||isLocalFileURL(source);}
export function parseMediaSource(source:string):{libraryID:string;path:string;session?:string}|null{return isLocalPhotoSource(source)?parsePhotoSource(source):parseLocalFileURL(source);}
export function parsePhotoSource(source:string){
  if(!isLocalPhotoSource(source))return null;
  const parts=source.slice(PREFIX.length).split('/'),libraryID=parts.shift()||'',path=parts.join('/');
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(libraryID)||!PHOTO_PATH.test(path))throw new Error('Invalid photo media reference.');
  return {libraryID,path};
}
