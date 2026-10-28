export const PHOTO_FLAGS=['picked','rejected','unmarked'] as const;
export type PhotoFlag=typeof PHOTO_FLAGS[number];
export function photoFlag(value:unknown):PhotoFlag{
  if(value==null)return 'unmarked';
  if(PHOTO_FLAGS.includes(value as PhotoFlag))return value as PhotoFlag;
  throw new Error('选片标记无效');
}
/** Select the existing successor before a mark can remove its source from a scope. */
export function flagSuccessor(ids:readonly string[],source:string):string|undefined{
  const index=ids.indexOf(source);return index>=0?ids[index+1]:undefined;
}
