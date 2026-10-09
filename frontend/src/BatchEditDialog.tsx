import {useState} from 'react';
import {Modal} from './components';
import {batchEditPhotos} from './api';
import {RatingStars,ColorLabelPicker} from './RatingColorLabel';

export default function BatchEditDialog({photoIds,onClose,onComplete,notify}:{photoIds:string[];onClose:()=>void;onComplete:()=>void;notify:(msg:string)=>void}){
  const [rating,setRating]=useState<number|null>(null);
  const [colorLabel,setColorLabel]=useState<string|null>(null);
  const [addTags,setAddTags]=useState('');
  const [removeTags,setRemoveTags]=useState('');
  const [clearRating,setClearRating]=useState(false);
  const [clearColor,setClearColor]=useState(false);
  const [saving,setSaving]=useState(false);

  async function handleSave(){
    setSaving(true);
    try{
      const payload:import('./types').BatchEditPayload={photo_ids:photoIds,clear_rating:clearRating,clear_color_label:clearColor};
      if(rating!==null)payload.rating=rating;
      if(colorLabel!==null)payload.color_label=colorLabel;
      if(addTags.trim())payload.add_tags=addTags.split(/[,，]/).map(t=>t.trim()).filter(Boolean);
      if(removeTags.trim())payload.remove_tags=removeTags.split(/[,，]/).map(t=>t.trim()).filter(Boolean);
      await batchEditPhotos(payload);
      notify(`已更新 ${photoIds.length} 张照片`);
      onComplete();
      onClose();
    }catch(e){notify(e instanceof Error?e.message:'保存失败')}finally{setSaving(false)}
  }

  return <Modal title={`批量编辑 · ${photoIds.length} 张照片`} onClose={onClose}>
    <div className="batch-edit-content">
      <div className="batch-edit-section"><span>评分</span><div className="row"><RatingStars rating={rating} onChange={setRating} size={20}/><label className="check"><input type="checkbox" checked={clearRating} onChange={e=>setClearRating(e.target.checked)}/>清除评分</label></div></div>
      <div className="batch-edit-section"><span>颜色标签</span><div className="row"><ColorLabelPicker color={colorLabel} onChange={setColorLabel}/><label className="check"><input type="checkbox" checked={clearColor} onChange={e=>setClearColor(e.target.checked)}/>清除颜色标签</label></div></div>
      <div className="batch-edit-section"><span>添加标签</span><input type="text" value={addTags} onChange={e=>setAddTags(e.target.value)} placeholder="用逗号分隔，如：人像，旅行"/></div>
      <div className="batch-edit-section"><span>移除标签</span><input type="text" value={removeTags} onChange={e=>setRemoveTags(e.target.value)} placeholder="用逗号分隔要移除的标签"/></div>
      <footer className="modal-footer"><button onClick={onClose} disabled={saving}>取消</button><button className="primary" disabled={saving} onClick={handleSave}>{saving?'保存中…':'保存'}</button></footer>
    </div>
  </Modal>;
}
