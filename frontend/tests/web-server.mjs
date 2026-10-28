import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
import {spawn} from 'node:child_process';
const showcase=process.argv.includes('--showcase');
if(process.argv.includes('--relay')&&!showcase){
  const python=process.env.PHOTO_TEST_PYTHON||fileURLToPath(new URL(process.platform==='win32'?'../../.venv/Scripts/python.exe':'../../.venv/bin/python',import.meta.url));
  const relay=spawn(python,['-m','uvicorn','cloud_relay.app:app','--host','127.0.0.1','--port','9000','--ws-max-size','131072','--no-access-log'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env:{...process.env,PHOTO_RELAY_ORIGIN:'http://127.0.0.1:4175'},stdio:['ignore','inherit','inherit'],windowsHide:true});
  relay.on('error',()=>console.error('AI relay could not start. Check the project Python environment.'));
  relay.on('exit',code=>{if(code)console.error('AI relay stopped. Check port 9000 and the Python environment.');});
  process.once('exit',()=>relay.kill());
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{relay.kill();process.exit(0);});
}
const root=fileURLToPath(new URL(process.argv.includes('--demo')?'../../.test-artifacts/public-preview/':showcase?'../dist-showcase/':'../dist-web/',import.meta.url));
const rules=JSON.parse(await readFile(new URL('../../edgeone.json',import.meta.url),'utf8')).headers;
const mime={'.wasm':'application/wasm','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
createServer(async(req,res)=>{try{const u=new URL(req.url,'http://127.0.0.1'),name=decodeURIComponent(u.pathname);if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}if(name.startsWith('/api/')){res.writeHead(404).end();return;}const path=resolve(root,'.'+(name==='/'?'/index.html':name));if(!path.startsWith(resolve(root)+sep)){res.writeHead(403).end();return;}if(!(await stat(path)).isFile()){res.writeHead(404).end();return;}const data=await readFile(path);const headers=Object.fromEntries(rules.filter(r=>r.source.endsWith('*')?name.startsWith(r.source.slice(0,-1)):name===r.source).flatMap(r=>r.headers.map(h=>[h.key,h.value])));if(!showcase&&headers['Content-Security-Policy'])headers['Content-Security-Policy']=headers['Content-Security-Policy'].replace("connect-src 'self' blob: wss:","connect-src 'self' blob: wss: ws://127.0.0.1:9000 ws://localhost:9000");res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':/\/assets\//.test(name)?'public,max-age=31536000,immutable':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...headers});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404).end();}}).listen(showcase?4176:4175,'127.0.0.1');
