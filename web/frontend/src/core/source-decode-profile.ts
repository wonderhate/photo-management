/** Transform after the browser decoder's own EXIF handling; recipe stays v1. */
export type SourceDecodeProfile={version:1|2;extra_orientation:number};
export const legacySourceDecode:SourceDecodeProfile={version:1,extra_orientation:1};
export function embeddedSourceProfile(jpeg:boolean,explicitExif:boolean,tags:Record<string,unknown>|null):SourceDecodeProfile{
  const profile:SourceDecodeProfile={version:2,extra_orientation:1},value=tags?.['XMP-tiff:Orientation'];
  return jpeg&&!explicitExif&&typeof value==='string'&&/^[1-8]$/.test(value.trim())?{...profile,extra_orientation:Number(value)}:profile;
}
export function sourceDecodeProfile(value:unknown):SourceDecodeProfile{
  if(value===undefined)return {...legacySourceDecode};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Unsupported source decoding profile.');
  const p=value as Record<string,unknown>;
  if(Object.keys(p).some(key=>!['version','extra_orientation'].includes(key))||![1,2].includes(p.version as number)||!Number.isInteger(p.extra_orientation)||Number(p.extra_orientation)<1||Number(p.extra_orientation)>8||p.version===1&&p.extra_orientation!==1)throw new Error('Unsupported source decoding profile.');
  return {version:p.version as 1|2,extra_orientation:p.extra_orientation as number};
}
