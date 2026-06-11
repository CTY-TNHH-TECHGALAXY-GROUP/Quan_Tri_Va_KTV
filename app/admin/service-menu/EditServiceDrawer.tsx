'use client';

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Save, Image as ImageIcon, Tags, Target, Settings2, FileText, Globe, CopyCheck } from 'lucide-react';
import { Service, FocusConfig } from '@/lib/types';
import { updateService, updateServiceBulkSync } from './actions';

interface EditServiceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  service: Service | null;
  onSuccess: () => void;
}

const COMBO_TAGS = [
  { id: 'body', label: 'Body Massage' },
  { id: 'fourhand', label: 'Four Hands' },
  { id: 'foot', label: 'Foot Massage' },
  { id: 'hairwash', label: 'Gội đầu' },
  { id: 'face', label: 'Chăm sóc da mặt' },
  { id: 'heel', label: 'Chà gót chân' },
  { id: 'nail', label: 'Làm móng' },
  { id: 'ear', label: 'Lấy ráy tai' },
  { id: 'shave', label: 'Cạo mặt/râu' },
  { id: 'barber', label: 'Cắt tóc' },
  { id: 'private', label: 'Phòng riêng' },
];

const FOCUS_AREAS = [
  { id: 'head', label: 'Đầu' },
  { id: 'neck', label: 'Cổ' },
  { id: 'shoulders', label: 'Vai' },
  { id: 'arms', label: 'Tay' },
  { id: 'upper_back', label: 'Lưng trên' },
  { id: 'lower_back', label: 'Lưng dưới' },
  { id: 'legs', label: 'Chân' },
  { id: 'feet', label: 'Bàn chân' },
];

export function EditServiceDrawer({ isOpen, onClose, service, onSuccess }: EditServiceDrawerProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBulkSync, setIsBulkSync] = useState(true);

  const [formData, setFormData] = useState<Partial<Service>>({});

  useEffect(() => {
    if (service) {
      setFormData({
        ...service,
        focusConfig: service.focusConfig || {},
        tags: service.tags || [],
        description: typeof service.description === 'string' 
          ? { vn: service.description, en: '', cn: '', jp: '', kr: '' } 
          : (service.description || { vn: '', en: '', cn: '', jp: '', kr: '' }),
      });
    }
  }, [service]);

  if (!service) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    // @ts-ignore
    const checked = type === 'checkbox' ? e.target.checked : undefined;
    
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : type === 'number' ? Number(value) : value
    }));
  };

  const handleDescriptionChange = (lang: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      description: {
        ...(typeof prev.description === 'object' && prev.description !== null ? prev.description : {}),
        [lang]: value
      }
    }));
  };

  const handleFocusAreaToggle = (areaId: string) => {
    setFormData(prev => {
      const focusCfg = { ...(prev.focusConfig as object) } as any;
      focusCfg[areaId] = !focusCfg[areaId];
      return { ...prev, focusConfig: focusCfg };
    });
  };

  const handleTagToggle = (tagId: string) => {
    setFormData(prev => {
      const currentTags = prev.tags || [];
      const newTags = currentTags.includes(tagId)
        ? currentTags.filter(t => t !== tagId)
        : [...currentTags, tagId];
      return { ...prev, tags: newTags };
    });
  };

  const getMultiTags = () => {
    const multi = (formData.tags || []).filter(t => typeof t === 'object' && t !== null) as Record<string, string>[];
    // Always pad to 2 items for UI rendering
    return [
      multi[0] || { vn: '', en: '', cn: '', jp: '', kr: '' },
      multi[1] || { vn: '', en: '', cn: '', jp: '', kr: '' }
    ];
  };

  const handleMultiTagChange = (index: number, lang: string, value: string) => {
    setFormData(prev => {
      const currentTags = prev.tags || [];
      const multi = currentTags.filter(t => typeof t === 'object' && t !== null) as Record<string, string>[];
      const strings = currentTags.filter(t => typeof t === 'string');

      while (multi.length < 2) {
        multi.push({ vn: '', en: '', cn: '', jp: '', kr: '' });
      }

      multi[index] = { ...multi[index], [lang]: value };

      return { ...prev, tags: [...multi, ...strings] };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const payload = {
        category: formData.category,
        duration: formData.duration,
        priceVND: formData.priceVND,
        priceUSD: formData.priceUSD,
        imageUrl: formData.imageUrl,
        
        nameVN: formData.nameVN,
        nameEN: formData.nameEN,
        nameCN: formData.nameCN,
        nameJP: formData.nameJP,
        nameKR: formData.nameKR,

        description: formData.description,
        service_description: formData.service_description,
        procedure: formData.procedure,

        isActive: formData.isActive,
        isBestChoice: formData.isBestChoice,
        isBestSeller: formData.isBestSeller,
        showCustomForYou: formData.showCustomForYou,
        showNotes: formData.showNotes,
        showGender: formData.showGender,
        showStrength: formData.showStrength,
        showFocus: formData.showFocus,

        focusConfig: formData.focusConfig,
        tags: formData.tags?.filter(t => {
            if (typeof t === 'string') return true;
            if (typeof t === 'object' && t !== null) {
                return Object.values(t).some(val => val && String(val).trim() !== '');
            }
            return false;
        }),
    };

    const res = await updateService(service.id, payload);

    if (res.success) {
      if (isBulkSync && service.nameVN) {
        await updateServiceBulkSync(service.nameVN, payload);
      }
      onSuccess();
      onClose();
    } else {
      setError(res.error || 'Đã xảy ra lỗi khi lưu.');
    }
    setIsSubmitting(false);
  };



  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] animate-in fade-in duration-200" />
        {/* Centered Modal */}
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-5xl h-[90vh] bg-white rounded-2xl shadow-2xl z-[70] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
          
          <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-indigo-50/50 shrink-0">
            <div>
              <Dialog.Title className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Settings2 className="text-indigo-600" /> Cấu Hình Dịch Vụ
              </Dialog.Title>
              <p className="text-sm font-medium text-gray-500 mt-1">{service.id} - {service.nameVN || service.name}</p>
            </div>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-white rounded-full transition-colors bg-white/50">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
            {error && (
              <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium flex items-start gap-3">
                <span className="text-lg">⚠️</span>
                {error}
              </div>
            )}

            <form id="edit-service-form" onSubmit={handleSubmit} className="space-y-10">
              
              {/* SECTION 1: CƠ BẢN */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 border-b pb-2">
                  <ImageIcon size={18} className="text-gray-400" />
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Thông tin cơ bản</h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Ảnh đại diện (URL)</label>
                    <input type="text" name="imageUrl" value={formData.imageUrl || formData.image_url || ''} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Danh mục</label>
                    <input type="text" name="category" value={formData.category || ''} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Thời lượng (Phút)</label>
                    <input type="number" name="duration" value={formData.duration || 0} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Giá (VND)</label>
                    <input type="number" name="priceVND" value={formData.priceVND || formData.price || 0} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Giá (USD)</label>
                    <input type="number" step="0.01" name="priceUSD" value={formData.priceUSD || 0} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                  </div>
                </div>
              </section>

              {/* SECTION 2: NGÔN NGỮ */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 border-b pb-2">
                  <Globe size={18} className="text-gray-400" />
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Tên Đa Ngôn Ngữ</h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Tiếng Việt (VN)</label>
                    <input type="text" name="nameVN" value={formData.nameVN || formData.name || ''} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-medium" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Tiếng Anh (EN)</label>
                    <input type="text" name="nameEN" value={formData.nameEN || ''} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Tiếng Trung (CN)</label>
                    <input type="text" name="nameCN" value={formData.nameCN || ''} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Tiếng Nhật (JP)</label>
                    <input type="text" name="nameJP" value={formData.nameJP || ''} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Tiếng Hàn (KR)</label>
                    <input type="text" name="nameKR" value={formData.nameKR || ''} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                  </div>
                </div>
              </section>

              {/* SECTION 2.5: TAG ĐẶC BIỆT ĐA NGÔN NGỮ */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 border-b pb-2">
                  <Tags size={18} className="text-gray-400" />
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Tag Đặc Biệt Đa Ngôn Ngữ (Tối Đa 2)</h3>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {getMultiTags().map((tag, idx) => (
                    <div key={`multi-tag-${idx}`} className="space-y-3 p-4 bg-gray-50 border border-gray-100 rounded-xl">
                      <h4 className="text-xs font-bold text-indigo-700 uppercase">Tag {idx + 1}</h4>
                      
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tiếng Việt (VN)</label>
                        <input type="text" value={tag.vn || ''} onChange={e => handleMultiTagChange(idx, 'vn', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="VD: Mang thai..." />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tiếng Anh (EN)</label>
                          <input type="text" value={tag.en || ''} onChange={e => handleMultiTagChange(idx, 'en', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="Pregnant..." />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tiếng Trung (CN)</label>
                          <input type="text" value={tag.cn || ''} onChange={e => handleMultiTagChange(idx, 'cn', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tiếng Nhật (JP)</label>
                          <input type="text" value={tag.jp || ''} onChange={e => handleMultiTagChange(idx, 'jp', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tiếng Hàn (KR)</label>
                          <input type="text" value={tag.kr || ''} onChange={e => handleMultiTagChange(idx, 'kr', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* SECTION 3: MÔ TẢ & QUY TRÌNH */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 border-b pb-2">
                  <FileText size={18} className="text-gray-400" />
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Nội dung & Quy trình</h3>
                </div>
                
                <div className="space-y-4">
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1 flex items-center justify-between">
                      Mô tả hiển thị cho Khách đa ngôn ngữ
                      <span className="text-[10px] font-normal text-gray-400 normal-case">(Lưu dạng văn bản thuần)</span>
                    </label>
                    <div className="space-y-3 p-4 bg-gray-50 border border-gray-100 rounded-xl">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tiếng Việt (VN)</label>
                        <textarea rows={2} value={formData.description?.vn || ''} onChange={e => handleDescriptionChange('vn', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tiếng Anh (EN)</label>
                          <textarea rows={2} value={formData.description?.en || ''} onChange={e => handleDescriptionChange('en', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tiếng Trung (CN)</label>
                          <textarea rows={2} value={formData.description?.cn || ''} onChange={e => handleDescriptionChange('cn', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tiếng Nhật (JP)</label>
                          <textarea rows={2} value={formData.description?.jp || ''} onChange={e => handleDescriptionChange('jp', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tiếng Hàn (KR)</label>
                          <textarea rows={2} value={formData.description?.kr || ''} onChange={e => handleDescriptionChange('kr', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Quy định / Lưu ý phụ</label>
                    <textarea 
                      name="service_description" 
                      rows={2}
                      value={formData.service_description || ''} 
                      onChange={handleChange} 
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1 flex items-center justify-between">
                      Quy trình cho Kỹ Thuật Viên
                      <span className="text-[10px] font-normal text-amber-600 normal-case bg-amber-50 px-2 py-0.5 rounded">Hiện trên điện thoại KTV</span>
                    </label>
                    <textarea 
                      name="procedure" 
                      rows={4}
                      value={formData.procedure || ''} 
                      onChange={handleChange} 
                      placeholder="Bước 1: ...&#10;Bước 2: ..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono text-xs" 
                    />
                  </div>
                </div>
              </section>

              {/* SECTION 4: TOGGLE FLAGS (TRẠNG THÁI & CUSTOM FOR YOU) */}
              <section className="space-y-4 bg-gray-50 -mx-6 px-6 py-6 border-y border-gray-100">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest mb-4">Cấu Hình Hiển Thị & Chức Năng</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Cột 1: Trạng thái */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-gray-500 uppercase">Trạng thái Dịch vụ</h4>
                    
                    <label className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-colors">
                      <span className="text-sm font-medium text-gray-700">Đang Bán (isActive)</span>
                      <input type="checkbox" name="isActive" checked={formData.isActive !== false} onChange={handleChange} className="w-5 h-5 accent-indigo-600 rounded" />
                    </label>
                    
                    <label className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl cursor-pointer hover:border-amber-300 transition-colors">
                      <span className="text-sm font-medium text-gray-700">Bán Chạy (Best Seller)</span>
                      <input type="checkbox" name="isBestSeller" checked={!!formData.isBestSeller} onChange={handleChange} className="w-5 h-5 accent-amber-500 rounded" />
                    </label>
                    
                    <label className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl cursor-pointer hover:border-blue-300 transition-colors">
                      <span className="text-sm font-medium text-gray-700">Gợi Ý (Best Choice)</span>
                      <input type="checkbox" name="isBestChoice" checked={!!formData.isBestChoice} onChange={handleChange} className="w-5 h-5 accent-blue-500 rounded" />
                    </label>
                  </div>

                  {/* Cột 2: Custom For You */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-gray-500 uppercase">Settings: Custom For You</h4>
                    
                    <label className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-colors">
                      <span className="text-sm font-medium text-gray-700">Bật "Custom For You"</span>
                      <input type="checkbox" name="showCustomForYou" checked={formData.showCustomForYou !== false} onChange={handleChange} className="w-5 h-5 accent-indigo-600 rounded" />
                    </label>
                    
                    <label className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-colors">
                      <span className="text-sm font-medium text-gray-700">Cho phép Nhập Ghi chú</span>
                      <input type="checkbox" name="showNotes" checked={formData.showNotes !== false} onChange={handleChange} className="w-5 h-5 accent-indigo-600 rounded" />
                    </label>
                    
                    <label className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-colors">
                      <span className="text-sm font-medium text-gray-700">Chọn Lực đấm</span>
                      <input type="checkbox" name="showStrength" checked={formData.showStrength !== false} onChange={handleChange} className="w-5 h-5 accent-indigo-600 rounded" />
                    </label>
                    
                    <label className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-colors">
                      <span className="text-sm font-medium text-gray-700">Chọn Giới tính KTV</span>
                      <input type="checkbox" name="showGender" checked={formData.showGender !== false} onChange={handleChange} className="w-5 h-5 accent-indigo-600 rounded" />
                    </label>

                    <label className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-colors">
                      <span className="text-sm font-medium text-gray-700">Chọn Vị trí (Focus/Avoid)</span>
                      <input type="checkbox" name="showFocus" checked={formData.showFocus !== false} onChange={handleChange} className="w-5 h-5 accent-indigo-600 rounded" />
                    </label>
                  </div>
                </div>
              </section>

              {/* SECTION 5: TAGS VÀ FOCUS AREAS */}
              <section className="space-y-6">
                
                {/* COMBO TAGS */}
                <div>
                  <div className="flex items-center gap-2 border-b pb-2 mb-4">
                    <Tags size={18} className="text-gray-400" />
                    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Gắn Nhãn (Combo Tags)</h3>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">Chọn các nhãn phân loại dịch vụ để hỗ trợ hệ thống Gợi Ý Combo tự động sinh ra sau này.</p>
                  
                  <div className="flex flex-wrap gap-2">
                    {COMBO_TAGS.map(tag => {
                      const isSelected = formData.tags?.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => handleTagToggle(tag.id)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                            isSelected 
                              ? 'bg-indigo-100 border-indigo-200 text-indigo-700' 
                              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {tag.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* FOCUS AREAS */}
                <div>
                  <div className="flex items-center gap-2 border-b pb-2 mb-4">
                    <Target size={18} className="text-gray-400" />
                    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Vị Trí Tập Trung (Focus Area)</h3>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">Khách có thể chọn khu vực mỏi khi đặt lịch trong hộp thoại Custom For You của dịch vụ này.</p>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {FOCUS_AREAS.map(area => {
                      const focusCfg: any = formData.focusConfig || {};
                      const isSelected = !!focusCfg[area.id];
                      return (
                        <label 
                          key={area.id}
                          className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                            isSelected ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <input 
                            type="checkbox" 
                            checked={isSelected}
                            onChange={() => handleFocusAreaToggle(area.id)}
                            className="w-4 h-4 accent-indigo-600"
                          />
                          <span className={`text-sm ${isSelected ? 'font-medium text-indigo-900' : 'text-gray-700'}`}>
                            {area.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

              </section>

              {/* Bottom Padding for scrollbar */}
              <div className="h-4"></div>
            </form>
          </div>

          <div className="p-6 border-t border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
            <div className="flex-1 mr-6">
              <label className="flex items-center gap-2.5 p-2.5 bg-white border border-indigo-100 rounded-xl cursor-pointer hover:border-indigo-300 transition-colors group">
                <input 
                  type="checkbox" 
                  checked={isBulkSync}
                  onChange={(e) => setIsBulkSync(e.target.checked)}
                  className="w-5 h-5 accent-indigo-600 rounded shrink-0" 
                />
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-indigo-900 group-hover:text-indigo-700 flex items-center gap-1.5">
                    <CopyCheck size={16} />
                    Đồng bộ hàng loạt
                  </span>
                  <span className="text-xs text-gray-500 font-medium">
                    Áp dụng ngôn ngữ, mô tả, tag cho tất cả dịch vụ cùng tên "{service.nameVN}" (60p, 90p...)
                  </span>
                </div>
              </label>
            </div>
            
            <div className="flex gap-3 shrink-0">
              <button 
                type="button" 
                onClick={onClose} 
                disabled={isSubmitting} 
                className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-white font-medium transition-colors"
              >
                Hủy
              </button>
              <button 
                type="submit" 
                form="edit-service-form" 
                disabled={isSubmitting} 
                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-medium transition-colors disabled:opacity-70 disabled:cursor-not-allowed shadow-sm"
              >
                {isSubmitting ? (
                  <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin"></div>
                ) : (
                  <> <Save size={18} /> Lưu Thay Đổi</>
                )}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
