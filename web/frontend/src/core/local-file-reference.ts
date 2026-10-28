export const LOCAL_FILE_PREFIX='/_pc-file/';
const ID=/^[a-zA-Z0-9-]{1,80}$/;
export interface LocalFileReference {libraryID:string;session:string;path:string}
export function validDerivedPath(path:string){
  if(/^ai-studio\/[a-zA-Z0-9-]{1,80}\/(image\.png|generated\.png|preview\.webp)$/.test(path))return true;
  if(/^drafts\/splits\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/(master\.png|panel-(0[1-9]|10)\.(png|jpg))$/.test(path))return true;
  if(/^photos\/[a-zA-Z0-9-]{1,80}-(thumb|preview)\.jpg$/.test(path))return true;
  if(/^drafts\/[a-zA-Z0-9-]{1,80}\/preview-[1-9][0-9]*\.webp$/.test(path))return true;
  if(/^works\/[a-zA-Z0-9-]{1,80}\/(scene\.png|poster-[1-9][0-9]*\.png|preview-[1-9][0-9]*\.webp)$/.test(path))return true;
  return /^exports\/[^<>:"/\\|?*\x00-\x1f]{1,200}\.(jpg|jpeg|png|webp)$/i.test(path)&&!path.slice(8).startsWith('.')&&!path.endsWith(' ')&&!path.includes('/../');
}
export function localFileURL(libraryID:string,session:string,path:string,origin=location.origin){
  if(!ID.test(libraryID)||!ID.test(session)||!validDerivedPath(path))throw new Error('Invalid local file reference.');
  return new URL(LOCAL_FILE_PREFIX+[session,libraryID,...path.split('/')].map(encodeURIComponent).join('/'),origin).href;
}
export function isLocalFileURL(source:string,origin=location.origin){
  try{const url=new URL(source,origin);return url.origin===origin&&url.pathname.startsWith(LOCAL_FILE_PREFIX);}catch{return false;}
}
export function parseLocalFileURL(source:string,origin=location.origin):LocalFileReference|null {
  if(!isLocalFileURL(source,origin))return null;
  const url=new URL(source,origin),[session,libraryID,...parts]=url.pathname.slice(LOCAL_FILE_PREFIX.length).split('/').map(decodeURIComponent),path=parts.join('/');
  if(url.search||url.hash||!ID.test(libraryID||'')||!ID.test(session||'')||parts.some(p=>!p||p==='.'||p==='..'||p.includes('/')||p.includes('\\'))||!validDerivedPath(path))throw new Error('Invalid local file reference.');
  return {libraryID,session,path};
}
