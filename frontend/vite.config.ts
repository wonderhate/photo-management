import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {emptyPortfolio} from './src/browser/portfolio';
export default defineConfig(({mode})=>{
  const showcase=mode==='showcase',browser=mode==='browser'||showcase;
  return {define:{'import.meta.env.VITE_APP_RUNTIME':JSON.stringify(browser?'browser':'desktop'),'import.meta.env.VITE_PUBLIC_SHOWCASE':JSON.stringify(showcase?'true':'false')},plugins:[react(),tailwindcss(),{
    name:'shared-raw-assets',
    configureServer(server:any){server.middlewares.use((req:any,res:any,next:any)=>{
      const fontPrefix='/local-assets/signatures/',assetPath=(req.url||'').split('?')[0],fontDir=fileURLToPath(new URL('../backend/app/assets/signatures/',import.meta.url));
      const brandPrefix='/local-assets/brand_logos/',brandDir=fileURLToPath(new URL('../backend/app/assets/brand_logos/',import.meta.url));
      if(assetPath.startsWith(brandPrefix)){const name=assetPath.slice(brandPrefix.length);if(readdirSync(brandDir).includes(name)){res.setHeader('Content-Type',name.endsWith('.png')?'image/png':'application/json');res.end(readFileSync(brandDir+name));return;}}
      if(assetPath.startsWith(fontPrefix)){const name=assetPath.slice(fontPrefix.length);if(readdirSync(fontDir).includes(name)){res.setHeader('Content-Type',name.endsWith('.ttf')?'font/ttf':name.endsWith('.png')?'image/png':'text/plain; charset=utf-8');res.end(readFileSync(fontDir+name));return;}}

      res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
      const path=(req.url||'').split('?')[0],name=path.replace('/raw-1.6.0/','');
      if(path.startsWith('/raw-1.6.0/')&&['index.js','worker.js','libraw.js','libraw.wasm'].includes(name)){
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'");
        res.setHeader('Content-Type',name.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(readFileSync(fileURLToPath(new URL('./node_modules/libraw-wasm/dist/'+name,import.meta.url))));return;
      }next();
    });},
    generateBundle(){for(const name of ['index.js','worker.js','libraw.js','libraw.wasm'])this.emitFile({type:'asset',fileName:'raw-1.6.0/'+name,source:readFileSync(fileURLToPath(new URL('./node_modules/libraw-wasm/dist/'+name,import.meta.url)))});}
  },...(browser?[{
    name:'browser-local-assets',
    configureServer(server:any){server.middlewares.use((req:any,res:any,next:any)=>{const path=(req.url||'').split('?')[0],rules=JSON.parse(readFileSync(fileURLToPath(new URL('../edgeone.json',import.meta.url)),'utf8')).headers;for(const rule of rules)if(rule.source.endsWith('*')?path.startsWith(rule.source.slice(0,-1)):path===rule.source)for(const h of rule.headers)res.setHeader(h.key,h.key==='Content-Security-Policy'?h.value.replace("connect-src 'self' blob: wss:","connect-src 'self' blob: wss: ws://127.0.0.1:9000 ws://localhost:9000"):h.value);const name=path.replace('/raw-1.6.0/','');if(path.startsWith('/raw-1.6.0/')&&['index.js','worker.js','libraw.js','libraw.wasm'].includes(name)){res.setHeader('Content-Type',name.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(readFileSync(fileURLToPath(new URL('./node_modules/libraw-wasm/dist/'+name,import.meta.url))));return;}next();});},
    generateBundle(_options:any,bundle:Record<string,any>){
      const stamp=createHash('sha256');
      if(showcase)this.emitFile({type:'asset',fileName:'portfolio/manifest.json',source:JSON.stringify(emptyPortfolio)});
      this.emitFile({type:'asset',fileName:'edgeone.json',source:readFileSync(fileURLToPath(new URL('../edgeone.json',import.meta.url)))});
      for(const name of ['index.html','public/manifest.webmanifest','public/icon-192.png','public/icon-512.png'])stamp.update(readFileSync(fileURLToPath(new URL('./'+name,import.meta.url))));
      for(const folder of ['signatures','brand_logos']){const base=fileURLToPath(new URL('../backend/app/assets/'+folder+'/',import.meta.url));for(const file of readdirSync(base)){const source=readFileSync(base+file);stamp.update(folder+'/'+file).update(source);this.emitFile({type:'asset',fileName:'local-assets/'+folder+'/'+file,source});}}
      for(const name of ['index.js','worker.js','libraw.js','libraw.wasm']){const source=readFileSync(fileURLToPath(new URL('./node_modules/libraw-wasm/dist/'+name,import.meta.url)));stamp.update(source);}
      const localWorker=readFileSync(fileURLToPath(new URL('./public/local-file-worker.js',import.meta.url)),'utf8');
      const assets=Object.keys(bundle).filter(file=>/\.(js|mjs|css|wasm)$/.test(file)&&!file.startsWith('raw-')),version=stamp.update(localWorker).update(assets.join('\n')).update(readFileSync(fileURLToPath(new URL('../edgeone.json',import.meta.url)))).digest('hex').slice(0,12),precache=['/','/manifest.webmanifest','/icon-192.png','/icon-512.png',...assets.map(file=>'/'+file)];
      this.emitFile({type:'asset',fileName:'sw.js',source:`${localWorker}
const CACHE='photo-browser-${version}',FILES=${JSON.stringify(precache)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('photo-browser-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method==='GET'&&u.origin===location.origin&&u.pathname.startsWith('/_pc-file/')){e.respondWith(localFile(e));return;}if(r.method!=='GET'||u.origin!==location.origin||(u.pathname.startsWith('/api/')||u.pathname.startsWith('/portfolio/')))return;e.respondWith((async()=>{const cached=await caches.match(r);if(r.mode!=='navigate'&&cached)return cached;try{const response=await fetch(r);if(response.ok&&(FILES.includes(u.pathname)||u.pathname.startsWith('/local-assets/')||u.pathname.startsWith('/raw-1.6.0/'))){const c=await caches.open(CACHE);await c.put(r,response.clone());}return response;}catch{return cached||(r.mode==='navigate'?await caches.match('/'):null)||Response.error();}})());});`});
    }
  }]:[])],server:{host:'127.0.0.1',port:browser?5175:5173,strictPort:true,...(!browser?{proxy:{'/api':'http://127.0.0.1:8000'}}:{})},build:{outDir:showcase?'dist-showcase':browser?'dist-web':'dist',rollupOptions:{output:{manualChunks:{charts:['recharts']}}}}};
});
