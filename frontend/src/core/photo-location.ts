/** Manual catalog locations never modify the original image or its EXIF. */
export type ManualLocation={latitude:number|null;longitude:number|null;country:string;city:string;label:string;accuracy_m:number|null};
export type StoredLocation={version:1;photo_id:string;source_hash:string;revision:number;manual:ManualLocation|null;history:(ManualLocation|null)[];updated_at:string};
export type EffectiveLocation=ManualLocation&{source:'manual'|'exif'|'none'};
export type LocationChange={source_hash:string;expected_revision:number;operation:'set'|'clear'|'undo';value?:ManualLocation};
const fail=():never=>{throw new Error('Invalid photo location.');};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>{if(Object.keys(v).some(k=>!keys.includes(k)))fail();};
const number=(v:unknown,min:number,max:number):number|null=>{if(v===null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)return fail();return v;};
const text=(v:unknown,max=120)=>{if(typeof v!=='string'||[...v].length>max||/[\u0000-\u001f\u007f]/.test(v)||[...v].some(c=>c.codePointAt(0)!>=0xd800&&c.codePointAt(0)!<=0xdfff))return fail();return v.trim();};
export function manualLocation(value:unknown):ManualLocation{
  if(!object(value))return fail();exact(value,['latitude','longitude','country','city','label','accuracy_m']);
  const latitude=number(value.latitude,-90,90),longitude=number(value.longitude,-180,180),accuracy_m=number(value.accuracy_m,0,20040000);
  if((latitude===null)!==(longitude===null)||latitude===null&&accuracy_m!==null)return fail();
  const result={latitude,longitude,country:text(value.country),city:text(value.city),label:text(value.label,240),accuracy_m};
  if(latitude===null&&!result.country&&!result.city&&!result.label)return fail();return result;
}
export function validateLocation(value:unknown):asserts value is StoredLocation{
  if(!object(value))return fail();exact(value,['version','photo_id','source_hash','revision','manual','history','updated_at']);
  if(value.version!==1||typeof value.photo_id!=='string'||!/^\w[\w-]{0,79}$/.test(value.photo_id)||typeof value.source_hash!=='string'||!(/^[a-f0-9]{64}$/).test(value.source_hash)||!Number.isSafeInteger(value.revision)||Number(value.revision)<1)return fail();
  if(typeof value.updated_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.updated_at)||!Number.isFinite(Date.parse(value.updated_at))||new Date(value.updated_at).toISOString()!==value.updated_at)return fail();
  if(value.manual!==null)manualLocation(value.manual);
  if(!Array.isArray(value.history)||value.history.length>20)return fail();for(const item of value.history)if(item!==null)manualLocation(item);
}
export function locationChange(value:unknown):LocationChange{
  if(!object(value))return fail();exact(value,['source_hash','expected_revision','operation','value']);
  if(typeof value.source_hash!=='string'||!(/^[a-f0-9]{64}$/).test(value.source_hash)||!Number.isSafeInteger(value.expected_revision)||Number(value.expected_revision)<0||!['set','clear','undo'].includes(String(value.operation)))return fail();
  if(value.operation!=='set'&&value.value!==undefined)return fail();
  return {source_hash:value.source_hash,expected_revision:Number(value.expected_revision),operation:value.operation as LocationChange['operation'],...(value.operation==='set'?{value:manualLocation(value.value)}:{})};
}
export function changeLocation(photo:{id:string;file_hash?:string},previous:StoredLocation|undefined,input:LocationChange,updated_at:string):StoredLocation{
  if(photo.file_hash!==input.source_hash||(previous?.revision||0)!==input.expected_revision||previous&&previous.source_hash!==photo.file_hash)throw new Error('Location source or revision changed. Reload the photo.');
  const history=[...(previous?.history||[])],current=previous?.manual||null;
  let manual:ManualLocation|null;
  if(input.operation==='undo'){if(!history.length)throw new Error('No location change to undo.');manual=history.pop()!;}
  else{manual=input.operation==='clear'?null:manualLocation(input.value);history.push(current);}
  const next:StoredLocation={version:1,photo_id:photo.id,source_hash:input.source_hash,revision:(previous?.revision||0)+1,manual,history:history.slice(-20),updated_at};validateLocation(next);return next;
}
export function effectiveLocation(photo:{file_hash?:string;gps_latitude?:number|null;gps_longitude?:number|null},record?:StoredLocation):EffectiveLocation{
  if(record?.source_hash===photo.file_hash&&record?.manual)return {...record.manual,source:'manual'};
  const lat=photo.gps_latitude,lon=photo.gps_longitude,valid=typeof lat==='number'&&Number.isFinite(lat)&&lat>=-90&&lat<=90&&typeof lon==='number'&&Number.isFinite(lon)&&lon>=-180&&lon<=180;
  return {source:valid?'exif':'none',latitude:valid?lat:null,longitude:valid?lon:null,country:'',city:'',label:'',accuracy_m:null};
}

export type GeoBounds={west:number;south:number;east:number;north:number};
export function exactPlace(value:unknown):[string,string,string]{
  if(typeof value==='string'){if(value.length>4096)return fail();try{value=JSON.parse(value);}catch{return fail();}}
  if(!Array.isArray(value)||value.length!==3)return fail();return [text(value[0]),text(value[1]),text(value[2],240)];
}
export function geoBounds(value:unknown):GeoBounds{
  if(!object(value))return fail();exact(value,['west','south','east','north']);
  const west=number(value.west,-180,180),east=number(value.east,-180,180),south=number(value.south,-90,90),north=number(value.north,-90,90);
  if(west===null||east===null||south===null||north===null||south>north)return fail();return {west,south,east,north};
}
export function insideBounds(latitude:number,longitude:number,b:GeoBounds){
  return latitude>=b.south&&latitude<=b.north&&(b.west<=b.east?longitude>=b.west&&longitude<=b.east:longitude>=b.west||longitude<=b.east);
}
