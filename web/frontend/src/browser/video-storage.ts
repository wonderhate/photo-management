import {current,localFile,uid,now,commit} from './storage';
import {editScope,hashFile} from './edit-storage';
import {decodeVideoFrame} from './video-decode';
import {isVideoFile} from '../core/video';
import type {StoredVideo,VideoAsset} from '../core/video';
import {launchTask} from './task-service';

const hydrate=(v:StoredVideo):VideoAsset=>({...v,cover_url:'',original_url:'',missing:false});
export function listVideos(page=1){const rows=[...(current().videos||[])].reverse();return {items:rows.slice((page-1)*60,page*60).map(hydrate),total:rows.length};}
export async function videoFile(id:string,kind:'cover'|'original'){
  const scope=editScope(),row=current().videos?.find(v=>v.id===id);if(!row)throw new Error('Video not found.');
  const file=await localFile(kind==='cover'?row.cover_path:row.source_path,scope.base);scope.check();return file;
}
export async function removeVideo(id:string){const scope=editScope();await commit(s=>{scope.check();s.videos=(s.videos||[]).filter(v=>v.id!==id);});}
export async function importVideos(files:File[]){
  return launchTask('video-import',async context=>{
    const job=context.job;job.total=files.length;
    for(const file of files){
      context.check();job.current=file.name;
      try{
        if(!isVideoFile(file.name))throw new Error('Unsupported video format.');
        if(file.size>256*1024**2)throw new Error('Browser video import is limited to 256 MiB per file. Use desktop for larger videos.');
        const hash=await hashFile(file);context.check();
        if(current().videos?.some(v=>v.file_hash===hash)){job.skipped++;continue;}
        const {metadata,cover}=await decodeVideoFrame(file,0,context.signal),id=uid(),source_path=`media/${id}/source.${file.name.split('.').at(-1)!.toLowerCase()}`,cover_path=`media/${id}/cover.jpg`;
        await context.write(source_path,file);await context.write(cover_path,cover);
        if(await hashFile(await context.file(source_path))!==hash)throw new Error('Video copy differs from its source.');context.check();
        const row:StoredVideo={id,kind:'video',file_name:file.name,file_hash:hash,file_size:file.size,file_path:source_path,source_path,cover_path,created_at:now(),metadata};
        await context.commit(s=>{if(s.videos?.some(v=>v.file_hash===hash))throw new Error('This video was already imported.');s.videos=[...(s.videos||[]),row];});job.success++;
      }catch(error){context.check();job.failed++;job.errors.push(file.name+': '+(error instanceof Error?error.message:String(error)));}
      finally{job.processed++;await context.checkpoint();}
    }
  });
}
