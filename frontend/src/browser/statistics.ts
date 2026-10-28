import {photoShape} from '../core/photo-query.ts';
import type {Photo,Bin,Statistics,Report,Lifecycle} from '../types';
import {formatShutter as shutter} from '../core/metadata.ts';
import {photoFlag} from '../core/photo-flag.ts';
import {photoTextValue,textContains} from '../core/photo-text.ts';
const fields=['focal_length','f_number','iso','exposure_seconds'] as const;
function counts(values:(string|number|null|undefined)[]){const result=new Map<string|number,number>();for(const v of values)if(v!==null&&v!==undefined&&v!=='')result.set(v,(result.get(v)||0)+1);return [...result.entries()].sort((a,b)=>b[1]-a[1]);}
const common=(data:Photo[],key:keyof Photo)=>counts(data.map(p=>p[key] as string|number|null))[0]?.[0]??null;
export function matches(photo:Photo,filters:Record<string,unknown>):boolean {
  for(const [key,raw] of Object.entries(filters)){if(raw===undefined||raw===null||raw==='')continue;const value=String(raw);
    if(key==='search'&&!`${photo.file_name} ${photo.camera_model||''} ${photo.lens_model||''} ${photo.tags.join(' ')}`.toLowerCase().includes(value.toLowerCase()))return false;
    if((key==='text'||key==='filename')&&!textContains(key==='text'?photoTextValue(photo,'text'):photo.file_name,value))return false;
    if(key==='tag'&&!photo.tags.includes(value))return false;
    if(key==='favorite'&&photo.favorite!==['true','1'].includes(value))return false;
    if(key==='flag'&&photoFlag(photo.flag)!==photoFlag(value))return false;
    if(key==='orientation'&&photoShape(photo)!==value)return false;
    if(key==='file_type'&&value!=='all'&&(value==='raw'?!photo.is_raw:photo.is_raw))return false;
    if(key==='date_from'&&(!photo.date_taken||(photo.date_taken.length===10?photo.date_taken+'T00:00:00':photo.date_taken.slice(0,19))<(value.length===10?value+'T00:00:00':value)))return false;
    if(key==='date_to'&&(!photo.date_taken||(photo.date_taken.length===10?photo.date_taken+'T00:00:00':photo.date_taken.slice(0,19))>value.slice(0,10)+'T23:59:59'))return false;
    const m=key.match(/^(focal_length|f_number|iso|exposure_seconds)(_min|_max|_lt|_gt)?$/);if(m){const n=photo[m[1] as keyof Photo] as number|null,target=Number(value);if(n==null||!Number.isFinite(target)||(!m[2]&&n!==target)||(m[2]==='_min'&&n<target)||(m[2]==='_max'&&n>target)||(m[2]==='_lt'&&n>=target)||(m[2]==='_gt'&&n<=target))return false;}
    if(['camera_make','camera_model','lens_model','rating','color_label'].includes(key)&&String(photo[key as keyof Photo]??'')!==value)return false;
  }return true;
}
export function histogram(data:Photo[],field:keyof Photo,mode='grouped'):Bin[]{
  let bins:[string,Record<string,string|number>][]=[];
  if(mode==='exact'||['lens_model','camera_model'].includes(field)){bins=counts(data.map(p=>p[field] as string|number|null)).sort(([a],[b])=>typeof a==='number'&&typeof b==='number'?a-b:String(a).localeCompare(String(b))).map(([v])=>[field==='focal_length'?v+' mm':field==='f_number'?'f/'+v:field==='iso'?'ISO '+v:field==='exposure_seconds'?shutter(Number(v))+' s':String(v),{[field]:v}]);}
  else if(field==='focal_length')bins=[[0,16,'< 16 mm'],[16,25,'16–24 mm'],[25,36,'25–35 mm'],[36,51,'36–50 mm'],[51,86,'51–85 mm'],[86,136,'86–135 mm'],[136,201,'136–200 mm'],[201,Infinity,'> 200 mm']].map(([a,b,l])=>[String(l),{...(a?{focal_length_min:Number(a)}:{}),...(b!==Infinity?{focal_length_lt:Number(b)}:{})}]);
  else if(field==='iso'){let previous=0;for(const high of [100,200,400,800,1600,3200,6400]){bins.push([`ISO ${previous+1}–${high}`,{iso_gt:previous,iso_max:high}]);previous=high;}bins.push(['ISO > 6400',{iso_gt:6400}]);}
  else if(field==='f_number'){const stops=[1,1.2,1.4,1.8,2,2.8,4,5.6,8,11,16,22,32,45,64];bins=stops.map((v,i)=>['f/'+v,{f_number_min:i?Math.sqrt(stops[i-1]*v):0,...(i<stops.length-1?{f_number_lt:Math.sqrt(v*stops[i+1])}:{})}]);}
  else if(field==='exposure_seconds'){const edges=[1,1/15,1/60,1/125,1/250,1/500,1/1000];bins=[['≥ 1 s',{exposure_seconds_min:1}],...edges.slice(0,-1).map((v,i)=>[`${shutter(v)}–${shutter(edges[i+1])} s`,{exposure_seconds_lt:v,exposure_seconds_min:edges[i+1]}] as [string,Record<string,number>]),['< 1/1000 s',{exposure_seconds_lt:1/1000}]];}
  const result=bins.map(([label,filter])=>{const count=data.filter(p=>p[field]!=null&&matches(p,filter)).length;return {label,filter,count,percent:data.length?Math.round(count/data.length*1000)/10:0};}).filter(b=>b.count||!['f_number','lens_model','camera_model'].includes(field));
  return ['lens_model','camera_model'].includes(field)?result.sort((a,b)=>b.count-a.count):result;
}
export function statistics(data:Photo[],mode='grouped'):Statistics {const dates=data.map(p=>p.date_taken?.slice(0,10)||null),days=counts(dates),months=counts(dates.map(d=>d?.slice(0,7))),n=(f:keyof Photo)=>common(data,f) as number|null;return {summary:{total:data.length,files:data.length,captures:data.length,cameras:counts(data.map(p=>p.camera_model)).length,lenses:counts(data.map(p=>p.lens_model)).length,shooting_days:days.length,shooting_months:months.length,common_lens:common(data,'lens_model') as string|null,common_focal:n('focal_length'),common_aperture:n('f_number'),common_iso:n('iso'),common_shutter:shutter(n('exposure_seconds')),active_day:(days[0] as [string,number])||null,active_month:(months[0] as [string,number])||null,unknown_date:dates.filter(d=>!d).length},charts:Object.fromEntries(fields.map(f=>[f,histogram(data,f,mode)]))};}
export function report(all:Photo[],year:number,month:number|null,bands:number[]):Report {
  if(!Number.isInteger(year)||year<1900||year>2200||month!==null&&(!Number.isInteger(month)||month<1||month>12))throw new Error('Invalid report period.');
  const from=`${year}-${String(month||1).padStart(2,'0')}-01`,to=new Date(Date.UTC(year,month||12,0)).toISOString().slice(0,10),data=all.filter(p=>matches(p,{date_from:from,date_to:to})),bandNames=[`< ${bands[0]}mm`,...bands.slice(1).map((v,i)=>`${bands[i]}–${v}mm`),`> ${bands.at(-1)}mm`],keys=month?Array.from({length:Number(to.slice(8))},(_,i)=>`${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`):Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
  const timeline=keys.map(period=>{const subset=data.filter(p=>p.date_taken?.startsWith(period)),focal:Record<string,number>={};for(const p of subset){if(p.focal_length==null)continue;const i=p.focal_length<bands[0]?0:bands.findIndex((v,i)=>i>0&&p.focal_length!<=v),key=bandNames[i<0?bands.length:i];focal[key]=(focal[key]||0)+1;}const total=Object.values(focal).reduce((a,b)=>a+b,0);return {period,count:subset.length,lenses:Object.fromEntries(counts(subset.map(p=>p.lens_model))),focal_bands:focal,focal_percent:Object.fromEntries(Object.entries(focal).map(([k,v])=>[k,total?Math.round(v/total*1000)/10:0]))};});
  const narratives=timeline.flatMap(row=>{const sorted=Object.entries(row.focal_bands).sort((a,b)=>b[1]-a[1]),total=sorted.reduce((n,[,v])=>n+v,0);return sorted.length?[`${row.period}：${sorted[0][0]} 使用最多，${sorted[0][1]} 次，占已知焦段 ${(sorted[0][1]/total*100).toFixed(0)}%。`]:[];});
  return {...statistics(data),year,month,filters:{date_from:from,date_to:to},lenses:histogram(data,'lens_model','exact'),timeline,narratives,focal_bands:bandNames,zoom:[[24,29],[29,36],[36,51],[51,61],[61,71]].map(([a,b])=>({label:`${a}–${b-1} mm`,count:data.filter(p=>p.focal_length!=null&&p.focal_length>=a&&p.focal_length<b).length,filter:{focal_length_min:a,focal_length_lt:b}})),cover_id:data[0]?.id||null};
}

export function lensLifecycle(data:Photo[],name:string,today=new Date()):Lifecycle{
  const date=(year:number,month:number,day:number)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const end=date(today.getFullYear(),today.getMonth()+1,today.getDate());
  const lastYear=today.getFullYear()-1,month=today.getMonth()+1,lastDay=new Date(Date.UTC(lastYear,month,0)).getUTCDate();
  const recent=date(lastYear,month,Math.min(today.getDate(),lastDay));
  const days=[...new Set(data.flatMap(p=>p.date_taken?[p.date_taken.slice(0,10)]:[]))].sort();
  const gaps=days.map((day,i)=>Math.max(0,(Date.parse((days[i+1]||end)+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000));
  return {lens:name,total:data.length,first_used:days[0]||null,last_used:days.at(-1)||null,past_12_months:data.filter(p=>p.date_taken&&p.date_taken.slice(0,10)>=recent&&p.date_taken.slice(0,10)<=end).length,busiest_month:statistics(data).summary.active_month,longest_unused_days:Math.max(0,...gaps)};
}
