/** Metadata values are camera wall-clock facts, independent of UI language/timezone. */
export type MetadataTags=Record<string,unknown>;
export type CameraMetadata={camera_make:string|null;camera_model:string|null;lens_model:string|null;width:number|null;height:number|null;f_number:number|null;exposure_seconds:number|null;exposure_time:string|null;iso:number|null;focal_length:number|null;focal_length_35mm:number|null;orientation:number|null;date_taken:string|null;gps_latitude:number|null;gps_longitude:number|null;gps_altitude:number|null};
export type PhotoMetadata=Omit<CameraMetadata,'width'|'height'>&{raw_exif:Record<string,string>};

export function metadataNumber(value:unknown):number|null{
  if(Array.isArray(value))value=value[0];
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value!=='string')return null;
  const text=value.trim(),fraction=text.match(/^([+-]?\d+)\/([+-]?\d+)$/);
  if(fraction){const n=Number(fraction[1])/Number(fraction[2]);return Number.isFinite(n)?n:null;}
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text))return null;
  const n=Number(text);return Number.isFinite(n)?n:null;
}
export function captureDate(value:unknown):string|null{
  if(typeof value!=='string')return null;
  const prefix=value.trim().slice(0,19);
  if(prefix.startsWith('0000'))return null;
  if(!/^(?:\d{4}:\d{2}:\d{2} |\d{4}-\d{2}-\d{2}[T ])\d{2}:\d{2}:\d{2}$/.test(prefix))return null;
  const result=prefix.slice(0,10).replaceAll(':','-')+'T'+prefix.slice(11),date=new Date(result+'Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,19)===result?result:null;
}
export function formatShutter(value:number|null):string|null{
  if(value===null||!Number.isFinite(value)||value<=0)return null;
  const inverse=1/value,nearest=Math.floor(inverse+.5);
  if(value<1&&nearest>=2&&nearest<=1_000_000_000&&Math.abs(value-1/nearest)<=value*.02)return '1/'+nearest;
  const rounded=Number(value.toPrecision(6));
  return rounded>=1e6||rounded<1e-4?rounded.toExponential():String(rounded);
}
export function gpsCoordinate(value:unknown,reference:unknown,limit:number):number|null{
  let ref=typeof reference==='string'?reference.trim().toUpperCase():'';
  if(typeof value==='string'){
    const xmp=value.trim().match(/^(\d+)\s*,\s*(\d+(?:\.\d*)?)\s*([NSEW])$/i);
    if(xmp){if(ref&&ref!==xmp[3].toUpperCase())return null;ref=xmp[3].toUpperCase();value=[xmp[1],xmp[2],0];}
  }
  if(ref&&!(limit===90?['N','S']:['E','W']).includes(ref))return null;
  let result:number|null;
  if(Array.isArray(value)){
    if(value.length!==3)return null;
    const values=value.map(metadataNumber);if(values.some(v=>v===null))return null;
    const [d,m,s]=values as number[];if(m<0||m>=60||s<0||s>=60)return null;
    result=(d<0?-1:1)*(Math.abs(d)+m/60+s/3600);
  }else result=metadataNumber(value);
  if(result===null||Math.abs(result)>limit)return null;
  return ref==='S'||ref==='W'?-Math.abs(result):result;
}
const metadataText=(v:unknown)=>typeof v==='string'?v.replaceAll('\0','').trim().slice(0,4096)||null:typeof v==='number'&&Number.isFinite(v)?String(v):null;
export function metadataFromTags(tags:MetadataTags):CameraMetadata{
  const rank=(key:string)=>key.startsWith('XMP-')?20:!key.includes(':')||['original','ExifIFD','IFD0','GPS','File','Composite'].includes(key.split(':')[0])?0:10;
  function first<T>(names:string[],convert:(v:unknown)=>T|null,allowXmp=true):T|null{
    for(const name of names){
      const entries=Object.entries(tags).filter(([key])=>key.split(':').at(-1)===name&&(allowXmp||!key.startsWith('XMP-'))).sort(([a],[b])=>rank(a)-rank(b));
      for(const [,value] of entries){const converted=convert(value);if(converted!==null&&converted!=='')return converted;}
    }return null;
  }
  const positive=(v:unknown)=>{const n=metadataNumber(v);return n!==null&&n>0?n:null;};
  const iso=first(['ISO','ISOSpeedRatings'],positive),orientation=first(['Orientation'],metadataNumber,false),seconds=first(['ExposureTime'],positive);
  let width=first(['ExifImageWidth','ImageWidth'],positive,false),height=first(['ExifImageHeight','ImageHeight'],positive,false);
  if(width!==null&&(!Number.isSafeInteger(width)||width>100_000_000))width=null;
  if(height!==null&&(!Number.isSafeInteger(height)||height>100_000_000))height=null;
  if(width&&height&&width*height>100_000_000)width=height=null;
  const altitude=first(['GPSAltitude'],metadataNumber),altRef=first(['GPSAltitudeRef'],metadataNumber);
  return {camera_make:first(['Make'],metadataText),camera_model:first(['Model'],metadataText),lens_model:first(['LensModel','Lens','LensID'],metadataText),width,height,
    f_number:first(['FNumber'],positive),exposure_seconds:seconds,exposure_time:formatShutter(seconds),iso:iso!==null&&Number.isSafeInteger(iso)&&iso<=2_147_483_647?iso:null,
    focal_length:first(['FocalLength'],positive),focal_length_35mm:first(['FocalLengthIn35mmFormat','FocalLengthIn35mmFilm'],positive),
    orientation:orientation!==null&&Number.isInteger(orientation)&&orientation>=1&&orientation<=8?orientation:null,
    date_taken:first(['DateTimeOriginal','DateCreated','CreateDate'],captureDate),
    gps_latitude:gpsCoordinate(first(['latitude','GPSLatitude'],v=>v??null),first(['GPSLatitudeRef'],metadataText),90),
    gps_longitude:gpsCoordinate(first(['longitude','GPSLongitude'],v=>v??null),first(['GPSLongitudeRef'],metadataText),180),
    gps_altitude:altitude===null?null:altRef===1?-Math.abs(altitude):altitude};
}
export function originalMetadata(tags:MetadataTags):PhotoMetadata{
  const {width:_,height:__,...fields}=metadataFromTags(tags),raw_exif:Record<string,string>={};
  const sources:Record<string,string>={};
  for(const [key,value] of Object.entries(fields))if(value!==null)sources[key]='original';
  if(fields.orientation===null){fields.orientation=1;sources.orientation='default';}
  for(const [key,value] of Object.entries(tags))if(typeof value==='string'||typeof value==='number')raw_exif[key]=String(value).slice(0,4096);
  if(typeof tags.ProfileDescription==='string')raw_exif['ICC:ProfileDescription']=tags.ProfileDescription.trim().slice(0,4096);
  raw_exif['PhotoCollection:MetadataSources']=JSON.stringify(sources);
  return {...fields,raw_exif};
}
export function supplementMetadata(base:PhotoMetadata,tags:MetadataTags,origin:'xmp-embedded'|'xmp-sidecar'):PhotoMetadata{
  const result=structuredClone(base),sources:Record<string,string>=JSON.parse(result.raw_exif['PhotoCollection:MetadataSources']||'{}');
  for(const [key,value] of Object.entries(tags))result.raw_exif[origin+':'+key]=(typeof value==='string'?value:JSON.stringify(value)??'').slice(0,4096);
  for(const [key,value] of Object.entries(metadataFromTags(tags))){
    if(['width','height','orientation'].includes(key)||value===null)continue;
    const field=key as keyof Omit<PhotoMetadata,'raw_exif'>;
    if(result[field]===null){(result as Record<string,unknown>)[field]=value;sources[field]=origin;}
  }
  result.raw_exif['PhotoCollection:MetadataSources']=JSON.stringify(sources);return result;
}
