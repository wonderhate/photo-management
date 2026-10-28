import {useEffect,useRef,useState} from 'react';
import {bt} from '../browser/text';
import {getLang} from '../i18n';
import type {GeoBounds} from '../core/photo-location';
import type {MapCluster} from '../core/photo-map';
import {validMapBounds,validMapPositions} from '../core/satellite-map';
import type {MapCamera,MapPosition} from '../core/satellite-map';
import type {Photo} from '../types';
import MediaImage from '../media/MediaImage';

export default function GoogleSatelliteMap({apiKey,clusters,photos,selected,command,onBounds,onSelect,onDismiss,onError,loadNearby,onOpenPhoto}:{apiKey:string;clusters:MapCluster[];photos:Record<string,Photo>;selected:string;command:{id:number;camera:MapCamera};onBounds:(bounds:GeoBounds,camera:MapCamera)=>void;onSelect:(p:MapCluster)=>void;onDismiss:()=>void;onError:(message:string)=>void;loadNearby:(point:MapCluster,signal:AbortSignal)=>Promise<Photo[]>;onOpenPhoto:(id:string)=>void}){
  const iframe=useRef<HTMLIFrameElement>(null),latest=useRef({clusters,onBounds,onSelect,onDismiss,onError});latest.current={clusters,onBounds,onSelect,onDismiss,onError};
  const [channel]=useState(()=>crypto.randomUUID()),[loaded,setLoaded]=useState(false),[positions,setPositions]=useState<MapPosition[]>([]),[labels,setLabels]=useState(false);
  const [fan,setFan]=useState<{id:string;photos:Photo[]}|null>(null),peek=useRef<AbortController|null>(null);
  function dismissFan(){peek.current?.abort();setFan(null);}
  function preview(p:MapCluster){peek.current?.abort();const controller=new AbortController();peek.current=controller;setFan({id:p.photo_id,photos:photos[p.photo_id]?[photos[p.photo_id]]:[]});if(p.count>1)void loadNearby(p,controller.signal).then(items=>{if(!controller.signal.aborted)setFan({id:p.photo_id,photos:items.slice(0,6)});}).catch(()=>{});}
  useEffect(()=>()=>peek.current?.abort(),[]);
  const send=(type:string,payload:Record<string,unknown>={})=>iframe.current?.contentWindow?.postMessage({channel,type,...payload},'*');
  useEffect(()=>{const frame=iframe.current;if(!frame)return;if(!('credentialless' in frame)){onError(bt('此浏览器尚不支持隔离卫星地图，请更新 Edge / Chrome 或 Windows WebView2，或使用离线地图。','This browser cannot isolate satellite maps. Update Edge / Chrome or Windows WebView2, or use the offline map.'));return;}(frame as HTMLIFrameElement&{credentialless:boolean}).credentialless=true;frame.setAttribute('credentialless','');const q=matchMedia('(prefers-reduced-motion: reduce)'),motion=()=>send('motion',{reduced:q.matches});
    const receive=(event:MessageEvent)=>{const data=event.data;if(event.source!==frame.contentWindow||event.origin!=='null'||!data||data.channel!==channel)return;
      if(data.type==='ready')send('initialize',{key:apiKey,language:getLang(),reduced:q.matches});
      if(data.type==='loaded'){setLoaded(true);send('points',{points:latest.current.clusters.map(p=>({id:p.photo_id,latitude:p.latitude,longitude:p.longitude}))});}
      if(data.type==='viewport'&&validMapBounds(data.bounds)&&data.camera&&[data.camera.latitude,data.camera.longitude,data.camera.zoom].every(Number.isFinite))latest.current.onBounds(data.bounds,data.camera);
      if(data.type==='positions'&&validMapPositions(data.positions))setPositions(data.positions);
      if(data.type==='dismiss')latest.current.onDismiss();
      if(data.type==='error')latest.current.onError(data.reason==='authorization'?bt('Google 地图授权失败，请核对 Key、API 启用状态和网站来源限制。','Google Maps authorization failed. Check the key, API activation and website restrictions.'):bt('Google 卫星地图暂时无法连接。可重试，或切换离线地图继续浏览。','Google satellite maps could not connect. Retry or continue with the offline map.'));
    };window.addEventListener('message',receive);frame.src=`/maps/satellite.html#${channel}`;q.addEventListener('change',motion);const observer=new ResizeObserver(()=>send('resize'));observer.observe(frame);return()=>{window.removeEventListener('message',receive);q.removeEventListener('change',motion);observer.disconnect();};
  },[apiKey,channel]);
  useEffect(()=>{if(loaded)send('points',{points:clusters.map(p=>({id:p.photo_id,latitude:p.latitude,longitude:p.longitude}))});},[clusters,loaded]);
  useEffect(()=>{if(loaded&&command.id)send('camera',{camera:command.camera});},[command,loaded]);
  const byId=new Map(clusters.map(p=>[p.photo_id,p])),fanPoint=fan&&byId.get(fan.id),fanPosition=fan&&positions.find(p=>p.id===fan.id);
  return <div className="satellite-map" onPointerLeave={dismissFan} onKeyDown={e=>{if(e.key==='Escape')dismissFan();}}>
    <iframe ref={iframe} title={bt('Google 卫星地图','Google satellite map')} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="strict-origin-when-cross-origin" onLoad={()=>send('hello')}/>
    {!loaded&&<p className="map-loading" role="status">{bt('正在连接 Google 卫星地图…','Connecting to Google satellite maps…')}</p>}
    <div className="satellite-photo-pins">{positions.map(pos=>{const p=byId.get(pos.id),photo=photos[pos.id];return p&&<button key={pos.id} className={`satellite-photo-pin${selected===pos.id?' selected':''}`} style={{left:pos.x,top:pos.y}} onPointerEnter={()=>preview(p)} onFocus={()=>preview(p)} onClick={()=>{dismissFan();onSelect(p);}} aria-pressed={selected===pos.id} aria-label={bt(`${p.count} 张，查看地点照片`,`${p.count} photos, preview location`)}>{photo?.thumbnail_url?<MediaImage src={photo.thumbnail_url} alt="" mediaPriority={2}/>:<span className="map-pin-placeholder"/>}<b>{p.count}</b></button>;})}
    {fan&&fanPoint&&fanPosition&&<div className="map-photo-fan" style={{left:fanPosition.x,top:fanPosition.y-25}} aria-label={bt('地点照片速览','Location photo previews')}><svg viewBox="-100 -100 200 200" aria-hidden="true">{fan.photos.map((p,i)=>{const a=(i/Math.max(3,fan.photos.length)*360-90)*Math.PI/180;return <path key={p.id} d={`M0 0L${Math.cos(a)*72} ${Math.sin(a)*72}`}/>;})}</svg>{fan.photos.map((p,i)=>{const a=(i/Math.max(3,fan.photos.length)*360-90)*Math.PI/180;return <button key={p.id} style={{left:Math.cos(a)*82,top:Math.sin(a)*82}} onClick={()=>onOpenPhoto(p.id)} aria-label={bt('打开照片：','Open photo: ')+p.file_name}><MediaImage src={p.thumbnail_url} alt=""/></button>;})}{fanPoint.count>fan.photos.length&&<span>+{fanPoint.count-fan.photos.length}</span>}</div>}
    </div>
    <button className="satellite-labels" disabled={!loaded} aria-pressed={labels} onClick={()=>{setLabels(v=>!v);send('layer',{labels:!labels});}}>{labels?bt('隐藏地名','Hide labels'):bt('显示地名','Show labels')}</button>
  </div>;
}
