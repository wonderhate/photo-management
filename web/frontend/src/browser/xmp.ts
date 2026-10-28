import type {MetadataTags} from '../core/metadata';
import {sourceHash} from '../core/editor-adapter';

export const MAX_XMP_BYTES=1024*1024;
const RDF='http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const namespaces:Record<string,string>={
  'http://ns.adobe.com/exif/1.0/':'XMP-exif','http://ns.adobe.com/tiff/1.0/':'XMP-tiff',
  'http://ns.adobe.com/xap/1.0/':'XMP-xmp','http://ns.adobe.com/photoshop/1.0/':'XMP-photoshop',
  'http://ns.adobe.com/exif/1.0/aux/':'XMP-aux','http://cipa.jp/exif/1.0/':'XMP-exifEX',
  'http://purl.org/dc/elements/1.1/':'XMP-dc','http://ns.adobe.com/lightroom/1.0/':'XMP-lr',
};
export function parseXmp(document:string):MetadataTags|null{
  if(new TextEncoder().encode(document).length>MAX_XMP_BYTES||/<!DOCTYPE|<!ENTITY/i.test(document))return null;
  const xml=new DOMParser().parseFromString(document,'application/xml');
  if(xml.getElementsByTagName('parsererror').length)return null;
  const waiting:{item:Element;depth:number}[]=[{item:xml.documentElement,depth:0}],nodes:Element[]=[];
  while(waiting.length){const {item,depth}=waiting.pop()!;if(depth>32||nodes.length>=4096)return null;nodes.push(item);for(const child of [...item.children].reverse())waiting.push({item:child,depth:depth+1});}
  const tags:MetadataTags={};
  const key=(namespace:string|null,name:string)=>namespace&&namespaces[namespace]?namespaces[namespace]+':'+name:null;
  const text=(element:Element)=>{let value='';for(const child of element.childNodes){if(child.nodeType===1)break;if(child.nodeType===3||child.nodeType===4)value+=child.nodeValue||'';}return value.trim();};
  for(const item of nodes){
    for(const attribute of item.attributes){const label=key(attribute.namespaceURI,attribute.localName);if(label)tags[label]=attribute.value.slice(0,4096);}
    const label=key(item.namespaceURI,item.localName);if(!label)continue;
    const values=[...item.getElementsByTagNameNS(RDF,'li')].map(text);
    const value=values.length>1?values.slice(0,64):values[0]||text(item);
    if(Array.isArray(value)||value)tags[label]=Array.isArray(value)?value:value.slice(0,4096);
  }
  return tags;
}
export type XmpFile={file:File;path:string;sourceId:string;read:()=>Promise<File>};
export type XmpSnapshot={file:File;path:string;sourceId:string;name:string;sha256:string;tags:MetadataTags};
export async function readXmp(candidate:XmpFile,check:()=>void):Promise<XmpSnapshot|null>{
  check();
  try{
    const file=await candidate.read();check();if(file.size>MAX_XMP_BYTES)return null;
    const bytes=new Uint8Array(await file.arrayBuffer());check();
    if(bytes.byteLength>MAX_XMP_BYTES)return null;
    const utf16=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
    const tags=parseXmp(new TextDecoder(utf16,{fatal:true}).decode(bytes));if(tags===null)return null;
    const sha256=await sourceHash(new Blob([bytes]));check();
    const again=await candidate.read();if(again.size>MAX_XMP_BYTES||await sourceHash(again)!==sha256)return null;check();
    // Keep the bytes that were hashed, even if a selected disk file changes later.
    const snapshot=new File([bytes],file.name,{type:file.type,lastModified:file.lastModified});
    return {...candidate,file:snapshot,name:file.name,sha256,tags};
  }catch{check();return null;}
}
export class XmpIndex {
  private files=new Map<string,XmpFile[]>();
  private names=new Map<string,number>();
  private key(sourceId:string,path:string){return sourceId+'\0'+path.toLowerCase();}
  addPhoto(sourceId:string,path:string){const key=this.key(sourceId,path);this.names.set(key,(this.names.get(key)||0)+1);}
  add(candidate:XmpFile){const key=this.key(candidate.sourceId,candidate.path),items=this.files.get(key)||[];items.push(candidate);this.files.set(key,items);}
  forPhoto(sourceId:string,path:string):XmpFile[]{
    if((this.names.get(this.key(sourceId,path))||0)>1)return [];
    const dot=path.lastIndexOf('.'),stem=dot>path.lastIndexOf('/')?path.slice(0,dot):path;
    return [stem+'.xmp',path+'.xmp'].flatMap(name=>{const candidates=this.files.get(this.key(sourceId,name));return candidates?.length===1?candidates:[];});
  }
}
