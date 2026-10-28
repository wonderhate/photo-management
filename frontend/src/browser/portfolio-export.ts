import {current,directory,librarySession,selectDirectory,sourceHandle,writeFile,assertCurrentRevision,uid} from './storage';
import {publishKey,publishSource} from './publish-sources';
import type {PublishRef} from './publish-sources';
import {enterLibraryMutation} from './maintenance';
import {processImage} from './images';
import {validatePortfolio} from './portfolio';
import type {Portfolio} from './portfolio';
import {albumMemberIds} from './album-members';

export type PublishSelection=PublishRef&{title:string;description:string;tags:string[]};
export async function exportPortfolio(options:{title:string;intro:string;photos:PublishSelection[];albumIds:string[];edge:number;quality:number},signal:AbortSignal,onProgress:(done:number,total:number)=>void){
  const leave=enterLibraryMutation();try{
  options=structuredClone(options);const base=directory(),scope=current().id,generation=librarySession();
  const check=()=>{signal.throwIfAborted();if(librarySession()!==generation||directory()!==base||current().id!==scope)throw new Error('Library changed. Reopen the current library.');};
  if(!options.photos.length||options.photos.length>2000||new Set(options.photos.map(publishKey)).size!==options.photos.length||![1600,2048,2560,3840].includes(options.edge)||!Number.isInteger(options.quality)||options.quality<60||options.quality>95)throw new Error('Invalid public export options.');
  // Pick on the initial gesture, before any asynchronous processing loses activation.
  const target=await selectDirectory('readwrite');
  check();
  const forbidden=[directory(),...current().sources.map(s=>sourceHandle(s.id)).filter((s):s is NonNullable<typeof s>=>!!s)];
  for(const h of forbidden)if(await h.isSameEntry(target)||await h.resolve(target)!==null||await target.resolve(h)!==null)throw new Error('Choose a separate public export directory.');
  await assertCurrentRevision();check();const snapshot=structuredClone(current());
  const selected=options.photos.map(p=>publishSource(p,snapshot));
  const mapped=new Map(options.photos.map((p,i)=>[publishKey(p),`frame-${String(i+1).padStart(4,'0')}`]));
  const catalog:Portfolio={version:1,title:options.title,intro:options.intro,photos:options.photos.map((p,i)=>({id:mapped.get(publishKey(p))!,title:p.title,description:p.description,tags:p.tags,src:`/portfolio/images/frame-${i}.jpg`,thumbnail:`/portfolio/images/thumb-${i}.jpg`,width:1,height:1})),albums:options.albumIds.map((id,i)=>{const a=snapshot.albums.find(a=>a.id===id);if(!a)throw new Error('Record not found.');return {id:`collection-${i+1}`,title:a.name,description:'',photoIds:albumMemberIds(a,snapshot.photos).filter(id=>mapped.has('photo:'+id)).map(id=>mapped.get('photo:'+id)!)};}).filter(a=>a.photoIds.length),featuredIds:[...mapped.values()].slice(0,12)};
  validatePortfolio(catalog);signal.throwIfAborted();
  const folderName='Lumina-public-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+uid().slice(0,8);
  const folder=await target.getDirectoryHandle(folderName,{create:true});
  for(let i=0;i<selected.length;i++){
    check();
    const file=await selected[i].read();check();
    if(file.size>256*1024*1024)throw new Error('Invalid public export options.');
    const sourceHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
    if(selected[i].hash&&sourceHash!==selected[i].hash)throw new Error('The source photo changed. Reopen it before saving.');
    const result=await processImage<{preview:Blob;thumbnail:Blob;width:number;height:number}>('portfolio',{file,profile:selected[i].profile,edge:options.edge,quality:options.quality},signal);
    signal.throwIfAborted();
    const digest=async(b:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
    check();if(await digest(await selected[i].read())!==sourceHash)throw new Error('The source photo changed. Reopen it before saving.');check();
    const imageName=await digest(result.preview),thumbName=await digest(result.thumbnail);
    await writeFile(`portfolio/images/${imageName}.jpg`,result.preview,folder);signal.throwIfAborted();
    await writeFile(`portfolio/images/${thumbName}.jpg`,result.thumbnail,folder);
    Object.assign(catalog.photos[i],{src:`/portfolio/images/${imageName}.jpg`,thumbnail:`/portfolio/images/${thumbName}.jpg`,width:result.width,height:result.height});onProgress(i+1,selected.length);
  }
  check();await assertCurrentRevision();check();
  await writeFile('README.txt','Lumina public portfolio\nOnly this explicitly selected collection is public.\nBuild from the project root:\nnpm run build:showcase -- --content "PATH_TO_THIS_FOLDER"\nUpload frontend/dist-showcase, with index.html at the root.\nThe first 12 photos are featured in selection order.\nTo update or unpublish, replace the whole deployment with a new export; do not merge old image folders.\n',folder);
  // Manifest is the completion marker. A failed/cancelled export is never buildable.
  check();
  await writeFile('portfolio/manifest.json',JSON.stringify(validatePortfolio(catalog),null,2),folder);
  return folderName;
  }finally{leave();}
}
