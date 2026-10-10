export const DEFAULT_BINDINGS:Record<string,string>={prev:'ArrowLeft',next:'ArrowRight',favorite:'f',tag:'t',remove:'Delete',selectAll:'ctrl+a',exportSel:'ctrl+e',help:'?'};
export const ACTION_LABELS:Record<string,string>={prev:'详情 · 上一张',next:'详情 · 下一张',favorite:'收藏 / 取消收藏',tag:'聚焦标签输入框',remove:'移出图库',selectAll:'全选当前筛选',exportSel:'导出所选（水印流程）',help:'快捷键帮助'};
const KEY='shortcuts';
export function getBindings():Record<string,string>{try{return {...DEFAULT_BINDINGS,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return {...DEFAULT_BINDINGS}}}
export function saveBinding(action:string,key:string){const bindings=getBindings();bindings[action]=key;try{localStorage.setItem(KEY,JSON.stringify(bindings))}catch{}}
export function resetBindings(){try{localStorage.removeItem(KEY)}catch{}}
export function eventKey(e:{key:string;ctrlKey:boolean;metaKey:boolean}):string{const key=e.key.length===1?e.key.toLowerCase():e.key;return (e.ctrlKey||e.metaKey?'ctrl+':'')+key}
export function displayKey(key:string):string{return key.replace('ctrl+','Ctrl + ').replace('ArrowLeft','←').replace('ArrowRight','→').replace('ArrowUp','↑').replace('ArrowDown','↓').replace(/^([a-z])$/,m=>m.toUpperCase())}
