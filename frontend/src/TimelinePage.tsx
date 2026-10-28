import {t,monthName} from './i18n';
import {useEffect,useRef,useState} from 'react';
import {Calendar,ChevronRight,ChevronDown} from 'lucide-react';
import {api,message,query} from './api';
import {bt} from './browser/text';
import {useAnalysisRange} from './workspace/AnalysisRange';
import {Empty,PhotoCard} from './components';
import type {TimelineData,Photo,Filters} from './types';

export default function TimelinePage({notify,onOpenPhoto,flagRevision=0,countMode='capture',sourceFilters={}}:{countMode?:string;sourceFilters?:Filters;flagRevision?:number;notify:(msg:string)=>void;onOpenPhoto?:(photo:Photo)=>void}){
  const range=useAnalysisRange(sourceFilters,countMode);
  const [timeline,setTimeline]=useState<TimelineData|null>(null);
  const [loading,setLoading]=useState(true);
  const [expandedYears,setExpandedYears]=useState<Set<string>>(new Set());
  const [expandedMonths,setExpandedMonths]=useState<Set<string>>(new Set());
  const [photos,setPhotos]=useState<Photo[]>([]);
  const [title,setTitle]=useState('');
  const [activeKey,setActiveKey]=useState('');
  const [page,setPage]=useState(1);const [total,setTotal]=useState(0);const [path,setPath]=useState('');const requestId=useRef(0);

  const [failure,setFailure]=useState(''),[pageLoading,setPageLoading]=useState(false),[pageFailure,setPageFailure]=useState('');
  useEffect(()=>{const controller=new AbortController();setLoading(true);setFailure('');
    if(range.error){setFailure(range.error);setLoading(false);return;}
    void api<TimelineData>('/timeline?'+query(range.filters),'GET',undefined,controller.signal).then(setTimeline).catch(e=>{if(!controller.signal.aborted){setFailure(message(e));notify(message(e));}}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>{controller.abort();requestId.current++;};
  },[range.key,range.error,flagRevision]);

  useEffect(()=>{if(path&&!range.error)void loadPage(path,1);},[flagRevision,range.key,range.error]);
  useEffect(()=>()=>{requestId.current++;},[]);

  function toggleYear(year:string){setExpandedYears(c=>{const n=new Set(c);n.has(year)?n.delete(year):n.add(year);return n})}
  function toggleMonth(key:string){setExpandedMonths(c=>{const n=new Set(c);n.has(key)?n.delete(key):n.add(key);return n})}

  async function loadPage(url:string,nextPage:number){const token=++requestId.current;setPhotos([]);setTotal(0);setPage(nextPage);setPageLoading(true);setPageFailure('');try{const result=await api<{photos:Photo[];total:number}>(url+'?'+query({...range.filters,page:nextPage,page_size:80}));if(token===requestId.current){setPhotos(result.photos);setTotal(result.total);}}catch(e){if(token===requestId.current){setPageFailure(message(e));notify(message(e));}}finally{if(token===requestId.current)setPageLoading(false);}}

  async function loadPhotos(year:string,month?:string,day?:string){
    const key=day?`${year}-${month}-${day}`:month?`${year}-${month}`:year;
    setActiveKey(key);
    try{
      const path=day?`/timeline/${year}/${month}/${day}`:month?`/timeline/${year}/${month}`:`/timeline/${year}`;
      setPath(path);
      setTitle(day?`${year}年${month}月${day}日`:month?`${year}年${month}月`:`${year}年`);
      await loadPage(path,1);
    }catch(e){notify(message(e))}
  }

  if(loading)return <>{range.control}<p className="loading">{t("正在加载时间线…")}</p></>;
  if(failure)return <>{range.control}<p role="alert" className="error-box">{failure}</p></>;
  if(!timeline||(!Object.keys(timeline.years).length&&!timeline.unknown_date))return <>{range.control}<Empty title={t("暂无时间线数据")}>{bt('当前范围没有照片。','There are no photos in this scope.')}</Empty></>;

  const years=Object.entries(timeline.years).sort(([a],[b])=>b.localeCompare(a));
  const downIcon=<ChevronDown size={14}/>;
  const rightIcon=<ChevronRight size={14}/>;
  const downSm=<ChevronDown size={12}/>;
  const rightSm=<ChevronRight size={12}/>;

  return <>{range.control}<div className="timeline-page">
    <div className="timeline-sidebar">
      <div className="timeline-sidebar-header"><h2><Calendar size={17}/>{t("时间线")}</h2></div>
      <div className="timeline-tree">{years.map(([year,data])=><div className="timeline-year" key={year}>
        <button className={activeKey===year?'active':''} onClick={()=>{toggleYear(year);loadPhotos(year)}}>
          {expandedYears.has(year)?downIcon:rightIcon}
          <span>{t("{0}年",{0:year})}</span><span className="count">{data.total}</span>
        </button>
        {expandedYears.has(year)&&Object.entries(data.months).sort(([a],[b])=>b.localeCompare(a)).map(([month,md])=>{
          const mk=`${year}-${month}`;
          return <div className="timeline-month" key={mk}>
            <button className={activeKey===mk?'active':''} onClick={()=>{toggleMonth(mk);loadPhotos(year,month)}}>
              {expandedMonths.has(mk)?downSm:rightSm}
              <span>{monthName(month)}</span><span className="count">{md.total}</span>
            </button>
            {expandedMonths.has(mk)&&Object.entries(md.days).sort(([a],[b])=>b.localeCompare(a)).map(([day,count])=>{
              const dk=`${year}-${month}-${day}`;
              return <div className="timeline-day" key={dk}><button className={activeKey===dk?'active':''} onClick={()=>loadPhotos(year,month,day)}><span>{t("{0}日",{0:day})}</span><span className="count">{count}</span></button></div>;
            })}
          </div>;
        })}
      </div>)}{!!timeline.unknown_date&&<button className={activeKey==='unknown'?'active':''} onClick={()=>{setActiveKey('unknown');setTitle('拍摄时间未知');setPath('/timeline/unknown');void loadPage('/timeline/unknown',1)}}>{t('拍摄时间未知')} <span className="count">{timeline.unknown_date}</span></button>}</div>
    </div>
    <div className="timeline-content">
      {activeKey?<><h3>{t(title)} · {total}{range.mode==='file'?bt(' 个文件',' files'):t(" 次拍摄")}</h3>
        {pageFailure&&<p role="alert" className="error-box">{pageFailure}</p>}{pageLoading&&<p role="status">{t("正在加载时间线…")}</p>}
        <div className="gallery compact" style={{maxHeight:'none'}}>{photos.map(photo=><PhotoCard key={photo.id} photo={photo} selected={false} onToggle={()=>{}} onOpen={()=>onOpenPhoto?.(photo)}/>)}</div>
        <div className="row"><button disabled={pageLoading||page===1} onClick={()=>void loadPage(path,page-1)}>{t("上一页")}</button><span>{page} / {Math.max(1,Math.ceil(total/80))}</span><button disabled={pageLoading||page*80>=total} onClick={()=>void loadPage(path,page+1)}>{t("下一页")}</button></div>
      </>:<div className="timeline-empty"><Empty title={t("选择时间节点")}>{t("从左侧选择年、月或日来浏览照片。")}</Empty></div>}
    </div>
  </div></>;
}
