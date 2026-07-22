'use client';

import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, User, Phone, Mail, CreditCard, Calendar, Ruler, Weight, Award, CheckCircle2, Briefcase, Edit2, Save, GraduationCap, Zap, BookOpen, Key, Loader2 } from 'lucide-react';
import { Employee, SkillLevel } from '@/lib/types';
import { updateStaffMember } from '@/app/admin/employees/actions';

interface EmployeeDetailModalProps {
  employee: Employee | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: (updatedEmployee: Employee) => void;
}

export function EmployeeDetailModal({ employee, isOpen, onClose, onUpdate }: EmployeeDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedEmployee, setEditedEmployee] = useState<Employee | null>(employee);

  React.useEffect(() => {
    setEditedEmployee(employee);
  }, [employee]);

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

  const skillLabels: Record<keyof Employee['skills'], string> = {
    hairCut: 'Cắt Tóc',
    shampoo: 'Gội đầu',
    hairExtensionShampoo: 'Gội Tóc Nối',
    earCombo: 'Ráy Combo',
    earChuyen: 'Ráy Chuyên',
    machineShave: 'Cạo Máy',
    razorShave: 'Cạo Dao',
    facial: 'Facial',
    thaiBody: 'Body Thái',
    shiatsuBody: 'Shiatsu',
    oilBody: 'Body Dầu',
    hotStoneBody: 'Body Đá Nóng',
    scrubBody: 'Scrub Body',
    bodyMix: 'Body Mix',
    foot: 'Foot',
    heelScrub: 'Bào Gót',
    nailCombo: 'Nail Combo',
    nailChuyen: 'Nail Chuyên',
  };

  const levelInfo: Record<string, { label: string, color: string, icon: React.ReactNode }> = {
    'false': { label: 'Chưa có', color: 'text-gray-400 bg-gray-50 border-gray-100 opacity-50', icon: <X size={12} /> },
    'true': { label: 'Có tay nghề', color: 'text-emerald-700 bg-emerald-50 border-emerald-100', icon: <CheckCircle2 size={12} /> },
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] animate-in fade-in duration-200" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl z-[70] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
          <div className="relative h-32 bg-indigo-600">
            <div className="absolute top-4 right-4 flex gap-2 z-10">
              {isEditing ? (
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className={`p-2 text-white rounded-full transition-colors shadow-lg flex items-center gap-2 px-4 ${isSaving ? 'bg-gray-400 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-600'}`}
                >
                  {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  <span className="text-sm font-bold">{isSaving ? 'Đang lưu...' : 'Lưu'}</span>
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
                onClick={onClose}
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
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${editedEmployee.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'
                    }`}>
                    {editedEmployee.status === 'active' ? 'Đang hoạt động' : 'Đã nghỉ'}
                  </span>
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
                      </select>
                    ) : (
                      <div className="text-sm font-bold text-emerald-700">
                        {editedEmployee.work_type === 'TYPE_B' ? 'Loại B (Hưởng tua 180k/h)' : 
                         editedEmployee.work_type === 'TYPE_C' ? 'Loại C (Cộng tác viên/Freelance)' : 
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

            <div className="mt-8">
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
                {(Object.keys(skillLabels) as (keyof Employee['skills'])[]).map((key) => {
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
                      <span className="text-xs font-bold truncate">{skillLabels[key]}</span>
                      {info.icon}
                    </button>
                  );
                })}
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
