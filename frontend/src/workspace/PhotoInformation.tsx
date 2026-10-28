import RelinkOriginal from './RelinkOriginal';
import AssetRelationships from './AssetRelationships';
import SimilarPhotos from './PhotoSimilarity';
import PhotoLocation from './PhotoLocation';
import PhotoRawSource from './PhotoRawSource';
import OriginalFileActions from './OriginalFileActions';
import {useCameraName} from './CameraNames';
import {useEffect,useState} from 'react';
import type {RefObject} from 'react';
import {Trash2,Heart,Frame,PenLine,MapPin} from 'lucide-react';
import {t} from '../i18n';
import {bt} from '../browser/text';
import {IS_BROWSER} from '../runtime';
import {api,message} from '../api';
import {Parameters} from '../components';
import {RatingStars,ColorLabelPicker} from '../RatingColorLabel';
import type {Photo} from '../types';
import PhotoRatingSource from './PhotoRatingSource';
import PhotoFlagControls from '../PhotoFlagControls';
import type {PhotoFlag} from '../core/photo-flag';
import PhotoAnnotations from './PhotoAnnotations';
import type {MetadataChanges} from '../core/photo-annotation';

interface Props {
  photo:Photo;notify:(message:string)=>void;tagInputRef?:RefObject<HTMLInputElement|null>;
  onFavorite:()=>void;onWatermark:()=>void;onWatercolor:()=>void;onWorks:()=>void;onSettings:()=>void;
  canSetCover:boolean;onSetCover:()=>void;onRating:(rating:number|null)=>void;onColor:(color:string|null)=>void;
  onTags:(tags:string[])=>Promise<void>;onRemove:()=>void;onOriginal:(id:string,download:boolean)=>Promise<void>;
  onRefreshRating:()=>Promise<void>;
  onFlag:(value:PhotoFlag)=>void;flagSaving:boolean;
  onMetadata:(changes:MetadataChanges)=>Promise<void>;
  onLocationSaved?:()=>void;
}
export default function PhotoInformation({photo,notify,tagInputRef,onFavorite,onWatermark,onWatercolor,onWorks,onSettings,canSetCover,onSetCover,onRating,onColor,onTags,onRemove,onOriginal,onRefreshRating,onFlag,flagSaving,onMetadata,onLocationSaved}:Props){
  const displayCamera=useCameraName(photo.camera_make,photo.camera_model);
  const [tags,setTags]=useState(photo.tags.join('，'));
  const tagValue=photo.tags.join('，');
  useEffect(()=>setTags(tagValue),[photo.id,tagValue]);
  return <>
<PhotoFlagControls value={photo.flag} disabled={flagSaving} onChange={onFlag}/>
<div className="detail-heading"><small>{photo.camera_make||'CAMERA'}</small><h2>{displayCamera||t('相机未知')}</h2>{displayCamera&&displayCamera!==photo.camera_model&&<small title={bt('原始 EXIF 机型','Original EXIF model')}>{photo.camera_model}</small>}<p>{photo.lens_model||t('镜头信息未记录')}</p></div><Parameters photo={photo}/><p className="muted">{photo.date_taken?.replace('T',' ')||t('拍摄时间未知')}<br/>{photo.width||'—'} × {photo.height||'—'} px · {(photo.file_size/1024/1024).toFixed(1)} MB</p>{photo.missing&&(IS_BROWSER?<div className="error-box"><p>{bt('原片目录尚未授权或连接。打开图库不等于授权原片；这不表示照片已被删除。','The original folder needs access permission or reconnection. Opening the library does not grant access to originals; this does not mean the photos were deleted.')}</p><button onClick={()=>{onSettings()}}>{bt('前往原片授权设置','Open original folder access settings')}</button></div>:<p className="error-box">{t('原图已移动或删除。可重新导入新位置以按 hash 关联。')}</p>)}<div className="button-row"><button className={photo.favorite?'active':''} onClick={()=>onFavorite()}><Heart size={16}/>{t(photo.favorite?'已收藏':'收藏')}</button><button className="primary" onClick={()=>onWatermark()}><Frame size={16}/>{t('制作水印')}</button><button onClick={()=>{onWatercolor()}}><PenLine size={16}/>{t('水彩转绘')}</button>{canSetCover&&<button onClick={()=>onSetCover()}>{t('设为影集封面')}</button>}</div><div className="photo-rating-controls"><span>{t('评分')} <RatingStars rating={photo.rating??null} onChange={r=>onRating(r)}/></span><span>{t('标签')} <ColorLabelPicker color={photo.color_label??null} onChange={c=>onColor(c)}/></span></div><PhotoRatingSource key={photo.id} source={photo.rating_source} onRefresh={onRefreshRating}/><button className="quiet" onClick={()=>{onWorks()}}>{t('查看水印作品')} · {photo.watermark_draft_count||0}</button><PhotoAnnotations key={'notes:'+photo.id} photo={photo} notify={notify} onChange={onMetadata}/><label className="tag-editor">{t('标签')}<input ref={tagInputRef} value={tags} onChange={e=>setTags(e.target.value)} placeholder={t("人像，旅行，日落")}/><button onClick={()=>void onTags(tags.split(/[,，]/).map(value=>value.trim()).filter(Boolean))}>{t('保存标签')}</button></label><h4>{t('本次拍摄文件')} · {photo.files.length}</h4><div className="capture-files">{photo.files.map(file=><div key={file.id}><span className="format-badge inline">{file.file_format}</span><b title={file.file_path}>{file.file_name}</b><div><button onClick={()=>IS_BROWSER?void onOriginal(file.id,false):api('/photos/'+file.id+'/open','POST').catch(e=>notify(message(e)))}>{t('打开原图')}</button>{IS_BROWSER?<button onClick={()=>void onOriginal(file.id,true)}>{t('下载')}</button>:<a href={'/api/photos/'+file.id+'/original'} download>{t('下载')}</a>}{IS_BROWSER?<span title={file.file_path}>{bt('来源：','Source: ')+file.file_path}</span>:<button onClick={()=>api('/photos/'+file.id+'/reveal','POST').catch(e=>notify(message(e)))}>{t('文件位置')}</button>}<RelinkOriginal id={file.id} notify={notify} onRelinked={onLocationSaved}/><OriginalFileActions id={file.id} path={file.file_path} notify={notify} onDownload={()=>onOriginal(file.id,true)}/></div></div>)}</div>{photo.gps_latitude!==null&&<p className="muted"><MapPin size={13}/> {bt('原始 GPS：','Original GPS: ')} {photo.gps_latitude?.toFixed(5)}, {photo.gps_longitude?.toFixed(5)}</p>}<details><summary>{t('完整 EXIF')}</summary><dl className="raw-exif"><div><dt>EXIF Make</dt><dd>{photo.camera_make||'—'}</dd></div><div><dt>EXIF Model</dt><dd>{photo.camera_model||'—'}</dd></div>{Object.entries(photo.raw_exif||{}).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details><button className="danger quiet" onClick={()=>onRemove()}><Trash2 size={15}/>{t('移出这次拍摄的记录（保留原图）')}</button>
  <PhotoLocation key={'location:'+photo.id} photo={photo} notify={notify} onSaved={onLocationSaved}/>
  <PhotoRawSource key={'raw-source:'+photo.id} photo={photo} notify={notify}/>
  <AssetRelationships key={'assets:'+photo.id} id={photo.id}/>
  <SimilarPhotos photo={photo}/>
  </>;
}
