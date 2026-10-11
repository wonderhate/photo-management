import {t} from './i18n';
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
      notify(t("已更新 {0} 张照片",{0:photoIds.length}));
      onComplete();
      onClose();
    }catch(e){notify(e instanceof Error?e.message:t("保存失败"))}finally{setSaving(false)}
  }

  return <Modal title={t("批量编辑 · {0} 张照片",{0:photoIds.length})} onClose={onClose}>
    <div className="batch-edit-content">
      <div className="batch-edit-section"><span>{t("评分")}</span><div className="row"><RatingStars rating={rating} onChange={setRating} size={20}/><label className="check"><input type="checkbox" checked={clearRating} onChange={e=>setClearRating(e.target.checked)}/>{t("清除评分")}</label></div></div>
      <div className="batch-edit-section"><span>{t("颜色标签")}</span><div className="row"><ColorLabelPicker color={colorLabel} onChange={setColorLabel}/><label className="check"><input type="checkbox" checked={clearColor} onChange={e=>setClearColor(e.target.checked)}/>{t("清除颜色标签")}</label></div></div>
      <div className="batch-edit-section"><span>{t("添加标签")}</span><input type="text" value={addTags} onChange={e=>setAddTags(e.target.value)} placeholder={t("用逗号分隔，如：人像，旅行")}/></div>
      <div className="batch-edit-section"><span>{t("移除标签")}</span><input type="text" value={removeTags} onChange={e=>setRemoveTags(e.target.value)} placeholder={t("用逗号分隔要移除的标签")}/></div>
      <footer className="modal-footer"><button onClick={onClose} disabled={saving}>{t("取消")}</button><button className="primary" disabled={saving} onClick={handleSave}>{saving?t("保存中…"):t("保存")}</button></footer>
    </div>
  </Modal>;
}
