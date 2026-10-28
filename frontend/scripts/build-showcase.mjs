import {readFile,lstat,mkdir,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validatePortfolio} from '../src/browser/portfolio.ts';
import {publicJpeg} from '../src/core/public-jpeg.ts';

const root=fileURLToPath(new URL('../../',import.meta.url)),frontend=resolve(root,'frontend');
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--content'))throw new Error('Usage: npm run build:showcase -- --content "exported folder"');
const files=new Map();let manifest,readPublic;
const digest=data=>createHash('sha256').update(data).digest('hex');
if(args.length){
  const base=await realpath(resolve(args[1]));
  readPublic=async function(path){
    const name=resolve(base,path),actual=await realpath(name);
    if(!actual.startsWith(base+sep)||!(await lstat(name)).isFile()||(await lstat(name)).isSymbolicLink())throw new Error('Public files must be regular files inside the export folder.');
    if((await lstat(actual)).size>25*1024*1024)throw new Error('Public file exceeds 25 MiB.');
    return readFile(actual);
  }
  const raw=await readPublic('portfolio/manifest.json');if(raw.length>8*1024*1024)throw new Error('Public manifest exceeds 8 MiB.');
  manifest=validatePortfolio(JSON.parse(raw.toString('utf8')));
  // Only referenced JPEG derivatives are copied; extra files and local records stay private.
  for(const p of manifest.photos)for(const url of [p.src,p.thumbnail])if(!files.has(url)){
    const data=await readPublic(url.slice(1));
    const clean=publicJpeg(data);
    if(url===p.src&&(clean.width!==p.width||clean.height!==p.height))throw new Error('Public image dimensions differ from the manifest.');
    files.set(url,digest(data));
  }
}
for(const [command,args] of [['typescript/bin/tsc',['-b']],['vite/bin/vite.js',['build','--mode','showcase']]]){
  const r=spawnSync(process.execPath,[resolve(frontend,'node_modules',command),...args],{cwd:frontend,stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);
}
const out=resolve(frontend,'dist-showcase');
if(manifest){
  for(const [url,hash] of files){
    const data=await readPublic(url.slice(1));
    if(digest(data)!==hash)throw new Error('Public source changed during the build. Export it again.');
    const name=resolve(out,'.'+url);await mkdir(dirname(name),{recursive:true});await writeFile(name,publicJpeg(data).bytes);
  }
  await writeFile(resolve(out,'portfolio/manifest.json'),JSON.stringify(manifest,null,2));
  // Useful metadata also works for crawlers that do not run JavaScript.
  const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const index=resolve(out,'index.html');let html=await readFile(index,'utf8');
  html=html.replace(/<title>[\s\S]*?<\/title>/,()=>'<title>'+escape(manifest.title)+'</title>');
  html=html.replace('</head>',()=>'<meta name="description" content="'+escape(manifest.intro.slice(0,300))+'">\n</head>');await writeFile(index,html);
}
console.log(`Public showcase ready: ${out} (${manifest?.photos.length||0} photographs). No deployment performed.`);
