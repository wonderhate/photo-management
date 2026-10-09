import {useEffect,useState} from 'react';
import {MapContainer,TileLayer,Marker,Popup,useMap} from 'react-leaflet';
import L from 'leaflet';
import {MapPin} from 'lucide-react';
import {api,message} from './api';
import {Empty} from './components';
import type {MapPhoto} from './types';
import 'leaflet/dist/leaflet.css';

const photoIcon=L.divIcon({className:'map-marker-icon',html:'<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#c6ae86" stroke="#1a1f20" stroke-width="2.5"/></svg>',iconSize:[24,24],iconAnchor:[12,12],popupAnchor:[0,-14]});

function FitBounds({photos}:{photos:MapPhoto[]}){
  const map=useMap();
  useEffect(()=>{if(photos.length){const bounds=L.latLngBounds(photos.map(p=>[p.latitude,p.longitude]as [number,number]));map.fitBounds(bounds,{padding:[50,50]})}},[photos,map]);
  return null;
}

export default function MapPage({notify,onOpenPhoto}:{notify:(msg:string)=>void;onOpenPhoto?:(id:string)=>void}){
  const [photos,setPhotos]=useState<MapPhoto[]>([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    api<MapPhoto[]>('/map/photos').then(setPhotos).catch(e=>notify(message(e))).finally(()=>setLoading(false));
  },[]);

  if(loading)return <p className="loading">正在加载地图数据…</p>;

  return <div className="map-page">
    <div className="section-intro">
      <div><span className="eyebrow">WHERE THE LIGHT FELL</span><h2>地图视图</h2><p>{photos.length?`${photos.length} 张照片包含地理位置`:'照片库中没有包含 GPS 信息的照片'}</p></div>
    </div>
    {!photos.length?<Empty title="暂无地理位置数据"><MapPin size={28} style={{marginBottom:8}}/>拍摄时开启相机或手机的 GPS 记录功能，<br/>导入后照片将自动显示在地图上。</Empty>:
    <div className="map-container"><MapContainer center={[35.86,104.19]} zoom={4} style={{height:'100%',width:'100%'}}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
      <FitBounds photos={photos}/>
      {photos.map(photo=><Marker key={photo.id} position={[photo.latitude,photo.longitude]} icon={photoIcon}>
        <Popup><div style={{textAlign:'center'}}>
          <img src={photo.thumbnail} alt={photo.file_name} style={{width:140,height:140,objectFit:'cover',cursor:'pointer'}} onClick={()=>onOpenPhoto?.(photo.id)}/>
          <div style={{fontSize:12,fontWeight:500,color:'#d4dbc4'}}>{photo.file_name}</div>
          {photo.date_taken&&<div style={{fontSize:10,color:'#8e9c8e'}}>{photo.date_taken.slice(0,10)}</div>}
          {photo.altitude!==null&&<div style={{fontSize:10,color:'#8e9c8e'}}>海拔 {photo.altitude.toFixed(0)}m</div>}
        </div></Popup>
      </Marker>)}
    </MapContainer></div>}
  </div>;
}
