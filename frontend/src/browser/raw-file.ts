export const rawExtensions=['dng','cr2','cr3','crw','nef','nrw','arw','sr2','raf','rw2','orf','pef','srw','raw','3fr','iiq','erf','kdc','dcr','mef','mos','mrw','x3f'] as const;
const rawNames=new Set<string>(rawExtensions);
export const isRawFile=(name:string)=>rawNames.has(name.split('.').at(-1)?.toLowerCase()||'');
export const photoFileAccept=['.jpg','.jpeg','.png','.webp','.avif','.heic','.heif','.tif','.tiff','.xmp',...rawExtensions.map(value=>'.'+value)].join(',');
export const isXmpFile=(name:string)=>/\.xmp$/i.test(name);
export const isImportPhoto=(name:string)=>isRawFile(name)||/\.(jpe?g|png|webp|avif|heic|heif|tiff?)$/i.test(name);
export function rawGeometry(info:{width:number;height:number;flip:number}){
  const {width,height,flip}=info;
  if(!Number.isInteger(flip)||flip<0||flip>7)throw new Error('RAW file is unsupported by this decoder or is damaged.');
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)throw new Error('RAW file is unsupported by this decoder or is damaged.');
  if(width*height>100_000_000)throw new Error('Image exceeds the 100 megapixel limit.');
  // libraw-wasm 1.6 metadata already exposes oriented output dimensions.
  return {width,height,orientation:[1,2,4,3,5,8,6,7][flip]};
}
