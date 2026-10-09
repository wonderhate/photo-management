import { useState } from 'react';
import { X } from 'lucide-react';
import { batchEditPhotos } from './api';
import { RatingStars, ColorLabelPicker } from './RatingColorLabel';
import type { Photo } from './types';

interface BatchEditDialogProps {
  photos: Photo[];
  onClose: () => void;
  onComplete: () => void;
}

export default function BatchEditDialog({ photos, onClose, onComplete }: BatchEditDialogProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [colorLabel, setColorLabel] = useState<string | null>(null);
  const [addTags, setAddTags] = useState('');
  const [removeTags, setRemoveTags] = useState('');
  const [clearRating, setClearRating] = useState(false);
  const [clearColor, setClearColor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        photo_ids: photos.map(p => p.id),
        clear_rating: clearRating,
        clear_color_label: clearColor,
      };

      if (rating !== null) payload.rating = rating;
      if (colorLabel !== null) payload.color_label = colorLabel;
      if (addTags.trim()) payload.add_tags = addTags.split(',').map(t => t.trim()).filter(Boolean);
      if (removeTags.trim()) payload.remove_tags = removeTags.split(',').map(t => t.trim()).filter(Boolean);

      await batchEditPhotos(payload);
      onComplete();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">批量编辑</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-sm text-gray-600">
            已选择 {photos.length} 张照片
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">评分</label>
            <div className="flex items-center gap-3">
              <RatingStars rating={rating} onChange={setRating} size="lg" />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={clearRating}
                  onChange={e => setClearRating(e.target.checked)}
                  className="rounded"
                />
                清除评分
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">颜色标签</label>
            <div className="flex items-center gap-3">
              <ColorLabelPicker color={colorLabel} onChange={setColorLabel} size="lg" />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={clearColor}
                  onChange={e => setClearColor(e.target.checked)}
                  className="rounded"
                />
                清除颜色标签
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">添加标签</label>
            <input
              type="text"
              value={addTags}
              onChange={e => setAddTags(e.target.value)}
              placeholder="用逗号分隔多个标签"
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">移除标签</label>
            <input
              type="text"
              value={removeTags}
              onChange={e => setRemoveTags(e.target.value)}
              placeholder="用逗号分隔多个标签"
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded"
            disabled={saving}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            disabled={saving}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
