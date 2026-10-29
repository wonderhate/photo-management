import {readFile,lstat,mkdir,writeFile,realpath,copyFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validatePortfolio,emptyPortfolio} from '../src/browser/portfolio.ts';
import {validateDemoSample} from '../src/core/demo-sample.ts';
import {publicJPEG} from './local-publisher.mjs';
import {createHash} from 'node:crypto';
import {buildPublicPages} from './public-pages.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),frontend=resolve(root,'frontend');
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--content'))throw new Error('Usage: npm run build:showcase -- --content "exported folder"');
const config=resolve(process.env.PHOTO_PORTFOLIO_CONFIG||resolve(root,'.local-notes/portfolio-source.json'));
let content=args[1];
if(!content){try{const remembered=JSON.parse(await readFile(config,'utf8'));if(typeof remembered.path!=='string'||!remembered.path)throw new Error('Invalid saved portfolio source.');content=remembered.path;}catch(e){if(e.code!=='ENOENT')throw e;}}
const files=new Map();let manifest,sample;
let base;
if(content){
  base=await realpath(resolve(content));
  async function readPublic(path){
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
    if(data[0]!==255||data[1]!==216||data[2]!==255)throw new Error('Public images must be JPEG display copies.');
    files.set(url,resolve(base,url.slice(1)));
  }
  let sampleText;
  try{sampleText=await readPublic('demo/sample.json');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(sampleText){
    if(sampleText.length>2048)throw new Error('Invalid published demo photo.');
    sample=validateDemoSample(JSON.parse(sampleText.toString('utf8')));
    const bytes=await readPublic(sample.src.slice(1)),image=publicJPEG(bytes);
    if(createHash('sha256').update(bytes).digest('hex')!==sample.sha256||!image.data.equals(bytes)||image.width!==sample.width||image.height!==sample.height)throw new Error('Published demo photo failed verification.');
    files.set(sample.src,resolve(base,sample.src.slice(1)));
  }
}
for(const [command,args] of [['typescript/bin/tsc',['-b']],['vite/bin/vite.js',['build','--mode','showcase']]]){
  const r=spawnSync(process.execPath,[resolve(frontend,'node_modules',command),...args],{cwd:frontend,stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);
}
const out=resolve(frontend,'dist-showcase');
if(manifest){
  for(const [url,source] of files){const name=resolve(out,'.'+url);await mkdir(dirname(name),{recursive:true});await copyFile(source,name);}
  await writeFile(resolve(out,'portfolio/manifest.json'),JSON.stringify(manifest,null,2));
  if(sample){await mkdir(resolve(out,'demo'),{recursive:true});await writeFile(resolve(out,'demo/sample.json'),JSON.stringify(sample,null,2));}
  if(args.length){await mkdir(dirname(config),{recursive:true});await writeFile(config,JSON.stringify({path:base},null,2));}
}
await buildPublicPages(out,manifest||emptyPortfolio);
console.log(`Public showcase ready: ${out} (${manifest?.photos.length||0} photographs). No deployment performed.`);
