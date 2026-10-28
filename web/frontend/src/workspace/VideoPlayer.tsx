import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {bt,browserError} from '../browser/text';
import {videoURL,proxyURL} from '../media/video-resources';
import {api} from '../api';
import {IS_BROWSER} from '../runtime';
import type {VideoAsset} from '../core/video';
import type {Job} from '../types';

export default function VideoPlayer({asset,onClose}:{asset:VideoAsset;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),video=useRef<HTMLVideoElement>(null),subtitles=useRef<HTMLInputElement>(null);
  const [url,setURL]=useState(''),[ready,setReady]=useState(false),[error,setError]=useState(''),[edge,setEdge]=useState(1920),[toneMap,setToneMap]=useState(true),[proxyJob,setProxyJob]=useState<Job>(),[busy,setBusy]=useState(false),[vtt,setVtt]=useState(''),[canProxy,setCanProxy]=useState(false);
  useEffect(()=>{const node=dialog.current!,previous=document.activeElement as HTMLElement|null;node.showModal();return()=>{video.current?.pause();node.close();previous?.focus();};},[]);
  useEffect(()=>{let active=true,release=()=>{};void videoURL(asset,'original').then(result=>{if(!active){result.release();return;}release=result.release;setURL(result.url);}).catch(e=>{if(active)setError(browserError(e));});if(!IS_BROWSER)void api<{proxy:boolean}>('/videos/capabilities').then(c=>{if(active)setCanProxy(c.proxy);}).catch(()=>{});return()=>{active=false;release();};},[asset.id]);
  useEffect(()=>{setReady(false);if(video.current)video.current.muted=true;},[url]);
  useEffect(()=>()=>{if(vtt)URL.revokeObjectURL(vtt);},[vtt]);
  useEffect(()=>{if(!proxyJob||!['queued','running'].includes(proxyJob.status))return;let alive=true;const timer=setInterval(()=>{void api<Job>('/jobs/'+proxyJob.id).then(job=>{if(!alive)return;setProxyJob(job);if(job.status==='completed'){setError('');setURL(proxyURL(asset.id,edge,toneMap));}else if(job.status==='failed')setError(browserError(job.error||'Video proxy failed.'));}).catch(e=>{if(alive)setError(browserError(e));});},1000);return()=>{alive=false;clearInterval(timer);};},[proxyJob?.id,proxyJob?.status,asset.id,edge,toneMap]);
  const pending=!!proxyJob&&['queued','running'].includes(proxyJob.status);
  async function makeProxy(){setBusy(true);try{const result=await api<{ready:boolean;job:Job|null}>('/videos/'+asset.id+'/proxy','POST',{edge,tone_map:toneMap});if(result.ready){setError('');setURL(proxyURL(asset.id,edge,toneMap));}else if(result.job)setProxyJob(result.job);}catch(e){setError(browserError(e));}finally{setBusy(false);}}
  async function loadSubtitles(file:File){try{if(file.size>2*1024**2||!/^WEBVTT(?:\s|$)/.test((await file.text()).replace(/^\uFEFF/,'')))throw new Error('Choose a valid WebVTT subtitle file under 2 MiB.');setVtt(URL.createObjectURL(new Blob([await file.text()],{type:'text/vtt'})));}catch(e){setError(browserError(e));}}
  return createPortal(<dialog ref={dialog} className="video-dialog" aria-labelledby="video-title" onCancel={e=>{e.preventDefault();onClose();}} onKeyDown={e=>{
    e.stopPropagation();const player=video.current;if(!player||!ready||['INPUT','SELECT','BUTTON','VIDEO'].includes((e.target as HTMLElement).tagName))return;
    if([' ','k','ArrowLeft','ArrowRight','m','f'].includes(e.key)){e.preventDefault();e.stopPropagation();}
    if(e.key===' '||e.key==='k'){if(player.paused)void player.play().catch(err=>setError(browserError(err)));else player.pause();}
    if(e.key==='ArrowLeft'||e.key==='ArrowRight')player.currentTime=Math.max(0,Math.min(player.duration,player.currentTime+(e.key==='ArrowRight'?5:-5)));
    if(e.key==='m')player.muted=!player.muted;
    if(e.key==='f')void player.requestFullscreen().catch(err=>setError(browserError(err)));
  }}><header><h2 id="video-title">{asset.file_name}</h2><button aria-label={bt('关闭视频','Close video')} onClick={onClose}><X size={20}/></button></header>
    <div className="video-stage" tabIndex={0} aria-label={bt('视频播放区；空格播放暂停，左右键跳转，M 静音，F 全屏','Video area: Space plays or pauses, arrows seek, M mutes, F enters fullscreen')}>
      {url&&<video ref={video} src={url} muted={!ready} controls playsInline preload="metadata" aria-label={asset.file_name} onLoadedData={()=>{setReady(true);if(video.current)video.current.muted=false;}} onError={()=>setError(bt('当前环境无法播放此视频，可尝试下方兼容代理。','This environment cannot play the video. Try a compatibility proxy below.'))}>{vtt&&<track key={vtt} kind="subtitles" label={bt('导入的字幕','Imported subtitles')} src={vtt} default onLoad={e=>{e.currentTarget.track.mode='showing';}}/>}</video>}
    </div>{error&&<p role="alert" className="error-box">{error}</p>}
    <div className="button-row"><button onClick={()=>subtitles.current?.click()}>{bt('加载 VTT 字幕','Load VTT subtitles')}</button>{vtt&&<button onClick={()=>setVtt('')}>{bt('移除字幕','Remove subtitles')}</button>}<input ref={subtitles} type="file" accept=".vtt,text/vtt" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void loadSubtitles(file);}}/></div>
    <details><summary>{bt('兼容播放与画质','Playback compatibility and quality')}</summary><p>{bt('原视频优先播放。代理是独立的 H.264/AAC 副本，原片保留；完成后手动点击播放。','The original plays first. A proxy is a separate H.264/AAC copy; the original is retained. Press play after conversion.')}</p>
      {IS_BROWSER?<p>{bt('纯浏览器不执行 FFmpeg 转码。无法播放的 HEVC 等视频请在 Windows 桌面版创建兼容副本。','The browser does not run FFmpeg. Use Windows desktop to create compatibility copies of unsupported HEVC and other videos.')}</p>:<><div className="button-row"><label>{bt('代理最长边','Proxy longest edge')}<select value={edge} disabled={busy||pending} onChange={e=>setEdge(Number(e.target.value))}>{[720,1080,1920].map(n=><option key={n} value={n}>{n} px</option>)}</select></label><label><input type="checkbox" checked={toneMap} disabled={busy||pending} onChange={e=>setToneMap(e.target.checked)}/>{bt('HDR 映射至 SDR（Hable）','Map HDR to SDR (Hable)')}</label><button disabled={busy||pending||!canProxy} onClick={()=>void makeProxy()}>{bt('生成 / 使用兼容代理','Create / use compatibility proxy')}</button>{pending&&<button onClick={()=>void api('/jobs/'+proxyJob!.id+'/cancel','POST').catch(e=>setError(browserError(e)))}>{bt('取消转码','Cancel conversion')}</button>}</div>{!canProxy&&<p>{bt('需要本机安装 FFmpeg 和 ffprobe，并加入 PATH 或通过 PHOTO_FFMPEG / PHOTO_FFPROBE 配置。','Install local FFmpeg and ffprobe on PATH, or configure PHOTO_FFMPEG / PHOTO_FFPROBE.')}</p>}{proxyJob&&<p role="status">{bt('转码状态：','Conversion status: ')}{({queued:bt('等待中','Queued'),running:bt('转码中','Converting'),completed:bt('完成','Completed'),failed:bt('失败','Failed'),cancelled:bt('已取消','Cancelled')} as Record<string,string>)[proxyJob.status]||proxyJob.status}</p>}</>}
    </details></dialog>,document.body);
}
