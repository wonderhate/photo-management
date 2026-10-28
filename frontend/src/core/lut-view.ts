export type LogMark='auto'|'log'|'normal';
export type LutView={columns:1|2|3;filter:'all'|'favorite'|'recent'|'hidden';hideLog:boolean;strength:number;treeExpanded?:boolean;[key:`mark:${string}`]:LogMark;[key:`fold:${string}`]:boolean;[key:`collapse:${string}`]:boolean};
export const lutViewDefaults:LutView={columns:1,filter:'all',hideLog:false,strength:1};
export function validLutViewField(key:string,value:unknown){
  if(key==='columns')return typeof value==='number'&&[1,2,3].includes(value);
  if(key==='filter')return ['all','favorite','recent','hidden'].includes(value as string);
  if(key==='hideLog'||key==='treeExpanded')return typeof value==='boolean';
  if(key==='strength')return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
  if(/^collapse:(favorite|recent|other|hidden)$/.test(key))return typeof value==='boolean';
  if(/^fold:(?:[a-f0-9-]{36}|library):[a-zA-Z0-9%_.!~*'()-]{0,18432}$/.test(key))return typeof value==='boolean';
  return /^mark:[a-f0-9]{64}$/.test(key)&&['auto','log','normal'].includes(value as string);
}
export function lutTreeOpen(view:LutView,key:`fold:${string}`){return view[key]??view.treeExpanded??false;}
export function lutTreeAll(view:LutView,open:boolean):Partial<LutView>{
  const patch:Partial<LutView>={treeExpanded:open};
  for(const key of Object.keys(view))if(key.startsWith('fold:'))patch[key as `fold:${string}`]=open;
  return patch;
}
// Keep the column when the last row is shorter.
export function lutStep(index:number,count:number,columns:number,key:string){
  if(!count)return -1;if(index<0)return 0;
  if(key==='ArrowLeft')return Math.max(0,index-1);
  if(key==='ArrowRight')return Math.min(count-1,index+1);
  const row=Math.floor(index/columns),next=row+(key==='ArrowUp'?-1:1);
  return next<0||next*columns>=count?index:Math.min(count-1,next*columns+index%columns);
}
