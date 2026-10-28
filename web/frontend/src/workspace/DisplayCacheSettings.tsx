import {useEffect,useState} from 'react';
import {displayCacheStatus,clearDisplayCache} from '../core/display-cache';
import {displayLibraryId} from '../media/display-library';
import {bt} from '../browser/text';
import {message} from '../api';

export default function DisplayCacheSettings({notify}:{notify:(text:string)=>void}){
  const [value,setValue]=useState<{library:string;available:boolean;entries:number;bytes:number}|null>(null),[busy,setBusy]=useState(false);
  useEffect(()=>{let alive=true;void displayLibraryId().then(async library=>{const status=await displayCacheStatus(library);if(alive)setValue({library,...status});}).catch(()=>{});return()=>{alive=false;};},[]);
  return <section className="settings-card"><h3>{bt('高清显示缓存','High-resolution display cache')}</h3><p className="muted">{bt('保存在当前应用的本地浏览器配置中，所有图库合计最多 64 项 / 256 MiB。仅缓存可重建的显示 JPEG，不包含原片、工程或导出。','Stored in this app’s local browser profile, up to 64 images / 256 MiB across libraries. Contains rebuildable display JPEGs, excluding originals, edits and exports.')}</p><p>{value&&!value.available?bt('持久缓存不可用，当前预览仍可继续。','Persistent cache is unavailable. Current previews still work.'):value?bt(`当前图库：${value.entries} 项，${(value.bytes/1024/1024).toFixed(1)} MiB`,`This library: ${value.entries} images, ${(value.bytes/1024/1024).toFixed(1)} MiB`):bt('正在读取…','Loading…')}</p><button disabled={!value?.available||busy} onClick={async()=>{if(!value)return;setBusy(true);try{if(await displayLibraryId()!==value.library)throw new Error('Library changed. Reopen the current library.');await clearDisplayCache(value.library);const status=await displayCacheStatus(value.library);setValue({library:value.library,...status});notify(bt('高清显示缓存已清理，原片和作品保留。','Display cache cleared. Originals and works are kept.'));}catch(error){notify(message(error));}finally{setBusy(false);}}}>{bt('清理此图库的高清缓存','Clear this library’s display cache')}</button></section>;
}
