import {useEffect,useRef,useState} from 'react';
import {Calendar,ChevronRight,ChevronDown} from 'lucide-react';
import {api,message} from './api';
import {Empty,PhotoCard} from './components';
import type {TimelineData,Photo} from './types';

export default function TimelinePage({notify,onOpenPhoto}:{notify:(msg:string)=>void;onOpenPhoto?:(photo:Photo)=>void}){
  const [timeline,setTimeline]=useState<TimelineData|null>(null);
  const [loading,setLoading]=useState(true);
  const [expandedYears,setExpandedYears]=useState<Set<string>>(new Set());
  const [expandedMonths,setExpandedMonths]=useState<Set<string>>(new Set());
  const [photos,setPhotos]=useState<Photo[]>([]);
  const [title,setTitle]=useState('');
  const [activeKey,setActiveKey]=useState('');
  const [page,setPage]=useState(1);const [total,setTotal]=useState(0);const [path,setPath]=useState('');const requestId=useRef(0);

  useEffect(()=>{api<TimelineData>('/timeline').then(setTimeline).catch(e=>notify(message(e))).finally(()=>setLoading(false))},[]);

  function toggleYear(year:string){setExpandedYears(c=>{const n=new Set(c);n.has(year)?n.delete(year):n.add(year);return n})}
  function toggleMonth(key:string){setExpandedMonths(c=>{const n=new Set(c);n.has(key)?n.delete(key):n.add(key);return n})}

  async function loadPage(url:string,nextPage:number){const token=++requestId.current;try{const result=await api<{photos:Photo[];total:number}>(url+`?page=${nextPage}&page_size=80`);if(token===requestId.current){setPhotos(result.photos);setTotal(result.total);setPage(nextPage)}}catch(e){if(token===requestId.current)notify(message(e))}}
  async function loadPhotos(year:string,month?:string,day?:string){
    const key=day?`${year}-${month}-${day}`:month?`${year}-${month}`:year;
    setActiveKey(key);
    try{
      const path=day?`/timeline/${year}/${month}/${day}`:month?`/timeline/${year}/${month}`:`/timeline/${year}`;
      setPath(path);await loadPage(path,1);
      setTitle(day?`${year}年${month}月${day}日`:month?`${year}年${month}月`:`${year}年`);
    }catch(e){notify(message(e))}
  }

  if(loading)return <p className="loading">正在加载时间线…</p>;
  if(!timeline||!Object.keys(timeline.years).length)return <Empty title="暂无时间线数据">照片库中没有包含拍摄日期的照片。</Empty>;

  const years=Object.entries(timeline.years).sort(([a],[b])=>b.localeCompare(a));
  const downIcon=<ChevronDown size={14}/>;
  const rightIcon=<ChevronRight size={14}/>;
  const downSm=<ChevronDown size={12}/>;
  const rightSm=<ChevronRight size={12}/>;

  return <div className="timeline-page">
    <div className="timeline-sidebar">
      <div className="timeline-sidebar-header"><h2><Calendar size={17}/>时间线</h2></div>
      <div className="timeline-tree">{years.map(([year,data])=><div className="timeline-year" key={year}>
        <button className={activeKey===year?'active':''} onClick={()=>{toggleYear(year);loadPhotos(year)}}>
          {expandedYears.has(year)?downIcon:rightIcon}
          <span>{year}年</span><span className="count">{data.total}</span>
        </button>
        {expandedYears.has(year)&&Object.entries(data.months).sort(([a],[b])=>b.localeCompare(a)).map(([month,md])=>{
          const mk=`${year}-${month}`;
          return <div className="timeline-month" key={mk}>
            <button className={activeKey===mk?'active':''} onClick={()=>{toggleMonth(mk);loadPhotos(year,month)}}>
              {expandedMonths.has(mk)?downSm:rightSm}
              <span>{month}月</span><span className="count">{md.total}</span>
            </button>
            {expandedMonths.has(mk)&&Object.entries(md.days).sort(([a],[b])=>b.localeCompare(a)).map(([day,count])=>{
              const dk=`${year}-${month}-${day}`;
              return <div className="timeline-day" key={dk}><button className={activeKey===dk?'active':''} onClick={()=>loadPhotos(year,month,day)}><span>{day}日</span><span className="count">{count}</span></button></div>;
            })}
          </div>;
        })}
      </div>)}</div>
    </div>
    <div className="timeline-content">
      {photos.length?<><h3>{title} · {total} 次拍摄</h3>
        <div className="gallery compact" style={{maxHeight:'none'}}>{photos.map(photo=><PhotoCard key={photo.id} photo={photo} selected={false} onToggle={()=>{}} onOpen={()=>onOpenPhoto?.(photo)}/>)}</div>
        <div className="row"><button disabled={page===1} onClick={()=>void loadPage(path,page-1)}>上一页</button><span>{page} / {Math.ceil(total/80)}</span><button disabled={page*80>=total} onClick={()=>void loadPage(path,page+1)}>下一页</button></div>
      </>:<div className="timeline-empty"><Empty title="选择时间节点">从左侧选择年、月或日来浏览照片。</Empty></div>}
    </div>
  </div>;
}
