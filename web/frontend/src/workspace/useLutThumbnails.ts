import {useEffect,useState} from 'react';
import type {EditorLibrary} from '../core/editor-adapter';
import type {LutAsset} from '../core/lut-contract';
import {LutPreviewQueue} from '../core/lut-preview-queue';
import {LutThumbnailPool,lutThumbnailConcurrency,LUT_THUMBNAIL_BYTES} from '../core/lut-thumbnail-pool';
export default function useLutThumbnails(library:EditorLibrary,base:Blob|null,active:boolean){
 const [queue,setQueue]=useState<LutPreviewQueue<LutAsset>|null>(null);
 useEffect(()=>{
  if(!active||!base){setQueue(null);return;}
  const concurrency=lutThumbnailConcurrency(navigator.hardwareConcurrency,(navigator as Navigator&{deviceMemory?:number}).deviceMemory);
  const pool=new LutThumbnailPool<LutAsset>(()=>new Worker(new URL('../browser/lut-preview-worker.ts',import.meta.url),{type:'module'}),asset=>library.lutPreviewSource(asset.id),base,concurrency);
  const next=new LutPreviewQueue<LutAsset>(async asset=>URL.createObjectURL(await pool.render(asset)),url=>URL.revokeObjectURL(url),64,{concurrency,weight:asset=>asset.bytes,maxWeight:LUT_THUMBNAIL_BYTES});setQueue(next);
  return()=>{next.close();pool.close();};
 },[library,base,active]);return queue;
}
