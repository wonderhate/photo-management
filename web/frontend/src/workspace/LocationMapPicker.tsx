import {useEffect,useRef,useState} from 'react';
import {Crosshair,MapPin,RotateCcw} from 'lucide-react';
import {Modal} from '../components';
import {bt} from '../browser/text';
import {openMapPacks,watchMapPacks} from '../browser/offline-map-packs';
import {fitMapPack} from '../core/offline-map-pack';
import type {OpenMapPack} from '../core/offline-map-pack';
import {pickedLocationPoint} from '../core/location-point';
import type {LocationPoint} from '../core/location-point';
import type {MapCamera} from '../core/satellite-map';
import LeafletSatelliteMap from './LeafletSatelliteMap';
import './location-map-picker.css';

const world:MapCamera={latitude:20,longitude:15,zoom:0};
export default function LocationMapPicker({photoName,initialPoint,onChoose,onClose}:{photoName:string;initialPoint:LocationPoint|null;onChoose:(point:LocationPoint)=>void;onClose:()=>void}){
  const [point,setPoint]=useState(initialPoint),[packs,setPacks]=useState<OpenMapPack[]>([]),[loaded,setLoaded]=useState(false),[hasView,setHasView]=useState(false),[notice,setNotice]=useState('');
  const [command,setCommand]=useState({id:0,camera:world});
  const viewport=useRef(world),area=useRef<HTMLDivElement>(null),initialized=useRef(false);
  const choose=(latitude:number,longitude:number)=>{const next=pickedLocationPoint(latitude,longitude);if(next)setPoint(next);};
  function fly(camera:MapCamera){setCommand(previous=>({id:previous.id+1,camera}));}
  function packCamera(pack:OpenMapPack){const r=area.current?.getBoundingClientRect();return fitMapPack(pack.record.bounds,r?.width||800,r?.height||450);}
  useEffect(()=>{
    let disposed=false,generation=0;
    const load=()=>{const own=++generation;void openMapPacks().then(result=>{
      if(disposed||own!==generation)return;
      const first=!initialized.current;initialized.current=true;setPacks(result.packs);setLoaded(true);
      setNotice(result.unavailable.length?bt('部分区域包暂不可用，仍可在全球概览上选点。','Some regional packages are unavailable. You can still choose a point on the global overview.'):'');
      fly(first?(initialPoint?{...initialPoint,zoom:result.packs.some(p=>initialPoint.latitude>=p.record.bounds.south&&initialPoint.latitude<=p.record.bounds.north&&initialPoint.longitude>=p.record.bounds.west&&initialPoint.longitude<=p.record.bounds.east)?12:6}:result.packs[0]?packCamera(result.packs[0]):world):viewport.current);
    }).catch(()=>{if(!disposed&&own===generation){setLoaded(true);initialized.current=true;fly(initialPoint?{...initialPoint,zoom:6}:world);setNotice(bt('区域包无法读取，正在使用全球概览。','Regional packages could not be read. Using the global overview.'));}});};
    load();const stop=watchMapPacks(load);return()=>{disposed=true;generation++;stop();};
  },[]);
  return <Modal title={bt('在地图上选择拍摄位置','Choose photo location on map')} onClose={onClose} wide className="location-map-picker">
    <div className="location-map-content">
      <div className="location-map-intro"><strong title={photoName}>{photoName}</strong><p>{bt('点击地图放置标记，拖动标记微调。也可用方向键平移后，选择地图中心。','Click the map to place a pin, then drag it to adjust. You can also pan with arrow keys and choose the map center.')}</p></div>
      <div className="location-map-toolbar">
        <button type="button" disabled={!hasView} onClick={()=>choose(viewport.current.latitude,viewport.current.longitude)}><Crosshair size={17} aria-hidden="true"/>{bt('使用地图中心','Use map center')}</button>
        <button type="button" disabled={!point||!hasView} onClick={()=>point&&fly({...point,zoom:Math.max(6,viewport.current.zoom)})}><MapPin size={17} aria-hidden="true"/>{bt('回到标记','Return to pin')}</button>
        <button type="button" disabled={!hasView} onClick={()=>fly(world)}><RotateCcw size={16} aria-hidden="true"/>{bt('全球概览','Global overview')}</button>
        {!!packs.length&&<label>{bt('离线地区','Offline region')}<select aria-label={bt('跳转到离线地区','Jump to offline region')} value="" onChange={e=>{const pack=packs.find(p=>p.record.id===e.target.value);if(pack)fly(packCamera(pack));}}><option value="">{bt('选择地区…','Choose a region…')}</option>{packs.map(p=><option key={p.record.id} value={p.record.id}>{p.record.name}</option>)}</select></label>}
      </div>
      <div ref={area} className="location-map-area">
        {loaded?<LeafletSatelliteMap source={{provider:packs.length?'local':'nasa',key:packs.map(p=>p.record.id).join(',')}} packs={packs} clusters={[]} photos={{}} selected="" command={command} pointPicker={{point,onChange:setPoint}} onBounds={(_bounds,camera)=>{viewport.current=camera;setHasView(true);}} onSelect={()=>{}} onDismiss={()=>{}} onError={()=>{}} loadNearby={async()=>[]} onOpenPhoto={()=>{}} onPackIssue={()=>setNotice(bt('部分高清瓦片读取失败，未显示的部分使用全球概览。','Some detail tiles could not be read. Unavailable areas use the global overview.'))}/>:<p className="location-map-loading" role="status">{bt('正在打开本机地图…','Opening local map…')}</p>}
        {hasView&&<span className="location-map-crosshair" aria-hidden="true"/>}
      </div>
      {notice&&<p className="muted" role="status">{notice}</p>}
      <div className="location-map-selection" aria-live="polite"><MapPin size={18} aria-hidden="true"/>{point?<span>{bt('所选位置','Selected point')} · {bt('纬度','Latitude')} <b>{point.latitude.toFixed(6)}</b> · {bt('经度','Longitude')} <b>{point.longitude.toFixed(6)}</b></span>:<span>{bt('尚未标点，请在地图上点击拍摄位置。','No point selected. Click the photo location on the map.')}</span>}</div>
      <p className="location-map-help muted">{bt('使用后将填入经纬度，再点击“保存地点”保存。国家、城市和地点名称保留原有填写；原始照片和 EXIF 不变。地图使用全球概览及已安装的离线地区，不联网查询地址。','This fills the coordinates; then choose “Save location” to save. Country, city and place names are kept. Original photos and EXIF stay unchanged. The map uses the global overview and installed offline regions, without online address lookup.')}</p>
    </div>
    <footer className="location-map-footer"><button type="button" onClick={onClose}>{bt('取消','Cancel')}</button><button type="button" className="primary" disabled={!point} onClick={()=>point&&onChoose(point)}>{bt('使用此位置','Use this location')}</button></footer>
  </Modal>;
}
