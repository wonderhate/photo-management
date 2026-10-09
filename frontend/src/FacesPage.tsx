import { useState, useEffect } from 'react';
import { getFacePersons, createFacePerson, renameFacePerson, deleteFacePerson, getFaceStatus } from './api';
import type { FacePerson } from './types';
import { Users, Plus, Edit2, Trash2, AlertCircle } from 'lucide-react';

export default function FacesPage() {
  const [persons, setPersons] = useState<FacePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const status = await getFaceStatus();
      setAvailable(status.available);
      if (status.available) {
        const data = await getFacePersons();
        setPersons(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      await createFacePerson(newName.trim());
      setNewName('');
      setShowAdd(false);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await renameFacePerson(id, editName.trim());
      setEditingId(null);
      setEditName('');
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重命名失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此人物吗？')) return;
    try {
      await deleteFacePerson(id);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  if (loading) {
    return <div className="p-8 text-center">加载中...</div>;
  }

  if (!available) {
    return (
      <div className="p-8">
        <div className="max-w-2xl mx-auto text-center">
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-yellow-500" />
          <h2 className="text-2xl font-bold mb-2">人脸识别功能不可用</h2>
          <p className="text-gray-600 mb-4">
            需要安装 face-recognition 库才能使用人脸识别功能
          </p>
          <div className="bg-gray-50 rounded-lg p-4 text-left">
            <p className="font-medium mb-2">安装方法：</p>
            <code className="block bg-gray-900 text-green-400 p-3 rounded text-sm">
              .\.venv\Scripts\pip.exe install face-recognition
            </code>
            <p className="text-sm text-gray-600 mt-2">
              注意：face-recognition 需要 CMake 和 Visual Studio Build Tools
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" />
            人物相册
          </h1>
          <p className="text-sm text-gray-600 mt-1">{persons.length} 个人物</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          添加人物
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="输入人物名称"
            className="w-full px-3 py-2 border rounded mb-2"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              创建
            </button>
            <button
              onClick={() => { setShowAdd(false); setNewName(''); }}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {persons.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Users className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p>还没有人物</p>
          <p className="text-sm">点击"添加人物"开始创建人物相册</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {persons.map(person => (
            <div key={person.id} className="bg-white border rounded-lg overflow-hidden hover:shadow-md transition-shadow">
              <div className="aspect-square bg-gray-100 flex items-center justify-center">
                <Users className="w-16 h-16 text-gray-300" />
              </div>
              <div className="p-3">
                {editingId === person.id ? (
                  <div>
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="w-full px-2 py-1 border rounded text-sm mb-2"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleRename(person.id)}
                        className="flex-1 px-2 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditName(''); }}
                        className="flex-1 px-2 py-1 text-gray-700 hover:bg-gray-100 rounded text-sm"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 className="font-medium truncate">{person.name}</h3>
                    <p className="text-sm text-gray-500">{person.photo_count} 张照片</p>
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={() => { setEditingId(person.id); setEditName(person.name); }}
                        className="flex-1 px-2 py-1 text-sm hover:bg-gray-100 rounded flex items-center justify-center gap-1"
                      >
                        <Edit2 className="w-3 h-3" />
                        重命名
                      </button>
                      <button
                        onClick={() => handleDelete(person.id)}
                        className="flex-1 px-2 py-1 text-sm text-red-600 hover:bg-red-50 rounded flex items-center justify-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
