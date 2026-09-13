'use client';

import React, { useState, useEffect } from 'react';
import { X, Save, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import { getDeepBodyConfig, updateDeepBodyConfig } from './actions';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function DeepBodySettingsModal({ isOpen, onClose }: Props) {
  const [config, setConfig] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    const res = await getDeepBodyConfig();
    if (res.success && Array.isArray(res.data)) {
      setConfig(res.data);
    } else {
      setConfig([]);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const res = await updateDeepBodyConfig(config);
    if (res.success) {
      alert('Đã lưu cấu hình Deep Body!');
      onClose();
    } else {
      alert('Lỗi: ' + res.error);
    }
    setSaving(false);
  };

  const handleItemChange = (index: number, path: string[], value: any) => {
    const newConfig = [...config];
    let current: any = newConfig[index];
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) current[path[i]] = {};
      current = current[path[i]];
    }
    current[path[path.length - 1]] = value;
    setConfig(newConfig);
  };

  const handleTechGalleryAdd = (index: number) => {
    const newConfig = [...config];
    if (!newConfig[index].techniqueGallery) newConfig[index].techniqueGallery = [];
    newConfig[index].techniqueGallery.push('');
    setConfig(newConfig);
  };

  const handleTechGalleryChange = (index: number, imgIndex: number, value: string) => {
    const newConfig = [...config];
    newConfig[index].techniqueGallery[imgIndex] = value;
    setConfig(newConfig);
  };

  const handleTechGalleryRemove = (index: number, imgIndex: number) => {
    const newConfig = [...config];
    newConfig[index].techniqueGallery.splice(imgIndex, 1);
    setConfig(newConfig);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
        <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
          <h2 className="text-xl font-bold text-gray-900">Cấu Hình Nội Dung Deep Body</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 space-y-8 bg-gray-50">
          {loading ? (
            <div className="text-center py-10 text-gray-500">Đang tải cấu hình...</div>
          ) : (
            config.map((item, index) => (
              <div key={item.id || index} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4 shadow-sm">
                <h3 className="text-lg font-bold text-indigo-700">{item.name?.vi || item.id}</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-gray-700">Tên (Tiếng Việt)</label>
                    <input 
                      type="text" 
                      value={item.name?.vi || ''} 
                      onChange={e => handleItemChange(index, ['name', 'vi'], e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-gray-700">Ảnh Thumbnail (URL)</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={item.thumbnail || ''} 
                        onChange={e => handleItemChange(index, ['thumbnail'], e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                      />
                      {item.thumbnail && <img src={item.thumbnail} className="w-10 h-10 object-cover rounded-lg border" />}
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Mô tả ngắn (Short Desc - Tiếng Việt)</label>
                  <textarea 
                    rows={2}
                    value={item.shortDesc?.vi || ''} 
                    onChange={e => handleItemChange(index, ['shortDesc', 'vi'], e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Mô tả đầy đủ (Full Desc - Tiếng Việt)</label>
                  <textarea 
                    rows={3}
                    value={item.fullDesc?.vi || ''} 
                    onChange={e => handleItemChange(index, ['fullDesc', 'vi'], e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">Ảnh Technique Gallery</label>
                  <div className="flex flex-col gap-2">
                    {(item.techniqueGallery || []).map((img: string, imgIndex: number) => (
                      <div key={imgIndex} className="flex gap-2 items-center">
                        <input 
                          type="text" 
                          value={img} 
                          onChange={e => handleTechGalleryChange(index, imgIndex, e.target.value)}
                          className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                        />
                        {img && <img src={img} className="w-10 h-10 object-cover rounded-lg border" />}
                        <button onClick={() => handleTechGalleryRemove(index, imgIndex)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => handleTechGalleryAdd(index)} className="mt-2 flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700">
                    <Plus size={16} /> Thêm ảnh Gallery
                  </button>
                </div>

              </div>
            ))
          )}
        </div>

        <div className="p-6 border-t border-gray-100 flex justify-end gap-3 shrink-0 bg-white">
          <button onClick={onClose} className="px-5 py-2.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium transition-colors">
            Đóng
          </button>
          <button 
            onClick={handleSave} 
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl font-medium shadow-sm shadow-indigo-200 transition-all"
          >
            <Save size={18} />
            {saving ? 'Đang lưu...' : 'Lưu Thay Đổi'}
          </button>
        </div>
      </div>
    </div>
  );
}
