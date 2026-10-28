import AIStudio from './AIStudio';
import AgentBridge from './workspace/AgentBridge';
import {PhotoSimilarityProvider} from './workspace/PhotoSimilarity';
import {locationFilterLabel} from './workspace/location-filter-label';
import {analysisBrowse} from './core/analysis-scope';
import {CameraNamesProvider} from './workspace/CameraNames';
import {createPreferenceStore} from './core/preference-store';
import {enterScope,normalizeQueryScope,normalizeScopeBase,scopeBase,clearTemporary,temporaryFilters,promoteLegacyScope,galleryFilters,galleryRoute} from './core/query-scope';
import type {CountMode,ScopeOrigin} from './core/query-scope';
import QueryScopeBar from './workspace/QueryScopeBar';
import {usePersonScope} from './workspace/usePersonScope';
import FacetBar,{facetSummary} from './workspace/FacetBar';
import ViewerPicture from './workspace/ViewerPicture';
import {photoFileAccept,isImportPhoto,isXmpFile} from './browser/raw-file';
import type {ViewerCommands} from './workspace/ViewerPicture';
import './workspace/viewer.css';
import DownloadLink from './media/DownloadLink';
import MediaImage,{useMediaURL} from './media/MediaImage';
import {lazy,Suspense,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import './styles.css';
import './archive.css';
import './workspace/workspace.css';
import WorkspaceNavigation from './workspace/WorkspaceNavigation';
import PageTransition from './workspace/PageTransition';
import PhotoInformation from './workspace/PhotoInformation';
import {flagSuccessor} from './core/photo-flag';
import type {PhotoFlag} from './core/photo-flag';
import ActivityCenter from './workspace/ActivityCenter';
import {useCommands} from './workspace/useCommands';
import CommandMenu from './workspace/CommandMenu';
import {usePhotoViewer} from './workspace/usePhotoViewer';
import useNeighborPreviews from './media/useNeighborPreviews';
import useDisplayPreview from './media/useDisplayPreview';
import PreviewQualityControl from './media/PreviewQualityControl';
import {nativeAdapter} from './core/native-adapter';
import {inferenceAdapter} from './core/inference-adapter';
import type {DisplayEdge} from './core/display-request';
import {PhotoHoverContext,usePhotoInspector} from './workspace/usePhotoInspector';
import type {DragEvent} from 'react';
import {BrowserLibraryContext} from './browser/LibraryContext';
import {MapPin,Video,Aperture,Images,FolderHeart,Sparkles,ChartNoAxesColumnIncreasing,BookOpen,Frame,Settings as SettingsIcon,Plus,Search,SlidersHorizontal,ArrowUpDown,Upload,FolderOpen,Check,Heart,Trash2,X,ChevronRight,ChevronLeft,Calendar,Users,GitCompare,PenLine,Undo2,LayoutGrid,History,Download,Sun,Moon,Keyboard,Home,Info,Maximize,Pause,Play} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {IS_BROWSER,routeLocation,writeRoute,photoURL} from './runtime';
import {bt} from './browser/text';
import {api,message,query,nativeFetch} from './api';
import {taskProgress} from './workspace/task-summary';
import {Empty,Modal,PhotoCard,Parameters,SearchBox,VirtualGallery} from './components';
import WatermarkPage from './WatermarkPage';
import WatermarkGalleryPage from './WatermarkGalleryPage';
import {StatsPage,ReportsPage} from './AnalysisPages';
import AlbumsPage from './AlbumsPage';
import SettingsPage from './SettingsPage';
import TimelinePage from './TimelinePage';
import ComparePage from './ComparePage';
import FacesPage from './FacesPage';
import BatchEditDialog from './BatchEditDialog';

import type {Photo,Filters,Job,AIStatus,Settings,ScanStatus,Album} from './types';
import {getRecent,recordRecent,clearRecent,recentExportPayload} from './recent';
import {recentExportSource} from './workspace/recent-export';
import type {RecentOp} from './recent';
import {shortcutAction,displayKey,ACTION_LABELS} from './shortcuts';
import {t,getLang,setStoredLang,getLocale} from './i18n';
import type {Lang} from './i18n';
import {mergeGalleryCache} from './gallery-cache';
import useGalleryPreferences from './workspace/useGalleryPreferences';
import useToolPreferences from './workspace/useToolPreferences';
import {toolDefaults} from './core/preferences';
import type {GalleryPreferences} from './core/preferences';
import type {GalleryLayout} from './gallery-layout';

import {pageFromURL} from './routes';
import type {Page} from './routes';
import HomePage from './HomePage';
import FilmTrain from './FilmTrain';
import ArtPage from './ArtPage';
const BrowserShowcase=IS_BROWSER?lazy(()=>import('./browser/Showcase')):()=>null;
const LocationsPage=lazy(()=>import('./workspace/LocationsPage'));
const VideoPage=lazy(()=>import('./workspace/VideoPage'));
const ToolsPage=lazy(()=>import('./browser/ToolsPage'));
const CollageTool=lazy(()=>import('./workspace/CollageLauncher'));
const navigation:{id:Page;label:string;icon:LucideIcon}[]=[{id:'photos',label:'照片',icon:Images},{id:'videos',label:'视频',icon:Video},{id:'albums',label:'影集',icon:FolderHeart},{id:'smart',label:'智能影集',icon:Sparkles},{id:'timeline',label:'时间线',icon:Calendar},{id:'locations',label:'拍摄地点',icon:MapPin},{id:'faces',label:'人物',icon:Users},{id:'stats',label:'统计',icon:ChartNoAxesColumnIncreasing},{id:'reports',label:'摄影报告',icon:BookOpen},{id:'watercolor',label:'水彩转绘',icon:PenLine},{id:'ai-studio',label:'AI创作与标注',icon:Sparkles},{id:'watermark',label:'水印工坊',icon:Frame},{id:'watermark-gallery',label:'水印图库',icon:Images}];
const filterNames:Record<string,string>={camera_model:'相机',lens_model:'镜头',focal_length:'焦距',f_number:'光圈',iso:'ISO',exposure_seconds:'快门',date_from:'起始日期',date_to:'结束日期',orientation:'画幅',file_type:'文件类型',favorite:'收藏',album_id:'影集',tag:'标签',search:'文件名',text:'全部文字',filename:'文件名',semantic:'画面内容',rating:'评分',color_label:'颜色标签',analyzed_color:'已索引画面色板',geo_bounds:'地图范围',geo_presence:'坐标状态',location_exact:'拍摄地点',location_country:'国家 / 地区',location_city:'城市',flag:'选片标记'};

function browserPage(page:Page):Page{return IS_BROWSER&&['faces','smart'].includes(page)?'settings':page;}

export default function App(){
  const libraryAccess=useContext(BrowserLibraryContext);

  const [mobileViewport,setMobileViewport]=useState(()=>matchMedia('(max-width: 760px)').matches);
  const mobile=mobileViewport;
  useEffect(()=>{const media=matchMedia('(max-width: 760px)');const update=()=>setMobileViewport(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
  const [toast,setToast]=useState('');
  const [aiImportId,setAIImportId]=useState('');
  const [galleryView,updateGalleryView]=useGalleryPreferences(setToast);
  const layout=galleryView.layout,grid=galleryView.grid,gridPrefs={gap:galleryView.gap,radius:galleryView.radius,dense:galleryView.dense};
  const [albumManual,setAlbumManual]=useState(false);
  const sort=albumManual?'manual':galleryView.sort,direction=galleryView.direction;
  const setLayout=(layout:GalleryLayout)=>updateGalleryView({layout});
  const setGrid=(grid:number)=>updateGalleryView({grid});
  function setGridPrefs(change:(p:typeof gridPrefs)=>typeof gridPrefs){const next=change(gridPrefs),patch:Partial<GalleryPreferences>={};if(next.gap!==gridPrefs.gap)patch.gap=next.gap;if(next.radius!==gridPrefs.radius)patch.radius=next.radius;if(next.dense!==gridPrefs.dense)patch.dense=next.dense;updateGalleryView(patch);}
  function setSort(sort:string){setAlbumManual(sort==='manual');if(sort!=='manual')updateGalleryView({sort:sort as GalleryPreferences['sort']});}
  const setDirection=(change:(v:string)=>string)=>updateGalleryView({direction:change(direction) as GalleryPreferences['direction']});
  const [viewerInfo,setViewerInfo]=useState(false),[viewerPlaying,setViewerPlaying]=useState(false);
  const [viewerPreferences,updateViewerPreferences]=useToolPreferences('viewer',toolDefaults.viewer,setToast);
  const displayEdge=viewerPreferences.quality,setDisplayEdge=(quality:0|DisplayEdge)=>updateViewerPreferences({quality});
  const [exhibit,setExhibit]=useState<'normal'|'aurora'|'snow'|'rail'>('normal');
  const filmMode=!mobile&&exhibit==='rail';
  const [atmosphere,setAtmosphere]=useState(false),[intro,setIntro]=useState(false),[railSpeed,setRailSpeed]=useState(75);
  const touchStart=useRef<{x:number;y:number}|null>(null),viewerRef=useRef<HTMLDivElement|null>(null);
  const thumbFocusOwner=useRef<HTMLElement|null>(null);
  const viewerCommands=useRef<ViewerCommands|null>(null);const [viewerProof,setViewerProof]=useState(false);
  const [page,updatePage]=useState<Page>(browserPage(pageFromURL(routeLocation().pathname,routeLocation().search)));
  const [draftId,setDraftId]=useState(new URLSearchParams(routeLocation().search).get('draft')||'');
  const [draftPhotoFilter,setDraftPhotoFilter]=useState(new URLSearchParams(routeLocation().search).get('photo')||'');
  const editorGuard=useRef<(()=>Promise<boolean>)|null>(null);
  const navigationRequest=useRef(0),navigationGuard=useRef<Promise<boolean>|null>(null);
  const currentURL=useRef(routeLocation().pathname+routeLocation().search),scopeAlive=useRef(true);
  useEffect(()=>{scopeAlive.current=true;return()=>{scopeAlive.current=false;searchGeneration.current++;};},[]);
  async function navigate(next:Page, draft='',photo='',push=true,comparison?:string[],galleryTarget?:Filters){
    searchGeneration.current++;
    next=browserPage(next);
    if(next===page&&next==='watermark'&&!draft&&!photo)return;
    const own=++navigationRequest.current;
    if(editorGuard.current){
      const pending=navigationGuard.current??(navigationGuard.current=editorGuard.current());
      let allowed=false;
      try{allowed=await pending;}finally{if(navigationGuard.current===pending)navigationGuard.current=null;}
      if(!allowed||own!==navigationRequest.current)return false;
    }

    closeViewer();if(next==='photos'&&galleryTarget){if(JSON.stringify(clearTemporary(galleryTarget))!==JSON.stringify(clearTemporary(filters))){setSelected(new Set());inspector.close();setBatchEditOpen(false);setBatchEditIds([]);}setFilters(galleryTarget);setPageNumber(1);filterHistory.current=[];setHistoryLen(0);}updatePage(next);setDraftId(draft);setDraftPhotoFilter(photo);
    if(next==='compare'&&comparison)setCompareIds(comparison);
    const url=next==='photos'?galleryRoute(galleryTarget||filters):['tools','darkroom'].includes(next)?'/tools'+(next==='tools'?'':'/'+next)+(photo?'?photo='+photo:''):next==='watermark-gallery'?'/watermark/gallery'+(photo?'?photo='+photo:''):next==='watermark'?'/watermark/workshop'+(draft?'?draft='+draft:photo?'?photo='+photo:([...selected].length?'?photo='+[...selected][0]:'')):next==='timeline'?'/timeline':next==='compare'?'/compare?ids='+(comparison||[...selected]).join(','):next==='faces'?'/faces':next==='watercolor'?'/watercolor'+(photo?'?photo='+photo:''):'/?page='+next;
    writeRoute(url,push);currentURL.current=url;return true;
  }
  function setPage(next:Page){void navigate(next)}
  function draftSaved(id:string){setDraftId(id);addRecent({kind:'draft',label:t("继续编辑水印草稿"),time:Date.now(),payload:{draft:id}});const url='/watermark/workshop'+(id?'?draft='+id:'');writeRoute(url);currentURL.current=url}
  useLayoutEffect(()=>{const pop=()=>{const target=routeLocation().pathname+routeLocation().search;writeRoute(currentURL.current);const params=new URLSearchParams(target.split('?')[1]||'');void navigate(pageFromURL(target.split('?')[0],target.includes('?')?'?'+target.split('?')[1]:''),params.get('draft')||'',params.get('photo')||'',false,params.get('ids')?.split(',').filter(Boolean),pageFromURL(target.split('?')[0],target.includes('?')?'?'+target.split('?')[1]:'')==='photos'?galleryFilters(target.includes('?')?'?'+target.split('?')[1]:''):undefined)};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)});
  const [ids,setIds]=useState<string[]>([]);const [cache,setCache]=useState<Record<string,Photo>>({});const cacheRef=useRef<Record<string,Photo>>({});const pendingRef=useRef<Set<string>>(new Set());const visibleRange=useRef<[number,number]>([0,0]);const visiblePhotoIds=useRef<string[]>([]);const [total,setTotal]=useState(0);const [filters,setFilters]=useState<Filters>(()=>galleryFilters(routeLocation().search));const [pageNumber,setPageNumber]=useState(1);const [gridPanel,setGridPanel]=useState(false);const [showFilters,setShowFilters]=useState(false);const [selected,setSelected]=useState<Set<string>>(new Set(new URLSearchParams(routeLocation().search).get('photo')?[new URLSearchParams(routeLocation().search).get('photo')!]:[]));const [detail,setDetail]=useState<Photo|null>(null);const [revision,setRevision]=useState(0);const [loading,setLoading]=useState(false);const [fatal,setFatal]=useState('');const [importOpen,updateImportOpen]=useState(libraryAccess.importAfterOpen);const [paths,setPaths]=useState('');const [recursive,setRecursive]=useState(true);const [importBusy,setImportBusy]=useState(false);const [job,setJob]=useState<Job|null>(null);const [jobExpanded,setJobExpanded]=useState(false);const [ai,setAI]=useState<AIStatus|null>(null);const [options,setOptions]=useState<Record<string,(string|number)[]>>({});const [preferences,setPreferences]=useState<Settings|null>(null);const [dragging,setDragging]=useState(false);const [batchEditOpen,setBatchEditOpen]=useState(false),[batchEditIds,setBatchEditIds]=useState<string[]>([]);const [collagePhotos,setCollagePhotos]=useState<string[]|null>(null);const [compareIds,setCompareIds]=useState<string[]>(()=>new URLSearchParams(routeLocation().search).get('ids')?.split(',').filter(Boolean)||[]);const [showShortcuts,setShowShortcuts]=useState(false);const tagInputRef=useRef<HTMLInputElement|null>(null);const [albumInfo,setAlbumInfo]=useState<Album|null>(null);const [recent,setRecent]=useState<RecentOp[]>(getRecent());const [recentOpen,setRecentOpen]=useState(false);const dragPhoto=useRef<string|null>(null);const [theme,setTheme]=useState(()=>localStorage.getItem('theme')||(IS_BROWSER?'dark':'light'));const [lang,setLang]=useState<Lang>(getLang());const [onboarding,setOnboarding]=useState(()=>!libraryAccess.preview&&!libraryAccess.importAfterOpen&&!localStorage.getItem('onboarded'));
  function setImportOpen(open:boolean){if(open&&libraryAccess.preview){libraryAccess.requestLibrary('import');return;}updateImportOpen(open);}
  useEffect(()=>{if(libraryAccess.importAfterOpen)localStorage.setItem('onboarded','1');},[libraryAccess.importAfterOpen]);
  const scopeState=useMemo(()=>{try{const value=Object.hasOwn(filters,'scope')?normalizeQueryScope(filters.scope):null;normalizeScopeBase(temporaryFilters(filters));if(filters.count_mode&&!['capture','file'].includes(filters.count_mode))throw new Error('Invalid photo scope.');return {value,base:value?.base||scopeBase(filters),error:''};}catch(e){return {value:null,base:{},error:message(e)};}},[filters]);
  const scopedAlbumId=scopeState.base.album_id||filters.album_id||'',galleryCountMode=(scopeState.value?.mode||filters.count_mode||'capture') as CountMode;
  const temporary=temporaryFilters(filters),contextKey=JSON.stringify(clearTemporary(filters));
  const scopeAvailable=page!=='photos'||(!scopeState.error&&!fatal);
  useEffect(()=>{if(page==='photos'){const url=galleryRoute(filters);writeRoute(url);currentURL.current=url;}},[page,filters]);
  useEffect(()=>{if(page!=='photos'||Object.hasOwn(filters,'scope')||!['album_id','person_id','count_mode'].some(k=>filters[k]))return;let alive=true;void createPreferenceStore().then(store=>{if(alive)setFilters(current=>Object.hasOwn(current,'scope')?current:promoteLegacyScope(current,store.libraryId));}).catch(e=>{if(alive)notify(message(e));});return()=>{alive=false};},[page,filters.scope,filters.album_id,filters.person_id,filters.count_mode]);
  function finishOnboarding(){localStorage.setItem('onboarded','1');setOnboarding(false)}
  const notify=useCallback((text:string)=>setToast(text),[]);
  const viewer=usePhotoViewer(page,setDetail,notify),closeViewer=viewer.close;
  const display=useDisplayPreview(detail,displayEdge,!!detail&&!mobile&&!filmMode&&!viewerPlaying&&!viewer.pendingID,preferences?.preview_preference==='raw');
  const detailMedia=useMediaURL(display.source,0);
  const galleryGeneration=useRef(0);const galleryQuery=useRef('');const preferredCacheIds=useRef(new Set<string>());
  useEffect(()=>{let alive=true;const controller=new AbortController();void api<Job[]>('/jobs?summary=true','GET',undefined,controller.signal).then(async items=>{const other=items.filter(j=>!j.kind.startsWith('watercolor')),active=other.find(j=>['running','queued'].includes(j.status))||other[0];if(active&&alive){const detail=await api<Job>('/jobs/'+active.id,'GET',undefined,controller.signal);if(alive){setJob(detail);setJobExpanded(detail.status==='interrupted')}}}).catch(()=>{});return()=>{alive=false;controller.abort();}},[]);
  const reload=()=>setRevision(v=>v+1);
  useEffect(()=>{
    if(libraryAccess.preview)return;
    let alive=true,stop:(()=>void)|undefined,seen='';
    const update=(candidate:Job)=>{if(!alive)return;const key=[candidate.id,candidate.status,candidate.processed].join(':');if(key===seen)return;seen=key;setRevision(v=>v+1);setJob(previous=>previous&&['queued','running'].includes(previous.status)&&previous.id!==candidate.id?previous:candidate);};
    if(IS_BROWSER){void import('./browser/source-monitor').then(module=>{if(alive)stop=module.monitorSources(update);});}
    else{const timer=setInterval(()=>{void api<ScanStatus>('/library/scan').then(s=>{if(s.job)update(s.job);}).catch(()=>{});},15000);stop=()=>clearInterval(timer);}
    return()=>{alive=false;stop?.();};
  },[]);
  const livePerson=usePersonScope(scopeState.base.person_id||'',scopeState.value?.library_id||'',galleryCountMode,page==='photos'&&!detail&&!scopeState.base.album_id&&!scopeState.error,reload);
  function addRecent(op:RecentOp){recordRecent(op);setRecent(getRecent())}
  async function openRecentExport(op:RecentOp){
    const target=IS_BROWSER?window.open('about:blank','_blank'):null;if(target)target.opener=null;
    try{
      const source=await recentExportSource(op.payload||{});
      if(IS_BROWSER){if(!target)throw new Error(bt('浏览器阻止了新标签页，请允许此页面打开新标签页。','The browser blocked the new tab. Allow pop-ups for this page.'));await (await import('./browser/local-file-service')).openFile(source.url,target);}
      else window.open(source.url,'_blank','noopener');
    }catch(error){target?.close();notify(message(error));}
  }

  function systemNotify(title:string,body:string){try{if(!('Notification' in window))return;if(Notification.permission==='granted')new Notification(title,{body});else if(Notification.permission==='default')void Notification.requestPermission()}catch{}}
  useEffect(()=>{if(!scopedAlbumId){setAlbumInfo(null);setAlbumManual(false);return}let alive=true;api<Album>('/albums/'+scopedAlbumId).then(a=>{if(alive){setAlbumInfo(a);setAlbumManual(a.type!=='rule')}}).catch(()=>{if(alive)setAlbumInfo(null)});return()=>{alive=false}},[scopedAlbumId,revision]);
  async function scanNow(){try{const r=await api<ScanStatus>('/library/scan?force=true','POST');if(r.job){setJob(r.job);setJobExpanded(true)}else notify(t("尚未配置自动扫描目录"))}catch(e){notify(message(e))}}
  useEffect(()=>{if(libraryAccess.preview)return;let alive=true;api<ScanStatus>('/library/scan','POST').then(r=>{if(alive&&r.job){setJob(r.job);setJobExpanded(['running','queued'].includes(r.job.status))}}).catch(e=>notify(message(e)));return()=>{alive=false}},[]);
  useEffect(()=>{if(job?.kind!=='import'||!['running','queued'].includes(job.status))return;const timer=setInterval(()=>setRevision(v=>v+1),3000);return()=>clearInterval(timer)},[job?.id,job?.status]);
  useEffect(()=>{if(toast){const timeout=setTimeout(()=>setToast(''),7000);return()=>clearTimeout(timeout)}},[toast]);
  useEffect(()=>{document.documentElement.lang=lang;document.title=t('光影集 · 本地摄影照片管理')},[lang]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('theme',theme)},[theme]);
  useEffect(()=>{let alive=true;api<Settings>('/settings').then(s=>{if(alive)setPreferences(s)}).catch(e=>setFatal(message(e)));return()=>{alive=false}},[revision]);
  useEffect(()=>{if(page==='photos'&&scopeState.error){setOptions({});return;}const controller=new AbortController(),params=page==='photos'?clearTemporary(filters):{};void api<Record<string,(string|number)[]>>('/filter-options?'+query({...params,count_mode:page==='photos'?galleryCountMode:preferences?.count_mode||'capture',include_tags:'false'}),'GET',undefined,controller.signal).then(next=>{if(!controller.signal.aborted)setOptions(next);}).catch(e=>{if(!controller.signal.aborted){setOptions({});notify(message(e));}});return()=>controller.abort();},[page,contextKey,revision,scopeState.error,galleryCountMode,preferences?.count_mode]);
  useEffect(()=>{let alive=true;const poll=()=>inferenceAdapter.semanticStatus().then(r=>{if(alive)setAI(r)}).catch(()=>{});poll();const timer=setInterval(poll,3000);return()=>{alive=false;clearInterval(timer)}},[]);
  useEffect(()=>{cacheRef.current=cache},[cache]);
  useEffect(()=>{
    const generation=++galleryGeneration.current,key=JSON.stringify([page,filters,sort,direction]),keep=galleryQuery.current===key;
    galleryQuery.current=key;if(page!=='photos')return;
    let alive=true;const controller=new AbortController();if(scopeState.error){setFatal(scopeState.error);setIds([]);setTotal(0);setLoading(false);return()=>{controller.abort();galleryGeneration.current++;};}if(!keep)setLoading(true);setFatal('');pendingRef.current.clear();
    void api<{ids:string[]}>('/photos/ids?'+query({...filters,sort,direction}),'GET',undefined,controller.signal).then(async result=>{
      if(!alive||generation!==galleryGeneration.current)return;
      setIds(result.ids);setTotal(result.ids.length);
      if(!keep){visiblePhotoIds.current=[];cacheRef.current={};setCache({});return;}
      const [start,end]=visibleRange.current,from=Math.max(0,start-30),window=result.ids.slice(from,Math.min(end+31,from+200)),retained=new Set(window);
      const remaining=new Set(result.ids);visiblePhotoIds.current=visiblePhotoIds.current.filter(id=>remaining.has(id));
      setCache(current=>{if(generation!==galleryGeneration.current)return current;const next=Object.fromEntries(Object.entries(current).filter(([id])=>retained.has(id)));cacheRef.current=next;return next;});
      if(window.length){const fresh=await api<{photos:Photo[]}>('/photos/by-ids','POST',{ids:window},controller.signal);if(!alive||generation!==galleryGeneration.current)return;
        setCache(current=>{if(generation!==galleryGeneration.current)return current;const next=mergeGalleryCache(current,fresh.photos,preferredCacheIds.current);cacheRef.current=next;return next;});}
    }).catch(error=>{if(alive&&!controller.signal.aborted)setFatal(message(error));}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;controller.abort();galleryGeneration.current++;};
  },[filters,sort,direction,revision,page]);
  async function loadWindow(start:number,end:number){
    const generation=galleryGeneration.current,from=Math.max(0,start-30),to=Math.min(ids.length,end+31,from+600);
    preferredCacheIds.current=new Set(ids.slice(Math.max(0,start-200),Math.min(ids.length,end+201)));
    const missing=ids.slice(from,to).filter(id=>!cacheRef.current[id]&&!pendingRef.current.has(id));if(!missing.length)return;missing.forEach(id=>pendingRef.current.add(id));
    try{for(let offset=0;offset<missing.length;offset+=200){if(generation!==galleryGeneration.current)return;
      const result=await api<{photos:Photo[]}>('/photos/by-ids','POST',{ids:missing.slice(offset,offset+200)});if(generation!==galleryGeneration.current)return;
      setCache(current=>{if(generation!==galleryGeneration.current)return current;const next=mergeGalleryCache(current,result.photos,preferredCacheIds.current);cacheRef.current=next;return next;});
    }}catch(error){if(generation===galleryGeneration.current)notify(message(error));}finally{if(generation===galleryGeneration.current)missing.forEach(id=>pendingRef.current.delete(id));}
  }
  useEffect(()=>{if(!job||!['running','queued'].includes(job.status))return;systemNotify('','');const timer=setInterval(()=>{api<Job>('/jobs/'+job.id).then(next=>{setJob(next);if(['completed','failed','cancelled'].includes(next.status)){reload();const text=next.status==='failed'?next.error||t("任务失败"):next.status==='cancelled'?t("任务已取消：已处理 {0} 项",{0:next.processed}):t("{0}完成：成功 {1}，跳过 {2}，失败 {3}",{0:next.kind==='import'?t("导入"):t("导出"),1:next.success,2:next.skipped,3:next.failed});notify(text);systemNotify(next.kind==='import'?t("光影集 · 导入任务"):t("光影集 · 导出任务"),text);if(next.status==='completed')addRecent(next.kind==='import'?{kind:'import',label:t("导入完成：成功 {0}",{0:next.success}),time:Date.now()}:{kind:'export',label:t("导出水印 {0} 个",{0:next.results.length}),time:Date.now(),payload:recentExportPayload(next,IS_BROWSER,location.origin)})}}).catch(e=>{clearInterval(timer);notify(message(e))})},800);return()=>clearInterval(timer)},[job?.id,job?.status]);
  const [flagRevision,setFlagRevision]=useState(0),flagLock=useRef(false),[flagSaving,setFlagSaving]=useState(false),[flagReveal,setFlagReveal]=useState<{id:string;token:number}|undefined>(undefined),flagToken=useRef(0);
  useEffect(()=>setFlagReveal(undefined),[filters,sort,direction,page,layout]);
  const flagContext=useRef({scope:'',selected,origin:''});flagContext.current={scope:page+JSON.stringify([filters,sort,direction,layout]),selected,origin:viewer.requested.current||detail?.id||''};
  async function updateFlags(targets:string[],flag:PhotoFlag,advance=false){
    if(!scopeAvailable||flagLock.current||!targets.length)return;
    flagLock.current=true;setFlagSaving(true);
    const viewerGeneration=viewer.generation.current,before=flagContext.current,source=targets[0],successor=advance&&targets.length===1?flagSuccessor(ids,source):undefined;let saved=0;
    try{
      for(let index=0;index<targets.length;index+=10000){
        const chunk=targets.slice(index,index+10000);await api('/photos/batch-edit','POST',{photo_ids:chunk,flag});saved+=chunk.length;const changed=new Set(chunk);
        setCache(current=>Object.fromEntries(Object.entries(current).map(([id,p])=>[id,changed.has(id)?{...p,flag}:p])));setDetail(current=>current&&changed.has(current.id)?{...current,flag}:current);
        for(const id of chunk)inspector.patch(id,{flag});
      }
      setFlagRevision(value=>value+1);
      if(flagContext.current.scope!==before.scope){reload();return;}
      const scoped=page==='photos'&&(!!filters.flag||!!filters.facets||!!filters.query||!!scopedAlbumId||Object.keys(scopeState.base).length>0);
      const remaining=scoped?(await api<{ids:string[]}>('/photos/ids?'+query({...filters,sort,direction}))).ids:ids;
      if(flagContext.current.scope!==before.scope){reload();return;}
      const existing=scoped?new Set(remaining):null,inScope=(id:string)=>!existing||existing.has(id);if(page==='photos'&&existing){setSelected(current=>new Set([...current].filter(id=>existing.has(id))));if(inspector.photo&&!existing.has(inspector.photo.id))inspector.close();}
      const typing=!!document.activeElement?.closest('input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox]');
      const modal=[...document.querySelectorAll('[aria-modal=true]')].at(-1),sameSurface=before.origin?modal===viewerRef.current?.closest('.modal'):!modal;
      const stillCurrent=!typing&&sameSurface&&viewer.generation.current===viewerGeneration&&(before.origin?flagContext.current.origin===source:!flagContext.current.origin&&flagContext.current.selected===before.selected&&flagContext.current.selected.size===1&&flagContext.current.selected.has(source));
      if(advance&&successor&&inScope(successor)&&stillCurrent){
        if(before.origin)await openId(successor);else{setSelected(new Set([successor]));setFlagReveal({id:successor,token:++flagToken.current});}
      }else if(before.origin&&stillCurrent&&!inScope(source))closeViewer();
      if(scoped||page!=='photos')reload();notify(t('已更新 {0} 张照片的选片标记',{0:saved}));
    }catch(e){if(saved)setFlagRevision(value=>value+1);reload();notify(saved?t('已保存 {0} 张，其余标记未保存：',{0:saved})+message(e):message(e));}
    finally{flagLock.current=false;setFlagSaving(false);}
  }
  const focusedFlagToken=useRef(0);
  useEffect(()=>{
    if(!flagReveal||focusedFlagToken.current===flagReveal.token)return;
    if(page!=='photos'||detail||selected.size!==1||!selected.has(flagReveal.id)){focusedFlagToken.current=flagReveal.token;return;}
    const frame=requestAnimationFrame(()=>{
      if(document.querySelector('[aria-modal=true]')||document.activeElement?.closest('input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox]')){focusedFlagToken.current=flagReveal.token;return;}
      const button=document.querySelector<HTMLButtonElement>(`.photo-card[data-photo-id="${flagReveal.id}"] .photo-image`);
      if(button){button.focus({preventScroll:true});focusedFlagToken.current=flagReveal.token;}
    });return()=>cancelAnimationFrame(frame);
  },[flagReveal,cache,selected,page,detail]);
  const flagTargets=()=>detail?[detail.id]:[...selected];
  const navigationIndex=ids.indexOf(viewer.requested.current||detail?.id||'');
  const appCommands=useCommands(detail?'viewer':page==='photos'?'library':['watermark','watercolor','darkroom'].includes(page)?'editor':'other',{
    selectAll:{enabled:ids.length>0,run:selectAllFiltered},exportSel:{enabled:selected.size>0,run:()=>watermark([...selected])},
    remove:{enabled:!!detail||selected.size>0,run:()=>remove(detail?[detail.id]:[...selected])},
    help:{run:()=>setShowShortcuts(value=>!value)},
    prev:{enabled:!!detail&&ids.length>=2&&navigationIndex>=0&&(filmMode||navigationIndex>0),run:()=>stepPhoto(-1)},next:{enabled:!!detail&&ids.length>=2&&navigationIndex>=0&&(filmMode||navigationIndex<ids.length-1),run:()=>stepPhoto(1)},
    flagPick:{enabled:!flagSaving&&!viewer.pendingID&&(!!detail||selected.size>0),run:()=>updateFlags(flagTargets(),'picked')},flagReject:{enabled:!flagSaving&&!viewer.pendingID&&(!!detail||selected.size>0),run:()=>updateFlags(flagTargets(),'rejected')},flagClear:{enabled:!flagSaving&&!viewer.pendingID&&(!!detail||selected.size>0),run:()=>updateFlags(flagTargets(),'unmarked')},
    flagPickNext:{enabled:!flagSaving&&!viewer.pendingID&&(!!detail||selected.size===1),run:()=>updateFlags(flagTargets(),'picked',true)},flagRejectNext:{enabled:!flagSaving&&!viewer.pendingID&&(!!detail||selected.size===1),run:()=>updateFlags(flagTargets(),'rejected',true)},flagClearNext:{enabled:!flagSaving&&!viewer.pendingID&&(!!detail||selected.size===1),run:()=>updateFlags(flagTargets(),'unmarked',true)},
    favorite:{enabled:!!detail,checked:detail?.favorite,run:()=>detail?favorite(detail):undefined},tag:{enabled:!!detail&&viewerInfo,run:()=>tagInputRef.current?.focus()},
    viewerZoomIn:{enabled:!!detail&&!filmMode,run:()=>viewerCommands.current?.step(1)},viewerZoomOut:{enabled:!!detail&&!filmMode,run:()=>viewerCommands.current?.step(-1)},
    viewerFit:{enabled:!!detail&&!filmMode,run:()=>viewerCommands.current?.fit()},viewerActual:{enabled:!!detail&&!filmMode,run:()=>viewerCommands.current?.zoom(1)},viewerProof:{enabled:!!detail&&!filmMode,checked:viewerProof,run:()=>viewerCommands.current?.toggleProof()},
  },{allowedModal:()=>viewerRef.current?.closest('.modal')||null,onError:error=>notify(message(error))});
  const bindings=appCommands.bindings;
  useEffect(()=>{function key(e:KeyboardEvent){if(e.defaultPrevented||e.isComposing)return;if(e.key==='Escape'){closeViewer();setImportOpen(false);setShowShortcuts(false);setBatchEditOpen(false);setGridPanel(false);setRecentOpen(false);setOnboarding(o=>{if(o)localStorage.setItem('onboarded','1');return false});return;}appCommands.dispatch(e);}document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[detail,ids,selected,filters,bindings,filmMode,page]);
  const searchGeneration=useRef(0),searchContext=useRef({page,filters});searchContext.current={page,filters};
  function filter(key:string,value:string){searchGeneration.current++;if(!(key==='search'&&filters.search!==undefined&&value!==''))pushHistory(filters);setFilters(current=>{const next={...current};if(value)next[key]=value;else delete next[key];return next});setPageNumber(1)}
  async function browse(value:Filters,mode?:CountMode,origin?:ScopeOrigin){const ticket=++searchGeneration.current;try{const [store,chosenMode]=await Promise.all([createPreferenceStore(),mode?Promise.resolve(mode):preferences?Promise.resolve(preferences.count_mode):api<Settings>('/settings').then(s=>s.count_mode)]);if(!scopeAlive.current||ticket!==searchGeneration.current)return;const next=analysisBrowse(store.libraryId,value,chosenMode,origin);await navigate('photos','','',true,undefined,next);}catch(e){if(scopeAlive.current&&ticket===searchGeneration.current)notify(message(e));}}
  async function submitSearch(mode:import('./components').SearchMode,text:string){
    const ticket=++searchGeneration.current,before=searchContext.current;
    const cleared=(current:Filters)=>{const next={...current};for(const key of ['text','filename','search','semantic','semantic_threshold'])delete next[key];return next;};
    if(!text||mode==='text'||mode==='filename'){pushHistory(filters);setFilters(current=>({...cleared(current),...(text?{[mode]:text}:{})}));setPageNumber(1);return;}
    if(IS_BROWSER){notify(bt('画面语义和自然语言解析需要本机服务。','Visual meaning and natural-language parsing require the local backend.'));return;}
    try{
      const result=mode==='semantic'?{filters:{semantic:text} as Filters,interpreted:[] as string[],remaining_query:text}:await api<{filters:Filters;interpreted:string[];remaining_query:string}>('/search/parse?'+query({q:text}));
      if(ticket!==searchGeneration.current||searchContext.current.page!==before.page||searchContext.current.filters!==before.filters)return;
      if(result.filters.semantic&&ai?.status!=='ready'&&ai?.status!=='indexing'){notify(t('画面内容“')+result.remaining_query+t('”需要本地 AI。请在设置加载模型；原查询已保留。'));return;}
      pushHistory(filters);setFilters(current=>({...cleared(current),...result.filters}));setPageNumber(1);notify(t('已理解：')+[...result.interpreted,...(result.remaining_query?[t('画面内容：')+result.remaining_query]:[])].join('、'));
    }catch(e){if(ticket===searchGeneration.current)notify(message(e));}
  }

  const filterHistory=useRef<Filters[]>([]);const [historyLen,setHistoryLen]=useState(0);
  function pushHistory(prev:Filters){const stack=filterHistory.current;if(JSON.stringify(stack[stack.length-1]??null)!==JSON.stringify(prev)){stack.push({...prev});if(stack.length>20)stack.shift();setHistoryLen(stack.length)}}
  function undoFilter(){searchGeneration.current++;const prev=filterHistory.current.pop();setHistoryLen(filterHistory.current.length);if(prev!==undefined&&JSON.stringify(clearTemporary(prev))===contextKey){setFilters(prev);setPageNumber(1)}}
  function toggle(id:string){setSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next})}
  async function open(photo:Photo,base?:Filters,current?:()=>boolean){
    if(current&&!current())return;
    if(base&&page!=='photos')setIds([photo.id]);
    const ticket=await viewer.load(photo.id,current);if(!ticket||page==='photos')return;
    try{const scoped=base?enterScope((await createPreferenceStore()).libraryId,base,'capture','person'):{};
      if(!ticket.current()||(current&&!current()))return;
      const result=await api<{ids:string[]}>('/photos/ids?'+query({...scoped,sort:'date_taken',direction:'desc'}),'GET',undefined,ticket.signal);
      if(ticket.current()&&(!current||current()))setIds(result.ids);
    }catch(e){if(ticket.current()&&(!current||current()))notify(message(e))}
  }
  async function openId(id:string,origin?:string){if(origin&&viewer.requested.current&&viewer.requested.current!==origin)return false;return !!await viewer.load(id,origin?()=>viewerRef.current?.querySelector<HTMLElement>('.film-stage')?.dataset.photoId===origin:undefined);}
  async function favorite(photo:Photo){if(!scopeAvailable)return;try{const result=await api<Photo>('/photos/'+photo.id,'PATCH',{favorite:!photo.favorite});setCache(current=>current[photo.id]?{...current,[photo.id]:result}:current);setDetail(current=>current?.id===photo.id?result:current);inspector.update(result);if(filters.favorite!==undefined||albumInfo?.type==='rule'||filters.query||filters.facets||Object.keys(scopeState.base).length>0)reload();}catch(e){notify(message(e))}}
  async function remove(ids:string[]){if(!scopeAvailable||!ids.length)return;if(!confirm(galleryCountMode==='file'?bt('从图库移出 '+ids.length+' 个文件记录？磁盘原始文件将完整保留。','Remove '+ids.length+' file records from the library? Originals stay on disk.'):t("从照片库移出 {0} 次拍摄及其 RAW/JPG 关联记录？磁盘原始文件将完整保留。",{0:ids.length})))return;try{for(const id of ids)await api('/photos/'+id+'?scope='+galleryCountMode,'DELETE');setSelected(new Set());closeViewer();inspector.close();reload();notify(t("已移出照片库，原始文件保留"))}catch(e){notify(message(e));reload()}}
  const importFileInput=useRef<HTMLInputElement>(null),[importFiles,setImportFiles]=useState<File[]>([]);
  const importCounts=useMemo(()=>importFiles.reduce((counts,file)=>({photos:counts.photos+Number(isImportPhoto(file.name)),xmp:counts.xmp+Number(isXmpFile(file.name))}),{photos:0,xmp:0}),[importFiles]);
  async function pick(kind:'files'|'directory'){
    if(IS_BROWSER&&kind==='files'){importFileInput.current?.click();return;}
    setImportBusy(true);try{const result=await nativeAdapter.pickOriginals(kind);if(result.kind==='paths'&&result.paths.length){setPaths(result.paths.join('\n'));setImportFiles([])}}catch(e){notify(message(e))}finally{setImportBusy(false)}
  }
  async function runImport(){const values=paths.split('\n').map(v=>v.trim().replace(/^"|"$/g,'')).filter(Boolean);if(!values.length&&!importFiles.length){notify(t("请选择文件或填写路径"));return}setImportBusy(true);try{setJob(IS_BROWSER&&importFiles.length?await (await import('./browser/api')).importSelectedFiles(importFiles):await api<Job>('/photos/import','POST',{paths:values,recursive}));setImportFiles([]);setImportOpen(false);setJobExpanded(true);setPage('photos')}catch(e){notify(message(e))}finally{setImportBusy(false)}}
  async function drop(event:DragEvent){event.preventDefault();setDragging(false);if(IS_BROWSER){notify(bt('请使用“导入照片”授权原片目录，照片不会上传。','Use Import Photos to authorize an original directory. Photos are not uploaded.'));return;}const files=Array.from(event.dataTransfer.files);if(!files.length)return;if(!confirm(t("浏览器无法读取原始绝对路径。拖入的 {0} 个文件将复制到照片库的 imports 目录；若要只登记路径，请取消并使用「导入照片」选择原文件。是否导入这些副本？",{0:files.length})))return;const body=new FormData();files.forEach(file=>body.append('files',file));try{const response=await nativeFetch('/api/photos/upload',{method:'POST',body});if(!response.ok)throw new Error(t("拖拽导入失败，请改用本地文件选择器"));setJob(await response.json() as Job);setJobExpanded(true);setPage('photos')}catch(e){notify(message(e))}}
  async function browserOriginal(id:string,download=false){try{const storage=await import('./browser/storage');const p=storage.current().photos.find(p=>p.id===id);if(!p)throw new Error('Record not found.');const file=await storage.original(p),url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;if(download)a.download=p.file_name;else{a.target='_blank';a.rel='noopener';}a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){notify(message(e));}}
  function watermark(ids:string[]){setSelected(new Set(ids));closeViewer();void navigate('watermark','',ids[0]||'')}
  function startCompare(){const ids=[...selected];if(ids.length<2||ids.length>4){notify(t("对比需要选择 2-4 张照片"));return}setCompareIds(ids);closeViewer();void navigate('compare')}
  async function selectAllFiltered(){if(!scopeAvailable)return;try{const r=await api<{ids:string[]}>('/photos/ids?'+query(filters));setSelected(new Set(r.ids));notify(galleryCountMode==='file'?bt('已选择全部 '+r.ids.length+' 个文件','Selected all '+r.ids.length+' files'):t("已选择全部 {0} 次拍摄",{0:r.ids.length}))}catch(e){notify(message(e))}}
  async function movePhoto(targetId:string){const source=dragPhoto.current;dragPhoto.current=null;if(!source||source===targetId||!scopedAlbumId||galleryCountMode==='file')return;try{const r=await api<{ids:string[]}>('/photos/ids?'+query({...filters,sort:'manual'}));const ids=r.ids.filter(id=>id!==source);const at=ids.indexOf(targetId);ids.splice(at<0?ids.length:at,0,source);await api('/albums/'+scopedAlbumId+'/order','PUT',{photo_ids:ids});setIds(current=>{const next=current.filter(id=>id!==source);const idx=next.indexOf(targetId);next.splice(idx<0?next.length:idx,0,source);return next});notify(t("影集顺序已保存"))}catch(e){notify(message(e))}}
  async function setAlbumCover(photoId:string){if(!albumInfo)return;try{await api('/albums/'+albumInfo.id,'PATCH',{cover_photo_id:photoId});notify(t("已设为影集封面"))}catch(e){notify(message(e))}}
  const ratingChange=useRef(0);
  async function updateRating(photoId:string,rating:number|null){if(!scopeAvailable)return;ratingChange.current++;try{const result=await api<Photo>('/photos/'+photoId,'PATCH',{rating});setDetail(current=>current?.id===photoId?result:current);inspector.update(result);setCache(current=>current[photoId]?{...current,[photoId]:result}:current);if(sort==='rating'||filters.rating!==undefined||albumInfo?.type==='rule'||filters.query||filters.facets||Object.keys(scopeState.base).length>0)reload();}catch(e){notify(message(e))}}
  async function updateColorLabel(photoId:string,color:string|null){if(!scopeAvailable)return;try{const result=await api<Photo>('/photos/'+photoId,'PATCH',{color_label:color||'none'});setDetail(current=>current?.id===photoId?result:current);inspector.update(result);setCache(current=>current[photoId]?{...current,[photoId]:result}:current);if(filters.color_label!==undefined||albumInfo?.type==='rule'||filters.query||filters.facets||Object.keys(scopeState.base).length>0)reload();}catch(e){notify(message(e))}}
  const inspector=usePhotoInspector(page+':'+JSON.stringify(filters),['photos','timeline','faces'].includes(page),!!detail||importOpen||showShortcuts||batchEditOpen);
  const inspectorKeyboard=useRef(false);
  useEffect(()=>{if(inspector.visible&&inspectorKeyboard.current){inspectorKeyboard.current=false;document.querySelector<HTMLButtonElement>('#photo-inspector header button')?.focus();}},[inspector.visible]);
  function closeInspector(){const restore=!!document.activeElement?.closest('#photo-inspector');inspector.close();if(restore)requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.photo-inspector-tab')?.focus({preventScroll:true}));}
  async function refreshRating(photoId:string){
    const ticket=++ratingChange.current;
    try{
      const result=await api<{photo:Photo;status:'updated'|'protected'|'not_found'|'changed'}>('/photos/'+photoId+'/rating/refresh','POST');
      if(ticket!==ratingChange.current){reload();return;}
      const values={rating:result.photo.rating,rating_source:result.photo.rating_source};
      setDetail(current=>current?.id===photoId?{...current,...values}:current);inspector.patch(photoId,values);setCache(current=>current[photoId]?{...current,[photoId]:{...current[photoId],...values}}:current);
      if(sort==='rating'||filters.rating!==undefined||albumInfo?.type==='rule'||filters.query||filters.facets||Object.keys(scopeState.base).length>0)reload();
      notify(t({updated:'已从 XMP 更新评分',protected:'保留人工或旧记录评分，未覆盖',not_found:'未找到有效的 XMP 评分，原评分保留',changed:'评分已在读取期间改变，保留最新操作'}[result.status]));
    }catch(e){notify(message(e));}
  }
  const metadataRequests=useRef(new Map<string,number>()),metadataSerial=useRef(0);
  async function saveMetadata(photoId:string,changes:import('./core/photo-annotation').MetadataChanges){
    if(!scopeAvailable)throw new Error('Invalid photo scope.');
    const group=Object.hasOwn(changes,'user_description')?'description':'tags',key=photoId+':'+group,ticket=++metadataSerial.current;metadataRequests.current.set(key,ticket);
    try{
    const result=await api<Photo>('/photos/'+photoId,'PATCH',changes);
    if(metadataRequests.current.get(key)!==ticket)return;
    const values=group==='description'?{user_description:result.user_description,description:result.description,description_source:result.description_source}:{tags:result.tags,tag_origins:result.tag_origins,rejected_ai_tags:result.rejected_ai_tags};
    inspector.patch(photoId,values);setDetail(current=>current?.id===photoId?{...current,...values}:current);setCache(current=>current[photoId]?{...current,[photoId]:{...current[photoId],...values}}:current);reload();
    }finally{if(metadataRequests.current.get(key)===ticket)metadataRequests.current.delete(key);}
  }
  function photoInformation(photo:Photo,inViewer=false){return <PhotoInformation photo={photo} notify={notify} onLocationSaved={reload} tagInputRef={inViewer?tagInputRef:undefined}
    onMetadata={changes=>saveMetadata(photo.id,changes)} flagSaving={flagSaving||!!viewer.pendingID} onFlag={flag=>void updateFlags([photo.id],flag)} onRefreshRating={()=>refreshRating(photo.id)} onFavorite={()=>void favorite(photo)} onWatermark={()=>watermark([photo.id])}
    onWatercolor={()=>{setSelected(new Set([photo.id]));closeViewer();void navigate('watercolor','',photo.id);}}
    onWorks={()=>{closeViewer();void navigate('watermark-gallery','',photo.id);}} onSettings={()=>{closeViewer();setPage('settings');}}
    canSetCover={!!albumInfo} onSetCover={()=>void setAlbumCover(photo.id)} onRating={rating=>void updateRating(photo.id,rating)} onColor={color=>void updateColorLabel(photo.id,color)}
    onTags={async tags=>{try{await saveMetadata(photo.id,{tags});notify(t('标签已保存'));}catch(error){notify(message(error));}}}
    onRemove={()=>void remove([photo.id])} onOriginal={browserOriginal}/>;}
  const countMode=preferences?.count_mode||'capture';
  useEffect(()=>{if(mobile){setViewerPlaying(false);setExhibit('normal');setAtmosphere(false);setIntro(false);if(document.fullscreenElement?.closest('.photo-viewer'))void document.exitFullscreen().catch(()=>{})}},[mobile]);
  useEffect(()=>{if(mobile||filmMode||!atmosphere||sessionStorage.getItem('aperture-intro')||matchMedia('(prefers-reduced-motion: reduce)').matches)return;sessionStorage.setItem('aperture-intro','1');setIntro(true);const timer=setTimeout(()=>setIntro(false),2100);return()=>{clearTimeout(timer);setIntro(false)}},[atmosphere,mobile,filmMode]);
  useLayoutEffect(()=>{const active=document.querySelector<HTMLButtonElement>('.viewer-filmstrip button.active'),owner=thumbFocusOwner.current;thumbFocusOwner.current=null;active?.scrollIntoView({block:'nearest',inline:'center'});if(active&&owner&&(document.activeElement===owner||!owner.isConnected&&document.activeElement===document.body))active.focus({preventScroll:true});},[detail?.id]);
  useEffect(()=>{if(!detail){setViewerPlaying(false);setExhibit('normal');setViewerProof(false)}},[detail?.id]);
  const detailIndex=detail?ids.indexOf(detail.id):-1;
  useNeighborPreviews(detail?.id||'',ids,!!detail&&!filmMode&&!viewer.pendingID);
  function stepPhoto(direction:number){const base=ids.indexOf(viewer.requested.current||detail?.id||''),index=base>=0?base:detailIndex;const target=filmMode?ids[(index+direction+ids.length)%ids.length]:ids[index+direction];if(index>=0&&target&&(target!==detail?.id||viewer.requested.current!==detail?.id))void openId(target);}
  function filmFullscreen(){const modal=viewerRef.current?.closest<HTMLElement>('.modal');if(!modal)return;const focus=()=>requestAnimationFrame(()=>modal.querySelector<HTMLElement>('.film-stage')?.focus());if(document.fullscreenElement===modal)focus();else void modal.requestFullscreen().catch(()=>{}).finally(focus)}
  function changeExhibit(mode:typeof exhibit){if(mode==='rail')setViewerProof(false);setExhibit(mode);setViewerPlaying(false);if(mode==='rail'){setViewerInfo(false);setIntro(false);filmFullscreen()}else if(exhibit==='rail'&&document.fullscreenElement)void document.exitFullscreen().catch(()=>{})}
  useEffect(()=>{if(!filmMode)return;const modal=viewerRef.current?.closest('.modal');let entered=document.fullscreenElement===modal;const changed=()=>{if(document.fullscreenElement===modal)entered=true;else if(entered){setExhibit('normal');setViewerPlaying(false)}};document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed)},[filmMode]);
  useEffect(()=>{if(mobile||exhibit==='rail'||!detail||!viewerPlaying||detailIndex<0||ids.length<2||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const timer=setTimeout(()=>void openId(ids[(detailIndex+1)%ids.length]),5200);return()=>clearTimeout(timer)},[detail?.id,viewerPlaying,detailIndex,ids,mobile,exhibit]);

  async function showAgentPhotos(requested:string[]){
    const response=await api<{photos:Photo[]}>('/photos/by-ids','POST',{ids:requested}),found=new Set(response.photos.map(p=>p.id)),shown=requested.filter(id=>found.has(id)),missing=requested.filter(id=>!found.has(id));
    if(!shown.length)return {shown,missing};
    const store=await createPreferenceStore(),target=analysisBrowse(store.libraryId,{},'file','query');
    const allowed=await navigate('photos','','',true,undefined,target);
    if(!allowed)throw new Error(bt('已取消界面跳转，未改变当前编辑。','Navigation cancelled. Current edits are unchanged.'));
    setSelected(new Set(shown));setFlagReveal({id:shown[0],token:++flagToken.current});
    return {shown,missing};
  }
  return <CameraNamesProvider><PhotoSimilarityProvider scope={page+':'+JSON.stringify(filters)} onOpenPhoto={photo=>void open(photo)} onColor={color=>void browse({...filters,analyzed_color:color},galleryCountMode,'query')} onSettings={()=>{closeViewer();void navigate('settings');}}><PhotoHoverContext.Provider value={inspector.actions}><div className={'app-shell workspace-shell '+(IS_BROWSER?'browser-shell ':'')+(page==='home'?'home-shell ':'')} data-lang={lang} onDragOver={e=>{e.preventDefault();if(e.dataTransfer.types.includes('Files'))setDragging(true)}} onDrop={drop} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false)}}>
    <a className="skip-link" href="#workspace-content">{t('跳到主要内容')}</a>

    <AgentBridge selected={selected} view={page} show={showAgentPhotos} onChanged={reload} notify={notify}/><main className="main-workspace"><header className="topbar"><button className="archive-wordmark" onClick={()=>setPage("home")}><MediaImage src="/icon-192.png" alt=""/><span>{t("光影集")}<small>THE PHOTO ARCHIVE</small></span></button><nav className="home-nav" aria-label={t("快捷导航")}>{IS_BROWSER?(['home','photos','albums','tools'] as const).map((id,i)=><button key={id} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}>{[bt('首页','Home'),bt('作品','Photographs'),bt('影集','Collections'),bt('工具','Tools')][i]}</button>):navigation.filter(n=>["photos","albums","watermark-gallery","reports"].includes(n.id)).map(item=><button key={item.id} onClick={()=>setPage(item.id)}>{t(item.label)}</button>)}</nav><div className="breadcrumb">{t('照片工作室')}<ChevronRight size={14}/><b>{t(page==='home'?'摄影空间':page==='settings'?'设置':navigation.find(n=>n.id===page)?.label||'')}</b></div><div className="topbar-actions"><button className="photography-space-link" aria-current={page==='home'?'page':undefined} onClick={()=>setPage('home')}><Home size={16}/>{t('摄影空间')}</button><button className="icon" aria-label={t("切换主题")} title={theme==='dark'?t("切换到亮色主题"):t("切换到暗色主题")} onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={16}/>:<Moon size={16}/>}</button><ActivityCenter notify={notify} onAnnotateImport={id=>{setAIImportId(id);setPage('ai-studio')}}/><span className="recent-wrap"><button className={'icon '+(recentOpen?'active':'')} aria-label={t("最近操作")} title={t("最近操作")} onClick={()=>{setRecent(getRecent());setRecentOpen(v=>!v)}}><History size={16}/></button>{recentOpen&&<div className="recent-panel"><header><b>{t('最近操作')}</b>{!!recent.length&&<button className="quiet" onClick={()=>{clearRecent();setRecent([])}}>{t('清空')}</button>}</header>{recent.length?recent.map((op,i)=><button key={i} className="recent-item" onClick={()=>{setRecentOpen(false);if(op.kind==='draft'&&op.payload?.draft)void navigate('watermark',op.payload.draft);else if(op.kind==='export')void openRecentExport(op);else browse({})}}>{op.kind==='import'?<Upload size={13}/>:op.kind==='export'?<Download size={13}/>:<Frame size={13}/>}<span>{t(op.label)}<small>{new Date(op.time).toLocaleString(getLocale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></span></button>):<p className="muted">{t('暂无记录')}</p>}</div>}</span><span className="local-pill"><span/>LOCAL FIRST</span><button className="primary" aria-label={t("导入照片")} onClick={()=>setImportOpen(true)}><Plus size={16}/>{t('导入照片')}</button></div></header>
    <WorkspaceNavigation items={[
      {id:'tools',label:'创作工具',icon:SlidersHorizontal,active:['tools','darkroom'].includes(page),select:()=>setPage('tools')},
      ...navigation.filter(item=>!IS_BROWSER||!['faces','smart'].includes(item.id)).map(item=>({...item,active:page===item.id,select:()=>setPage(item.id)})),
      {id:'favorite',label:'我的收藏',icon:Heart,active:page==='photos'&&(scopeState.base.favorite==='true'||filters.favorite==='true'),select:()=>void browse({favorite:'true'},countMode,'favorite')},
      {id:'settings',label:'设置',icon:SettingsIcon,active:page==='settings',select:()=>setPage('settings')}
    ]}/>
    <PageTransition page={page}><div className="page-content" id="workspace-content" tabIndex={-1}>{page==="home"&&(IS_BROWSER?<Suspense fallback={<p role="status">{bt("正在读取…","Loading…")}</p>}><BrowserShowcase onBrowse={browse} onPage={setPage} onImport={()=>setImportOpen(true)} onOpen={open} notify={notify}/></Suspense>:<HomePage onBrowse={browse} onPage={setPage} onImport={()=>setImportOpen(true)} onOpen={open} notify={notify}/>)}{["tools","darkroom"].includes(page)&&<Suspense fallback={<p role="status">{bt("正在读取…","Loading…")}</p>}><ToolsPage onCollage={()=>setCollagePhotos([])} key={page+':'+draftPhotoFilter} mode={page as "tools"|"darkroom"} photoId={draftPhotoFilter} onPage={setPage} onSend={target=>void navigate(target.page,target.kind==='draft'?target.id:"",target.kind==='photo'?target.id:"")} guard={editorGuard} notify={notify}/></Suspense>}{page==='photos'&&<><div className="gallery-heading"><div><span className="eyebrow">YOUR MOMENTS, WELL KEPT</span><h1>{t(scopeState.base.person_id&&!scopedAlbumId?'人物照片':(scopeState.base.favorite==='true'||filters.favorite==='true')?'我的收藏':scopedAlbumId?'影集照片':'所有照片')}<span>{total.toLocaleString()}</span></h1><p>{t('每一次按下快门，都是值得留下的瞬间。')}</p></div><div className="gallery-tools"><SearchBox value={String(filters.text||filters.filename||filters.search||filters.semantic||'')} literalField={filters.text?'text':filters.filename||filters.search?'filename':undefined} options={options} tagScope={clearTemporary(filters)} revision={revision} onFilter={filter} onSearch={(mode,text)=>void submitSearch(mode,text)}/><button className={showFilters?'active':''} onClick={()=>setShowFilters(v=>!v)}><SlidersHorizontal size={16}/>{t('筛选')}</button></div></div>
    <QueryScopeBar scope={scopeState.value} base={scopeState.base} collection={albumInfo?.name} error={scopeState.error} failed={!!fatal} onExit={()=>void browse({})} person={livePerson.data} personError={livePerson.error} personRefreshing={livePerson.loading} onPersonRefresh={livePerson.refresh} personAlbumId={albumInfo?.person_id} onBrowsePerson={id=>void browse({person_id:id},galleryCountMode,'person')}/>
    <div className="library-toolbar"><div className="button-row">{historyLen>0&&<button className="quiet" onClick={undoFilter} title={t("返回上次筛选")}><Undo2 size={14}/>{t('上次筛选')}</button>}{preferences?.scan_paths?.length ? <button className="quiet" onClick={scanNow}><FolderOpen size={15}/>{t('同步目录')}</button> : null}<button className="quiet" onClick={()=>setSelected(new Set([...selected,...visiblePhotoIds.current]))}><Check size={15}/>{t('选择可见')}</button>{selected.size>0&&scopeAvailable&&<>{<button className="quiet" onClick={()=>void navigate('darkroom','',[...selected][0])}>{bt('光影暗房','Lumina Darkroom')}</button>}<button className="quiet" onClick={()=>setCollagePhotos([...selected])}>{bt('照片拼图','Photo collage')}</button><b className="selection-count">{t('已选')} {selected.size}</b><button className="quiet" onClick={()=>setPage('watermark')}>{t('制作水印')}</button><button className="quiet" onClick={()=>setPage('albums')}>{t('收入影集')}</button>{selected.size>=2&&selected.size<=4&&<button className="quiet" onClick={startCompare}><GitCompare size={14}/>{t('对比')}</button>}<button className="quiet" onClick={()=>{setBatchEditIds([...selected]);setBatchEditOpen(true)}}><PenLine size={14}/>{t('批量编辑')}</button><button className="quiet danger" onClick={()=>remove([...selected])}>{t('移出图库')}</button><button className="icon" aria-label={t("清空选择")} onClick={()=>setSelected(new Set())}><X size={15}/></button></>}</div><div className="button-row"><CommandMenu surface={appCommands} ids={['flagPick','flagReject','flagClear','selectAll','exportSel','remove','help']} label={bt('照片操作菜单','Photo actions')}/><label className="grid-range" title={t("调整网格大小")}><Images size={15}/><input aria-label={t("网格大小")} type="range" min={150} max={380} value={grid} onChange={e=>setGrid(Number(e.target.value))}/></label><span className="display-settings"><button className={'icon '+(gridPanel?'active':'')} aria-label={t("网格显示设置")} title={t("网格显示设置")} onClick={()=>setGridPanel(v=>!v)}><LayoutGrid size={15}/></button>{gridPanel&&<div className="display-panel"><label>{t("浏览布局")}<select aria-label={t("浏览布局")} value={layout} onChange={e=>setLayout(e.target.value as GalleryLayout)}><option value="justified">{t("保持构图 · 拼排行")}</option><option value="grid">{t("规则网格")}</option><option value="tiles">{t("紧凑拼贴")}</option><option value="waterfall">{t("瀑布流")}</option></select></label><label>{t("间距")}<input type="range" min={8} max={36} value={gridPrefs.gap??14} onChange={e=>setGridPrefs(p=>({...p,gap:Number(e.target.value)}))}/></label><label>{t("圆角")}<input type="range" min={0} max={18} value={gridPrefs.radius??6} onChange={e=>setGridPrefs(p=>({...p,radius:Number(e.target.value)}))}/></label><label className="check"><input type="checkbox" checked={!!gridPrefs.dense} onChange={e=>setGridPrefs(p=>({...p,dense:e.target.checked}))}/>{t("紧凑模式（隐藏卡片说明）")}</label></div>}</span><select aria-label={t("照片排序")} className="sort-select" value={sort} onChange={e=>{setSort(e.target.value);setPageNumber(1)}}>{albumInfo&&albumInfo.type!=='rule'&&<option value="manual">{galleryCountMode==='file'?bt('影集顺序','Collection order'):t('影集排序（可拖拽）')}</option>}<option value="date_taken">{t('拍摄时间')}</option><option value="created_at">{t('导入时间')}</option><option value="file_name">{t('文件名称')}</option><option value="rating">{t('评分')}</option></select><button className="icon" title={t("切换升降序")} onClick={()=>setDirection(d=>d==='desc'?'asc':'desc')}><ArrowUpDown size={15}/></button></div></div>
    {showFilters&&!scopeState.error&&<><FacetBar filters={filters} revision={revision+flagRevision} onChange={next=>{searchGeneration.current++;pushHistory(filters);setFilters(next);setPageNumber(1)}}/><label className="facet-file-type">{t('文件类型')}<select aria-label={t('文件类型')} value={filters.file_type||''} onChange={e=>filter('file_type',e.target.value)}>{[['',t('全部')],['jpeg',bt('包含非 RAW','Includes non-RAW')],['raw','RAW'],['paired','RAW + JPG'],['raw_only',t('仅 RAW')],['jpeg_only',t('仅 JPG / 非 RAW')]].map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label></>}
    {!!Object.keys(temporary).length&&!scopeState.error&&<div className="filter-chips">{Object.entries(temporary).map(([key,value])=><button key={key} data-combined-facets={key==='facets'?true:undefined} onClick={()=>filter(key,'')}>{t(key==='facets'?bt('组合筛选','Combined filters'):filterNames[key]||key)}：{locationFilterLabel(key,value)??(key==='facets'?facetSummary(value):key==='rating'?value+' '+t('星'):key==='color_label'?t(({red:'红色',yellow:'黄色',green:'绿色',blue:'蓝色'}as Record<string,string>)[value]||value):value)}<X size={12}/></button>)}<button className="quiet" onClick={()=>{searchGeneration.current++;pushHistory(filters);setFilters(clearTemporary(filters));setPageNumber(1)}}>{t('清除筛选')}</button></div>}
    {fatal?<div className="error-box">{fatal}<button onClick={reload}>{t('重试')}</button></div>:loading?<p className="loading">{t('正在加载照片…')}</p>:ids.length?<><div className={'gallery-virtual'+(gridPrefs.dense?' dense':'')} style={{['--card-radius' as string]:(gridPrefs.radius??6)+'px'}}><VirtualGallery key={JSON.stringify([filters,sort,direction])} ids={ids} cache={cache} reveal={flagReveal} layout={layout} grid={grid} gap={gridPrefs.gap??14} dense={gridPrefs.dense} onNeed={(s,e)=>void loadWindow(s,e)} onRange={(s,e)=>{visibleRange.current=[s,e]}} onVisible={ids=>{visiblePhotoIds.current=ids}} renderCard={(photo,id)=>photo?<PhotoCard key={id} photo={photo} selected={selected.has(id)} onToggle={()=>toggle(id)} onOpen={()=>open(photo)} onFavorite={favorite} highlight={filters.search} dragHandle={albumInfo&&albumInfo.type!=='rule'&&galleryCountMode==='capture'&&sort==='manual'?{onStart:()=>{dragPhoto.current=id},onDrop:()=>void movePhoto(id)}:undefined}/>:<div className="vg-placeholder" data-photo-id={id}/>}/></div><p className="vg-total">{t('共')} {total.toLocaleString()} {galleryCountMode==='file'?bt('个文件 · 已加载','files · loaded'):t('次拍摄 · 已加载')} {Object.keys(cache).length}</p></>:<Empty title={t(Object.keys(temporary).length||Object.keys(scopeState.base).length?'没有符合条件的照片':'从第一张照片开始')} action={<button className="primary" onClick={()=>setImportOpen(true)}><Plus size={16}/>{t('导入照片')}</button>}>{t(Object.keys(filters).length?'试试调整筛选条件。':'选择原始照片或整个目录。我们只登记路径，为你整理光圈、焦段和每一次拍摄。')}</Empty>}</>}
    {page==='ai-studio'&&<AIStudio ids={[...selected]} importJobId={aiImportId} notify={notify} guard={editorGuard} onBrowse={value=>{void browse(value,'file','query')}}/>}
    {page==='watercolor'&&<ArtPage photoId={draftPhotoFilter||[...selected][0]||''} notify={notify} guard={editorGuard} onWatermark={id=>void navigate('watermark',id)}/>}{page==='stats'&&<StatsPage onBrowse={value=>void browse(value,countMode,'stats')} notify={notify} countMode={countMode} sourceFilters={filters}/>}{page==='reports'&&<ReportsPage onBrowse={value=>void browse(value,countMode,'reports')} notify={notify} countMode={countMode} sourceFilters={filters} lenses={(options.lens_model||[]).map(String)}/>}{(page==='albums'||page==='smart')&&<AlbumsPage key={page} smart={page==='smart'} selectedIds={[...selected]} onBrowse={browse} onOpenPhoto={open} notify={notify} ai={ai}/>}{page==='timeline'&&<TimelinePage notify={notify} onOpenPhoto={open} flagRevision={flagRevision} countMode={countMode} sourceFilters={filters}/>}{page==='compare'&&<ComparePage ids={compareIds} notify={notify} onClose={()=>setPage('photos')}/>}{page==='faces'&&!IS_BROWSER&&<FacesPage notify={notify} onOpenPhoto={(photo,id,current)=>void open(photo,id?{person_id:id}:undefined,current)} onBrowse={value=>void browse(value,countMode,'person')}/>}{page==='watermark'&&<WatermarkPage draftId={draftId} onSaved={draftSaved} guard={editorGuard} ids={IS_BROWSER&&draftPhotoFilter?[draftPhotoFilter]:[...selected]} onChoose={()=>setPage('photos')} onJob={j=>{setJob(j);setJobExpanded(true)}} notify={notify}/>}{page==='watermark-gallery'&&<WatermarkGalleryPage photoId={draftPhotoFilter} revision={revision} onEdit={id=>void navigate('watermark',id)} onChoose={()=>setPage('photos')} onJob={j=>{setJob(j);setJobExpanded(true)}} notify={notify}/>}{page==='locations'&&<Suspense fallback={<p role="status">{bt('正在读取地图…','Loading map…')}</p>}><LocationsPage countMode={countMode} sourceFilters={filters} revision={revision} onBrowse={value=>void browse(value,countMode,'query')} onOpen={open} notify={notify}/></Suspense>}{page==='videos'&&<Suspense fallback={<p role="status">{bt('正在读取视频…','Loading videos…')}</p>}><VideoPage notify={notify}/></Suspense>}{page==='settings'&&<SettingsPage onPage={setPage} mobile={mobile} ai={ai} notify={notify} onSaved={reload} onScan={scanNow} lang={lang} onLang={l=>{setStoredLang(l);setLang(l)}}/>}</div></PageTransition>
    <footer className="app-footer"><span>{t("光影集 ")}<i> / </i> {t('为看见而收藏')}</span><span>{t(page==='watercolor'?'水彩 AI 按需连接云端':ai?.status==='ready'?'本地语义索引就绪':'照片仅在本机处理')}<span className="footer-dot"/></span></footer></main>
    {['photos','timeline','faces'].includes(page)&&!detail&&<>
      {!inspector.visible&&<button className="photo-inspector-tab icon" aria-label={t('显示照片信息')} aria-controls="photo-inspector" aria-expanded={false} disabled={!inspector.photo&&!Object.keys(cache).length} onClick={event=>{inspectorKeyboard.current=event.detail===0;const photo=inspector.photo||cache[[...selected][0]]||cache[ids[visibleRange.current[0]]]||Object.values(cache)[0];if(photo)inspector.show(photo);}}><Info size={18}/></button>}
      {inspector.visible&&inspector.photo&&<aside id="photo-inspector" className="photo-inspector" aria-label={t('悬停照片信息')}><header><h2>{t('照片信息')}</h2><button className="icon" aria-label={t('关闭照片信息')} onClick={closeInspector}><X size={18}/></button></header><div className="photo-inspector-content"><MediaImage mediaPriority={1} className="inspector-preview" src={inspector.photo.preview_url} alt={inspector.photo.file_name}/><h3 className="inspector-file-name">{inspector.photo.file_name}</h3>{inspector.loading&&<p role="status">{t('正在读取照片信息…')}</p>}{inspector.error&&<p className="error-box" role="alert">{inspector.error}</p>}<button className="quiet" onClick={()=>void open(inspector.photo!)}>{t('打开照片')}</button>{photoInformation(inspector.photo)}</div></aside>}
    </>}
    {onboarding&&<Modal title={t('欢迎来到光影集')} onClose={finishOnboarding}><div className="import-content"><p className="muted">{t('本地优先的照片库：原图保留在原位置，检索与整理在本机完成。使用水彩 AI 时，仅在你点击后上传选中的照片。')}</p><div className="import-choices"><button onClick={()=>{finishOnboarding();setImportOpen(true)}}><Images size={28}/><b>{t('导入第一批照片')}</b><small>{t('文件 / 文件夹')}</small></button><button onClick={()=>{finishOnboarding();setShowShortcuts(true)}}><Keyboard size={28}/><b>{t('了解快捷键')}</b><small>{t('按 ? 随时查看')}</small></button></div><p className="muted">{t('小提示：搜索框支持自然语言，例如「上个月用 50mm 拍的照片」；悬停照片卡片可快速预览大图与参数；进入影集后可拖拽调整顺序。')}</p><footer className="modal-footer"><button className="primary" onClick={finishOnboarding}>{t('开始使用')}</button></footer></div></Modal>}
    {importOpen&&<Modal className="photo-import" title={t("导入你的照片")} onClose={()=>setImportOpen(false)}><div className="import-content"><p className="muted">{IS_BROWSER?bt('选择照片会保存副本到图库；选择文件夹仅登记原图路径。自动去重，不上传照片。','Selected files are copied into the library; folders keep links to originals. Duplicates are skipped. No uploads.'):t('选择本地文件或文件夹，仅登记原图路径，自动去重并读取 EXIF。')}</p>{IS_BROWSER&&<input ref={importFileInput} hidden type="file" multiple accept={photoFileAccept} aria-label={bt('导入照片文件','Import photo files')} onChange={e=>{const files=Array.from(e.target.files||[]);if(files.length){setImportFiles(files);setPaths('');}e.target.value='';}}/>}<div className="import-choices"><button disabled={importBusy} onClick={()=>pick('files')}><Images size={28}/><b>{t('选择照片')}</b><small>{t('单张 / 多张')}</small></button><button disabled={importBusy} onClick={()=>pick('directory')}><FolderOpen size={28}/><b>{t('选择文件夹')}</b><small>{t('整目录扫描')}</small></button></div><label style={IS_BROWSER?{display:"none"}:undefined}>{t("也可以粘贴绝对路径（每行一个）")}<textarea rows={4} placeholder={'D:\\Photos\\2026\nD:\\Photos\\DSC00125.ARW'} value={paths} onChange={e=>setPaths(e.target.value)}/></label>{IS_BROWSER&&<p className="muted">{importFiles.length&&!importCounts.photos?bt('XMP 文件需要与对应照片一同选择。','Select XMP files together with their photos.'):importFiles.length?bt(`已选择 ${importCounts.photos} 张照片${importCounts.xmp>0?'及 '+importCounts.xmp+' 个 XMP 侧文件':''}，可以开始导入。`,`Selected ${importCounts.photos} photo${importCounts.photos===1?'':'s'}${importCounts.xmp>0?' and '+importCounts.xmp+' XMP sidecar'+(importCounts.xmp===1?'':'s'):''}. Ready to import.`):paths?bt('原片目录已选择，可以开始导入。','Original directory selected. Ready to import.'):bt('请选择多张照片或原片目录。所有处理都在本机完成。','Select photos or an original directory. All processing stays local.')}</p>}<label className="check"><input type="checkbox" disabled={IS_BROWSER&&importFiles.length>0} checked={recursive} onChange={e=>setRecursive(e.target.checked)}/>{t('包含子文件夹')}</label><p className="muted">{IS_BROWSER?bt('JPEG · PNG · WebP · AVIF · HEIF · TIFF · RAW；可同选 XMP。RAW 支持取决于解码器；同目录、同名且元数据一致的 RAW + JPEG 可合并为一次拍摄。','JPEG · PNG · WebP · AVIF · HEIF · TIFF · RAW; select XMP sidecars together. RAW support depends on the decoder. Matching RAW + JPEG files in the same folder can form one capture.'):<>JPG · PNG · TIFF · HEIC / HEIF · RAW<br/>{t("RAW + JPG 自动合并显示；RAW 解码失败时保留文件和 EXIF 记录。")}</>}</p><footer className="modal-footer"><button onClick={()=>setImportOpen(false)}>{t('取消')}</button><button className="primary" disabled={importBusy} onClick={runImport}><Upload size={16}/>{t(importBusy?'请稍候…':'开始导入')}</button></footer></div></Modal>}
    {detail&&<Modal title={detail.file_name} onClose={closeViewer} wide className={'photo-viewer'+(filmMode?' film-viewer':'')}><div className={'photo-detail exhibit-'+(mobile?'normal':exhibit)+(viewerInfo?' show-info':'')+(!filmMode&&viewerProof?' proofing':'')+(!mobile&&!filmMode&&atmosphere?' atmosphere':'')+(!mobile&&viewerPlaying?' is-playing':'')} onPointerMove={filmMode?e=>{const rect=e.currentTarget.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,viewer=e.currentTarget.closest<HTMLElement>('.photo-viewer');if(viewer)viewer.dataset.filmEdge=y<76?'top':y>rect.height-84?'bottom':x<84?'left':x>rect.width-84?'right':''}:undefined} onPointerLeave={e=>{const viewer=e.currentTarget.closest<HTMLElement>('.photo-viewer');if(viewer)delete viewer.dataset.filmEdge}}><div className="viewer-main"><div className="viewer-toolbar">{<button onClick={()=>{closeViewer();void navigate('darkroom','',detail.id)}}><SlidersHorizontal size={16}/>{bt('编辑照片','Edit photo')}</button>}<span className="viewer-counter">{detailIndex>=0?detailIndex+1:1} / {detailIndex>=0?ids.length:1}</span><button aria-label={t("照片信息")} aria-expanded={viewerInfo} className={viewerInfo?'active':''} onClick={()=>setViewerInfo(v=>!v)}><Info size={18}/><span>{t("照片信息")}</span></button><button aria-label={t("收藏 ")+detail.file_name} aria-pressed={detail.favorite} onClick={()=>favorite(detail)}><Heart size={18} fill={detail.favorite?'currentColor':'none'}/></button>{!mobile&&<><button aria-label={t(viewerPlaying?'暂停展映':'播放展映')} aria-pressed={viewerPlaying} onClick={()=>{if(!viewerPlaying){if(filmMode)filmFullscreen();else viewerCommands.current?.fit();setViewerPlaying(true)}else setViewerPlaying(false)}}>{viewerPlaying?<Pause size={18}/>:<Play size={18}/>}</button><button aria-label={t("全屏")} onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void viewerRef.current?.closest('.modal')?.requestFullscreen().catch(e=>notify(message(e)))}}><Maximize size={18}/></button></>}<CommandMenu surface={appCommands} ids={['prev','next','favorite','tag','viewerZoomIn','viewerZoomOut','viewerFit','viewerActual','viewerProof','remove','help']} label={bt('查看操作菜单','View actions')}/></div><div ref={viewerRef} className="detail-image" aria-busy={!!viewer.pendingID||display.pending||(detail.preview_status==='pending'&&!display.source)} data-display-preview={display.ready?'ready':display.pending?'pending':display.error?'error':'standard'} style={{['--ambient-image' as string]:detailMedia.url?`url("${detailMedia.url}")`:"none"}} onTouchStart={e=>{touchStart.current=e.touches.length===1&&!viewerCommands.current?.canPan?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null}} onTouchEnd={e=>{const start=touchStart.current;if(start&&!viewerCommands.current?.canPan){const dx=e.changedTouches[0].clientX-start.x,dy=e.changedTouches[0].clientY-start.y;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)stepPhoto(dx<0?1:-1)}touchStart.current=null}}>{filmMode?<FilmTrain ids={ids} current={detail} cache={cache} playing={viewerPlaying} speed={railSpeed} onAdvance={()=>openId(ids[(detailIndex+1)%ids.length],detail.id).then(ok=>{if(!ok)setViewerPlaying(false);return ok})}/>:<ViewerPicture stage={viewerRef} commands={viewerCommands} photo={detail} source={display.source} onInteract={()=>setViewerPlaying(false)} onProof={setViewerProof} pinned={viewerPreferences.pinned} onPin={pinned=>updateViewerPreferences({pinned})}/>}{!mobile&&exhibit==='snow'&&<div className="snow-layer" aria-hidden="true">{Array.from({length:18},(_,i)=><i key={i} style={{left:(i*37%100)+'%',animationDelay:-(i*.7)+'s',animationDuration:(8+i%5)+'s'}}/>)}</div>}{!mobile&&!filmMode&&atmosphere&&<><span className="shutter-flash" key={detail.id} aria-hidden="true"/><span className="film-grain" aria-hidden="true"/></>}{!mobile&&!filmMode&&intro&&<div className="aperture-intro"><Aperture size={100}/><span>THE PHOTO ARCHIVE</span><button onClick={()=>setIntro(false)}>{t("跳过开场")}</button></div>}{!mobile&&!filmMode&&atmosphere&&<span className="viewfinder" aria-hidden="true"><i/></span>}{detailIndex>=0&&<><button className="viewer-prev" aria-label={t("上一张")} {...appCommands.props('prev')}><ChevronLeft size={26}/></button><button className="viewer-next" aria-label={t("下一张")} {...appCommands.props('next')}><ChevronRight size={26}/></button></>}</div><div className="viewer-caption"><b>{detail.file_name}</b><Parameters photo={detail}/></div>{detailIndex>=0&&!filmMode&&<div className="viewer-filmstrip" role="navigation" aria-label={bt('胶片导航','Filmstrip navigation')} onKeyDown={event=>{
      const action=shortcutAction(event.nativeEvent,bindings,{scope:'viewer'});if(action==='prev'||action==='next')thumbFocusOwner.current=document.activeElement as HTMLElement;
      if(!action&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&(event.key==='Home'||event.key==='End')){event.preventDefault();event.stopPropagation();thumbFocusOwner.current=document.activeElement as HTMLElement;const target=event.key==='Home'?ids[0]:ids.at(-1);if(target&&target!==detail.id)void openId(target);}
    }}>{ids.slice(Math.max(0,detailIndex-8),detailIndex+9).map(id=><button key={id} className={id===detail.id?'active':''} aria-label={t("查看照片")+" "+(ids.indexOf(id)+1)} aria-pressed={id===detail.id} onClick={()=>void openId(id)}><MediaImage loading="lazy" src={photoURL(id,'thumbnail')} alt={cache[id]?.file_name||''}/></button>)}</div>}{!mobile&&<div className="exhibit-controls"><PreviewQualityControl edge={displayEdge} onChange={setDisplayEdge} disabled={filmMode||viewerPlaying} pending={display.pending} error={display.error} unsupported={display.unsupported} retry={display.retry}/><label>{t("展映模式")}<select aria-label={t("展映模式")} value={exhibit} onChange={e=>changeExhibit(e.target.value as typeof exhibit)}><option value="normal">{t("普通浏览")}</option><option value="aurora">{t("极光")}</option><option value="snow">{t("雪境")}</option><option value="rail">{t("胶片列车")}</option></select></label>{exhibit==='rail'&&<label>{t("列车速度")}<input aria-label={t("列车速度")} type="range" min={25} max={100} value={railSpeed} onChange={e=>setRailSpeed(Number(e.target.value))}/></label>}<label className="check"><input type="checkbox" checked={atmosphere} onChange={e=>setAtmosphere(e.target.checked)}/>{t("摄影氛围")}</label></div>}</div><aside aria-label={t("照片信息")}>{photoInformation(detail,true)}</aside></div></Modal>}
    {job&&(!IS_BROWSER||jobExpanded||['running','queued','failed','interrupted'].includes(job.status))&&<aside className={'job-panel '+(jobExpanded?'expanded':'')}><button className="job-summary" onClick={()=>setJobExpanded(v=>!v)}><span>{t(job.kind==='import'?'照片导入':'水印导出')}{job.phase==='previews'?' · '+t('生成预览'):''} · {t(job.status==='completed'?'已完成':job.status==='failed'?'失败':job.status==='cancelled'?'已取消':'处理中')}</span><b>{IS_BROWSER&&job.kind==='import'&&(job.status==='queued'||job.status==='running'&&job.phase==='scanning')?bt('正在统计照片…','Counting photos…'):<>{taskProgress(job).processed} / {taskProgress(job).total}</>}</b></button>{jobExpanded&&<div className="job-body"><progress value={IS_BROWSER&&job.kind==='import'&&(job.status==='queued'||job.status==='running'&&job.phase==='scanning')?undefined:taskProgress(job).indeterminate?undefined:taskProgress(job).processed} max={taskProgress(job).total||1}/><p>{t('成功')} {job.success} · {t('跳过')} {job.skipped} · {t('失败')} {job.failed}</p>{!!job.preview_failed&&<p className="muted">{t('预览失败 {0}；已登记照片保留，可再次导入补齐。',{0:job.preview_failed})}</p>}<small className="job-current">{t(job.current)}</small>{job.error&&<p className="error-box">{message(job.error)}</p>}{job.errors.length>0&&<details><summary>{t('查看错误')}</summary>{job.errors.map((error,i)=><p key={i} className="muted">{message(error)}</p>)}</details>}{job.results.length>0&&<div className="job-results">{job.results.map(result=><DownloadLink key={result.url} href={result.url} download={result.file_name}>{result.file_name} ↗</DownloadLink>)}</div>}{['running','queued'].includes(job.status)?<button className="danger" onClick={()=>api<Job>('/jobs/'+job.id+'/cancel','POST').then(setJob).catch(e=>notify(message(e)))}>{t('取消任务')}</button>:<button onClick={()=>setJob(null)}>{t('关闭任务')}</button>}</div>}</aside>}
    {toast&&<div role="status" className="toast">{t(toast)}<button className="icon" aria-label={t("关闭提示")} onClick={()=>setToast('')}><X size={15}/></button></div>}{dragging&&<div className="drop-overlay"><Upload size={48}/><h2>{t('拖入照片')}</h2><p>{t('松开后选择导入方式')}</p></div>}
    {collagePhotos&&<Suspense fallback={<p role="status">{bt("正在读取…","Loading…")}</p>}><CollageTool photoIds={collagePhotos} onClose={()=>setCollagePhotos(null)}/></Suspense>}
    {batchEditOpen&&<BatchEditDialog photoIds={batchEditIds} onClose={()=>setBatchEditOpen(false)} onComplete={()=>{reload();setSelected(new Set())}} notify={notify}/>}
    {showShortcuts&&<Modal title={t('键盘快捷键')} onClose={()=>setShowShortcuts(false)}><div className="batch-edit-content"><dl className="shortcuts-list">{Object.keys(ACTION_LABELS).map(a=><div key={a}><dt><kbd>{bindings[a]?displayKey(bindings[a]):t('未绑定')}</kbd></dt><dd>{t(ACTION_LABELS[a])}</dd></div>)}<div><dt><kbd>Esc</kbd></dt><dd>{t('关闭详情 / 弹窗')}</dd></div></dl><p className="muted">{t("可在「设置 · 键盘快捷键」中自定义按键。")}</p></div></Modal>}
  </div></PhotoHoverContext.Provider></PhotoSimilarityProvider></CameraNamesProvider>;
}
