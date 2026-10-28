import {useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {t} from '../i18n';
import type {RatingSource} from '../core/photo-rating';
const labels:Record<RatingSource,string>={none:'尚无外部评分',manual:'应用手动评分',legacy:'旧记录（来源未知）','xmp-embedded':'照片内嵌 XMP','xmp-sidecar':'XMP 侧文件'};
export default function PhotoRatingSource({source,onRefresh}:{source?:RatingSource;onRefresh:()=>Promise<void>}){
  const [busy,setBusy]=useState(false);
  return <div className="photo-rating-source"><small>{t('评分来源：')}{t(labels[source||'legacy'])}</small><button disabled={busy} className="quiet" onClick={async()=>{setBusy(true);try{await onRefresh();}finally{setBusy(false);}}}><RefreshCw size={13}/>{t(busy?'正在读取 XMP 评分…':'刷新 XMP 评分')}</button></div>;
}
