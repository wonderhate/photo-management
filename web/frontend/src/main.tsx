import React from 'react';
import {createRoot} from 'react-dom/client';
import {IS_BROWSER} from './runtime';
import {setStoredLang} from './i18n';
async function start(){
  const url=new URL(location.href),lang=url.searchParams.get('lang');
  if(lang==='zh'||lang==='en'){
    setStoredLang(lang);url.searchParams.delete('lang');history.replaceState(null,'',url);
  }
  if('serviceWorker' in navigator&&import.meta.env.PROD){void navigator.serviceWorker.register('/sw.js').catch(()=>{})}
  if(IS_BROWSER){
    document.documentElement.dataset.runtime='browser';document.documentElement.dataset.theme=localStorage.getItem('theme')||'dark';
    if(import.meta.env.VITE_PUBLIC_SHOWCASE==='true'&&url.searchParams.get('local')!=='1'){
      if(lang==='en'||lang==='zh'){url.pathname=lang==='en'?'/en/':'/';history.replaceState(null,'',url);}
      setStoredLang(url.pathname==='/en'||url.pathname.startsWith('/en/')?'en':'zh');
      const {default:PublicSite}=await import('./browser/PublicSite');createRoot(document.getElementById('root')!).render(<React.StrictMode><PublicSite/></React.StrictMode>);
    }else{const [{default:BrowserStart},{default:App},{installGlassInteractions}]=await Promise.all([import('./browser/Start'),import('./App'),import('./glass-interaction'),import('./liquid-glass.css')]);document.documentElement.dataset.material='liquid-glass';const disposeGlass=installGlassInteractions();if(import.meta.hot)import.meta.hot.dispose(disposeGlass);createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserStart><App/></BrowserStart></React.StrictMode>);}
  }else{const {default:App}=await import('./App');createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);}
}
void start();
