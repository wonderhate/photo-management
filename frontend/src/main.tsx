import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './styles.css';
import './archive.css';
import {setStoredLang} from './i18n';
async function start(){
  const url=new URL(location.href),lang=url.searchParams.get('lang');
  if(lang==='zh'||lang==='en'){
    setStoredLang(lang);url.searchParams.delete('lang');history.replaceState(null,'',url);
  }
  if('serviceWorker' in navigator&&import.meta.env.PROD){void navigator.serviceWorker.register('/sw.js').catch(()=>{})}
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
}
void start();
