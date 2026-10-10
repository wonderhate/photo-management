import type {Photo} from './types';

export function mergeGalleryCache(current:Record<string,Photo>,photos:Photo[],preferred:Set<string>,limit=600):Record<string,Photo>{
  const merged={...current};for(const photo of photos)merged[photo.id]=photo;
  const ids=Object.keys(merged).sort((a,b)=>Number(preferred.has(b))-Number(preferred.has(a)));
  return Object.fromEntries(ids.slice(0,limit).map(id=>[id,merged[id]]));
}
