'use client';

import React, { useState, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, User, Phone, Mail, CreditCard, Calendar, Ruler, Weight, Award, CheckCircle2, Briefcase, Edit2, Save, GraduationCap, Zap, BookOpen, Key, Loader2, Upload } from 'lucide-react';
import { Employee, SkillLevel, GalleryItem } from '@/lib/types';
import { SKILL_KEYS, SKILL_LABELS } from '@/lib/constants/staff.constants';
import { updateStaffMember } from '@/app/admin/employees/actions';
import {
  checkGalleryDuplicate,
  removeGalleryItemByIndex,
  GALLERY_GROUPS,
  GalleryGroupId,
  createGalleryItem,
  getGalleryGroup,
  isGalleryImageUrl,
} from '@/lib/galleryHelper';
export {
  checkGalleryDuplicate,
  removeGalleryItemByIndex,
  GALLERY_GROUPS,
  createGalleryItem,
  getGalleryGroup,
};

interface EmployeeDetailModalProps {
  employee: Employee | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: (updatedEmployee: Employee) => void;
}

export function EmployeeDetailModal({ employee, isOpen, onClose, onUpdate }: EmployeeDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [galleryUrlDrafts, setGalleryUrlDrafts] = useState<
    Partial<Record<GalleryGroupId, string>>
  >({});
  const [galleryUrlErrors, setGalleryUrlErrors] = useState<
    Partial<Record<GalleryGroupId, string>>
  >({});
  const [uploadingGroups, setUploadingGroups] = useState<
    Partial<Record<GalleryGroupId, boolean>>
  >({});
  const [uploadErrors, setUploadErrors] = useState<
    Partial<Record<GalleryGroupId, string>>
  >({});
  const [editedEmployee, setEditedEmployee] = useState<Employee | null>(employee);
  const gallerySessionRef = useRef(0);

  React.useEffect(() => {
    gallerySessionRef.current += 1;
    setEditedEmployee(employee);
    setGalleryUrlDrafts({});
    setGalleryUrlErrors({});
    setUploadingGroups({});
    setUploadErrors({});
    return () => {
      gallerySessionRef.current += 1;
    };
  }, [employee, isOpen]);

  const getItemUrl = (item: string | GalleryItem): string =>
    typeof item === 'string' ? item : item?.url ?? '';

  const isSkillActive = (value: unknown): boolean =>
    value === true || (typeof value === 'string' && value !== '' && value !== 'none');

  const addGalleryUrlToGroup = (groupId: GalleryGroupId) => {
    const url = (galleryUrlDrafts[groupId] ?? '').trim();
    if (!url || !editedEmployee) return;

    if (!isGalleryImageUrl(url)) {
      setGalleryUrlErrors((current) => ({
        ...current,
        [groupId]: 'Vui lòng nhập URL ảnh http:// hoặc https:// hợp lệ.',
      }));
      return;
    }

    const item = createGalleryItem(url, groupId);
    if (checkGalleryDuplicate(editedEmployee.galleryUrls ?? [], item)) {
      setGalleryUrlErrors((current) => ({
        ...current,
        [groupId]: 'Ảnh này đã có trong nhóm.',
      }));
      return;
    }

    setEditedEmployee((current) => {
      if (!current) return current;
      const gallery = current.galleryUrls ?? [];
      if (checkGalleryDuplicate(gallery, item)) return current;
      return { ...current, galleryUrls: [...gallery, item] };
    });

    setGalleryUrlDrafts((current) => ({ ...current, [groupId]: '' }));
    setGalleryUrlErrors((current) => ({ ...current, [groupId]: '' }));
  };

  const handleFileUpload = async (groupId: GalleryGroupId, files: FileList | null) => {
    if (
      !files ||
      files.length === 0 ||
      !editedEmployee ||
      !isOpen ||
      isSaving ||
      uploadingGroups[groupId]
    ) return;

    const sessionAtStart = gallerySessionRef.current;
    const employeeIdAtStart = editedEmployee.id;
    const isCurrentSession = () => gallerySessionRef.current === sessionAtStart;

    setUploadingGroups((prev) => ({ ...prev, [groupId]: true }));
    setUploadErrors((prev) => ({ ...prev, [groupId]: '' }));

    try {
      const fileArray = Array.from(files);
      const newItems: Array<string | GalleryItem> = [];
      const errors: string[] = [];

      for (const file of fileArray) {
        if (!isCurrentSession()) return;

        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          errors.push(`"${file.name}": Chỉ chấp nhận JPG, PNG, WebP.`);
          continue;
        }
        if (file.size === 0) {
          errors.push(`"${file.name}": File rỗng.`);
          continue;
        }
        if (file.size > 5 * 1024 * 1024) {
          errors.push(`"${file.name}": Vượt quá dung lượng 5MB.`);
          continue;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('staffId', employeeIdAtStart);
        formData.append('groupId', groupId);

        try {
          const res = await fetch('/api/admin/employees/upload-gallery', {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          if (!isCurrentSession()) return;

          if (!res.ok || !data.success || !data.url) {
            errors.push(`"${file.name}": ${data.error || 'Lỗi tải ảnh'}`);
            continue;
          }

          const item = createGalleryItem(data.url, groupId);
          newItems.push(item);
        } catch (err: any) {
          if (!isCurrentSession()) return;
          errors.push(`"${file.name}": ${err.message || 'Lỗi kết nối'}`);
        }
      }

      if (!isCurrentSession()) return;

      if (newItems.length > 0) {
        setEditedEmployee((current) => {
          if (
            !isCurrentSession() ||
            !current ||
            current.id !== employeeIdAtStart
          ) return current;

          const gallery = [...(current.galleryUrls ?? [])];
          for (const item of newItems) {
            if (!checkGalleryDuplicate(gallery, item)) {
              gallery.push(item);
            }
          }

          return {
            ...current,
            galleryUrls: gallery,
          };
        });
      }

      if (errors.length > 0) {
        if (isCurrentSession()) {
          setUploadErrors((prev) => ({
            ...prev,
            [groupId]: errors.join('; '),
          }));
        }
      }
    } finally {
      if (isCurrentSession()) {
        setUploadingGroups((current) => ({
          ...current,
          [groupId]: false,
        }));
      }
    }
  };

  const removeGalleryUrl = (indexToRemove: number) => {
    if (!editedEmployee) return;
    setEditedEmployee({
      ...editedEmployee,
      galleryUrls: removeGalleryItemByIndex(editedEmployee.galleryUrls || [], indexToRemove),
    });
  };

  if (!employee || !editedEmployee) return null;

  const toggleSkill = (skillKey: keyof Employee['skills']) => {
    if (!isEditing) return;

    setEditedEmployee(prev => {
      if (!prev) return null;

      const rawLevel = prev.skills?.[skillKey];
      const isCurrentlySkilled = rawLevel === true || (rawLevel as any) === 'basic' || (rawLevel as any) === 'expert' || (rawLevel as any) === 'training';

      return {
        ...prev,
        skills: {
          ...prev.skills,
          [skillKey]: !isCurrentlySkilled
        }
      };
    });
  };

  const handleSave = async () => {
    if (!editedEmployee) return;
    setIsSaving(true);
    console.log('[EmployeeDetailModal] Saving...', editedEmployee.id, { skills: editedEmployee.skills });
    try {
      // Call server action to persist to DB
      const result = await updateStaffMember(editedEmployee.id, editedEmployee);
      console.log('[EmployeeDetailModal] Save result:', result);
      if (result.success) {
        // Update local state in parent
        if (onUpdate) onUpdate(editedEmployee);
        setIsEditing(false);
        alert('✅ Đã lưu thành công!');
      } else {
        alert(`❌ Lỗi khi lưu: ${result.error}`);
      }
    } catch (err: any) {
      console.error('[EmployeeDetailModal] Save error:', err);
      alert(`❌ Lỗi hệ thống: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const updateField = (field: keyof Employee, value: any) => {
    setEditedEmployee(prev => {
      if (!prev) return null;
      return { ...prev, [field]: value };
    });
  };

  const levelInfo: Record<string, { label: string, color: string, icon: React.ReactNode }> = {
    'false': { label: 'Chưa có', color: 'text-gray-400 bg-gray-50 border-gray-100 opacity-50', icon: <X size={12} /> },
    'true': { label: 'Có tay nghề', color: 'text-emerald-700 bg-emerald-50 border-emerald-100', icon: <CheckCircle2 size={12} /> },
  };

  const handleCloseModal = () => {
    gallerySessionRef.current += 1;
    onClose();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleCloseModal();
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] animate-in fade-in duration-200" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl z-[70] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
          <div className="relative h-32 bg-indigo-600">
            <div className="absolute top-4 right-4 flex gap-2 z-10">
              {isEditing ? (
                <button
                  onClick={handleSave}
                  disabled={isSaving || Object.values(uploadingGroups).some(Boolean)}
                  className={`p-2 text-white rounded-full transition-colors shadow-lg flex items-center gap-2 px-4 ${
                    isSaving || Object.values(uploadingGroups).some(Boolean)
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-emerald-500 hover:bg-emerald-600'
                  }`}
                >
                  {isSaving || Object.values(uploadingGroups).some(Boolean) ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Save size={18} />
                  )}
                  <span className="text-sm font-bold">
                    {isSaving
                      ? 'Đang lưu...'
                      : Object.values(uploadingGroups).some(Boolean)
                      ? 'Đang tải ảnh...'
                      : 'Lưu'}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 bg-white/20 hover:bg-white/30 text-white rounded-full transition-colors flex items-center gap-2 px-4"
                >
                  <Edit2 size={18} />
                  <span className="text-sm font-bold">Sửa tay nghề</span>
                </button>
              )}
              <button
                onClick={handleCloseModal}
                className="p-2 bg-white/20 hover:bg-white/30 text-white rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="absolute -bottom-12 left-8">
              <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-4 border-white shadow-lg bg-gray-100">
                <img
                  src={employee.photoUrl}
                  alt={employee.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>
          </div>

          <div className="pt-16 px-8 pb-8 overflow-y-auto">
            <Dialog.Title className="text-2xl font-bold text-gray-900">{editedEmployee.name}</Dialog.Title>
            <Dialog.Description className="sr-only">
              Chi tiết hồ sơ nhân viên {editedEmployee.name}
            </Dialog.Description>

            <div className="flex justify-between items-start mb-6 mt-2">
              <div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-indigo-600 font-bold text-sm tracking-wider">{editedEmployee.code}</span>
                  <span className="text-gray-300">•</span>
                  {isEditing ? (
                    <select
                      value={editedEmployee.status || 'active'}
                      onChange={(e) => updateField('status', e.target.value)}
                      className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 outline-none cursor-pointer ${editedEmployee.status === 'active' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}
                    >
                      <option value="active" className="bg-white text-gray-900">Đang hoạt động</option>
                      <option value="inactive" className="bg-white text-gray-900">Đã nghỉ</option>
                    </select>
                  ) : (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${editedEmployee.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}>
                      {editedEmployee.status === 'active' ? 'Đang hoạt động' : 'Đã nghỉ'}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-gray-900">{editedEmployee.position}</div>
                <div className="text-xs text-gray-500 mt-1">{editedEmployee.experience} kinh nghiệm</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <User size={14} /> Thông tin cá nhân
                </h3>
                <div className="space-y-3">
                  <InfoItem label="Ngày sinh" value={editedEmployee.dob} icon={<Calendar size={14} />} isEditing={isEditing} onChange={(val) => updateField('dob', val)} />
                  <InfoItem label="Giới tính" value={editedEmployee.gender} isEditing={isEditing} onChange={(val) => updateField('gender', val)} />
                  <InfoItem label="Số CCCD" value={editedEmployee.idCard} isEditing={isEditing} onChange={(val) => updateField('idCard', val)} />
                  <InfoItem label="Chiều cao" value={editedEmployee.height} icon={<Ruler size={14} />} isEditing={isEditing} onChange={(val) => updateField('height', val)} />
                  <InfoItem label="Cân nặng" value={editedEmployee.weight} icon={<Weight size={14} />} isEditing={isEditing} onChange={(val) => updateField('weight', val)} />

                  {isEditing ? (
                    <div className="space-y-3 mt-4 pt-4 border-t border-gray-100">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editedEmployee.isActiveVipMenu || false} onChange={(e) => updateField('isActiveVipMenu', e.target.checked)} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm font-medium text-gray-700">Hiển thị trên VIP Menu</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editedEmployee.isHomeSpa || false} onChange={(e) => updateField('isHomeSpa', e.target.checked)} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm font-medium text-gray-700">Đi Home Spa</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editedEmployee.isActiveTherapyMenu || false} onChange={(e) => updateField('isActiveTherapyMenu', e.target.checked)} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm font-medium text-gray-700">Hiển thị trên Menu Điều trị</span>
                      </label>
                        <label className="flex items-center gap-2 cursor-pointer mt-2">
                          <input type="checkbox" checked={editedEmployee.enableKpiDemo || false} onChange={(e) => updateField('enableKpiDemo', e.target.checked)} className="w-4 h-4 text-amber-500 rounded border-amber-300 focus:ring-amber-500" />
                          <span className="text-sm font-medium text-amber-700">Hiển thị Demo KPI</span>
                        </label>
                      <label className="flex items-center gap-2 cursor-pointer mt-2 pt-2 border-t border-gray-100">
                        <input type="checkbox" checked={editedEmployee.enableBonus ?? true} onChange={(e) => updateField('enableBonus', e.target.checked)} className="w-4 h-4 text-emerald-500 rounded border-emerald-300 focus:ring-emerald-500" />
                        <span className="text-sm font-medium text-emerald-700">Tính điểm Bonus (Ví Bonus)</span>
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-3 mt-4 pt-4 border-t border-gray-100">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">VIP Menu:</span>
                        <span className="text-sm font-medium text-gray-900">{editedEmployee.isActiveVipMenu ? 'Có' : 'Không'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">Home Spa:</span>
                        <span className="text-sm font-medium text-gray-900">{editedEmployee.isHomeSpa ? 'Có' : 'Không'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">Menu Điều trị:</span>
                        <span className="text-sm font-medium text-gray-900">{editedEmployee.isActiveTherapyMenu ? 'Có' : 'Không'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">Nhận điểm Bonus:</span>
                        <span className="text-sm font-medium text-emerald-600">{editedEmployee.enableBonus ?? true ? 'Có' : 'Không'}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Phone size={14} /> Liên lạc & Tài chính
                </h3>
                <div className="space-y-3">
                  <InfoItem label="Số điện thoại" value={editedEmployee.phone} icon={<Phone size={14} />} isEditing={isEditing} onChange={(val) => updateField('phone', val)} />
                  <InfoItem label="Email" value={editedEmployee.email} icon={<Mail size={14} />} isEditing={isEditing} onChange={(val) => updateField('email', val)} />
                  <InfoItem label="STK Ngân hàng" value={editedEmployee.bankAccount} icon={<CreditCard size={14} />} isEditing={isEditing} onChange={(val) => updateField('bankAccount', val)} />
                  <InfoItem label="Ngân hàng" value={editedEmployee.bankName} isEditing={isEditing} onChange={(val) => updateField('bankName', val)} />
                  <InfoItem label="Ngày vào làm" value={editedEmployee.joinDate} icon={<Briefcase size={14} />} isEditing={isEditing} onChange={(val) => updateField('joinDate', val)} />
                </div>
              </div>
            </div>

            <div className="mt-8">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                <Key size={14} /> Thông tin cấp quyền (Hệ thống)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <InfoItem label="Tên đăng nhập (ID)" value={editedEmployee.username || editedEmployee.code} isEditing={false} />
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="text-[10px] text-gray-400 font-medium uppercase">Mật khẩu hiện tại</div>
                    <div className="text-sm text-gray-900 font-medium font-mono">
                      {editedEmployee.password || '---'}
                    </div>
                  </div>
                </div>

                {editedEmployee.role === 'TECHNICIAN' && (
                  <div className="md:col-span-2 mt-2 pt-4 border-t border-gray-200">
                    <div className="text-[10px] text-gray-400 font-medium uppercase mb-2">Hình thức làm việc (KTV)</div>
                    {isEditing ? (
                      <select 
                        value={editedEmployee.work_type || 'TYPE_A'} 
                        onChange={(e) => updateField('work_type', e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-bold text-emerald-700 text-sm"
                      >
                        <option value="TYPE_A">Loại A (Tính theo Ca/Điểm)</option>
                        <option value="TYPE_B">Loại B (Hưởng tua 180k/h)</option>
                        <option value="TYPE_C">Loại C (Cộng tác viên/Freelance)</option>
                        <option value="TYPE_D">Loại D (Khoán)</option>
                      </select>
                    ) : (
                      <div className="text-sm font-bold text-emerald-700">
                        {editedEmployee.work_type === 'TYPE_B' ? 'Loại B (Hưởng tua 180k/h)' : 
                         editedEmployee.work_type === 'TYPE_C' ? 'Loại C (Cộng tác viên/Freelance)' : 
                         editedEmployee.work_type === 'TYPE_D' ? 'Loại D (Khoán)' : 
                         'Loại A (Tính theo Ca/Điểm)'}
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {editedEmployee.role === 'TECHNICIAN' && editedEmployee.work_type === 'TYPE_B' && (
                  <div className="mt-4 p-4 bg-amber-50 rounded-xl border border-amber-200">
                    <h3 className="text-xs font-bold text-amber-900 uppercase tracking-widest border-b border-amber-200 pb-2 mb-3">Cấu hình Chỉ tiêu (Loại B)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <div className="text-[10px] text-amber-800 font-medium uppercase mb-1">Mức lương / giờ (VNĐ)</div>
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editedEmployee.baseSalaryPerHour || 180000} 
                                onChange={(e) => updateField('baseSalaryPerHour', parseInt(e.target.value) || 0)}
                                className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 font-bold text-sm"
                              />
                            ) : (
                              <div className="text-sm font-bold text-gray-900">
                                {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(editedEmployee.baseSalaryPerHour || 180000)}
                              </div>
                            )}
                        </div>
                        <div>
                            <div className="text-[10px] text-amber-800 font-medium uppercase mb-1">Chỉ tiêu tháng (Giờ)</div>
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editedEmployee.targetHoursPerMonth || 80} 
                                onChange={(e) => updateField('targetHoursPerMonth', parseInt(e.target.value) || 0)}
                                className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 font-bold text-sm"
                              />
                            ) : (
                              <div className="text-sm font-bold text-gray-900">
                                {editedEmployee.targetHoursPerMonth || 80} giờ
                              </div>
                            )}
                        </div>
                    </div>
                  </div>
              )}
            </div>

            <div className="mt-8 space-y-6">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                    <Award size={14} />{' '}
                    Ảnh gallery theo menu
                  </h3>
                  {isEditing && (
                    <span className="text-[10px] text-indigo-600 font-bold">
                      Tải file từ máy hoặc dán URL theo từng nhóm
                    </span>
                  )}
                </div>

                {(() => {
                  const allItems = (editedEmployee.galleryUrls || []).map((item, originalIndex) => ({
                    item,
                    originalIndex,
                    url: getItemUrl(item),
                    group: getGalleryGroup(item),
                  }));
                  const groupsToRender = [
                    ...(editedEmployee.isActiveTherapyMenu
                      ? GALLERY_GROUPS.filter((g) => g.id !== 'legacy').map((g) => ({ ...g, label: `NHT · ${g.label}` }))
                      : []),
                    ...(editedEmployee.isActiveVipMenu
                      ? SKILL_KEYS.filter((key) => isSkillActive(editedEmployee.skills?.[key]))
                          .map((key) => ({ id: `vip:${key}` as GalleryGroupId, label: `VIP NHP · ${SKILL_LABELS[key]}` }))
                      : []),
                    ...(!editedEmployee.isActiveTherapyMenu && !editedEmployee.isActiveVipMenu || allItems.some((i) => i.group === 'legacy')
                      ? [{ id: 'legacy' as GalleryGroupId, label: 'Ảnh cũ chưa phân loại' }]
                      : []),
                  ];

                  if (!isEditing) {
                    const hasAnyPhotos = allItems.some((item) => groupsToRender.some((group) => group.id === item.group));
                    if (!hasAnyPhotos) {
                      return (
                        <div className="text-xs text-gray-500 italic py-2">
                          Nhân viên này chưa có ảnh gallery.
                        </div>
                      );
                    }

                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {groupsToRender.map((group) => {
                          const groupItems = allItems.filter((i) => i.group === group.id);
                          if (groupItems.length === 0) return null;

                          return (
                            <div
                              key={group.id}
                              className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm"
                            >
                              <div className="flex items-center justify-between mb-2.5">
                                <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                                  {group.label}
                                </span>
                                <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full font-medium">
                                  {groupItems.length}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                {groupItems.map(({ originalIndex, url }) => (
                                  <GalleryThumbnailItem
                                    key={`${url}-${originalIndex}`}
                                    url={url}
                                    index={originalIndex}
                                    isEditing={false}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {editedEmployee.isActiveVipMenu && !SKILL_KEYS.some((key) => isSkillActive(editedEmployee.skills?.[key])) && (
                        <p className="col-span-full text-xs text-amber-700">Hãy bật kỹ năng VIP ở mục Kỹ năng chuyên môn để tải ảnh NHP theo kỹ năng.</p>
                      )}
                      {groupsToRender.map((group) => {
                        const groupItems = allItems.filter((i) => i.group === group.id);
                        const isUploading = Boolean(uploadingGroups[group.id]);
                        const uploadErr = uploadErrors[group.id];
                        const urlErr = galleryUrlErrors[group.id];

                        return (
                          <div
                            key={group.id}
                            className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                                    {group.label}
                                  </span>
                                  <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-full font-bold">
                                    {groupItems.length}
                                  </span>
                                </div>

                                <div>
                                  <input
                                    id={`file-upload-${group.id}`}
                                    type="file"
                                    multiple
                                    accept="image/jpeg,image/png,image/webp"
                                    className="hidden"
                                    disabled={isSaving || isUploading}
                                    onChange={(e) => {
                                      if (e.target.files && e.target.files.length > 0) {
                                        handleFileUpload(group.id, e.target.files);
                                        e.target.value = '';
                                      }
                                    }}
                                  />
                                  <label
                                    htmlFor={`file-upload-${group.id}`}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                                      isSaving || isUploading
                                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                        : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                                    }`}
                                  >
                                    {isUploading ? (
                                      <>
                                        <Loader2 size={12} className="animate-spin text-indigo-600" />
                                        <span>Đang tải...</span>
                                      </>
                                    ) : (
                                      <>
                                        <Upload size={12} />
                                        <span>+ Tải ảnh</span>
                                      </>
                                    )}
                                  </label>
                                </div>
                              </div>

                              <div className="flex gap-1.5 mb-2">
                                <input
                                  type="url"
                                  aria-label={`URL ảnh ${group.label}`}
                                  placeholder="https://.../photo.jpg"
                                  value={galleryUrlDrafts[group.id] ?? ''}
                                  disabled={isSaving || isUploading}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setGalleryUrlDrafts((current) => ({
                                      ...current,
                                      [group.id]: value,
                                    }));
                                    setGalleryUrlErrors((current) => ({
                                      ...current,
                                      [group.id]: '',
                                    }));
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      addGalleryUrlToGroup(group.id);
                                    }
                                  }}
                                  className="flex-1 min-w-0 px-2.5 py-1 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  disabled={
                                    isSaving ||
                                    isUploading ||
                                    !(galleryUrlDrafts[group.id] ?? '').trim()
                                  }
                                  onClick={() => addGalleryUrlToGroup(group.id)}
                                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shrink-0 transition-colors"
                                >
                                  Thêm ảnh
                                </button>
                              </div>

                              {uploadErr && (
                                <p role="alert" className="text-[11px] text-red-600 font-medium mb-2">
                                  {uploadErr}
                                </p>
                              )}
                              {urlErr && (
                                <p role="alert" className="text-[11px] text-red-600 font-medium mb-2">
                                  {urlErr}
                                </p>
                              )}

                              {groupItems.length === 0 ? (
                                <div className="text-[11px] text-gray-400 italic py-2 text-center bg-gray-50 rounded-lg border border-dashed border-gray-200">
                                  Chưa có ảnh trong nhóm này.
                                </div>
                              ) : (
                                <div className="grid grid-cols-3 gap-2">
                                  {groupItems.map(({ originalIndex, url }) => (
                                    <GalleryThumbnailItem
                                      key={`${url}-${originalIndex}`}
                                      url={url}
                                      index={originalIndex}
                                      isEditing={true}
                                      onRemove={() => removeGalleryUrl(originalIndex)}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <Award size={14} /> Kỹ năng chuyên môn
                  </h3>
                  {isEditing && (
                    <span className="text-[10px] text-indigo-600 font-bold animate-pulse">
                      ĐANG CHỈNH SỬA - Bấm vào kỹ năng để chuyển đổi cấp độ
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SKILL_KEYS.map((key) => {
                    const rawLevel = editedEmployee.skills?.[key];
                    const isSkilled = rawLevel === true || (rawLevel as any) === 'basic' || (rawLevel as any) === 'expert' || (rawLevel as any) === 'training';
                    const info = levelInfo[String(isSkilled)];
                    return (
                      <button
                        key={key}
                        onClick={() => toggleSkill(key)}
                        disabled={!isEditing}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${info.color} ${isEditing ? 'hover:border-indigo-400 hover:shadow-sm cursor-pointer' : 'cursor-default'}`}
                      >
                        <span className="text-xs font-bold truncate">{SKILL_LABELS[key]}</span>
                        {info.icon}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InfoItem({
  label,
  value,
  icon,
  isEditing,
  onChange
}: {
  label: string,
  value: string | number,
  icon?: React.ReactNode,
  isEditing?: boolean,
  onChange?: (val: string) => void
}) {
  return (
    <div className="flex items-start gap-3">
      {icon && <div className="mt-0.5 text-gray-400">{icon}</div>}
      <div className="flex-1">
        <div className="text-[10px] text-gray-400 font-medium uppercase">{label}</div>
        {isEditing && onChange ? (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full text-sm font-medium text-gray-900 border-b border-indigo-300 focus:border-indigo-600 outline-none bg-transparent py-0.5"
          />
        ) : (
          <div className="text-sm text-gray-900 font-medium">{value}</div>
        )}
      </div>
    </div>
  );
}

function GalleryThumbnailItem({
  url,
  index,
  isEditing,
  onRemove,
}: {
  url: string;
  index: number;
  isEditing: boolean;
  onRemove?: () => void;
}) {
  const [loadError, setLoadError] = useState(false);

  return (
    <div className="relative group rounded-lg overflow-hidden border border-gray-200 bg-gray-100 aspect-square flex items-center justify-center">
      {loadError ? (
        <div className="p-1 text-center text-[10px] text-red-500 font-medium leading-tight">
          Lỗi tải ảnh
        </div>
      ) : (
        <img
          src={url}
          alt={`gallery-${index}`}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setLoadError(true)}
        />
      )}

      {isEditing && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Xóa ảnh"
          title="Xóa ảnh"
          className="absolute top-1 right-1 bg-red-600 hover:bg-red-700 text-white rounded-full p-1 shadow-md transition-opacity sm:opacity-90 opacity-100 touch-manipulation z-10"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
