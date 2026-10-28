import {useEffect,useMemo,useState,useRef} from 'react';
import {Plus,Trash2} from 'lucide-react';
import {api,message} from './api';
import {t} from './i18n';
import {Modal} from './components';
import MediaImage from './media/MediaImage';
import {photoURL} from './runtime';
import {QUERY_FIELDS,normalizePhotoQuery} from './core/photo-query';
import type {PhotoQuery,QueryNode,QueryLeaf,QueryField,QueryValue} from './core/photo-query';
import type {Album,Photo} from './types';

const names:Record<QueryField,string>={orientation:'画幅',text:'全部文字',description:'当前描述',user_description:'人工描述',ai_caption:'AI 原始描述',detected_text:'识别文字',file_name:'文件名称',camera_make:'相机品牌',camera_model:'相机型号',lens_model:'镜头型号',color_label:'颜色标签',file_format:'文件格式',tag:'标签',rating:'评分',flag:'选片标记',favorite:'收藏',is_raw:'RAW 文件',date_taken:'拍摄时间',created_at:'导入时间',width:'宽度',height:'高度',focal_length:'焦距',focal_length_35mm:'等效焦距',f_number:'光圈',iso:'ISO',exposure_seconds:'快门秒数'};
const operations:Record<QueryLeaf['op'],string>={eq:'等于',ne:'不等于',lt:'小于',lte:'小于或等于',gt:'大于',gte:'大于或等于',contains:'包含文字',icontains:'包含（忽略大小写）',in:'属于任一值',is_null:'未设置',not_null:'已设置'};
const condition=(field:QueryField='rating'):QueryLeaf=>({op:field==='rating'?'gte':'eq',field,value:QUERY_FIELDS[field]==='shape'?'landscape':QUERY_FIELDS[field]==='flag'?'picked':QUERY_FIELDS[field]==='boolean'?true:['number','rating'].includes(QUERY_FIELDS[field])?field==='rating'?4:0:QUERY_FIELDS[field]==='date'?'2026-01-01T00:00:00':''});

function MembershipInput({leaf,onChange}:{leaf:QueryLeaf;onChange:(leaf:QueryLeaf)=>void}){
  const format=()=>Array.isArray(leaf.value)?leaf.value.join(', '):String(leaf.value??'');
  const [text,setText]=useState(format),last=useRef(JSON.stringify(leaf.value));
  useEffect(()=>{const next=JSON.stringify(leaf.value);if(next!==last.current)setText(format());last.current=next;},[leaf.value]);
  return <input aria-label={t('条件值')} maxLength={4096} value={text} onChange={e=>{
    const raw=e.target.value,kind=QUERY_FIELDS[leaf.field];setText(raw);
    const values=raw.split(/[,，]/).map(s=>{const v=s.trim();return ['number','rating'].includes(kind)?v===''?NaN:Number(v):kind==='boolean'?v==='true'?true:v==='false'?false:v:v;});
    last.current=JSON.stringify(values);onChange({...leaf,value:values});
  }}/>;
}

function RuleNode({value,onChange,depth=0}:{value:QueryNode;onChange:(node:QueryNode)=>void;depth?:number}){
  const negative=value.op==='not',content=value.op==='not'?value.child:value;
  const change=(node:QueryNode)=>onChange(negative?{op:'not',child:node}:node);
  const negate=<label className="query-not"><input type="checkbox" checked={negative} onChange={()=>onChange(negative?content:{op:'not',child:content})}/>{t('排除 · NOT')}</label>;
  if(content.op==='not')return <fieldset className="query-group query-negative">{negate}<RuleNode value={content} onChange={change} depth={depth+1}/></fieldset>;
  if(content.op==='and'||content.op==='or')return <fieldset className={'query-group'+(negative?' query-negative':'')}><div className="query-group-heading"><label>{t('匹配关系')}<select aria-label={t('匹配关系')} value={content.op} onChange={e=>change({...content,op:e.target.value as 'and'|'or'})}><option value="and">{t('全部满足 · AND')}</option><option value="or">{t('任一满足 · OR')}</option></select></label>{negate}</div>
    {content.children.map((child,index)=><div className="query-child" key={index}><RuleNode value={child} depth={depth+1} onChange={next=>change({...content,children:content.children.map((old,i)=>i===index?next:old)})}/><button className="icon" aria-label={t('移除条件')} disabled={content.children.length===1} onClick={()=>change({...content,children:content.children.filter((_,i)=>i!==index)})}><Trash2 size={15}/></button></div>)}
    <div className="query-add"><button disabled={content.children.length>=32} onClick={()=>change({...content,children:[...content.children,condition()]})}><Plus size={14}/>{t('添加条件')}</button>{depth<4&&<button disabled={content.children.length>=32} onClick={()=>change({...content,children:[...content.children,{op:'or',children:[condition('camera_model')]}]})}>{t('添加分组')}</button>}</div></fieldset>;
  const leaf=content as QueryLeaf,kind=QUERY_FIELDS[leaf.field],nullOp=leaf.op==='is_null'||leaf.op==='not_null';
  const ops:QueryLeaf['op'][]=['eq','ne',...(['text','tag'].includes(kind)?['contains' as const,'icontains' as const]:[]),...(['number','rating','date'].includes(kind)?['lt' as const,'lte' as const,'gt' as const,'gte' as const]:[]),'in','is_null','not_null'];
  function changeOperator(op:QueryLeaf['op']){const fallback=condition(leaf.field).value as QueryValue,current=leaf.value??fallback;change(op==='is_null'||op==='not_null'?{op,field:leaf.field}:{op,field:leaf.field,value:op==='in'?(Array.isArray(current)?current:[current]):Array.isArray(current)?current[0]:current});}
  return <div className="query-leaf"><label>{t('照片字段')}<select aria-label={t('照片字段')} value={leaf.field} onChange={e=>change(condition(e.target.value as QueryField))}>{Object.entries(names).map(([key,name])=><option key={key} value={key}>{t(name)}</option>)}</select></label><label>{t('条件')}<select aria-label={t('条件')} value={leaf.op} onChange={e=>changeOperator(e.target.value as QueryLeaf['op'])}>{ops.map(op=><option key={op} value={op}>{t(operations[op])}</option>)}</select></label>
    {!nullOp&&<label className="query-value">{t(leaf.op==='in'?'条件值（逗号分隔）':'条件值')}{leaf.op==='in'?<MembershipInput key={leaf.field} leaf={leaf} onChange={change}/>:kind==='flag'?<select aria-label={t('条件值')} value={String(leaf.value)} onChange={e=>change({...leaf,value:e.target.value})}><option value="picked">{t('留用')}</option><option value="rejected">{t('排除')}</option><option value="unmarked">{t('未标记')}</option></select>:kind==='shape'?<select aria-label={t('条件值')} value={String(leaf.value)} onChange={e=>change({...leaf,value:e.target.value})}><option value="landscape">{t('横幅')}</option><option value="portrait">{t('竖幅')}</option><option value="square">{t('方形')}</option></select>:kind==='boolean'?<select aria-label={t('条件值')} value={String(leaf.value)} onChange={e=>change({...leaf,value:e.target.value==='true'})}><option value="true">{t('是')}</option><option value="false">{t('否')}</option></select>:<input aria-label={t('条件值')} type={['number','rating'].includes(kind)?'number':'text'} min={0} max={kind==='rating'?5:1e12} step={kind==='rating'?1:'any'} maxLength={256} placeholder={kind==='date'?'YYYY-MM-DDTHH:MM:SS':undefined} value={Array.isArray(leaf.value)?leaf.value.join(', '):typeof leaf.value==='number'&&!Number.isFinite(leaf.value)?'':String(leaf.value??'')} onChange={e=>{const text=e.target.value;change({...leaf,value:['number','rating'].includes(kind)?text===''?NaN:Number(text):text});}}/>}</label>}{negate}</div>;
}

export default function RuleAlbumDialog({album,onClose,onSaved}:{album:Album|null;onClose:()=>void;onSaved:(saved:Album)=>void}){
  const [name,setName]=useState(album?.name||''),[value,setValue]=useState<PhotoQuery>(album?.query||{version:1,root:{op:'and',children:[condition()]}}),[preview,setPreview]=useState<{total:number;candidates:Photo[]}|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const validated=useMemo(()=>{try{return {query:normalizePhotoQuery(value),error:''};}catch(e){return {query:null,error:message(e)};}},[value]);
  useEffect(()=>{const controller=new AbortController();setPreview(null);setError('');if(!validated.query)return()=>controller.abort();const timer=setTimeout(()=>{void api<{total:number;candidates:Photo[]}>('/albums/rules/preview','POST',{query:validated.query},controller.signal).then(result=>{if(!controller.signal.aborted)setPreview(result);}).catch(e=>{if(!controller.signal.aborted)setError(message(e));});},300);return()=>{clearTimeout(timer);controller.abort();};},[validated]);
  async function save(){if(!validated.query||!name.trim())return;setSaving(true);setError('');try{const saved=await api<Album>(album?'/albums/'+album.id:'/albums',album?'PATCH':'POST',{name:name.trim(),...(album?{}:{type:'rule'}),query:validated.query});onSaved(saved);}catch(e){setError(message(e));}finally{setSaving(false);}}
  return <Modal title={album?t('编辑条件集合'):t('新建条件集合')} wide onClose={()=>{if(!saving)onClose();}}><div className="rule-album-form"><label>{t('影集名称')}<input autoFocus value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></label><p className="muted">{t('照片信息改变后自动更新；未评分与零分分别匹配。')}</p><fieldset disabled={saving} className="query-editor"><RuleNode value={value.root} onChange={root=>setValue({version:1,root})}/></fieldset>
    {validated.error||error?<p role="alert">{validated.error||error}</p>:<p role="status">{preview?t('匹配 {0} 次拍摄',{0:preview.total}):t('正在统计…')}</p>}
    {preview&&!!preview.candidates.length&&<div className="rule-preview">{preview.candidates.map(photo=><figure key={photo.id}><MediaImage src={photoURL(photo.id)} alt={photo.file_name}/><figcaption>{photo.file_name}</figcaption></figure>)}</div>}
    <footer className="modal-footer"><button disabled={saving} onClick={onClose}>{t('取消')}</button><button className="primary" disabled={saving||!name.trim()||!validated.query} onClick={()=>void save()}>{saving?t('正在保存…'):t('保存条件集合')}</button></footer></div></Modal>;
}
