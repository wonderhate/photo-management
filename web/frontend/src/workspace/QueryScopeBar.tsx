import type {FacetField} from '../core/photo-facets';
import {ArrowLeft,LockKeyhole} from 'lucide-react';
import {bt} from '../browser/text';
import {t} from '../i18n';
import type {QueryScope} from '../core/query-scope';
import type {Filters} from '../types';
import {facetSummary,facetValueLabel} from './FacetBar';
import './query-scope.css';
import {locationFilterLabel} from './location-filter-label';
import type {PersonScopeState} from './usePersonScope';
const names:Record<string,string>={location_country:'国家 / 地区',location_city:'城市',camera_make:'相机品牌',camera_model:'相机',lens_model:'镜头',favorite:'收藏',rating:'评分',flag:'选片标记',color_label:'颜色标签',tag:'标签',date_from:'起始日期',date_to:'结束日期',search:'文件名',text:'全部文字',filename:'文件名',semantic:'画面内容',orientation:'画幅',file_type:'文件类型',iso:'ISO',focal_length:'焦距',f_number:'光圈',exposure_seconds:'快门秒数'};
export default function QueryScopeBar({scope,base,collection,error,failed,onExit,person,personError='',personRefreshing=false,personAlbumId,onPersonRefresh,onBrowsePerson}:{scope:QueryScope|null;base:Filters;collection?:string;error:string;failed:boolean;onExit:()=>void;person?:PersonScopeState|null;personError?:string;personRefreshing?:boolean;personAlbumId?:string|null;onPersonRefresh?:()=>void;onBrowsePerson?:(id:string)=>void}){
  if(!scope&&!Object.keys(base).length&&!error)return null;
  const mode=scope?.mode||'capture',hasBase=Object.keys(base).length>0;
  const title=error?bt('检索范围无效','Invalid search scope'):base.album_id?collection||bt('当前影集','Current collection'):base.person_id?person?.name||bt('当前人物','Current person'):scope?.origin==='stats'?bt('统计图表范围','Statistics selection'):scope?.origin==='reports'?bt('摄影报告范围','Report selection'):base.favorite==='true'?bt('我的收藏','Favorites'):hasBase?bt('固定检索范围','Search selection'):bt('全部照片','All photos');
  const live=!!base.person_id&&!base.album_id,snapshot=!!base.album_id&&(scope?.origin==='person'||!!personAlbumId);
  const details=Object.entries(base).filter(([key])=>!['album_id','person_id','semantic_threshold'].includes(key)).map(([key,value])=>{
    const location=locationFilterLabel(key,value);if(location!==undefined)return bt('地点：','Location: ')+location;
    if(key==='query')return bt('固定照片条件','Fixed photo conditions');if(key==='facets')return facetSummary(value);
    const m=key.match(/^(.*)(_min|_max|_lt|_gt)$/),field=m?.[1]||key,op=m?({_min:' ≥ ',_max:' ≤ ',_lt:' < ',_gt:' > '} as Record<string,string>)[m[2]]:': ';
    const shown=key==='favorite'?value==='true'?bt('是','Yes'):bt('否','No'):['flag','orientation','color_label'].includes(key)?facetValueLabel(key as FacetField,value):value;return t(names[field]||field)+op+shown;
  }).join(' · ');
  return <section className="query-scope-bar" aria-label={bt('当前检索范围','Current search scope')} data-scope-origin={scope?.origin||'collection'} data-person-view={live?'live':snapshot?'snapshot':undefined}><div><LockKeyhole size={14}/><b>{title}</b><span>{mode==='file'?bt('按文件','Per file'):bt('按拍摄','Per capture')}</span></div>{details&&<p>{details}</p>}{error&&<p role="alert">{error}</p>}{(hasBase||error||failed)&&<button onClick={onExit}><ArrowLeft size={14}/>{bt('返回全部照片','All photos')}</button>}
    {live&&<div className="person-scope-note"><p>{bt('实时人物照片：随当前分组更新，包含待确认关联；已有影集保持快照。','Live person photos follow current groups, including unconfirmed links. Existing albums keep their saved members.')}{person&&<> {mode==='file'?bt(`人物范围：${person.total} 个文件。`,`Person scope: ${person.total} files.`):bt(`人物范围：${person.total} 次拍摄。`,`Person scope: ${person.total} captures.`)} {bt(`${person.pending} 张人脸待确认。`,`${person.pending} ${person.pending===1?'face':'faces'} awaiting confirmation.`)}</>}{person?.ignored&&<> {bt('该分组已忽略，此处仍可查看已有记录。','This group is ignored. Existing records remain available here.')}</>}</p>{onPersonRefresh&&<button disabled={personRefreshing} onClick={onPersonRefresh}>{bt('刷新人物匹配','Refresh person matches')}</button>}{person?.merged_into&&<button onClick={()=>onBrowsePerson?.(person.merged_into!.id)}>{bt('查看合并后的人物：','Open merged person: ')}{person.merged_into.name}</button>}{personError&&<p role="alert">{personError}</p>}</div>}
    {snapshot&&<div className="person-scope-note"><p>{bt('人物影集快照：保留已保存成员，新识别或重新分组的照片不会自动加入；仍可手动编辑影集。','Person album snapshot: saved members are preserved. New recognition or grouping does not add photos automatically. The album can still be edited manually.')}</p>{personAlbumId&&onBrowsePerson&&<button onClick={()=>onBrowsePerson(personAlbumId)}>{bt('查看实时人物照片','Open live person photos')}</button>}</div>}
  </section>;
}
