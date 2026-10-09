import { useEffect, useState } from 'react';
import { getTimeline, getTimelineYear, getTimelineMonth, getTimelineDay } from './api';
import type { TimelineData, Photo } from './types';
import { ChevronRight, ChevronDown, Calendar } from 'lucide-react';

export default function TimelinePage() {
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [selectedPhotos, setSelectedPhotos] = useState<Photo[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<string>('');

  useEffect(() => {
    getTimeline()
      .then(setTimeline)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const toggleYear = (year: string) => {
    const next = new Set(expandedYears);
    if (next.has(year)) next.delete(year);
    else next.add(year);
    setExpandedYears(next);
  };

  const toggleMonth = (key: string) => {
    const next = new Set(expandedMonths);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedMonths(next);
  };

  const loadPhotos = async (year: string, month?: string, day?: string) => {
    try {
      let result;
      if (day && month) {
        result = await getTimelineDay(year, month, day);
        setSelectedTitle(`${year}年${month}月${day}日`);
      } else if (month) {
        result = await getTimelineMonth(year, month);
        setSelectedTitle(`${year}年${month}月`);
      } else {
        result = await getTimelineYear(year);
        setSelectedTitle(`${year}年`);
      }
      setSelectedPhotos(result.photos);
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return <div className="p-8 text-center">加载时间线...</div>;
  }

  if (!timeline || Object.keys(timeline.years).length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="text-6xl mb-4">📅</div>
        <h2 className="text-2xl font-bold mb-2">暂无时间线数据</h2>
        <p className="text-gray-600">照片库中没有包含拍摄日期的照片</p>
      </div>
    );
  }

  const years = Object.entries(timeline.years).sort(([a], [b]) => b.localeCompare(a));

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <div className="w-80 border-r bg-white overflow-y-auto">
        <div className="p-4 border-b">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            时间线
          </h1>
        </div>
        <div className="py-2">
          {years.map(([year, data]) => (
            <div key={year}>
              <button
                onClick={() => toggleYear(year)}
                className="w-full px-4 py-2 flex items-center gap-2 hover:bg-gray-50 text-left"
              >
                {expandedYears.has(year) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span className="font-medium">{year}年</span>
                <span className="ml-auto text-sm text-gray-500">{data.total} 张</span>
              </button>
              {expandedYears.has(year) && (
                <div className="ml-4">
                  {Object.entries(data.months)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([month, monthData]) => {
                      const monthKey = `${year}-${month}`;
                      return (
                        <div key={monthKey}>
                          <button
                            onClick={() => {
                              toggleMonth(monthKey);
                              loadPhotos(year, month);
                            }}
                            className="w-full px-4 py-1.5 flex items-center gap-2 hover:bg-gray-50 text-left text-sm"
                          >
                            {expandedMonths.has(monthKey) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            <span>{month}月</span>
                            <span className="ml-auto text-xs text-gray-500">{monthData.total} 张</span>
                          </button>
                          {expandedMonths.has(monthKey) && (
                            <div className="ml-6">
                              {Object.entries(monthData.days)
                                .sort(([a], [b]) => b.localeCompare(a))
                                .map(([day, count]) => (
                                  <button
                                    key={day}
                                    onClick={() => loadPhotos(year, month, day)}
                                    className="w-full px-4 py-1 text-left text-xs hover:bg-gray-50 flex items-center"
                                  >
                                    <span>{day}日</span>
                                    <span className="ml-auto text-gray-500">{count} 张</span>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50">
        {selectedPhotos.length > 0 ? (
          <div className="p-4">
            <h2 className="text-lg font-bold mb-4">{selectedTitle}</h2>
            <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {selectedPhotos.map(photo => (
                <a
                  key={photo.id}
                  href={`/photo/${photo.id}`}
                  className="aspect-square bg-white rounded overflow-hidden hover:ring-2 hover:ring-blue-500 transition-shadow"
                >
                  <img
                    src={photo.thumbnail_url}
                    alt={photo.file_name}
                    className="w-full h-full object-cover"
                  />
                </a>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <Calendar className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>选择左侧的时间节点查看照片</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
