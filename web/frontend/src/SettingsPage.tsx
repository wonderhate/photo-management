import SettingsTransfer from './workspace/SettingsTransfer';
import AgentSettings from './workspace/AgentSettings';
import DerivedRecycle from './workspace/DerivedRecycle';
import SourceScanSettings from './workspace/SourceScanSettings';
import RemovedPhotos from './workspace/RemovedPhotos';
import CameraNameSettings from './workspace/CameraNameSettings';
import {useEffect,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {Download,Cpu,FolderOpen,Keyboard,Blocks,Play,Languages} from 'lucide-react';
import {api,message} from './api';
import {getBindings,saveBinding,resetBindings,eventKey,displayKey,ACTION_LABELS} from './shortcuts';
import {t,getLang} from './i18n';
import type {Lang} from './i18n';
import type {AIStatus,Settings} from './types';
import {IS_BROWSER} from './runtime';
import BrowserSettings from './browser/Settings';
import StorageSettings from './StorageSettings';
import CatalogSettings from './workspace/CatalogSettings';
import CapabilitiesPanel from './workspace/CapabilitiesPanel';
import {useShortcutBindings} from './workspace/useCommands';
import DisplayCacheSettings from './workspace/DisplayCacheSettings';
import TextIndexSettings from './workspace/TextIndexSettings';
import ImportFaceSettings from './workspace/ImportFaceSettings';
import type {Page} from './routes';
import {inferenceAdapter} from './core/inference-adapter';
interface PluginInfo {name:string;description:string;error?:boolean}
export default function SettingsPage({mobile,ai,notify,onSaved,onScan,onBindings,lang,onLang,onPage}:{mobile:boolean;ai:AIStatus|null;notify:(text:string)=>void;onSaved:()=>void;onScan:()=>void;onBindings?:(bindings:Record<string,string>)=>void;lang?:Lang;onLang?:(lang:Lang)=>void;onPage?:(page:Page)=>void}) {
  if(IS_BROWSER)return <BrowserSettings notify={notify} onSaved={onSaved} onLang={onLang} onBindings={onBindings} onPage={onPage}/>;
  const [settings,setSettings]=useState<Settings|null>(null);const [bands,setBands]=useState('');
  const keys=useShortcutBindings();const [editingKey,setEditingKey]=useState('');
  const [plugins,setPlugins]=useState<PluginInfo[]>([]);const [pluginOutput,setPluginOutput]=useState<Record<string,string>>({});const [running,setRunning]=useState('');
  useEffect(()=>{api<Settings>('/settings').then(s=>{setSettings(s);setBands(s.focal_bands.join(', '))}).catch(e=>notify(message(e)))},[]);
  useEffect(()=>{api<PluginInfo[]>('/plugins').then(setPlugins).catch(()=>{})},[]);
  async function runPlugin(name:string){setRunning(name);try{const r=await api<{ok:boolean;result:string;log:string[]}>('/plugins/'+name+'/run','POST',{params:{}});setPluginOutput(o=>({...o,[name]:[...r.log,r.result].filter(Boolean).join('\n')||t("已完成")}));onSaved();notify(t("插件运行完成"))}catch(e){setPluginOutput(o=>({...o,[name]:message(e)}));notify(message(e))}finally{setRunning('')}}
  function change<K extends keyof Settings>(key:K,value:Settings[K]){setSettings(s=>s?{...s,[key]:value}:s)}
  async function save(){try{await api('/settings','PUT',{...settings,focal_bands:bands.split(/[,，]/).map(Number)});notify(t("偏好设置已保存"));onSaved()}catch(e){notify(message(e))}}
  async function loadAI(download:boolean){try{await inferenceAdapter.loadSemantic(download);notify(download?t("正在准备模型；首次下载可能需要几分钟"):t("正在从本地缓存加载模型"))}catch(e){notify(message(e))}}
  function capture(e:KeyboardEvent<HTMLInputElement>,action:string){
    if(e.nativeEvent.isComposing)return;
    if(e.key==='Tab'){setEditingKey('');return;}e.preventDefault();e.stopPropagation();
    if(e.key==='Escape'){setEditingKey('');return;}if(['Control','Meta','Alt','Shift'].includes(e.key))return;
    if(e.altKey){notify(t('快捷键未能保存'));return;}
    const result=saveBinding(action,eventKey(e));
    if(!result.ok){notify(result.conflict?t('快捷键已用于：{0}',{0:t(ACTION_LABELS[result.conflict])}):t('快捷键未能保存'));return;}
    const next=getBindings();onBindings?.(next);setEditingKey('');
  }
  if(!settings)return <p className="loading">{t("正在读取设置…")}</p>;
  return <div className="settings-page"><SettingsTransfer notify={notify}/><section className="settings-card"><header><Languages size={20}/><div><h3>{t('界面语言')}</h3><p>{t('选择界面语言，立即生效。')}</p></div></header><select value={lang||getLang()} onChange={e=>onLang?.(e.target.value as Lang)}><option value="zh">{t("中文")}</option><option value="en">English</option></select></section>{!mobile&&<section className="settings-card"><header><Keyboard size={20}/><div><h3>{t("键盘快捷键")}</h3><p>{t("点击输入框后按下新按键即可修改；Esc 取消。")}</p></div></header><div className="shortcuts-edit">{Object.keys(ACTION_LABELS).map(a=><label key={a}>{t(ACTION_LABELS[a])}<input data-shortcut-recorder readOnly value={editingKey===a?t("按下新按键…"):keys[a]?displayKey(keys[a]):t("未绑定")} onFocus={()=>setEditingKey(a)} onBlur={()=>setEditingKey('')} onKeyDown={e=>capture(e,a)}/></label>)}</div><button className="quiet" onClick={()=>{resetBindings();const next=getBindings();onBindings?.(next);notify(t("已恢复默认快捷键"))}}>{t("恢复默认")}</button></section>}<StorageSettings notify={notify} onScan={onScan}/><CatalogSettings notify={notify}/>
  <AgentSettings notify={notify}/><DerivedRecycle notify={notify}/><SourceScanSettings notify={notify}/><RemovedPhotos notify={notify} onRestored={onSaved}/><CameraNameSettings notify={notify}/><DisplayCacheSettings notify={notify}/><TextIndexSettings notify={notify}/><ImportFaceSettings notify={notify}/><CapabilitiesPanel onPage={onPage}/><section className="settings-card" id="local-model-settings"><header><Cpu size={20}/><div><h3>{t("本地视觉语义模型")}</h3><p>{t("Chinese-CLIP · 支持中文关键词 · CPU / CUDA")}</p></div><span className={'status-pill '+(ai?.status==='ready'?'ready':'')}>{ai?.status||t("未加载")}</span></header><p>{t(ai?.stage||'')}</p><p className="muted">{ai?.model||settings.ai_model} · {ai?.device||'CPU'}{t(" · 缓存 ")}{((ai?.cached_bytes||0)/1024/1024).toFixed(0)} MB</p>{ai?.total? <div><progress value={ai.processed} max={ai.total}/><p>{t("已处理 ")}{ai.processed} / {ai.total}{t(" · 已索引 ")}{ai.indexed}{t(" · 失败 ")}{ai.failed}</p></div>:null}{ai?.error&&<p className="error-box">{message(ai.error)}</p>}<div className="button-row"><button className="primary" disabled={ai?.status==='loading'||ai?.status==='indexing'} onClick={()=>loadAI(true)}><Download size={16}/>{t("下载 / 加载模型并建立索引")}</button><button disabled={ai?.status==='loading'||ai?.status==='indexing'} onClick={()=>loadAI(false)}>{t("仅使用本地缓存")}</button></div><p className="muted">{t("首次需要联网下载模型。下载完成后可离线分析，图片和关键词不会上传至第三方。")}</p></section>
  <section className="settings-card"><header><FolderOpen size={20}/><div><h3>{t("浏览与摄影统计")}</h3><p>{t("RAW + JPG 代表同一次快门。")}</p></div></header><div className="two-columns"><label>{t("统计方式")}<select value={settings.count_mode} onChange={e=>change('count_mode',e.target.value as Settings['count_mode'])}><option value="capture">{t("按拍摄次数（推荐）")}</option><option value="file">{t("按文件数量")}</option></select></label><label>{t("首选预览")}<select value={settings.preview_preference} onChange={e=>change('preview_preference',e.target.value as Settings['preview_preference'])}><option value="jpeg">JPG / HEIF</option><option value="raw">{t("RAW 内嵌预览（可用时）")}</option></select></label><label>{t("缩略图质量（后续导入）")}<input type="number" min={30} max={100} value={settings.thumbnail_quality} onChange={e=>change('thumbnail_quality',Number(e.target.value))}/></label><label>{t("报告焦段分界（5 个递增数字）")}<input value={bands} onChange={e=>setBands(e.target.value)}/></label></div></section>
  <section className="settings-card"><header><Blocks size={20}/><div><h3>{t("插件脚本")}</h3><p>{t("在 plugins 目录放置 .py 文件，定义 run(ctx) 即可扩展功能。")}</p></div></header>{plugins.length?<div className="plugin-list">{plugins.map(p=><div key={p.name} className="plugin-row"><div><b>{p.name}</b><p className="muted">{t(p.description)}</p>{pluginOutput[p.name]&&<pre className="plugin-output">{t(pluginOutput[p.name])}</pre>}</div><button disabled={!!p.error||running===p.name} onClick={()=>runPlugin(p.name)}><Play size={14}/>{running===p.name?t("运行中…"):t("运行")}</button></div>)}</div>:<p className="muted">{t("暂无插件。把脚本放进照片库的 plugins 文件夹后刷新本页。")}</p>}<p className="muted">{t("脚本可获得 ctx.photos(筛选)、ctx.update(照片id, 收藏/评分/标签) 与 ctx.message(输出)。插件只在本机运行，请仅安装可信来源的脚本。")}</p></section>
  <section className="settings-card"><h3>{t("默认导出")}</h3><div className="three-columns"><label>{t("格式")}<select value={settings.export_format} onChange={e=>change('export_format',e.target.value as 'jpg'|'png'|'webp')}><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option></select></label><label>{t("编码质量")}<input type="number" min={1} max={100} value={settings.export_quality} onChange={e=>change('export_quality',Number(e.target.value))}/></label><label>{t("长边像素（0 为原始）")}<input type="number" min={0} max={16000} value={settings.export_long_edge} onChange={e=>change('export_long_edge',Number(e.target.value))}/></label></div><button className="primary" onClick={save}>{t("保存偏好")}</button></section></div>;
}
