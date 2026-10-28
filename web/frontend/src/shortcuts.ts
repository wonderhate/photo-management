export type ShortcutScope='library'|'viewer'|'editor'|'other';
interface ShortcutDefinition {key:string;label:string;scopes:ShortcutScope[];repeatable?:boolean}
export const SHORTCUTS:Record<string,ShortcutDefinition>={
  prev:{key:'ArrowLeft',label:'详情 · 上一张',scopes:['viewer']},next:{key:'ArrowRight',label:'详情 · 下一张',scopes:['viewer']},
  favorite:{key:'f',label:'收藏 / 取消收藏',scopes:['viewer']},tag:{key:'t',label:'聚焦标签输入框',scopes:['viewer']},
  flagPick:{key:'p',label:'选片 · 留用',scopes:['library','viewer'],repeatable:false},flagReject:{key:'x',label:'选片 · 排除',scopes:['library','viewer'],repeatable:false},flagClear:{key:'u',label:'选片 · 清除标记',scopes:['library','viewer'],repeatable:false},
  flagPickNext:{key:'shift+p',label:'选片 · 留用并前进',scopes:['library','viewer'],repeatable:false},flagRejectNext:{key:'shift+x',label:'选片 · 排除并前进',scopes:['library','viewer'],repeatable:false},flagClearNext:{key:'shift+u',label:'选片 · 清除标记并前进',scopes:['library','viewer'],repeatable:false},
  viewerZoomIn:{key:'+',label:'详情 · 放大照片',scopes:['viewer']},viewerZoomOut:{key:'-',label:'详情 · 缩小照片',scopes:['viewer']},
  viewerFit:{key:'0',label:'详情 · 适应窗口',scopes:['viewer']},viewerActual:{key:'z',label:'详情 · 预览实际像素',scopes:['viewer']},viewerProof:{key:'b',label:'详情 · 白底校样',scopes:['viewer']},
  editorOpen:{key:'ctrl+o',label:'编辑器 · 打开照片',scopes:['editor'],repeatable:false},
  editorUndo:{key:'ctrl+z',label:'编辑器 · 撤销',scopes:['editor']},editorRedo:{key:'ctrl+y',label:'编辑器 · 重做',scopes:['editor']},
  editorSave:{key:'ctrl+s',label:'编辑器 · 保存',scopes:['editor'],repeatable:false},editorExport:{key:'ctrl+e',label:'编辑器 · 导出副本',scopes:['editor'],repeatable:false},
  editorOriginal:{key:'b',label:'编辑器 · 原图对比',scopes:['editor']},editorFit:{key:'0',label:'编辑器 · 适应窗口',scopes:['editor']},
  editorZoomIn:{key:'+',label:'编辑器 · 放大预览',scopes:['editor']},editorZoomOut:{key:'-',label:'编辑器 · 缩小预览',scopes:['editor']},
  editorReference:{key:'ctrl+shift+o',label:'编辑器 · 打开参考图',scopes:['editor'],repeatable:false},editorReset:{key:'ctrl+0',label:'编辑器 · 重置参数',scopes:['editor'],repeatable:false},
  editorCancel:{key:'',label:'编辑器 · 取消处理',scopes:['editor'],repeatable:false},editorReady:{key:'',label:'编辑器 · 标记待导出',scopes:['editor'],repeatable:false},
  editorBatchExport:{key:'',label:'编辑器 · 批量导出',scopes:['editor'],repeatable:false},editorWatermark:{key:'',label:'编辑器 · 送入水印',scopes:['editor'],repeatable:false},editorWatercolor:{key:'',label:'编辑器 · 送入水彩',scopes:['editor'],repeatable:false},
  remove:{key:'Delete',label:'移出图库',scopes:['library','viewer']},selectAll:{key:'ctrl+a',label:'全选当前筛选',scopes:['library']},
  exportSel:{key:'ctrl+e',label:'导出所选（水印流程）',scopes:['library']},help:{key:'?',label:'快捷键帮助',scopes:['library','viewer','editor','other']}
};
export const DEFAULT_BINDINGS:Record<string,string>=Object.fromEntries(Object.entries(SHORTCUTS).map(([id,item])=>[id,item.key]));
export const ACTION_LABELS:Record<string,string>=Object.fromEntries(Object.entries(SHORTCUTS).map(([id,item])=>[id,item.label]));
const KEY='shortcuts';
export const SHORTCUT_CHANGE='photocollection-shortcuts-changed';
function changed(){if(typeof window!=='undefined')window.dispatchEvent(new Event(SHORTCUT_CHANGE));}
const RESERVED=new Set(['Escape','Tab','Control','Meta','Alt','Shift','Unidentified','Process']);
export function getBindings():Record<string,string>{
  const result={...DEFAULT_BINDINGS};
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}'),custom=new Set<string>();if(saved&&typeof saved==='object'&&!Array.isArray(saved))for(const action of Object.keys(SHORTCUTS)){const key=saved[action];if(typeof key==='string'&&key.length>0&&key.length<=80&&!RESERVED.has(key)){result[action]=key;custom.add(action);}}
    for(const action of Object.keys(SHORTCUTS))if(!custom.has(action)&&[...custom].some(other=>result[other]===result[action]&&SHORTCUTS[other].scopes.some(scope=>SHORTCUTS[action].scopes.includes(scope))))result[action]='';
  }catch{}
  return result;
}
export function bindingConflict(action:string,key:string,bindings:Record<string,string>):string|undefined{
  const scopes=SHORTCUTS[action]?.scopes;if(!scopes)return;
  return Object.keys(SHORTCUTS).find(other=>other!==action&&bindings[other]===key&&SHORTCUTS[other].scopes.some(scope=>scopes.includes(scope)));
}
export function saveBinding(action:string,key:string):{ok:boolean;conflict?:string;error?:'invalid'|'storage'}{
  if(!SHORTCUTS[action]||!key||key.length>80||RESERVED.has(key))return {ok:false,error:'invalid'};
  const bindings=getBindings(),conflict=bindingConflict(action,key,bindings);if(conflict)return {ok:false,conflict};
  bindings[action]=key;try{localStorage.setItem(KEY,JSON.stringify(bindings));changed();return {ok:true};}catch{return {ok:false,error:'storage'};}
}
export function resetBindings(){try{localStorage.removeItem(KEY);changed()}catch{}}
export function eventKey(e:{key:string;ctrlKey:boolean;metaKey:boolean;shiftKey?:boolean}):string{const key=e.key.length===1?e.key.toLowerCase():e.key,control=e.ctrlKey||e.metaKey,shift=e.shiftKey&&(control||e.key.length>1||/^[a-z]$/i.test(e.key));return (control?'ctrl+':'')+(shift?'shift+':'')+key}
export function displayKey(key:string):string{return key.replace('ctrl+','Ctrl + ').replace('shift+','Shift + ').replace('ArrowLeft','←').replace('ArrowRight','→').replace('ArrowUp','↑').replace('ArrowDown','↓').replace(/(^| \+ )([a-z])$/,(m,prefix,letter)=>prefix+letter.toUpperCase())}
export function ariaShortcut(key:string):string{return key.replace('ctrl+','Control+').replace('shift+','Shift+').replace(/\+$/,'Plus').replace(/(^|\+)([a-z])$/,(m,prefix,letter)=>prefix+letter.toUpperCase());}
export interface ShortcutContext {scope:ShortcutScope;typing?:boolean;modal?:boolean;recording?:boolean;menu?:boolean}
export function shortcutAction(event:{key:string;ctrlKey:boolean;metaKey:boolean;shiftKey?:boolean;altKey?:boolean;defaultPrevented?:boolean;isComposing?:boolean},bindings:Record<string,string>,context:ShortcutContext):string|undefined{
  if(event.defaultPrevented||event.isComposing||event.altKey||context.typing||context.modal||context.recording||context.menu)return;
  const key=eventKey(event);return Object.keys(SHORTCUTS).find(action=>bindings[action]===key&&SHORTCUTS[action].scopes.includes(context.scope));
}
