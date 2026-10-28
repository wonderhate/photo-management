import * as exifr from 'exifr';
import {parseXmp} from './xmp';
import type {SourceDecodeProfile} from '../core/source-decode-profile';
import {embeddedSourceProfile} from '../core/source-decode-profile';

/** New editor sources follow valid embedded JPEG XMP only when EXIF is absent. */
export async function newSourceDecodeProfile(file:File):Promise<SourceDecodeProfile>{
  const profile:SourceDecodeProfile={version:2,extra_orientation:1};
  const magic=new Uint8Array(await file.slice(0,2).arrayBuffer());
  if(magic[0]!==255||magic[1]!==216)return profile;
  try{
    if(await exifr.orientation(file)!==undefined)return profile;
    const tags=await exifr.parse(file,{xmp:{parse:false},reviveValues:false,translateValues:false});
    if(typeof tags?.xmp!=='string')return profile;
    return embeddedSourceProfile(true,false,parseXmp(tags.xmp));
  }catch{return profile;}
}
