import type * as Leaflet from 'leaflet';
import {geographicTileBounds,mercatorY,packOverlaps} from '../core/offline-map-pack';
import type {OpenMapPack} from '../core/offline-map-pack';

/** Compose local Mercator archives onto the existing geographic NASA grid.
 * The camera/markers never change projection at a package edge. */
export function offlineMapLayer(L:typeof Leaflet,packs:OpenMapPack[],onIssue:(name:string)=>void){
  const cache=new Map<string,Promise<HTMLImageElement|undefined>>(),failed=new Set<string>();let disposed=false;
  function cached(key:string,load:()=>Promise<HTMLImageElement|undefined>){
    const hit=cache.get(key);if(hit){cache.delete(key);cache.set(key,hit);return hit;}
    const pending=load().catch(error=>{cache.delete(key);throw error;});cache.set(key,pending);
    while(cache.size>80)cache.delete(cache.keys().next().value!);return pending;
  }
  function image(url:string){return new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>{if(img.naturalWidth>2048||img.naturalHeight>2048)reject(new Error('tile size'));else resolve(img);};img.onerror=()=>reject(new Error('tile'));img.src=url;});}
  async function tile(pack:OpenMapPack,z:number,x:number,y:number){
    return cached(`${pack.record.id}/${z}/${x}/${y}`,async()=>{
      const value=await pack.archive.getZxy(z,x,y);if(!value)return;
      const url=URL.createObjectURL(new Blob([value.data]));try{return await image(url);}finally{URL.revokeObjectURL(url);}
    });
  }
  async function paint(canvas:HTMLCanvasElement,coords:Leaflet.Coords){
    const {z,x,y}=coords,ctx=canvas.getContext('2d')!;
    const native=Math.min(4,z),scale=2**(z-native),nx=Math.floor(x/scale),ny=Math.floor(y/scale);
    const base=await cached(`nasa/${native}/${nx}/${ny}`,()=>image(`/maps/earth/${native}/${nx}-${ny}.jpg`));
    if(disposed)return;
    if(base)ctx.drawImage(base,(x/scale-nx)*base.width,(y/scale-ny)*base.height,base.width/scale,base.height/scale,0,0,256,256);
    if(z<=4)return;
    const bounds=geographicTileBounds(z,x,y),span=bounds.east-bounds.west;
    for(const pack of [...packs].reverse()){
      const {record}=pack,qz=Math.min(z+1,record.maxZoom);
      if(disposed)return;
      if(failed.has(record.id)||qz<record.minZoom||!packOverlaps(bounds,record.bounds))continue;
      try{
        const west=Math.max(bounds.west,record.bounds.west),east=Math.min(bounds.east,record.bounds.east),north=Math.min(bounds.north,record.bounds.north),south=Math.max(bounds.south,record.bounds.south);
        const world=2**qz*256,px=(lon:number)=>(lon+180)/360*world;
        const x0=Math.floor(px(west)/256),x1=Math.min(2**qz-1,Math.ceil(px(east)/256)-1),y0=Math.max(0,Math.floor(mercatorY(north,qz)/256)),y1=Math.min(2**qz-1,Math.ceil(mercatorY(south,qz)/256)-1);
        if((x1-x0+1)*(y1-y0+1)>64)continue;
        const mosaic=document.createElement('canvas');mosaic.width=(x1-x0+1)*256;mosaic.height=(y1-y0+1)*256;const target=mosaic.getContext('2d')!;
        // Bounded sequential reads per tile; PMTiles caches directory ranges.
        for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){
          if(disposed)return;const img=await tile(pack,qz,tx,ty);if(img)target.drawImage(img,(tx-x0)*256,(ty-y0)*256,256,256);
        }
        if(disposed)return;
        ctx.save();ctx.beginPath();ctx.rect((west-bounds.west)/span*256,(bounds.north-north)/span*256,(east-west)/span*256,(north-south)/span*256);ctx.clip();
        for(let row=0;row<256;row++){
          const top=bounds.north-row/256*span,bottom=top-span/256;
          const sy=mercatorY(top,qz)-y0*256,sh=mercatorY(bottom,qz)-mercatorY(top,qz);
          if(sh>0)ctx.drawImage(mosaic,px(bounds.west)-x0*256,sy,span/360*world,sh,0,row,256,1);
        }
        ctx.restore();
      }catch{if(!disposed&&!failed.has(record.id)){failed.add(record.id);onIssue(record.name);}}
    }
  }
  // Prevent a fast pan from scheduling an unbounded number of archive reads.
  const queue:(()=>Promise<void>)[]=[];let running=0;
  function drain(){while(!disposed&&running<4&&queue.length){const run=queue.shift()!;running++;void run().finally(()=>{running--;drain();});}}
  const Layer=L.GridLayer.extend({
    createTile(coords:Leaflet.Coords,done:Leaflet.DoneCallback){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
      queue.push(async()=>{if(disposed||canvas.dataset.cancelled)return;try{await paint(canvas,coords);if(!disposed&&!canvas.dataset.cancelled){canvas.dataset.ready='true';done(undefined,canvas);}}catch{if(!disposed&&!canvas.dataset.cancelled){canvas.dataset.failed='true';done(new Error('Offline overview tile unavailable'),canvas);}}});drain();return canvas;
    }
  }) as {new(options:Leaflet.GridLayerOptions):Leaflet.GridLayer};
  const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const layer=new Layer({tileSize:256,minZoom:0,maxZoom:18,keepBuffer:1,updateWhenIdle:true,updateWhenZooming:false,bounds:[[-90,-180],[90,180]],attribution:['NASA Earth Observatory',...new Set(packs.map(p=>p.record.attribution))].map(escape).join(' | ')}) as Leaflet.GridLayer;
  layer.on('tileunload',event=>{(event as Leaflet.TileEvent).tile.dataset.cancelled='true';});
  return {layer,dispose:()=>{disposed=true;queue.length=0;cache.clear();}};
}
