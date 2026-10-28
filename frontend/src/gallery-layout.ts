import type {Photo} from './types';

export type GalleryLayout='grid'|'justified'|'tiles'|'waterfall';
export const GALLERY_LAYOUTS:GalleryLayout[]=['grid','justified','tiles','waterfall'];
export function storedGalleryLayout(value:string|null):GalleryLayout{return GALLERY_LAYOUTS.includes(value as GalleryLayout)?value as GalleryLayout:'justified';}
export function photoAspect(photo:Pick<Photo,'width'|'height'>|undefined):number{
  const ratio=photo?.width&&photo.height?photo.width/photo.height:1.5;
  return Number.isFinite(ratio)&&ratio>0?ratio:1.5;
}

export type GalleryRow={ids:string[];ratios:number[];height:number;start:number;end:number};
export function galleryRows(ids:string[],cache:Record<string,Photo>,width:number,target:number,gap:number,aspects?:ReadonlyMap<string,number>):GalleryRow[]{
  const rows:GalleryRow[]=[];
  let items:string[]=[],ratios:number[]=[],sum=0,start=0;
  for(let i=0;i<ids.length;i++){
    const ratio=aspects?.get(ids[i])??photoAspect(cache[ids[i]]);
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

export type GalleryPosition={index:number;left:number;top:number;width:number;imageHeight:number;height:number};
export type WaterfallLayout={columns:GalleryPosition[][];totalHeight:number};
// Geometry contains IDs/coordinates only. Full photo records remain in the existing bounded cache.
export function waterfallLayout(ids:string[],aspects:ReadonlyMap<string,number>,width:number,target:number,gap:number,caption=38,mobile=false):WaterfallLayout{
  if(width<=0||!ids.length)return {columns:[],totalHeight:0};
  const count=mobile?Math.min(2,Math.max(1,ids.length)):Math.max(1,Math.floor((width+gap)/(target+gap)));
  const cellWidth=Math.max(1,(width-gap*(count-1))/count),columns:GalleryPosition[][]=Array.from({length:count},()=>[]),heights=Array(count).fill(0) as number[];
  ids.forEach((id,index)=>{
    let column=0;for(let i=1;i<count;i++)if(heights[i]<heights[column])column=i;
    const ratio=aspects.get(id)??1.5;
    const imageHeight=Math.min(8192,Math.max(1,cellWidth/(Number.isFinite(ratio)&&ratio>0?ratio:1.5)));
    const height=imageHeight+caption,top=heights[column];
    columns[column].push({index,left:column*(cellWidth+gap),top,width:cellWidth,imageHeight,height});
    heights[column]=top+height+gap;
  });
  return {columns,totalHeight:Math.max(0,Math.max(...heights)-gap)};
}

// Each column is sorted vertically; skip offscreen items in O(columns * log(n)) instead of filtering the entire library on every scroll.
export function waterfallWindow(layout:WaterfallLayout,scrollTop:number,height:number,overscan=0):GalleryPosition[]{
  const from=Math.max(0,scrollTop-overscan),to=scrollTop+height+overscan,visible:GalleryPosition[]=[];
  for(const column of layout.columns){
    let lo=0,hi=column.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(column[mid].top+column[mid].height<from)lo=mid+1;else hi=mid;}
    for(let i=lo;i<column.length&&column[i].top<=to;i++)visible.push(column[i]);
  }
  return visible.sort((a,b)=>a.index-b.index);
}

export function indexRuns(indices:number[],maxGap=8):[number,number][]{
  const runs:[number,number][]=[];
  for(const index of indices){const last=runs.at(-1);if(last&&index-last[1]<=maxGap&&index-last[0]<128)last[1]=index;else runs.push([index,index]);}
  return runs;
}
