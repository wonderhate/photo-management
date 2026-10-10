const CACHE='photo-archive-v2';
const MAX_ENTRIES=250;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/manifest.webmanifest','/icon-192.png','/icon-512.png'])).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
async function remember(request,response){
  if(!response.ok)return response;
  const cache=await caches.open(CACHE);await cache.put(request,response.clone());
  const keys=await cache.keys();for(const key of keys.slice(0,Math.max(0,keys.length-MAX_ENTRIES)))await cache.delete(key);
  return response;
}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==location.origin)return;
  const photo=/^\/api\/photos\/[^/]+\/(thumbnail|preview)$/.test(url.pathname);
  if(url.pathname.startsWith('/api/')&&!photo)return;
  // HTML always checks the server for the current build. Hashed assets are immutable.
  const immutable=/\/assets\/[^/]+-[^/]+\.(js|css)$/.test(url.pathname);
  event.respondWith((async()=>{
    if(immutable){const hit=await caches.match(request);if(hit)return hit;}
    try{return await remember(request,await fetch(request));}
    catch{return await caches.match(request)||Response.error();}
  })());
});
