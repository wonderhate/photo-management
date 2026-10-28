import {useEffect,useState} from 'react';
import {api,message} from '../api';
import {bt} from '../browser/text';
import type {AssetKind,DerivedGraph} from '../core/derived-graph';

const kindName=(kind:string)=>({'ai-result':bt('AI结果','AI result'),photo:bt('照片','Photo'),capture:bt('拍摄分组','Capture group'),raw:bt('登记的 RAW 来源','Registered RAW source'),edit:bt('暗房工程','Edit document'),variant:bt('派生副本','Derived variant'),watercolor:bt('水彩作品','Watercolor'),watermark:bt('水印草稿','Watermark draft'),collage:bt('拼图工程','Collage project'),'collage-output':bt('拼图成品','Collage output'),split:bt('切图分组','Split group')}[kind]||kind);
const relation=(kind:string)=>({'ai-source':bt('AI创作来源','AI source'),'ai-version':bt('AI结果版本','AI result version'),'capture-member':bt('属于拍摄分组','Capture membership'),'raw-source':bt('人工确认的 RAW 关联','Manually confirmed RAW link'),'edit-source':bt('编辑来源','Edit source'),'rendered-from':bt('渲染自','Rendered from'),'watermark-source':bt('水印来源','Watermark source'),'watercolor-source':bt('水彩来源','Watercolor source'),'collage-source':bt('拼图来源','Collage source'),'split-source':bt('切图来源','Split source')}[kind]||kind);
export default function AssetRelationships({kind='photo',id}:{kind?:AssetKind;id:string}){
  const [open,setOpen]=useState(false),[focus,setFocus]=useState({kind,id}),[graph,setGraph]=useState<DerivedGraph|null>(null),[error,setError]=useState('');
  useEffect(()=>{setFocus({kind,id});setGraph(null);},[kind,id]);
  useEffect(()=>{if(!open)return;const controller=new AbortController();setGraph(null);setError('');void api<DerivedGraph>('/assets/graph?'+new URLSearchParams(focus),'GET',undefined,controller.signal).then(setGraph).catch(e=>{if(!controller.signal.aborted)setError(message(e));});return()=>controller.abort();},[open,focus]);
  const nodes=new Map(graph?.nodes?.map(n=>[n.key,n])||[]);
  return <details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{bt('来源与派生关系','Sources and derived works')}</summary>{open&&<>
    <p className="muted">{bt('拍摄分组、人工 RAW 关联与编辑派生分别记录。版本号指向保存时使用的版本，不随之后修改而改变。','Capture membership, manual RAW links and derived works are separate relationships. Version numbers identify the saved source revision.')}</p>
    {error&&<p role="alert">{error}</p>}{!graph&&!error&&<p>{bt('正在读取关系…','Loading relationships…')}</p>}
    {graph&&<><ul style={{paddingInlineStart:18}}>{graph.nodes.map(node=><li key={node.key}><button className="quiet" disabled={node.key===graph.focus||node.missing} onClick={()=>setFocus({kind:node.kind,id:node.id})}>{kindName(node.kind)} · {node.name}</button>{node.revision!==undefined&&<small> · v{node.revision}</small>}{node.removed&&<small> · {bt('已移出，可恢复','Removed; recoverable')}</small>}{node.missing&&<small> · {bt('历史来源记录','Historical source record')}</small>}</li>)}</ul><ul style={{paddingInlineStart:18}}>{graph.links.map((edge,i)=><li key={i} style={{overflowWrap:'anywhere'}}>{nodes.get(edge.from)?.name} → {nodes.get(edge.to)?.name}<small> · {relation(edge.kind)}{edge.revision!==undefined?' · v'+edge.revision:''}</small></li>)}</ul>{graph.truncated&&<p className="muted">{bt('此视图最多显示 80 个节点和 6 层关系；点击节点继续查看。','Showing up to 80 records and six relationship levels; choose a record to continue.')}</p>}</>}
    {(focus.id!==id||focus.kind!==kind)&&<button onClick={()=>setFocus({kind,id})}>{bt('返回当前照片','Return to this source')}</button>}
  </>}</details>;
}
