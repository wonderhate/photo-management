import {useEffect,useRef,useState} from 'react';
import type {Map as LeafletMap,TileLayer} from 'leaflet';
import {bt} from '../browser/text';
import type {GeoBounds} from '../core/photo-location';
import type {MapCluster} from '../core/photo-map';
import type {MapCamera,MapPosition} from '../core/satellite-map';
import {MapViewportEpoch,nasaMinimumZoom,nasaViewportCamera,nearestWorldLongitude,satelliteBounds,satelliteCamera,satelliteTiles,SatelliteSourceError} from '../core/leaflet-satellite';
import type {SatelliteSource,SatelliteTiles} from '../core/leaflet-satellite';
import type {Photo} from '../types';
import MediaImage from '../media/MediaImage';
import MapPhotoFan from './MapPhotoFan';
import './leaflet-map.css';

export type LeafletSatelliteMapProps={
  source:SatelliteSource;retry?:number;requestKey?:string;clusters:MapCluster[];photos:Record<string,Photo>;selected:string;
  command:{id:number;camera:MapCamera};onBounds:(bounds:GeoBounds,camera:MapCamera)=>void;
  onSelect:(point:MapCluster)=>void;onDismiss:()=>void;onError:(message:string)=>void;
  loadNearby:(point:MapCluster,signal:AbortSignal)=>Promise<Photo[]>;onOpenPhoto:(id:string)=>void;
  onConfigure?:()=>void;onFallback?:()=>void;
};

export default function LeafletSatelliteMap(props:LeafletSatelliteMapProps){
  const {source,retry=0,clusters,photos,selected,command,onConfigure,onFallback}=props;
  const latest=useRef(props);latest.current=props;
  const host=useRef<HTMLDivElement>(null),snapshot=useRef<HTMLDivElement>(null);
  const controls=useRef<{navigate:(camera:MapCamera)=>void;project:()=>void}|null>(null);
  const restartCamera=useRef<{provider:SatelliteSource['provider'];key:string;camera:MapCamera}|null>(null);
  const resolvedTiles=useRef<{provider:SatelliteSource['provider'];key:string;retry:number;attempt:number;value:SatelliteTiles}|null>(null);
  const [attempt,setAttempt]=useState(0),[status,setStatus]=useState<'loading'|'ready'|'error'|'configure'>('loading');
  const [motionRevision,setMotionRevision]=useState(0);
  const [transition,setTransition]=useState<'holding'|'fading'|'none'>('none'),[message,setMessage]=useState('');
  const [positions,setPositions]=useState<MapPosition[]>([]),[fan,setFan]=useState<string|null>(null),[view,setView]=useState(command.camera),[minimumZoom,setMinimumZoom]=useState(0);
  const zoom=view.zoom;

  useEffect(()=>{
    const element=host.current;if(!element)return;
    const controller=new AbortController(),epochs=new MapViewportEpoch(),motion=matchMedia('(prefers-reduced-motion: reduce)');
    let disposed=false,map:LeafletMap|undefined,layer:TileLayer|undefined,moving=false,waiting=false,suppressReport=false,epoch=0,navigationTarget:MapCamera|undefined;
    let deadline:ReturnType<typeof setTimeout>|undefined,poll:ReturnType<typeof setInterval>|undefined,fade:ReturnType<typeof setTimeout>|undefined,frame=0;
    let observer:ResizeObserver|undefined;
    setStatus('loading');setMessage('');setPositions([]);setFan(null);latest.current.onError('');
    const active=()=>!disposed&&!controller.signal.aborted;
    const clearWait=()=>{clearTimeout(deadline);clearInterval(poll);deadline=undefined;poll=undefined;};
    function removeSnapshot(){clearTimeout(fade);snapshot.current?.replaceChildren();setTransition('none');}
    function fadeSnapshot(){
      if(!snapshot.current?.childElementCount)return;
      clearTimeout(fade);setTransition(motion.matches?'none':'fading');
      if(motion.matches)removeSnapshot();else fade=setTimeout(()=>{if(!disposed)removeSnapshot();},280);
    }
    function freeze(){
      if(!map||!snapshot.current)return;
      const rect=element!.getBoundingClientRect(),tiles=[...element!.querySelectorAll<HTMLImageElement>('.leaflet-tile')].filter(img=>img.complete&&img.naturalWidth>0);
      if(!rect.width||!rect.height||!tiles.length)return;
      const canvas=document.createElement('canvas'),scale=Math.min(devicePixelRatio||1,2);
      canvas.width=Math.ceil(rect.width*scale);canvas.height=Math.ceil(rect.height*scale);
      const context=canvas.getContext('2d');if(!context)return;
      context.scale(scale,scale);context.fillStyle='#091b2c';context.fillRect(0,0,rect.width,rect.height);
      // Transient presentation only: no canvas export, storage, or local photos.
      for(const img of tiles){const r=img.getBoundingClientRect();if(r.right>rect.left&&r.left<rect.right&&r.bottom>rect.top&&r.top<rect.bottom)context.drawImage(img,r.left-rect.left,r.top-rect.top,r.width,r.height);}
      clearTimeout(fade);snapshot.current.replaceChildren(canvas);setTransition('holding');
    }
    function failure(){
      if(disposed)return;clearWait();waiting=false;epochs.cancel();fadeSnapshot();
      const text=source.provider==='nasa'?bt('离线底图未能完整加载，请重试。','The offline map did not finish loading. Please retry.'):bt('卫星影像暂时无法加载，请核对服务密钥或网络连接。可重试，或返回离线概览。','Satellite imagery could not load. Check the service key or connection, retry, or return to the offline overview.');
      setMessage(text);setStatus('error');latest.current.onError(text);
    }
    function project(){
      if(!map||disposed)return;const center=map.getCenter().lng,size=map.getSize();
      setPositions(latest.current.clusters.map(p=>{const point=map!.latLngToContainerPoint([p.latitude,nearestWorldLongitude(p.longitude,center)]);return {id:p.photo_id,x:point.x,y:point.y};}).filter(p=>p.x>=-60&&p.y>=-60&&p.x<=size.x+60&&p.y<=size.y+60));
    }
    function queueProject(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;project();check(epoch);});}
    function report(){
      if(!map||disposed||moving||suppressReport)return;const bounds=map.getBounds(),center=map.getCenter(),camera=satelliteCamera({latitude:center.lat,longitude:center.lng,zoom:map.getZoom()},source.provider);
      setView(camera);setMinimumZoom(map.getMinZoom());latest.current.onBounds(satelliteBounds(bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()),camera);
    }
    function check(own:number){
      if(!active()||!waiting||!epochs.current(own)||moving||!map||!layer||layer.isLoading())return;
      const rect=element!.getBoundingClientRect();
      const visible=[...element!.querySelectorAll<HTMLImageElement>('.leaflet-tile')].filter(img=>{const r=img.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>rect.left+1&&r.left<rect.right-1&&r.bottom>rect.top+1&&r.top<rect.bottom-1;});
      if(!visible.length||visible.some(img=>!img.complete||img.naturalWidth===0))return;
      clearWait();waiting=false;setStatus('ready');setMessage('');latest.current.onError('');fadeSnapshot();project();
    }
    function begin(){
      if(!active())return;clearWait();waiting=true;epoch=epochs.next();const own=epoch;
      setStatus('loading');setFan(null);deadline=setTimeout(()=>{if(active()&&epochs.current(own))failure();},10000);
      poll=setInterval(()=>check(own),250);
    }
    function moveStart(){moving=true;if(!waiting)begin();setFan(null);}
    function moveEnd(){moving=false;navigationTarget=undefined;report();queueProject();check(epoch);}
    function navigate(value:MapCamera){
      if(!map)return;suppressReport=true;map.stop();suppressReport=false;moving=false;freeze();begin();
      let camera=satelliteCamera(value,source.provider);
      if(source.provider==='nasa')camera=nasaViewportCamera(camera,element!.clientWidth,element!.clientHeight);
      camera.zoom=Math.max(map.getMinZoom(),camera.zoom);
      const center=map.getCenter(),longitude=nearestWorldLongitude(camera.longitude,center.lng),same=map.getZoom()===camera.zoom&&Math.abs(center.lat-camera.latitude)<1e-9&&Math.abs(center.lng-longitude)<1e-9;
      navigationTarget={...camera,longitude};
      if(same||motion.matches)map.setView([camera.latitude,longitude],camera.zoom,{animate:false});
      else map.flyTo([camera.latitude,longitude],camera.zoom,{animate:true,duration:.6,easeLinearity:.25});
      // Never report the old/intermediate camera: the parent uses settled zoom
      // to switch automatically between the overview and online detail source.
      if(same){moving=false;navigationTarget=undefined;report();}queueProject();
    }
    const motionChanged=()=>{
      if(map){
        const center=map.getCenter(),target=navigationTarget||{latitude:center.lat,longitude:center.lng,zoom:map.getZoom()};
        suppressReport=true;map.options.inertia=false;map.stop();map.setView([target.latitude,target.longitude],target.zoom,{animate:false});suppressReport=false;
        restartCamera.current={provider:source.provider,key:source.key,camera:target};
      }
      // Leaflet caches animation flags when constructed. Recreate with the
      // current preference instead of changing CSS while retaining inertia.
      setMotionRevision(value=>value+1);
    };
    motion.addEventListener('change',motionChanged);
    deadline=setTimeout(()=>{if(active()){failure();controller.abort();}},10000);
    void (async()=>{
      try{
        const cached=resolvedTiles.current;
        const spec=cached&&cached.provider===source.provider&&cached.key===source.key&&cached.retry===retry&&cached.attempt===attempt?cached.value:await satelliteTiles(source,controller.signal);
        if(!active())return;resolvedTiles.current={provider:source.provider,key:source.key,retry,attempt,value:spec};
        const [L]=await Promise.all([import('leaflet'),import('leaflet/dist/leaflet.css')]);
        if(!active())return;clearWait();
        const minimum=spec.geographic?nasaMinimumZoom(element.clientWidth,element.clientHeight):spec.minZoom;
        // Both projections retain fractional zoom. Rounding the online target
        // would cross the parent's automatic detail threshold on source switch.
        map=L.map(element,{crs:spec.geographic?L.CRS.EPSG4326:L.CRS.EPSG3857,minZoom:minimum,maxZoom:spec.maxZoom,zoomSnap:0,maxBounds:spec.geographic?[[-90,-540],[90,540]]:undefined,maxBoundsViscosity:1,zoomControl:true,attributionControl:true,keyboard:true,worldCopyJump:true,zoomAnimation:!motion.matches,fadeAnimation:!motion.matches,inertia:!motion.matches});
        element.setAttribute('role','region');element.setAttribute('aria-label',bt('照片卫星地图：方向键平移，加减缩放','Photo satellite map: arrow keys to pan, plus and minus to zoom'));
        const restart=restartCamera.current;restartCamera.current=null;
        let camera=satelliteCamera(restart&&restart.provider===source.provider&&restart.key===source.key?restart.camera:latest.current.command.camera,source.provider);
        if(spec.geographic)camera=nasaViewportCamera(camera,element.clientWidth,element.clientHeight);
        map.setView([camera.latitude,camera.longitude],Math.max(minimum,camera.zoom),{animate:false});
        layer=L.tileLayer(spec.url,{tileSize:256,minZoom:spec.minZoom,maxZoom:spec.maxZoom,maxNativeZoom:spec.maxNativeZoom,keepBuffer:2,updateWhenIdle:true,updateWhenZooming:false,crossOrigin:'anonymous',referrerPolicy:'strict-origin-when-cross-origin',attribution:spec.attribution,bounds:spec.geographic?[[-90,-180],[90,180]]:undefined});
        layer.on('loading',()=>{if(!waiting)begin();});layer.on('load tileload tileerror',queueProject);
        map.on('movestart zoomstart',moveStart);map.on('move zoom',queueProject);map.on('moveend',moveEnd);map.on('click',()=>{setFan(null);latest.current.onDismiss();});
        begin();layer.addTo(map);
        controls.current={navigate,project:queueProject};
        const plus=element.querySelector('.leaflet-control-zoom-in'),minus=element.querySelector('.leaflet-control-zoom-out');
        plus?.setAttribute('aria-label',bt('放大地图','Zoom in'));minus?.setAttribute('aria-label',bt('缩小地图','Zoom out'));
        observer=new ResizeObserver(()=>{
          if(!map||!active())return;
          suppressReport=true;map.invalidateSize({animate:false,pan:false});
          if(spec.geographic){
            const center=map.getCenter(),current={latitude:center.lat,longitude:center.lng,zoom:map.getZoom()},next=nasaViewportCamera(current,element.clientWidth,element.clientHeight),minimum=nasaMinimumZoom(element.clientWidth,element.clientHeight);
            const adjust=Math.abs(current.zoom-next.zoom)>1e-9||Math.abs(current.latitude-next.latitude)>1e-9;
            if(adjust)map.stop();
            if(Math.abs(map.getMinZoom()-minimum)>1e-9)map.setMinZoom(minimum);
            if(adjust)map.setView([next.latitude,next.longitude],next.zoom,{animate:false});
          }
          suppressReport=false;report();queueProject();
        });observer.observe(element);
        report();queueProject();
      }catch(error){
        if(!active())return;
        clearWait();if(error instanceof SatelliteSourceError&&error.code==='key'){removeSnapshot();setStatus('configure');setMessage(bt('配置自己的地图服务密钥后即可查看在线高清影像。','Configure your own map service key to view online high resolution imagery.'));}
        else failure();
      }
    })();
    return()=>{freeze();disposed=true;controller.abort();epochs.cancel();clearWait();clearTimeout(fade);cancelAnimationFrame(frame);observer?.disconnect();motion.removeEventListener('change',motionChanged);controls.current=null;layer?.off();map?.off();map?.remove();};
  },[source.provider,source.key,retry,attempt,motionRevision]);

  useEffect(()=>{controls.current?.project();},[clusters]);
  useEffect(()=>{controls.current?.navigate(command.camera);},[command.id]);
  const byId=new Map(clusters.map(p=>[p.photo_id,p])),fanPoint=fan?byId.get(fan):undefined,fanPosition=fan?positions.find(p=>p.id===fan):undefined;
  return <div className="satellite-map leaflet-satellite-map" data-provider={source.provider} data-source={source.provider} data-status={status} data-state={status} data-transition={transition} data-zoom={zoom} data-min-zoom={minimumZoom} data-latitude={view.latitude} data-longitude={view.longitude} onPointerLeave={()=>setFan(null)} onKeyDown={event=>{if(event.key==='Escape'){setFan(null);latest.current.onDismiss();}}}>
    <div ref={host} className="leaflet-map-host"/>
    <div ref={snapshot} className="leaflet-map-snapshot" aria-hidden="true"/>
    <div className="satellite-photo-pins" aria-hidden={transition==='holding'} style={transition==='holding'?{visibility:'hidden'}:undefined}>
      {positions.map(pos=>{const point=byId.get(pos.id),photo=photos[pos.id];return point&&<button key={pos.id} className={`satellite-photo-pin${selected===pos.id?' selected':''}`} style={{left:pos.x,top:pos.y}} onPointerEnter={()=>setFan(pos.id)} onFocus={()=>setFan(pos.id)} onClick={()=>{setFan(null);latest.current.onSelect(point);}} aria-pressed={selected===pos.id} aria-label={bt(`${point.count} 张，查看地点照片`,`${point.count} photos, preview location`)}>{photo?.thumbnail_url?<MediaImage src={photo.thumbnail_url} alt="" mediaPriority={2}/>:<span className="map-pin-placeholder"/>}<b>{point.count}</b></button>;})}
      {fanPoint&&fanPosition&&<MapPhotoFan point={fanPoint} requestKey={`${props.requestKey||''}:${source.provider}:${command.id}:${fanPoint.photo_id}`} initial={photos[fanPoint.photo_id]} load={props.loadNearby} onOpen={props.onOpenPhoto} style={{left:fanPosition.x,top:fanPosition.y-25}}/>}
    </div>
    {status==='loading'&&<p className="leaflet-map-progress" role="status">{bt('正在加载当前视野…','Loading the current view…')}</p>}
    {(status==='error'||status==='configure')&&<div className="leaflet-map-notice" data-liquid-glass role="status"><p>{message}</p><div className="button-row">{status==='error'&&<button className="leaflet-map-retry" onClick={()=>setAttempt(n=>n+1)}>{bt('重试加载','Retry loading')}</button>}{source.provider!=='nasa'&&onConfigure&&<button className="leaflet-map-configure" onClick={onConfigure}>{bt('配置地图服务','Configure map service')}</button>}{source.provider!=='nasa'&&onFallback&&<button className="leaflet-map-fallback" onClick={onFallback}>{bt('返回离线概览','Return to offline overview')}</button>}</div></div>}
    {source.provider==='nasa'&&<span className="leaflet-map-resolution">{zoom>4?bt('已达到原生清晰度 · 离线全球概览','Native detail limit · Offline global overview'):bt('NASA 离线全球概览','NASA offline global overview')}</span>}
  </div>;
}
