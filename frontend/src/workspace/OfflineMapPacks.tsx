import {useEffect,useRef,useState} from 'react';
import {FolderPlus,MapPin,Trash2} from 'lucide-react';
import {bt} from '../browser/text';
import {changeMapPack,installMapPack,listMapPacks,watchMapPacks} from '../browser/offline-map-packs';
import {MapPackError} from '../core/offline-map-pack';
import type {OfflineMapPack} from '../core/offline-map-pack';
import './offline-map-packs.css';

export default function OfflineMapPacks({onLocate}:{onLocate:(pack:OfflineMapPack)=>void}){
  const [packs,setPacks]=useState<OfflineMapPack[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[removing,setRemoving]=useState('');
  const input=useRef<HTMLInputElement>(null),operation=useRef<AbortController|null>(null),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;let generation=0;const load=()=>{const own=++generation;void listMapPacks().then(value=>{if(mounted.current&&generation===own)setPacks(value);}).catch(()=>{if(mounted.current)setError(bt('本机地图存储暂不可用，请重试。','Local map storage is unavailable. Please retry.'));});};load();const stop=watchMapPacks(load);return()=>{mounted.current=false;generation++;stop();operation.current?.abort();};},[]);
  function failure(e:unknown){setError(e instanceof MapPackError&&e.code==='quota'?bt('可用空间不足，请移除不再使用的地图包后重试。','Not enough storage. Remove unused map packages and retry.'):e instanceof MapPackError&&e.code==='format'?bt('请选择 PMTiles v3 栅格地图包（JPEG、PNG 或 WebP），不支持矢量或其他压缩格式。','Choose a PMTiles v3 raster package (JPEG, PNG or WebP). Vector tiles and other compression formats are not supported.'):e instanceof MapPackError&&e.code==='invalid'?bt('地图包无效或不完整。需要有效的覆盖范围、名称、来源署名和许可信息。','This package is invalid or incomplete. Coverage, name, attribution and license metadata are required.'):bt('未能保存地图包。请检查本机存储空间后重试。','Could not save the map package. Check local storage and retry.'));}
  async function add(files:File[]){
    if(!files.length||operation.current)return;
    setBusy(true);setError('');setStatus('');const controller=new AbortController();operation.current=controller;
    let installed=0,currentFile='';
    try{
      for(const file of files){
        if(controller.signal.aborted)break;
        currentFile=file.name;
        if(mounted.current)setStatus(bt(`正在安装 ${installed+1}/${files.length}：${file.name}`,`Installing ${installed+1}/${files.length}: ${file.name}`));
        await installMapPack(file,controller.signal);installed++;
      }
      if(mounted.current){
        setStatus(controller.signal.aborted?bt(`已取消。已完成的 ${installed} 个地图包保留，可继续选择其余文件。`,`Cancelled. ${installed} completed packages are kept; select the remaining files to continue.`):bt(`已安装 ${installed} 个地图包，放大到覆盖地区后自动显示。`,`Installed ${installed} map packages. Zoom into their coverage to see local detail.`));
        if(installed)void navigator.storage?.persist?.().catch(()=>{});
      }
    }catch(e){
      if(mounted.current){
        setStatus(controller.signal.aborted?bt(`已取消。已完成的 ${installed} 个地图包保留，可继续选择其余文件。`,`Cancelled. ${installed} completed packages are kept; select the remaining files to continue.`):bt(`已安装 ${installed}/${files.length} 个；在 ${currentFile} 停止。已完成的地图包保留。`,`Installed ${installed}/${files.length}; stopped at ${currentFile}. Completed packages are kept.`));
        if(!controller.signal.aborted)failure(e);
      }
    }finally{operation.current=null;if(mounted.current)setBusy(false);}
  }
  async function update(id:string,enabled:boolean|null){const previous=packs;setBusy(true);setError('');if(enabled!==null)setPacks(old=>old.map(p=>p.id===id?{...p,enabled}:p));try{await changeMapPack(id,enabled);if(mounted.current){setRemoving('');setStatus(enabled===null?bt('已移除应用内的地图副本，原地图文件未改动。','Removed the app’s map copy. The original map file is unchanged.'):bt('地图包状态已更新。','Map package updated.'));}}catch(e){if(mounted.current){setPacks(previous);failure(e);}}finally{if(mounted.current)setBusy(false);}}
  const size=(bytes:number)=>bytes<1024**2?`${Math.max(1,Math.round(bytes/1024)).toLocaleString()} KB`:`${(bytes/1024**2).toLocaleString(undefined,{maximumFractionDigits:1})} MB`;
  return <section className="offline-map-packs" aria-label={bt('本地高清地图包','Local detailed map packages')} data-liquid-glass="panel">
    <header><div><h2>{bt('把常去的地方，留在本机','Keep your favourite places offline')}</h2><p>{bt('安装区域卫星地图包，放大自动显示高清；未覆盖的地方继续使用全球概览。无需 Key，不连接外部地图服务。','Install regional satellite packages for automatic detail as you zoom. Uncovered areas keep the global overview. No key or external map service needed.')}</p></div><button disabled={busy} onClick={()=>input.current?.click()}><FolderPlus size={17} aria-hidden="true"/>{bt('安装地图包','Install map package')}</button></header>
    <input hidden ref={input} type="file" multiple accept=".pmtiles" aria-label={bt('选择本地 PMTiles 地图包','Choose a local PMTiles map package')} onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';if(files.length)void add(files);}}/>
    {busy&&<p>{bt('正在处理本地地图包…','Processing local map package…')} {operation.current&&!operation.current.signal.aborted&&<button onClick={()=>operation.current?.abort()}>{bt('取消安装','Cancel installation')}</button>}</p>}
    {error&&<p role="alert" className="error-box">{error}</p>}{status&&<p role="status">{status}</p>}
    {!packs.length&&!busy&&<p className="muted">{bt('尚未安装区域地图包。可同时选择多个 .pmtiles 分区文件，逐个复制到此设备的应用存储。','No regional packages yet. Select multiple .pmtiles region files to copy them one at a time into this device’s app storage.')}</p>}
    <ul>{packs.map(pack=><li key={pack.id}><div className="offline-pack-info"><strong>{pack.name}</strong><span>{[pack.resolution,pack.year,size(pack.bytes)].filter(Boolean).join(' · ')}</span><small>{pack.bounds.west.toFixed(3)}° – {pack.bounds.east.toFixed(3)}° / {pack.bounds.south.toFixed(3)}° – {pack.bounds.north.toFixed(3)}°</small><details><summary>{bt('来源与许可','Source and license')}</summary><p>{pack.attribution}<br/>{pack.license}</p></details></div><div className="offline-pack-actions"><label><input type="checkbox" disabled={busy} checked={pack.enabled} onChange={e=>void update(pack.id,e.target.checked)}/>{bt('启用','Enabled')}</label><button disabled={busy} onClick={()=>onLocate(pack)}><MapPin size={16} aria-hidden="true"/>{bt('查看地区','View region')}</button><button disabled={busy} aria-label={bt(`移除 ${pack.name}`,`Remove ${pack.name}`)} onClick={()=>setRemoving(pack.id)}><Trash2 size={16} aria-hidden="true"/></button></div>{removing===pack.id&&<div className="offline-pack-remove" role="group" aria-label={bt('确认移除地图包','Confirm map removal')}><p>{bt('仅移除应用中的地图副本。原地图文件和照片保持不变。','Only the app’s map copy will be removed. Original map files and photos stay unchanged.')}</p><button disabled={busy} onClick={()=>void update(pack.id,null)}>{bt('确认移除','Confirm removal')}</button><button disabled={busy} onClick={()=>setRemoving('')}>{bt('取消','Cancel')}</button></div>}</li>)}</ul>
    <p className="muted">{bt('地图包按视野读取，不会一次加载全部影像。清除站点数据会移除已安装副本，请保留原始地图包。10 米卫星合成适合山川、海岸和城市轮廓，不提供单栋建筑细节。','Only tiles in view are read. Clearing site data removes installed copies, so keep your original packages. 10 m composites show terrain, coasts and city patterns, not individual building detail.')}</p>
  </section>;
}
