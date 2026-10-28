import {useEffect,useState} from 'react';
import {bt} from '../browser/text';
import {message} from '../api';
import {annotationView} from '../core/photo-annotation';
import type {MetadataChanges} from '../core/photo-annotation';
import type {Photo} from '../types';

export default function PhotoAnnotations({photo,onChange,notify}:{photo:Photo;onChange:(changes:MetadataChanges)=>Promise<void>;notify:(text:string)=>void}){
  const view=annotationView(photo),[text,setText]=useState(photo.user_description??photo.annotation?.caption??''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
  useEffect(()=>{if(!dirty)setText(photo.user_description??photo.annotation?.caption??'');},[photo.user_description,photo.annotation?.revision,dirty]);
  async function save(changes:MetadataChanges){setBusy(true);try{await onChange(changes);if(Object.hasOwn(changes,'user_description')){setDirty(false);setText(changes.user_description??photo.annotation?.caption??'');}notify(bt('照片整理信息已保存','Photo notes saved'));}catch(e){notify(message(e));}finally{setBusy(false);}}
  return <section className="photo-annotations" aria-label={bt('描述与标签来源','Description and tag sources')}>
    <label>{bt('人工描述','Manual description')}<textarea aria-label={bt('人工描述','Manual description')} rows={3} maxLength={4000} value={text} disabled={busy} onChange={e=>{setDirty(true);setText(e.target.value);}}/></label>
    <p className="muted">{bt('当前描述来源：','Description source: ')}{view.description_source==='user'?bt('人工','Manual'):view.description_source==='ai'?'AI':bt('未设置','Not set')}</p>
    <div className="button-row"><button disabled={busy} onClick={()=>void save({user_description:text})}>{bt('保存描述','Save description')}</button><button disabled={busy||photo.user_description==null} onClick={()=>void save({user_description:null})}>{bt('恢复使用 AI 描述','Use AI description')}</button></div>
    <p className="muted">{bt('留空后保存会保持空白；恢复后可显示 AI 描述。','Saving an empty description keeps it blank. Use AI description to restore the automatic text.')}</p>
    {photo.annotation&&<details><summary>{bt('AI 标注记录','AI annotation record')}</summary><p>{photo.annotation.provider} · {photo.annotation.model}</p><p className="annotation-text">{photo.annotation.caption}</p>{photo.annotation.detected_text&&<p className="annotation-text">{bt('识别文字：','Detected text: ')}{photo.annotation.detected_text}</p>}</details>}
    {photo.tags.length>0&&<details className="tag-provenance"><summary>{bt('标签来源与确认','Tag sources and review')} · {photo.tags.length}</summary>{photo.tags.map(tag=><div className="tag-origin-row" key={tag}><span>{tag} · {view.tag_origins[tag]==='ai'?'AI':bt('人工','Manual')}</span>{view.tag_origins[tag]==='ai'&&<button disabled={busy} aria-label={bt('转为人工标签：','Keep as manual tag: ')+tag} onClick={()=>void save({add_tags:[tag]})}>{bt('转为人工','Keep as manual')}</button>}<button disabled={busy} aria-label={bt('移除标签：','Remove tag: ')+tag} onClick={()=>void save({remove_tags:[tag]})}>{bt('移除','Remove')}</button></div>)}</details>}
    {view.rejected_ai_tags.length>0&&<details className="rejected-tags"><summary>{bt('已拒绝的标签','Rejected tags')} · {view.rejected_ai_tags.length}</summary><p className="muted">{bt('这些标签不会被 AI 重标注自动加回。','AI relabeling will not add these tags back.')}</p>{view.rejected_ai_tags.map(tag=><div className="tag-origin-row" key={tag}><span>{tag}</span><button disabled={busy} aria-label={bt('重新允许标签：','Allow tag again: ')+tag} onClick={()=>void save({restore_ai_tags:[tag]})}>{bt('重新允许','Allow again')}</button></div>)}</details>}
  </section>;
}
