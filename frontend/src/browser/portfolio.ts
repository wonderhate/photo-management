export interface PublicPhoto {
  id:string;title:string;description:string;src:string;thumbnail:string;width:number;height:number;tags:string[];
}
export interface Portfolio {
  version:1;title:string;intro:string;photos:PublicPhoto[];
  albums:{id:string;title:string;description:string;photoIds:string[]}[];featuredIds:string[];
}
export const emptyPortfolio:Portfolio={version:1,title:'光影集 / Lumina',intro:'追光，也收藏时光。',photos:[],albums:[],featuredIds:[]};

// Reconstruct the public allowlist; local library records are never serialized here.
export function validatePortfolio(value:unknown):Portfolio {
  const fail=():never=>{throw new Error('Invalid public portfolio.');};
  const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail();
  const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)?v:fail();
  const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(v)?v:fail();
  const list=(v:unknown,max:number):unknown[]=>Array.isArray(v)&&v.length<=max?v:fail();
  const path=(v:unknown)=>typeof v==='string'&&/^\/portfolio\/images\/[a-zA-Z0-9-]{1,100}\.jpg$/.test(v)?v:fail();
  const dimension=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=8192?v:fail();
  const s=obj(value);if(s.version!==1)fail();
  const photos=list(s.photos,2000).map(v=>{const p=obj(v);return {id:id(p.id),title:text(p.title,160),description:text(p.description,2000),src:path(p.src),thumbnail:path(p.thumbnail),width:dimension(p.width),height:dimension(p.height),tags:list(p.tags,20).map(t=>text(t,80))};});
  const ids=new Set(photos.map(p=>p.id));if(ids.size!==photos.length)fail();
  const references=(v:unknown,max:number)=>{const a=list(v,max).map(id);if(new Set(a).size!==a.length||a.some(n=>!ids.has(n)))fail();return a;};
  const albums=list(s.albums,200).map(v=>{const a=obj(v);return {id:id(a.id),title:text(a.title,160),description:text(a.description,2000),photoIds:references(a.photoIds,2000)};});
  if(new Set(albums.map(a=>a.id)).size!==albums.length)fail();
  return {version:1,title:text(s.title,160),intro:text(s.intro,2000),photos,albums,featuredIds:references(s.featuredIds,12)};
}

export async function loadPortfolio():Promise<Portfolio> {
  const response=await fetch('/portfolio/manifest.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Public portfolio could not be loaded.');
  const blob=await response.blob();if(blob.size>8*1024*1024)throw new Error('Public portfolio is too large.');
  return validatePortfolio(JSON.parse(await blob.text()));
}
