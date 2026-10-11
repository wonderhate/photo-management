import {t} from './i18n';
import {useEffect,useState} from 'react';
import {api,message} from './api';
import {isRemote,downloadRemote} from './remote-client';
import {Modal} from './components';
import type {Settings,WatermarkDraft,ExportResult,Job} from './types';

export default function WatermarkExportDialog({drafts,onClose,onDone,onJob,notify}:{drafts:WatermarkDraft[];onClose:()=>void;onDone:()=>void;onJob:(job:Job)=>void;notify:(text:string)=>void}) {
  const initial=drafts[0].settings_json;
  const [format,setFormat]=useState(initial.format),[quality,setQuality]=useState(initial.quality);
  const [edge,setEdge]=useState(initial.long_edge),[filename,setFilename]=useState(initial.filename_template);
  const [directory,setDirectory]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{api<Settings>('/settings').then(s=>setDirectory(s.exports_dir)).catch(e=>setError(message(e)))},[]);
  async function run(){setBusy(true);setError('');try{
    const options={format,quality,long_edge:edge,filename_template:filename,output_directory:directory};
    if(drafts.length>1)onJob(await api<Job>('/watermark/drafts/batch-export','POST',{...options,draft_ids:drafts.map(d=>d.id)}));
    else{const r=await api<ExportResult>('/watermark/drafts/'+drafts[0].id+'/export','POST',options);downloadRemote(r);notify(isRemote?t("电脑已生成水印，正在保存到手机相册"):t("已导出：")+r.path)}
    onDone();onClose();
  }catch(e){setError(message(e))}finally{setBusy(false)}}
  return <Modal title={drafts.length>1?t("批量导出 {0} 个作品",{0:drafts.length}):t("导出水印作品")} onClose={()=>{if(!busy)onClose()}}><div className="draft-dialog">
    <p className="muted">{t("每个作品使用各自保存的水印设计，以下选项只控制输出文件。")}</p>
    <div className="two-columns"><label>{t("格式")}<select value={format} onChange={e=>setFormat(e.target.value as 'jpg'|'png')}><option value="jpg">JPG</option><option value="png">PNG</option></select></label><label>{t("JPG 质量")}<input type="number" min={1} max={100} value={quality} onChange={e=>setQuality(Math.max(1,Math.min(100,+e.target.value)))}/></label></div>
    <label>{t("长边")}<select value={[0,4096,2560,2048].includes(edge)?edge:'custom'} onChange={e=>setEdge(e.target.value==='custom'?3000:+e.target.value)}><option value={0}>{t("原始尺寸")}</option><option value={4096}>4096 px</option><option value={2560}>2560 px</option><option value={2048}>2048 px</option><option value="custom">{t("自定义")}</option></select></label>
    {![0,4096,2560,2048].includes(edge)&&<input aria-label={t("自定义长边")} type="number" min={1} max={16000} value={edge} onChange={e=>setEdge(Math.max(1,Math.min(16000,+e.target.value)))}/>}
    <label>{t("文件名模板")}<input value={filename} onChange={e=>setFilename(e.target.value)} maxLength={180}/></label><small className="muted">{'{original} · {date} · {camera} · {index}'}</small>
    {!isRemote&&<><label>{t("输出目录")}<input value={directory} onChange={e=>setDirectory(e.target.value)}/></label><button onClick={async()=>{try{const r=await api<{paths:string[]}>('/dialog/directory','POST');if(r.paths[0])setDirectory(r.paths[0])}catch(e){setError(message(e))}}}>{t("选择输出文件夹")}</button><small className="muted">{t("默认使用已配置的目录；同名文件自动编号，不覆盖已有文件。")}</small></>}{isRemote&&<p className="muted">{t("电脑生成正式水印，手机保存至相册 PhotoCollection。批量任务完成后，点击任务中的作品下载链接即可保存。")}</p>}
    {error&&<p className="error-box">{error}</p>}<footer className="modal-footer"><button disabled={busy} onClick={onClose}>{t("取消")}</button><button className="primary" disabled={busy||!filename.trim()} onClick={run}>{busy?t("正在导出…"):t("确认导出")}</button></footer>
  </div></Modal>;
}
