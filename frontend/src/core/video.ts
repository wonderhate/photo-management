export type VideoMetadata={width:number;height:number;duration:number;fps:number;codec:string;pixel_format?:string;color_transfer?:string;hdr?:boolean;audio?:boolean;subtitle_tracks?:number;rotation?:number;date_taken?:string};
export type VideoAsset={id:string;kind:'video';file_name:string;file_hash:string;file_size:number;file_path:string;created_at:string;metadata:VideoMetadata;cover_url:string;original_url:string;missing:boolean};
export type StoredVideo=Omit<VideoAsset,'cover_url'|'original_url'|'missing'> & {source_path:string;cover_path:string};
export const videoAccept='.mp4,.mov,.m4v,.mkv,.webm,.avi,.mts,.m2ts';
export const isVideoFile=(name:string)=>/\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts)$/i.test(name);
export function videoDuration(seconds:number){const n=Math.max(0,Math.floor(seconds));return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
export function validateVideos(value:unknown):asserts value is StoredVideo[]{
  if(!Array.isArray(value)||value.length>100000)throw new Error('Invalid video library.');
  const ids=new Set<string>(),hashes=new Set<string>();
  for(const v of value){
    if(!v||typeof v!=='object'||v.kind!=='video'||typeof v.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(v.id)||ids.has(v.id)||typeof v.file_hash!=='string'||!(/^[a-f0-9]{64}$/).test(v.file_hash)||hashes.has(v.file_hash)||typeof v.file_name!=='string'||v.file_name.length>255||/[\\/\u0000-\u001f]/.test(v.file_name)||!isVideoFile(v.file_name)||!Number.isSafeInteger(v.file_size)||v.file_size<1||v.file_size>256*1024**2||v.source_path!==`media/${v.id}/source.${v.file_name.split('.').at(-1)!.toLowerCase()}`||v.cover_path!==`media/${v.id}/cover.jpg`||v.file_path!==v.source_path||typeof v.created_at!=='string'||!Number.isFinite(Date.parse(v.created_at)))throw new Error('Invalid video library.');
    const m=v.metadata;
    if(!m||typeof m!=='object'||!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<1||m.height<1||m.width*m.height>100_000_000||typeof m.duration!=='number'||!Number.isFinite(m.duration)||m.duration<=0||m.duration>7*86400||typeof m.fps!=='number'||!Number.isFinite(m.fps)||m.fps<0||m.fps>1000||typeof m.codec!=='string'||m.codec.length>80)throw new Error('Invalid video library.');
    ids.add(v.id);hashes.add(v.file_hash);
  }
}
