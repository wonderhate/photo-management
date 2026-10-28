import {useEffect,useId,useRef,useState} from 'react';
import {api,message} from '../api';
import {bt} from '../browser/text';
import type {Photo} from '../types';
import {manualLocation,effectiveLocation,validateLocation} from '../core/photo-location';
import type {EffectiveLocation,StoredLocation,LocationChange} from '../core/photo-location';
import {locationFieldIssue} from '../core/location-guidance';
import type {LocationFields} from '../core/location-guidance';
import './location.css';

type Result={photo_id:string;source_hash:string;record:StoredLocation|null;effective:EffectiveLocation;original:{latitude:number|null;longitude:number|null}};
type Fields=LocationFields;
const empty:Fields={latitude:'',longitude:'',country:'',city:'',label:'',accuracy_m:''};
const fields=(location:EffectiveLocation):Fields=>({country:location.country,city:location.city,label:location.label,latitude:location.latitude===null?'':String(location.latitude),longitude:location.longitude===null?'':String(location.longitude),accuracy_m:location.accuracy_m===null?'':String(location.accuracy_m)});
function checked(value:Result,id:string):Result{
  if(!value||value.photo_id!==id||!(/^[a-f0-9]{64}$/).test(value.source_hash)||!value.original||!['latitude','longitude'].every(key=>value.original[key as keyof Result['original']]===null||Number.isFinite(value.original[key as keyof Result['original']]))||value.record===undefined)throw new Error(bt('地点记录无法读取，请重新打开照片','Location data could not be read. Reopen the photo.'));
  if(value.record){validateLocation(value.record);if(value.record.photo_id!==id||value.record.source_hash!==value.source_hash)throw new Error(bt('地点来源已变化，请重新打开照片','Location source changed. Reopen the photo.'));}
  return {...value,effective:effectiveLocation({file_hash:value.source_hash,gps_latitude:value.original.latitude,gps_longitude:value.original.longitude},value.record||undefined)};
}
export default function PhotoLocation({photo,notify,onSaved}:{photo:Photo;notify:(text:string)=>void;onSaved?:()=>void}){
  const [data,setData]=useState<Result|null>(null),[form,setForm]=useState<Fields>(empty),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [editing,setEditing]=useState(false),[showValidation,setShowValidation]=useState(false),helpId=useId(),errorId=useId();
  const issue=showValidation?locationFieldIssue(form):null;
  const issueText=issue?{
    latitude:bt('纬度请输入 −90 到 90 之间的数字。','Enter a latitude between −90 and 90.'),
    longitude:bt('经度请输入 −180 到 180 之间的数字。','Enter a longitude between −180 and 180.'),
    pair:bt('纬度和经度需要一起填写，或一起留空。','Enter both latitude and longitude, or leave both empty.'),
    accuracy:bt('精度请输入 0 到 20,040,000 米之间的数字，或留空。','Enter accuracy between 0 and 20,040,000 meters, or leave it empty.'),
    accuracyCoordinates:bt('填写精度前，请先填写一组经纬度。','Enter both coordinates before adding accuracy.'),
    empty:bt('请至少填写一个地点名称，或一组经纬度。','Enter a place name or both coordinates.'),
  }[issue]:'';
  const current=useRef(photo.id);current.current=photo.id;const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{const controller=new AbortController();setData(null);setForm(empty);setBusy(false);setError('');setEditing(false);setShowValidation(false);void api<Result>('/locations/photos/'+photo.id,'GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted){const result=checked(value,photo.id);setData(result);setForm(fields(result.effective));setEditing(result.effective.latitude===null);}}).catch(e=>{if(!controller.signal.aborted)setError(message(e));});return()=>controller.abort();},[photo.id]);
  async function save(operation:LocationChange['operation']){
    if(!data||busy)return;
    if(operation==='set'){setShowValidation(true);if(locationFieldIssue(form))return;}
    const id=photo.id;setBusy(true);setError('');
    try{
      const parse=(value:string)=>value.trim()===''?null:Number(value);
      const value=operation==='set'?manualLocation({...form,latitude:parse(form.latitude),longitude:parse(form.longitude),accuracy_m:parse(form.accuracy_m)}):undefined;
      const result=checked(await api<Result>('/locations/photos/'+id,'PUT',{source_hash:data.source_hash,expected_revision:data.record?.revision||0,operation,...(value?{value}:{})}),id);
      if(mounted.current&&current.current===id){setData(result);setForm(fields(result.effective));setShowValidation(false);onSaved?.();notify(operation==='set'&&result.effective.latitude===null?bt('地点名称已保存；补充经纬度后才会显示地图标记。原始 EXIF 保持不变。','Place name saved. Add coordinates to show a map marker. Original EXIF is unchanged.'):bt('地点已保存到图库，原始 EXIF 保持不变','Location saved in the library. Original EXIF is unchanged.'));}
    }catch(e){if(mounted.current&&current.current===id)setError(message(e));}finally{if(mounted.current&&current.current===id)setBusy(false);}
  }
  const source=data?.effective.source;
  return <section className="photo-location" aria-label={bt('拍摄地点','Photo location')}>
    <h4>{bt('拍摄地点','Photo location')}</h4>
    {data&&<><p>{[data.effective.country,data.effective.city,data.effective.label].filter(Boolean).join(' · ')||bt('未填写地点名称','No place name set')}</p><p className="muted">{source==='manual'?bt('来源：人工设置','Source: manual'):source==='exif'?bt('来源：原始 GPS','Source: original GPS'):bt('未记录坐标','No coordinates recorded')}{data.effective.latitude!==null&&` · ${data.effective.latitude.toFixed(5)}, ${data.effective.longitude!.toFixed(5)}`}{data.effective.accuracy_m!==null&&` · ±${data.effective.accuracy_m} m`}</p></>}
    <details open={editing} onToggle={e=>setEditing(e.currentTarget.open)}><summary>{bt('修改地点 / 撤销','Edit location / undo')}</summary>
      <p>{bt('国家、城市和地点名称用于整理照片，不会自动转换成地图坐标。要在地图上看到照片，请填写纬度和经度。','Country, city and place names organize your photos; they do not become map coordinates automatically. Enter latitude and longitude to place a photo on the map.')}</p>
      <p id={helpId} className="muted">{bt('使用十进制度数（WGS84）：北纬、东经为正，南纬、西经为负；例如纬度 30.25、经度 120.15。只填写名称时，可将两个坐标一起留空。','Use decimal degrees (WGS84): north/east are positive and south/west are negative, for example latitude 30.25, longitude 120.15. To save a name only, leave both coordinates empty.')}</p>
      <p className="muted">{bt('只修改当前文件的图库记录，不改原始 EXIF，也不会联网查询位置。清除人工覆写会恢复原始 GPS（如有）。','Only this file’s library record changes. Original EXIF is untouched and no online location lookup is performed. Clearing the manual override restores original GPS, if available.')}</p>
      <form noValidate onSubmit={e=>{e.preventDefault();if(e.currentTarget.reportValidity())void save('set');}}>
      <div className="location-fields">{(['country','city','label','latitude','longitude','accuracy_m'] as const).map(key=>{
        const labels={country:bt('国家 / 地区','Country / region'),city:bt('城市','City'),label:bt('地点名称','Place name'),latitude:bt('纬度','Latitude'),longitude:bt('经度','Longitude'),accuracy_m:bt('精度（米，可留空）','Accuracy (meters, optional)')};
        const numeric=['latitude','longitude','accuracy_m'].includes(key);
        const invalid=issue===key||issue==='pair'&&['latitude','longitude'].includes(key)||(issue==='accuracy'||issue==='accuracyCoordinates')&&key==='accuracy_m';
        return <label key={key}>{labels[key]}<input aria-label={labels[key]} aria-describedby={numeric?helpId+(issue?' '+errorId:''):undefined} aria-invalid={invalid||undefined} value={form[key]} disabled={!data||busy} type={numeric?'number':'text'} step="any" min={key==='latitude'?-90:key==='longitude'?-180:key==='accuracy_m'?0:undefined} max={key==='latitude'?90:key==='longitude'?180:key==='accuracy_m'?20040000:undefined} maxLength={key==='label'?240:120} onBlur={()=>{if(numeric)setShowValidation(true);}} onChange={e=>{setForm({...form,[key]:e.target.value});setError('');}}/></label>;
      })}</div>
      {issue&&<p id={errorId} role="alert" className="error-box">{issueText}</p>}
      <div className="button-row"><button type="submit" disabled={!data||busy}>{busy?bt('正在保存…','Saving…'):bt('保存地点','Save location')}</button><button type="button" disabled={!data?.record?.manual||busy} onClick={()=>void save('clear')}>{bt('清除人工覆写','Clear manual override')}</button><button type="button" disabled={!data?.record?.history.length||busy} onClick={()=>void save('undo')}>{bt('撤销上次地点更改','Undo last location change')}</button></div>
      </form>
      {data?.original.latitude!=null&&<p className="muted">{bt('原始 GPS：','Original GPS: ')}{data.original.latitude}, {data.original.longitude}</p>}
    </details>{error&&<p role="alert" className="error-box">{error}</p>}
  </section>;
}
