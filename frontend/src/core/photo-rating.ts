export const RATING_SOURCES=['none','xmp-embedded','xmp-sidecar','manual','legacy'] as const;
export type RatingSource=typeof RATING_SOURCES[number];
export type ExternalRating={rating:number|null;rating_source:'none'|'xmp-embedded'|'xmp-sidecar'};
export function xmpRating(value:unknown):number|null{
  if(typeof value==='string'){const text=value.trim();if(!/^[0-5]$/.test(text))return null;return Number(text);}
  return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=5?value:null;
}
/** File-specific sidecars have already overridden shared sidecars in the metadata reader. */
export function externalRating(raw:Record<string,unknown>):ExternalRating{
  for(const [key,source] of [['xmp-sidecar:XMP-xmp:Rating','xmp-sidecar'],['xmp-embedded:XMP-xmp:Rating','xmp-embedded'],['exiftool:XMP-xmp:Rating','xmp-embedded']] as const){
    const rating=xmpRating(raw[key]);if(rating!==null)return {rating,rating_source:source};
  }
  return {rating:null,rating_source:'none'};
}
export const ratingProtected=(source?:RatingSource)=>source===undefined||source==='manual'||source==='legacy';
