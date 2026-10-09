import { useState, useEffect } from 'react';
import { getComparePhotos } from './api';
import type { Photo } from './types';
import { X, ZoomIn, ZoomOut } from 'lucide-react';

export default function ComparePage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ids = params.get('ids')?.split(',').filter(Boolean) || [];
    if (ids.length >= 2) {
      setSelectedIds(ids);
      loadCompare(ids);
    }
  }, []);

  const loadCompare = async (ids: string[]) => {
    setLoading(true);
    try {
      const result = await getComparePhotos(ids);
      setPhotos(result.photos);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const addPhotoToCompare = () => {
    const input = prompt('输入照片 ID（用逗号分隔多个）:');
    if (input) {
      const newIds = input.split(',').map(s => s.trim()).filter(Boolean);
      const combined = [...new Set([...selectedIds, ...newIds])].slice(0, 4);
      setSelectedIds(combined);
      loadCompare(combined);
    }
  };

  const removePhoto = (id: string) => {
    const newIds = selectedIds.filter(i => i !== id);
    setSelectedIds(newIds);
    if (newIds.length >= 2) {
      loadCompare(newIds);
    } else {
      setPhotos([]);
    }
  };

  const gridClass = photos.length === 2 ? 'grid-cols-2' : photos.length === 3 ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-gray-900">
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">照片对比</h1>
          <p className="text-sm text-gray-600">{photos.length} 张照片</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
            className="p-2 hover:bg-gray-100 rounded"
            title="缩小"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-sm w-16 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(z => Math.min(3, z + 0.25))}
            className="p-2 hover:bg-gray-100 rounded"
            title="放大"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <button
            onClick={addPhotoToCompare}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            添加照片
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-white">
            加载中...
          </div>
        ) : photos.length < 2 ? (
          <div className="flex items-center justify-center h-full text-white">
            <div className="text-center">
              <div className="text-6xl mb-4">🔍</div>
              <h2 className="text-2xl font-bold mb-2">选择照片进行对比</h2>
              <p className="text-gray-400 mb-4">至少选择 2 张照片开始对比</p>
              <button
                onClick={addPhotoToCompare}
                className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                选择照片
              </button>
            </div>
          </div>
        ) : (
          <div className={`grid ${gridClass} gap-4 h-full`}>
            {photos.map(photo => (
              <div key={photo.id} className="relative bg-black rounded overflow-hidden flex flex-col">
                <div className="absolute top-2 right-2 z-10">
                  <button
                    onClick={() => removePhoto(photo.id)}
                    className="p-1 bg-black/50 hover:bg-black/70 rounded text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-auto flex items-center justify-center p-2">
                  <img
                    src={photo.preview_url || photo.thumbnail_url}
                    alt={photo.file_name}
                    style={{ transform: `scale(${zoom})` }}
                    className="max-w-full max-h-full object-contain transition-transform"
                  />
                </div>
                <div className="bg-black/80 text-white p-2 text-xs space-y-1">
                  <div className="font-medium truncate">{photo.file_name}</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-300">
                    {photo.camera_model && <div>相机: {photo.camera_model}</div>}
                    {photo.lens_model && <div>镜头: {photo.lens_model}</div>}
                    {photo.focal_length && <div>焦距: {photo.focal_length}mm</div>}
                    {photo.f_number && <div>光圈: f/{photo.f_number}</div>}
                    {photo.exposure_time && <div>快门: {photo.exposure_time}s</div>}
                    {photo.iso && <div>ISO: {photo.iso}</div>}
                    {photo.date_taken && (
                      <div>时间: {new Date(photo.date_taken).toLocaleString('zh-CN')}</div>
                    )}
                    {photo.width && photo.height && <div>尺寸: {photo.width}×{photo.height}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
