import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { getMapPhotos } from './api';
import type { MapPhoto } from './types';
import 'leaflet/dist/leaflet.css';

const photoIcon = L.icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiMzYjgyZjYiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPgo8L3N2Zz4K',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12]
});

function FitBounds({ photos }: { photos: MapPhoto[] }) {
  const map = useMap();
  useEffect(() => {
    if (photos.length > 0) {
      const bounds = L.latLngBounds(photos.map(p => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [photos, map]);
  return null;
}

export default function MapPage() {
  const [photos, setPhotos] = useState<MapPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMapPhotos()
      .then(setPhotos)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-8 text-center">加载地图数据...</div>;
  }

  if (error) {
    return <div className="p-8 text-center text-red-600">错误: {error}</div>;
  }

  if (photos.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="text-6xl mb-4">🗺️</div>
        <h2 className="text-2xl font-bold mb-2">暂无地理位置数据</h2>
        <p className="text-gray-600">照片库中没有包含 GPS 信息的照片</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)]">
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">地图视图</h1>
          <p className="text-sm text-gray-600">{photos.length} 张照片包含地理位置</p>
        </div>
      </div>
      <MapContainer
        center={[35.8617, 104.1954]}
        zoom={4}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds photos={photos} />
        {photos.map(photo => (
          <Marker
            key={photo.id}
            position={[photo.latitude, photo.longitude]}
            icon={photoIcon}
          >
            <Popup>
              <div className="text-center">
                <img
                  src={photo.thumbnail}
                  alt={photo.file_name}
                  className="w-32 h-32 object-cover rounded mb-2"
                />
                <div className="text-sm font-medium">{photo.file_name}</div>
                {photo.date_taken && (
                  <div className="text-xs text-gray-500">
                    {new Date(photo.date_taken).toLocaleDateString('zh-CN')}
                  </div>
                )}
                {photo.altitude !== null && (
                  <div className="text-xs text-gray-500">
                    海拔: {photo.altitude.toFixed(0)}m
                  </div>
                )}
                <a
                  href={`/photo/${photo.id}`}
                  className="text-xs text-blue-600 hover:underline mt-1 block"
                >
                  查看详情
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
