import FrameEditor from './workspace/FrameEditor';
import DownloadLink from './media/DownloadLink';
import MediaImage from './media/MediaImage';
import {t} from './i18n';
import {useEffect,useState,useRef} from 'react';
import type {MutableRefObject} from 'react';
import {Download,Frame,Sun,SlidersHorizontal} from 'lucide-react';
import {IS_BROWSER,photoURL} from './runtime';
import {bt} from './browser/text';
import {api,apiBlob,message} from './api';
import {useWatermarkDraft} from './useWatermarkDraft';
import type {LeaveGuard} from './useWatermarkDraft';
import {Empty,Parameters} from './components';
import type {Photo,WatermarkOptions,Job,Settings,ExportResult} from './types';
import {useCommands} from './workspace/useCommands';
import CommandMenu from './workspace/CommandMenu';

const initial:WatermarkOptions={template:'frame',style:'modern_info_bar',show_brand_logo:true,info_bar_ratio:.14,font_scale:1,fields:['camera_make','camera_model','focal_length','f_number','exposure_time','iso','date_taken'],signature:'',signature_style:'text',theme:'white',border:.035,info_height:.16,font_size:1,align:'center',radius:.008,blur:.08,intensity:.85,brightness:.7,saturation:1.25,photo_scale:.88,shadow:true,format:'jpg',quality:95,long_edge:4096,filename_template:'{original}_watermark'};
const fields:Record<string,string>={camera_make:'相机品牌',camera_model:'相机型号',lens_model:'镜头型号',focal_length:'焦距',f_number:'光圈',exposure_time:'快门',iso:'ISO',date_taken:'拍摄时间',signature:'自定义署名'};
const signatureStyles=[['text','普通文字'],['natural','原版连笔'],['fine','细线手写'],['brush','毛笔笔触'],['calligraphy','经典花体'],['chinese_brush','中文毛笔'],['chinese_running','中文行书'],['chinese_cursive','中文草书'],['chinese_handwriting','中文手写']] as const;
type DemoWatermarkFlow={onExport:(result:ExportResult)=>void;saveRef:MutableRefObject<(()=>Promise<boolean>)|null>;initialOptions?:WatermarkOptions;onOptions:(options:WatermarkOptions)=>void};
export default function WatermarkPage({ids,onChoose,onJob,notify,draftId,onSaved,guard,workflow}:{ids:string[];onChoose:()=>void;onJob:(job:Job)=>void;notify:(text:string)=>void;draftId:string;onSaved:(id:string)=>void;guard:LeaveGuard;workflow?:DemoWatermarkFlow}) {
  const [photo,setPhoto]=useState<Photo|null>(null);
  const [active,setActive]=useState(ids[0]||'');
  const [options,setOptions]=useState<WatermarkOptions>(workflow?.initialOptions||initial);
  const [preview,setPreview]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [exporting,setExporting]=useState(false);
  const [result,setResult]=useState<ExportResult|null>(null);
  const [exportDirectory,setExportDirectory]=useState('');
  const history=useRef<WatermarkOptions[]>([]),future=useRef<WatermarkOptions[]>([]);
  const editor=useWatermarkDraft({active,options,setOptions,draftId,onSaved,guard,notify});
  useEffect(()=>{workflow?.onOptions(options);},[options]);
  useEffect(()=>{
    if(!workflow)return;
    const save=async()=>{if(exporting||editor.loading){notify(bt('正在准备作品，请稍候。','Preparing the image. Please wait.'));return false;}try{return !!await editor.save();}catch(e){notify(message(e));return false;}};
    workflow.saveRef.current=save;return()=>{if(workflow.saveRef.current===save)workflow.saveRef.current=null;};
  },[options,busy,exporting,editor.loading,editor.draft?.id]);
  const assetDraft=!!editor.draft?.asset_variant_id,snapshotDraft=!!editor.draft?.artwork_id||assetDraft;
  const hasSource=!!active||snapshotDraft;
  useEffect(()=>{if(editor.draft){setActive(editor.draft.photo_id||'');history.current=[];future.current=[]}},[editor.draft?.id]);
  useEffect(()=>{api<Settings>('/settings').then(s=>{setExportDirectory(s.exports_dir);if(!workflow?.initialOptions)editor.defaults({format:s.export_format,quality:s.export_quality,long_edge:s.export_long_edge})}).catch(e=>notify(message(e)))},[]);
  useEffect(()=>{if(!draftId&&!ids.includes(active))setActive(ids[0]||'')},[ids.join('|')]);
  useEffect(()=>{let alive=true;setPreview('');if(snapshotDraft){setPhoto(null);setPreview(editor.draft?.preview_url||'')}else if(active)api<Photo>('/photos/'+active).then(p=>{if(alive)setPhoto(p)}).catch(e=>{if(alive)setError(message(e))});else{setPhoto(null);setPreview(editor.draft?.preview_url||'')}return()=>{alive=false}},[active,editor.draft?.id]);
  useEffect(()=>{
    if(!hasSource||editor.loading)return;
    const controller=new AbortController(); let url='';
    setBusy(true);setError('');
    const timer=setTimeout(async()=>{
      try {
        const blob=await apiBlob(snapshotDraft?'/watermark/drafts/'+editor.draft!.id+'/render':'/watermark/preview',snapshotDraft?options:{photo_id:active,options},controller.signal);
         if(controller.signal.aborted)return;
        url=URL.createObjectURL(blob);setPreview(url);
      }catch(e){if(!controller.signal.aborted)setError(message(e))}finally{if(!controller.signal.aborted)setBusy(false)}
    },350);
    return ()=>{clearTimeout(timer);controller.abort();if(url)URL.revokeObjectURL(url)};
  },[active,options,editor.loading,editor.draft?.artwork_id,editor.draft?.asset_variant_id]);
  function change<K extends keyof WatermarkOptions>(key:K,value:WatermarkOptions[K],extra:Partial<WatermarkOptions>={}){history.current=[...history.current.slice(-49),options];future.current=[];setOptions(o=>({...o,...extra,[key]:value}))}
  function undo(){const value=history.current.pop();if(value){future.current.push(options);setOptions(value)}}
  function redo(){const value=future.current.pop();if(value){history.current.push(options);setOptions(value)}}
  async function switchPhoto(id:string){if(id===active)return;if(await editor.requestLeave()){editor.reset();onSaved('');setActive(id);history.current=[];future.current=[];setResult(null)}}
  async function exportPhotos(batch:boolean){setExporting(true);try{if(batch)onJob(await api<Job>('/watermark/batch-export','POST',{photo_ids:ids,options}));else{const d=editor.draft||workflow?await editor.save():null;const r=await api<ExportResult>(d?'/watermark/drafts/'+d.id+'/export':'/watermark/export','POST',d?{}:{photo_id:active,options});setResult(r);if(workflow){workflow.onExport(r);}else notify(t("已保存到本地导出目录"))}}catch(e){notify(message(e))}finally{setExporting(false)}}
  const slider=(key:keyof WatermarkOptions,label:string,min:number,max:number,step:number)=> <label className="range-label" key={key}><span>{t(label)}<small>{Number(options[key]).toFixed(step<.1?2:1)}</small></span><input type="range" min={min} max={max} step={step} value={Number(options[key])} onChange={e=>change(key,Number(e.target.value))}/></label>;
  const commands=useCommands('editor',{
    editorOpen:{label:bt('从图库选择','From library'),run:onChoose},
    editorUndo:{label:t('撤销'),enabled:history.current.length>0,run:undo},editorRedo:{label:t('重做'),enabled:future.current.length>0,run:redo},
    editorSave:{label:t(editor.draft?'保存':'保存到水印图库'),enabled:hasSource&&editor.state!=='正在保存…'&&!exporting,run:editor.save},
    editorReady:{label:t('标记为待导出'),enabled:hasSource&&!exporting,run:editor.ready},
    editorExport:{label:workflow?bt('下一步：下载作品','Next: Download your image'):bt('导出当前照片','Export current photo'),enabled:hasSource&&!exporting&&!error,run:()=>exportPhotos(false)},
    editorBatchExport:{label:bt('批量导出','Batch export'),enabled:ids.length>1&&!editor.draft&&!snapshotDraft&&!exporting&&!error,run:()=>exportPhotos(true)},
  },{active:!editor.loading&&(!draftId||!!editor.draft),listen:true,exclusive:true,onError:error=>notify(message(error))});
  if(editor.loading)return <p className="loading">{t("正在恢复水印作品…")}</p>;
  if(draftId&&!editor.draft)return <Empty title={t("无法打开水印作品")} action={<button onClick={onChoose}>{t("返回照片库")}</button>}>{t(editor.state)}</Empty>;
  if(!ids.length&&!draftId&&!active)return <Empty title={t("为照片留下一枚署名")} action={<button className="primary" onClick={onChoose}>{t("去图库选择照片")}</button>}>{t("选择一张或多张照片，制作相框与沉浸光感水印。")}</Empty>;
  return <><div className="draft-editor-bar"><div><input aria-label={t("水印作品名称")} placeholder={photo?.file_name.replace(/\.[^.]+$/,'')||t("作品名称")} value={editor.name} maxLength={180} onChange={e=>editor.setName(e.target.value)}/><small role="status">{t(editor.state)||t("尚未保存为草稿")}</small></div><div className="button-row"><CommandMenu surface={commands} ids={['editorOpen','editorUndo','editorRedo','editorSave','editorReady','editorExport','editorBatchExport']} label={bt('编辑操作菜单','Edit actions')}/><button {...commands.props('editorUndo')}>{t("撤销")}</button><button {...commands.props('editorRedo')}>{t("重做")}</button><button {...commands.props('editorSave')}>{editor.draft?t("保存"):t("保存到水印图库")}</button><button className="primary" {...commands.props('editorReady')}>{t("标记为待导出")}</button></div></div>{editor.draft?.source_missing&&<p className="error-box">{IS_BROWSER&&!snapshotDraft?<>{bt('原片目录需要重新授权，编辑记录仍然保留。','Reconnect the original folder. Your edits are retained.')} <a href="#/?page=settings">{bt('前往原片授权设置','Open original folder access settings')}</a></>:t(assetDraft?"编辑副本不可用，请从备份恢复作品文件。":snapshotDraft?"水彩来源文件不可用，请恢复照片库中的作品文件。":"原始照片不可用。请在水印图库选择「重新定位」，编辑记录仍然保留。")}</p>}<div className="watermark-layout"><div className="watermark-stage"><div className="stage-toolbar"><span><span className="live-dot"/>{t("实时预览")}</span><button onClick={onChoose}>{t("重新选择 · 已选 ")}{ids.length}{t(" 张")}</button></div><div className="render-stage">{preview?<MediaImage src={preview} alt={t("水印实时预览")}/>:<SlidersHorizontal size={40}/>}<span className="render-status">{busy?t("正在渲染…"):t(error)||t(assetDraft?"预览图 · 导出使用保存的编辑副本":snapshotDraft?"预览图 · 导出使用保存的水彩海报":"预览图 · 导出使用原图")}</span></div>{snapshotDraft&&<div className="watermark-caption"><h3>{editor.draft?.source.file_name}</h3><p className="muted">{t(assetDraft?"编辑副本快照 · 拍摄信息来自原照片":"水彩海报快照 · 拍摄信息来自原照片")}</p></div>}{photo&&<div className="watermark-caption"><h3>{photo.file_name}</h3><Parameters photo={photo}/></div>}{photo&&photo.files.length>1&&<label>{t("本次拍摄的水印来源")}<select value={active} onChange={e=>switchPhoto(e.target.value)}>{photo.files.map(f=><option key={f.id} value={f.id}>{f.file_format} · {f.file_name}</option>)}</select><small className="muted">{t("切换来源后可另存为独立水印作品。")}</small></label>}<div className="filmstrip">{(!snapshotDraft?ids:[]).map(id=><button key={id} className={active===id?'active':''} onClick={()=>switchPhoto(id)} aria-label={t("切换预览照片")}><MediaImage src={photoURL(id,'thumbnail')} alt={t("待导出照片")}/></button>)}</div>{result&&!workflow&&<DownloadLink className="download-result" href={result.url} download={result.file_name}><Download size={16}/>{result.file_name} · {result.width} × {result.height}</DownloadLink>}</div>
  <aside className="editor-panel"><div className="template-tabs"><button className={options.template==='frame'?'active':''} onClick={()=>change('template','frame')}><Frame size={20}/>{t("现代信息条相框")}</button><button className={options.template==='ambient'?'active':''} onClick={()=>change('template','ambient')}><Sun size={20}/>{t("沉浸光感")}</button></div>
  {options.template==='frame'&&<FrameEditor key={editor.draft?.id||active} value={options.frame_v2} source={photo||editor.draft?.source||{}} author={options.signature} loadedDraft={!!editor.draft} change={value=>change('frame_v2',value)} notify={notify}/>}
  {!(options.template==='frame'&&options.frame_v2)&&<><section><h3>{options.template==='frame'?t("现代信息条相框"):t("画面与光线")}</h3>{options.template==='frame'?<><p className="muted">{t("满宽主图 · 白色信息条 · 品牌 / Logo / 拍摄参数")}</p>{slider('info_bar_ratio',t("信息栏高度"),.06,.25,.005)}{slider('font_scale',t("字号缩放"),.5,2,.05)}<label className="check"><input type="checkbox" checked={options.show_brand_logo} onChange={e=>change('show_brand_logo',e.target.checked)}/>{t("显示品牌 logo")}</label></>:<>{slider('blur',t("背景模糊"),.005,.25,.005)}{slider('intensity',t("环境光强度"),0,1,.01)}{slider('brightness',t("背景亮度"),.1,2,.05)}{slider('saturation',t("背景饱和度"),0,3,.05)}{slider('photo_scale',t("主图占比"),.5,.99,.01)}<label className="check"><input type="checkbox" checked={options.shadow} onChange={e=>change('shadow',e.target.checked)}/>{t("主图阴影")}</label>{slider('radius',t("图片圆角"),0,.15,.005)}{slider('font_size',t("文字大小"),.5,2,.05)}</>}</section>
  <section><h3>{t("保留哪些拍摄信息")}</h3><div className="field-checks">{Object.entries(fields).filter(([key])=>key!=='signature'&&(options.template!=='frame'||key!=='lens_model')).map(([key,label])=><label key={key} className="check"><input type="checkbox" checked={options.fields.includes(key)} onChange={e=>change('fields',e.target.checked?[...options.fields,key]:options.fields.filter(f=>f!==key))}/>{t(label)}</label>)}</div><p className="muted">{t("缺失的 EXIF 字段会自动隐藏。")}</p>{options.template==='frame'&&options.fields.includes('lens_model')&&<details><summary>{t("已有草稿的附加信息")}</summary><label className="check"><input type="checkbox" checked onChange={()=>change('fields',options.fields.filter(f=>f!=='lens_model'))}/>{t(fields.lens_model)}</label></details>}</section>
  <section className="signature-editor"><h3>{t("艺术字署名")}</h3><label className="check"><input type="checkbox" checked={options.fields.includes('signature')} onChange={e=>change('fields',e.target.checked?[...options.fields,'signature']:options.fields.filter(f=>f!=='signature'),e.target.checked&&!options.signature?{signature:'wonder'}:{})}/>{t("显示署名")}</label><div className="signature-styles" role="group" aria-label={t("署名风格")}>{signatureStyles.map(([style,label])=><button key={style} type="button" disabled={!options.fields.includes('signature')} aria-pressed={(options.signature_style||'text')===style} onClick={()=>change('signature_style',style,{signature:style==='natural'?'wonder':style.startsWith('chinese_')&&(!options.signature||options.signature==='wonder')?'光影':options.signature||'wonder'})}>{style==='text'?<span className="signature-text-sample">wonder</span>:IS_BROWSER?(style==='natural'?<MediaImage src="/local-assets/signatures/natural.png" alt=""/>:<span className="browser-signature" style={{fontFamily:'pc-'+style}}>{style.startsWith('chinese_')?'光影':'wonder'}</span>):<MediaImage src={'/api/watermark/signatures/'+style} alt=""/>}<span>{t(label)}</span></button>)}</div>{options.fields.includes('signature')&&<><label>{t("署名内容")}<input value={options.signature} placeholder={t("你的摄影署名")} maxLength={120} readOnly={options.signature_style==='natural'} onChange={e=>change('signature',e.target.value)}/></label>{options.signature_style==='natural'?<p className="muted">{t("原版署名字样固定为 wonder。")}</p>:(options.signature_style||'text')!=='text'&&<p className="muted">{t(options.signature_style.startsWith('chinese_')?"中文书法风格支持常用中文，可修改署名内容。":"英文手写风格适合英文署名；中文请选中文书法风格。")}</p>}</>}</section>
  </>}<section><h3>{t("导出设置")}</h3><div className="two-columns"><label>{t("文件格式")}<select value={options.format} onChange={e=>change('format',e.target.value as 'jpg'|'png'|'webp')}><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option></select></label><label>{t("编码质量")}<input type="number" min={1} max={100} value={options.quality} onChange={e=>change('quality',Math.max(1,Math.min(100,Number(e.target.value))))}/></label></div><label>{t("导出长边")}<select value={[0,4096,2560,2048].includes(options.long_edge)?options.long_edge:'custom'} onChange={e=>change('long_edge',e.target.value==='custom'?3000:Number(e.target.value))}><option value={0}>{t("原图尺寸 + 相框")}</option><option value={4096}>4096 px</option><option value={2560}>2560 px</option><option value={2048}>2048 px</option><option value="custom">{t("自定义")}</option></select></label>{![0,4096,2560,2048].includes(options.long_edge)&&<input aria-label={t("自定义长边")} type="number" min={1} max={16000} value={options.long_edge} onChange={e=>change('long_edge',Math.max(1,Math.min(16000,Number(e.target.value))))}/>}<label>{t("文件名模板")}<input value={options.filename_template} onChange={e=>change('filename_template',e.target.value)}/></label><small className="muted">{'{original} · {date} · {camera} · {index}'}</small><p className="muted">{t("导出采用 sRGB；不包含原片 EXIF、GPS、XMP。相框中的可见文字仍会保留。")}</p></section>
  <div className="export-actions"><button className="primary" {...commands.props('editorExport')}><Download size={16}/>{workflow?bt('下一步：下载作品','Next: Download your image'):t("导出当前照片")}</button>{!editor.draft&&ids.length>1&&<button {...commands.props('editorBatchExport')}>{t("批量导出 ")}{ids.length}{t(" 张")}</button>}{!workflow&&<small style={{overflowWrap:'anywhere'}}>{t("保存至 ")}{exportDirectory||t("正在读取…")}{t(" · 同名文件自动编号")}</small>}</div></aside></div>{editor.dialog}</>;
}
