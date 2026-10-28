import {localPhotoSource} from './core/media-source';
import {current} from './browser/storage';
export const IS_BROWSER=import.meta.env.VITE_APP_RUNTIME==='browser';
export function photoURL(id:string,kind='thumbnail'){return IS_BROWSER?localPhotoSource(current().id,`photos/${id}-${kind==='thumbnail'?'thumb':'preview'}.jpg`):`/api/photos/${id}/${kind}`;}
export function routeLocation(){if(!IS_BROWSER)return {pathname:location.pathname,search:location.search};const value=location.hash.slice(1)||'/',i=value.indexOf('?');return {pathname:i<0?value:value.slice(0,i),search:i<0?'':value.slice(i)};}
export function writeRoute(url:string,push=false){history[push?'pushState':'replaceState']({},'',IS_BROWSER?'#'+url:url);}
