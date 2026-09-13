'use client';

import React, { useState, useEffect } from 'react';
import { X, Save, Image as ImageIcon, Plus, Trash2, Globe, Sparkles } from 'lucide-react';
import { getDeepBodyConfig, updateDeepBodyConfig } from './actions';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'cn', label: '中文 (Chinese)', flag: '🇨🇳' },
  { code: 'jp', label: '日本語 (Japanese)', flag: '🇯🇵' },
  { code: 'kr', label: '한국어 (Korean)', flag: '🇰🇷' },
] as const;

type LangCode = typeof LANGUAGES[number]['code'];

export function DeepBodySettingsModal({ isOpen, onClose }: Props) {
  const [config, setConfig] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [globalLang, setGlobalLang] = useState<LangCode>('vi');
  // Per-card language override map: { [itemIndex]: LangCode }
  const [cardLangs, setCardLangs] = useState<{ [key: number]: LangCode }>({});

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
      alert('Đã lưu cấu hình Deep Body 5 ngôn ngữ thành công!');
      onClose();
    } else {
      alert('Lỗi: ' + res.error);
    }
    setSaving(false);
  };

  const handleItemChange = (index: number, path: string[], value: any) => {
    setConfig(prev => {
      const newConfig = JSON.parse(JSON.stringify(prev));
      let current: any = newConfig[index];
      for (let i = 0; i < path.length - 1; i++) {
        if (!current[path[i]] || typeof current[path[i]] !== 'object') {
          current[path[i]] = {};
        }
        current = current[path[i]];
      }
      current[path[path.length - 1]] = value;
      return newConfig;
    });
  };

  const handleTechGalleryAdd = (index: number) => {
    setConfig(prev => {
      const newConfig = JSON.parse(JSON.stringify(prev));
      if (!Array.isArray(newConfig[index].techniqueGallery)) {
        newConfig[index].techniqueGallery = [];
      }
      newConfig[index].techniqueGallery.push('');
      return newConfig;
    });
  };

  const handleTechGalleryChange = (index: number, imgIndex: number, value: string) => {
    setConfig(prev => {
      const newConfig = JSON.parse(JSON.stringify(prev));
      newConfig[index].techniqueGallery[imgIndex] = value;
      return newConfig;
    });
  };

  const handleTechGalleryRemove = (index: number, imgIndex: number) => {
    setConfig(prev => {
      const newConfig = JSON.parse(JSON.stringify(prev));
      newConfig[index].techniqueGallery.splice(imgIndex, 1);
      return newConfig;
    });
  };

  const handleGlobalLangChange = (lang: LangCode) => {
    setGlobalLang(lang);
    setCardLangs({}); // reset overrides to follow global
  };

  const setItemLang = (index: number, lang: LangCode) => {
    setCardLangs(prev => ({ ...prev, [index]: lang }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-gray-100">
        
        {/* MODAL HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 border-b border-gray-100 bg-white gap-4 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={20} className="text-purple-600" />
              <h2 className="text-xl font-bold text-gray-900">Cấu Hình Nội Dung Deep Body (5 Ngôn Ngữ)</h2>
            </div>
            <p className="text-xs text-gray-500 mt-1">Chỉnh sửa tên, mô tả, ảnh thumbnail, gallery và các ngôn ngữ cho trang Deep Body.</p>
          </div>

          {/* GLOBAL LANGUAGE SWITCHER */}
          <div className="flex items-center gap-1.5 p-1 bg-gray-100 rounded-xl self-start sm:self-auto border border-gray-200">
            <span className="text-[11px] font-bold text-gray-400 uppercase px-2 flex items-center gap-1">
              <Globe size={13} />
            </span>
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                onClick={() => handleGlobalLangChange(lang.code)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  globalLang === lang.code
                    ? 'bg-white text-purple-700 shadow-sm border border-purple-100'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                }`}
              >
                <span>{lang.flag}</span>
                <span className="hidden md:inline">{lang.label}</span>
                <span className="md:hidden uppercase">{lang.code}</span>
              </button>
            ))}
          </div>

          <button 
            onClick={onClose} 
            className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        
        {/* MODAL BODY */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6 bg-gray-50/70">
          {loading ? (
            <div className="text-center py-16 text-gray-400 font-medium">Đang tải dữ liệu cấu hình...</div>
          ) : config.length === 0 ? (
            <div className="text-center py-16 text-gray-400">Không tìm thấy dữ liệu `menu_deep_body_config`.</div>
          ) : (
            config.map((item, index) => {
              const currentLang = cardLangs[index] || globalLang;
              const currentLangMeta = LANGUAGES.find(l => l.code === currentLang) || LANGUAGES[0];

              return (
                <div key={item.id || index} className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm hover:shadow transition-shadow">
                  
                  {/* CARD TOP BAR: TITLE + ITEM LANGUAGE TABS */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-100 gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 font-bold text-sm shrink-0">
                        {index + 1}
                      </div>
                      <div>
                        <h3 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                          <span>{item.name?.[currentLang] || item.name?.vi || item.id}</span>
                          <span className="text-xs px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 font-mono font-normal">
                            {item.id}
                          </span>
                        </h3>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Đang xem ngôn ngữ: <strong className="text-purple-700">{currentLangMeta.flag} {currentLangMeta.label}</strong>
                        </p>
                      </div>
                    </div>

                    {/* CARD SPECIFIC LANGUAGE SWITCHER */}
                    <div className="flex items-center gap-1 p-0.5 bg-gray-50 rounded-lg border border-gray-200 self-start sm:self-auto">
                      {LANGUAGES.map(lang => (
                        <button
                          key={lang.code}
                          type="button"
                          onClick={() => setItemLang(index, lang.code)}
                          className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all ${
                            currentLang === lang.code
                              ? 'bg-purple-600 text-white shadow-xs'
                              : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                          }`}
                          title={lang.label}
                        >
                          <span className="mr-1">{lang.flag}</span>
                          <span className="uppercase">{lang.code}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* MEDIA (THUMBNAIL) */}
                  <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide">Ảnh Thumbnail (URL)</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          value={item.thumbnail || ''} 
                          onChange={e => handleItemChange(index, ['thumbnail'], e.target.value)}
                          placeholder="/assets/images/treatments/..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-xs bg-white"
                        />
                        {item.thumbnail ? (
                          <img src={item.thumbnail} alt="thumbnail" className="w-10 h-10 object-cover rounded-lg border border-gray-200 shrink-0 bg-white" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-300 shrink-0 bg-white">
                            <ImageIcon size={16} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* MULTI-LANGUAGE FIELDS FOR ACTIVE LANGUAGE */}
                  <div className="space-y-4 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md border border-purple-100 flex items-center gap-1.5">
                        <span>{currentLangMeta.flag}</span>
                        <span>Nội dung ({currentLangMeta.label})</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-gray-700">
                          Tên phương pháp ({currentLangMeta.code.toUpperCase()})
                        </label>
                        <input 
                          type="text" 
                          value={item.name?.[currentLang] || ''} 
                          onChange={e => handleItemChange(index, ['name', currentLang], e.target.value)}
                          placeholder={`Nhập tên (${currentLangMeta.label})...`}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm font-medium"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-gray-700">
                          Huy hiệu nổi bật / Badge ({currentLangMeta.code.toUpperCase()})
                        </label>
                        <input 
                          type="text" 
                          value={item.badge?.[currentLang] || ''} 
                          onChange={e => handleItemChange(index, ['badge', currentLang], e.target.value)}
                          placeholder="Ví dụ: Dưỡng Ẩm & Thư Giãn, Thermal Therapy..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-gray-700">
                        Mô tả ngắn - Short Description ({currentLangMeta.code.toUpperCase()})
                      </label>
                      <textarea 
                        rows={2}
                        value={item.shortDesc?.[currentLang] || ''} 
                        onChange={e => handleItemChange(index, ['shortDesc', currentLang], e.target.value)}
                        placeholder={`Mô tả ngắn gọn bằng ${currentLangMeta.label}...`}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-gray-700">
                        Mô tả chi tiết đầy đủ - Full Description ({currentLangMeta.code.toUpperCase()})
                      </label>
                      <textarea 
                        rows={3}
                        value={item.fullDesc?.[currentLang] || ''} 
                        onChange={e => handleItemChange(index, ['fullDesc', currentLang], e.target.value)}
                        placeholder={`Mô tả chi tiết quy trình, tác dụng bằng ${currentLangMeta.label}...`}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-gray-700">
                        Khuyên dùng cho / Phù hợp với - Recommended For ({currentLangMeta.code.toUpperCase()})
                      </label>
                      <input 
                        type="text" 
                        value={item.recommendedFor?.[currentLang] || ''} 
                        onChange={e => handleItemChange(index, ['recommendedFor', currentLang], e.target.value)}
                        placeholder="Ví dụ: Người đau mỏi lưng cổ vai gáy, mất ngủ..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                      />
                    </div>
                  </div>

                  {/* TECHNIQUE GALLERY */}
                  <div className="space-y-2 pt-2 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide">
                        Ảnh Technique Gallery ({item.techniqueGallery?.length || 0} ảnh)
                      </label>
                      <button 
                        type="button"
                        onClick={() => handleTechGalleryAdd(index)} 
                        className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-700 hover:bg-purple-50 px-2 py-1 rounded-md transition-colors"
                      >
                        <Plus size={14} /> Thêm ảnh Gallery
                      </button>
                    </div>

                    <div className="space-y-2">
                      {(item.techniqueGallery || []).map((img: string, imgIndex: number) => (
                        <div key={imgIndex} className="flex gap-2 items-center">
                          <input 
                            type="text" 
                            value={img} 
                            onChange={e => handleTechGalleryChange(index, imgIndex, e.target.value)}
                            placeholder="/assets/images/treatments/..."
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-xs"
                          />
                          {img ? (
                            <img src={img} alt="gallery" className="w-9 h-9 object-cover rounded-lg border border-gray-200 shrink-0" />
                          ) : (
                            <div className="w-9 h-9 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-300 shrink-0">
                              <ImageIcon size={14} />
                            </div>
                          )}
                          <button 
                            type="button"
                            onClick={() => handleTechGalleryRemove(index, imgIndex)} 
                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                            title="Xóa ảnh này"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              );
            })
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="p-4 sm:p-5 border-t border-gray-100 flex items-center justify-between gap-3 shrink-0 bg-white">
          <div className="text-xs text-gray-400 hidden sm:block">
            Mẹo: Nhấn chọn ngôn ngữ ở thanh trên cùng để chuyển nhanh toàn bộ các mục sang ngôn ngữ đó.
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <button 
              type="button"
              onClick={onClose} 
              className="px-5 py-2.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium text-sm transition-colors"
            >
              Đóng
            </button>
            <button 
              type="button"
              onClick={handleSave} 
              disabled={saving || loading}
              className="flex items-center gap-2 px-6 py-2.5 text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl font-semibold text-sm shadow-md shadow-purple-200 transition-all active:scale-[0.98]"
            >
              <Save size={17} />
              {saving ? 'Đang lưu...' : 'Lưu Thay Đổi (5 Ngôn Ngữ)'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
