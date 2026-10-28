/* Google SDK is confined to an opaque, credentialless frame. Photo pixels and
   library handles stay in the parent; only map coordinates cross this bridge. */
(()=>{'use strict';
  const channel=location.hash.slice(1),origin=new URL(location.href).origin;
  if(!/^[a-f0-9-]{36}$/.test(channel)||parent===window)return;
  const send=(type,payload={})=>parent.postMessage({channel,type,...payload},origin);
  let map,overlay,points=[],raf=0,animation=0,initialized=false,reduced=false,deadline;
  const finite=(n)=>typeof n==='number'&&Number.isFinite(n);
  const cancel=()=>{cancelAnimationFrame(animation);animation=0;};
  function positions(){
    if(raf)return;raf=requestAnimationFrame(()=>{raf=0;if(!overlay?.getProjection())return;
      const projection=overlay.getProjection();send('positions',{positions:points.map(p=>{const v=projection.fromLatLngToContainerPixel(new google.maps.LatLng(p.latitude,p.longitude));return {id:p.id,x:v.x,y:v.y};})});
    });
  }
  function viewport(){const b=map.getBounds(),c=map.getCenter();if(!b||!c)return;const j=b.toJSON();send('viewport',{bounds:{west:j.west,east:j.east,south:j.south,north:j.north},camera:{latitude:c.lat(),longitude:c.lng(),zoom:map.getZoom()}});positions();}
  function fly(target){
    if(!map||!target||![target.latitude,target.longitude,target.zoom].every(finite))return;
    cancel();const start=map.getCenter(),z=map.getZoom(),lat=Math.max(-85,Math.min(85,target.latitude)),lng=((target.longitude+180)%360+360)%360-180,zoom=Math.max(2,Math.min(20,target.zoom));
    if(reduced){map.moveCamera({center:{lat,lng},zoom});return;}
    const began=performance.now(),delta=((lng-start.lng()+540)%360)-180;
    const tick=(time)=>{const t=Math.min(1,(time-began)/780),k=1-Math.pow(1-t,3);map.moveCamera({center:{lat:start.lat()+(lat-start.lat())*k,lng:start.lng()+delta*k},zoom:z+(zoom-z)*k});if(t<1)animation=requestAnimationFrame(tick);else animation=0;};animation=requestAnimationFrame(tick);
  }
  function fail(reason){clearTimeout(deadline);send('error',{reason});}
  function initialize(data){
    if(initialized||typeof data.key!=='string'||!(/^[A-Za-z0-9_-]{20,200}$/).test(data.key))return;
    initialized=true;reduced=!!data.reduced;window.gm_authFailure=()=>fail('authorization');
    window.__luminaMapReady=async()=>{try{
      const {Map}=await google.maps.importLibrary('maps');
      map=new Map(document.getElementById('map'),{center:{lat:20,lng:15},zoom:2,mapTypeId:'satellite',disableDefaultUI:true,keyboardShortcuts:true,gestureHandling:'greedy',clickableIcons:false,streetViewControl:false,fullscreenControl:false,rotateControl:false,tilt:0,isFractionalZoomEnabled:true,backgroundColor:'#15212a'});
      overlay=new google.maps.OverlayView();overlay.onAdd=()=>{};overlay.draw=positions;overlay.onRemove=()=>{};overlay.setMap(map);
      map.addListener('idle',viewport);map.addListener('dragstart',cancel);map.addListener('bounds_changed',positions);
      document.getElementById('map').addEventListener('wheel',cancel,{passive:true});document.getElementById('map').addEventListener('pointerdown',cancel,{passive:true});document.getElementById('map').addEventListener('keydown',cancel);
      map.addListener('click',()=>send('dismiss'));clearTimeout(deadline);send('loaded');viewport();
    }catch{fail('unavailable');}};
    const script=document.createElement('script');const url=new URL('https://maps.googleapis.com/maps/api/js');
    url.search=new URLSearchParams({key:data.key,loading:'async',callback:'__luminaMapReady',v:'quarterly',language:data.language==='zh'?'zh-CN':'en',auth_referrer_policy:'origin'}).toString();script.src=url.href;script.async=true;script.onerror=()=>fail('network');document.head.append(script);deadline=setTimeout(()=>fail('timeout'),20000);
  }
  addEventListener('message',({source,origin:sender,data})=>{
    if(source!==parent||sender!==origin||!data||data.channel!==channel)return;
    if(data.type==='hello')send('ready');
    if(data.type==='initialize')initialize(data);
    if(data.type==='points'&&Array.isArray(data.points)&&data.points.length<=300){points=data.points.filter(p=>p&&typeof p.id==='string'&&p.id.length<=200&&finite(p.latitude)&&Math.abs(p.latitude)<=90&&finite(p.longitude)&&Math.abs(p.longitude)<=180);positions();}
    if(data.type==='camera')fly(data.camera);
    if(data.type==='motion'){reduced=!!data.reduced;if(reduced)cancel();}
    if(data.type==='layer'&&map)map.setMapTypeId(data.labels?'hybrid':'satellite');
    if(data.type==='resize'&&map){google.maps.event.trigger(map,'resize');positions();}
  });
  send('ready');
})();
