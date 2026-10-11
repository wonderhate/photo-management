import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './styles.css';
import './mobile.css';
import './archive.css';
import './music-layout.css';
import {isRemote,setRemote} from './remote-client';
async function start(){
  try{const response=await fetch('/api/remote/session',{cache:'no-store'});if(response.ok){const session=await response.json();setRemote(isRemote||session.remote)}}catch{/* Keep the native user-agent hint when the connection drops. */}
  if(isRemote){
    document.documentElement.dataset.remote='true';
    if('serviceWorker' in navigator)await navigator.serviceWorker.getRegistrations().then(items=>Promise.all(items.map(item=>item.unregister()))).catch(()=>{});
    if('caches' in window)await caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('photo-archive-')).map(k=>caches.delete(k)))).catch(()=>{});
  }else if('serviceWorker' in navigator&&import.meta.env.PROD){void navigator.serviceWorker.register('/sw.js').catch(()=>{})}
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
}
void start();
