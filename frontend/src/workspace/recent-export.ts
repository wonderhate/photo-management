import type {RecentPayload} from '../recent';
import type {Job} from '../types';
import {IS_BROWSER} from '../runtime';
import {api,scopeNativeResult} from '../api';
import {createPreferenceStore} from '../core/preference-store';
import {parseLocalFileURL} from '../core/local-file-reference';
import {bt} from '../browser/text';

export async function recentExportSource(payload:RecentPayload){
  const {libraryId}=await createPreferenceStore();
  const wrong=()=>new Error(bt('此导出属于其他图库，请先打开对应图库。','This export belongs to another library. Open that library first.'));
  if(payload.libraryId&&payload.libraryId!==libraryId)throw wrong();
  let file=payload.file,verified=!!payload.libraryId;
  if((!verified||!file)&&payload.job){const job=await api<Job>('/jobs/'+encodeURIComponent(payload.job));if(job.scope?.library_id&&job.scope.library_id!==libraryId)throw wrong();const first=job.results[0];file=first?{name:first.file_name,path:first.path,url:first.url}:undefined;verified=true;}
  if(IS_BROWSER){
    const storage=await import('../browser/storage');
    if(storage.current().id!==libraryId)throw wrong();
    if(verified&&file?.path?.startsWith('exports/'))return {url:await storage.imageURL(file.path),name:file.name};
    const legacy=payload.urls?.[0],reference=legacy?parseLocalFileURL(legacy):null;
    if(reference){if(reference.libraryID!==libraryId)throw wrong();if(reference.path.startsWith('exports/'))return {url:await storage.imageURL(reference.path),name:reference.path.split('/').at(-1)||''};}
  }else{
    const source=file?.url||payload.urls?.[0];
    if(source){const url=new URL(source,location.origin);if(url.origin===location.origin&&url.pathname.startsWith('/api/exports/')){
      const scoped=new URL(scopeNativeResult({url:url.pathname}).url,location.origin);
      if(!verified&&(!url.searchParams.get('pc_session')||url.searchParams.get('pc_session')!==scoped.searchParams.get('pc_session')))throw new Error(bt('无法核验这条旧记录的图库身份，请从活动中心打开导出。','Cannot verify the library for this old entry. Open the export from the activity center.'));
      url.searchParams.delete('pc_session');return {url:scopeNativeResult({url:url.pathname+url.search}).url,name:file?.name||''};
    }}
  }
  throw new Error(bt('导出文件不可用，请在活动中心或导出目录中查看。','Export unavailable. Check the activity center or the export directory.'));
}
