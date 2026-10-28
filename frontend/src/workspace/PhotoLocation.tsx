import {useEffect,useRef,useState} from 'react';
import {api,message} from '../api';
import {bt} from '../browser/text';
import type {Photo} from '../types';
import {manualLocation,effectiveLocation,validateLocation} from '../core/photo-location';
import type {EffectiveLocation,StoredLocation,LocationChange} from '../core/photo-location';
import './location.css';

type Result={photo_id:string;source_hash:string;record:StoredLocation|null;effective:EffectiveLocation;original:{latitude:number|null;longitude:number|null}};
type Fields={latitude:string;longitude:string;country:string;city:string;label:string;accuracy_m:string};
const empty:Fields={latitude:'',longitude:'',country:'',city:'',label:'',accuracy_m:''};
const fields=(location:EffectiveLocation):Fields=>({country:location.country,city:location.city,label:location.label,latitude:location.latitude===null?'':String(location.latitude),longitude:location.longitude===null?'':String(location.longitude),accuracy_m:location.accuracy_m===null?'':String(location.accuracy_m)});
function checked(value:Result,id:string):Result{
  if(!value||value.photo_id!==id||!(/^[a-f0-9]{64}$/).test(value.source_hash)||!value.original||!['latitude','longitude'].every(key=>value.original[key as keyof Result['original']]===null||Number.isFinite(value.original[key as keyof Result['original']]))||value.record===undefined)throw new Error(bt('地点记录无法读取，请重新打开照片','Location data could not be read. Reopen the photo.'));
  if(value.record){validateLocation(value.record);if(value.record.photo_id!==id||value.record.source_hash!==value.source_hash)throw new Error(bt('地点来源已变化，请重新打开照片','Location source changed. Reopen the photo.'));}
  return {...value,effective:effectiveLocation({file_hash:value.source_hash,gps_latitude:value.original.latitude,gps_longitude:value.original.longitude},value.record||undefined)};
}
export default function PhotoLocation({photo,notify,onSaved}:{photo:Photo;notify:(text:string)=>void;onSaved?:()=>void}){
  const [data,setData]=useState<Result|null>(null),[form,setForm]=useState<Fields>(empty),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const current=useRef(photo.id);current.current=photo.id;const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{const controller=new AbortController();setData(null);setForm(empty);setBusy(false);setError('');void api<Result>('/locations/photos/'+photo.id,'GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted){const result=checked(value,photo.id);setData(result);setForm(fields(result.effective));}}).catch(e=>{if(!controller.signal.aborted)setError(message(e));});return()=>controller.abort();},[photo.id]);
  async function save(operation:LocationChange['operation']){
    if(!data||busy)return;const id=photo.id;setBusy(true);setError('');
    try{
      const parse=(value:string)=>value.trim()===''?null:Number(value);
      const value=operation==='set'?manualLocation({...form,latitude:parse(form.latitude),longitude:parse(form.longitude),accuracy_m:parse(form.accuracy_m)}):undefined;
      const result=checked(await api<Result>('/locations/photos/'+id,'PUT',{source_hash:data.source_hash,expected_revision:data.record?.revision||0,operation,...(value?{value}:{})}),id);
      if(mounted.current&&current.current===id){setData(result);setForm(fields(result.effective));onSaved?.();notify(bt('地点已保存到图库，原始 EXIF 保持不变','Location saved in the library. Original EXIF is unchanged.'));}
    }catch(e){if(mounted.current&&current.current===id)setError(message(e));}finally{if(mounted.current&&current.current===id)setBusy(false);}
  }
  const source=data?.effective.source;
  return <section className="photo-location" aria-label={bt('拍摄地点','Photo location')}>
    <h4>{bt('拍摄地点','Photo location')}</h4>
    {data&&<><p>{[data.effective.country,data.effective.city,data.effective.label].filter(Boolean).join(' · ')||bt('未填写地点名称','No place name set')}</p><p className="muted">{source==='manual'?bt('来源：人工设置','Source: manual'):source==='exif'?bt('来源：原始 GPS','Source: original GPS'):bt('未记录坐标','No coordinates recorded')}{data.effective.latitude!==null&&` · ${data.effective.latitude.toFixed(5)}, ${data.effective.longitude!.toFixed(5)}`}{data.effective.accuracy_m!==null&&` · ±${data.effective.accuracy_m} m`}</p></>}
    <details><summary>{bt('修改地点 / 撤销','Edit location / undo')}</summary>
      <p className="muted">{bt('只修改当前文件的图库记录。国家、城市与坐标由你填写；不会上传 GPS 或自动查询在线地图。清除覆写后恢复原始 GPS。','Edits affect this file’s library record. Enter a country, city and coordinates yourself; GPS is never uploaded or looked up online. Clearing the override restores original GPS.')}</p>
      <div className="location-fields">{(['country','city','label','latitude','longitude','accuracy_m'] as const).map(key=>{
        const labels={country:bt('国家 / 地区','Country / region'),city:bt('城市','City'),label:bt('地点名称','Place name'),latitude:bt('纬度','Latitude'),longitude:bt('经度','Longitude'),accuracy_m:bt('精度（米，可留空）','Accuracy (meters, optional)')};
        const numeric=['latitude','longitude','accuracy_m'].includes(key);
        return <label key={key}>{labels[key]}<input aria-label={labels[key]} value={form[key]} disabled={!data||busy} type={numeric?'number':'text'} step="any" maxLength={key==='label'?240:120} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>;
      })}</div>
      <div className="button-row"><button disabled={!data||busy} onClick={()=>void save('set')}>{bt('保存地点','Save location')}</button><button disabled={!data?.record?.manual||busy} onClick={()=>void save('clear')}>{bt('清除人工覆写','Clear manual override')}</button><button disabled={!data?.record?.history.length||busy} onClick={()=>void save('undo')}>{bt('撤销上次地点更改','Undo last location change')}</button></div>
      {data?.original.latitude!=null&&<p className="muted">{bt('原始 GPS：','Original GPS: ')}{data.original.latitude}, {data.original.longitude}</p>}
    </details>{error&&<p role="alert" className="error-box">{error}</p>}
  </section>;
}
