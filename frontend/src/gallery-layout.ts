import type {Photo} from './types';

export type GalleryRow={ids:string[];ratios:number[];height:number;start:number;end:number};
export function galleryRows(ids:string[],cache:Record<string,Photo>,width:number,target:number,gap:number):GalleryRow[]{
  const rows:GalleryRow[]=[];
  let items:string[]=[],ratios:number[]=[],sum=0,start=0;
  for(let i=0;i<ids.length;i++){
    const photo=cache[ids[i]],ratio=photo?.width&&photo.height?photo.width/photo.height:1.5;
    if(items.length&&(width-gap*items.length)/(sum+ratio)<target*.75){
      rows.push({ids:items,ratios,height:Math.min(target*1.4,(width-gap*(items.length-1))/sum),start,end:i-1});
      start=i;items=[];ratios=[];sum=0;
    }
    items.push(ids[i]);ratios.push(ratio);sum+=ratio;
    if(sum*target+gap*(items.length-1)>=width||i===ids.length-1){
      rows.push({ids:items,ratios,height:Math.min(target*1.4,Math.max(1,(width-gap*(items.length-1))/sum)),start,end:i});
      start=i+1;items=[];ratios=[];sum=0;
    }
  }
  return rows;
}
