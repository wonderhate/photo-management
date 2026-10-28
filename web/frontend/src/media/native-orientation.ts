import * as exifr from 'exifr';

/** Match the existing native JPEG preview without changing legacy editor decoding.
 * createImageBitmap already handles EXIF; Pillow can also infer orientation from
 * embedded XMP when EXIF is absent. Only that missing-EXIF JPEG case needs a turn.
 */
export async function nativeDisplayOrientation(file:File,orientation:number|null|undefined,signal:AbortSignal){
  signal.throwIfAborted();
  if(!orientation||orientation===1||!Number.isInteger(orientation)||orientation<1||orientation>8)return 1;
  const magic=new Uint8Array(await file.slice(0,2).arrayBuffer());signal.throwIfAborted();
  if(magic[0]!==255||magic[1]!==216)return 1;
  try{
    const explicit=await exifr.orientation(file);signal.throwIfAborted();
    return explicit===undefined?orientation:1;
  }catch{signal.throwIfAborted();return 1;}
}
