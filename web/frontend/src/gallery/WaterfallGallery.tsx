import {useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import type {Photo} from '../types';
import {indexRuns,waterfallLayout,waterfallWindow} from '../gallery-layout';

interface Props {
  ids:string[];cache:Record<string,Photo>;dimensions:{aspects:ReadonlyMap<string,number>};height:number;grid:number;gap:number;dense?:boolean;mobile:boolean;
  reveal?:{id:string;token:number};
  onNeed:(start:number,end:number)=>void;onRange?:(start:number,end:number)=>void;onVisible?:(ids:string[])=>void;
  renderCard:(photo:Photo|undefined,id:string)=>ReactNode;
}
export default function WaterfallGallery({ids,cache,reveal,dimensions,height,grid,gap,dense,mobile,onNeed,onRange,onVisible,renderCard}:Props){
  const [scrollTop,setScrollTop]=useState(0),frame=useRef<number|undefined>(undefined),offset=useRef(0),scroller=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(0);
  useEffect(()=>{const node=scroller.current;if(!node)return;const measure=()=>setWidth(node.clientWidth);measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[]);
  const geometry=useMemo(()=>waterfallLayout(ids,dimensions.aspects,width,grid,gap,dense?0:38,mobile),[ids,dimensions,width,grid,gap,dense,mobile]);
  const revealed=useRef(0);
  useEffect(()=>{
    if(!reveal||revealed.current===reveal.token||width<=0||!scroller.current)return;
    const index=ids.indexOf(reveal.id);if(index<0)return;
    // Each column is ordered by source index; locate without flattening the library.
    for(const column of geometry.columns){let low=0,high=column.length;while(low<high){const mid=(low+high)>>>1;if(column[mid].index<index)low=mid+1;else high=mid;}
      const item=column[low];if(item?.index!==index)continue;
      const node=scroller.current;if(item.top<node.scrollTop)node.scrollTop=item.top;else if(item.top+item.height>node.scrollTop+height)node.scrollTop=Math.max(0,item.top+item.height-height);
      offset.current=node.scrollTop;setScrollTop(node.scrollTop);revealed.current=reveal.token;break;
    }
  },[reveal,ids,width,height,geometry]);
  const callbacks=useRef({onNeed,onRange,onVisible});callbacks.current={onNeed,onRange,onVisible};
  const needed=useMemo(()=>waterfallWindow(geometry,scrollTop,height,Math.max(400,height*.7)),[geometry,scrollTop,height]);
  const visible=useMemo(()=>waterfallWindow(geometry,scrollTop,height),[geometry,scrollTop,height]);
  const needKey=needed.map(p=>p.index).join(','),visibleKey=visible.map(p=>p.index).join(',');
  useEffect(()=>{
    for(const [start,end] of indexRuns(needKey?needKey.split(',').map(Number):[]))callbacks.current.onNeed(start,end);
  },[needKey,ids]);
  useEffect(()=>{
    const indices=visibleKey?visibleKey.split(',').map(Number):[];
    if(indices.length)callbacks.current.onRange?.(indices[0],indices.at(-1)!);
    callbacks.current.onVisible?.(indices.map(index=>ids[index]));
  },[visibleKey,ids]);
  useEffect(()=>()=>{if(frame.current!==undefined)cancelAnimationFrame(frame.current);},[]);
  return <div ref={scroller} className="waterfall-scroller" style={{height,overflowY:'auto',overflowX:'hidden',scrollbarGutter:'stable',position:'relative'}} onScroll={event=>{
    offset.current=event.currentTarget.scrollTop;
    if(frame.current===undefined)frame.current=requestAnimationFrame(()=>{frame.current=undefined;setScrollTop(offset.current);});
  }}><div style={{height:geometry.totalHeight,position:'relative'}}>{needed.map(position=>{
    const id=ids[position.index];
    return <div key={id} className="waterfall-cell" style={{position:'absolute',left:position.left,top:position.top,width:position.width,height:position.height,['--photo-height' as string]:position.imageHeight+'px'}}>{renderCard(cache[id],id)}</div>;
  })}</div></div>;
}
