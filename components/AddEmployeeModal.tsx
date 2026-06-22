'use client';

import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Save, User, UserPlus, Award } from 'lucide-react';
import { createStaffMember } from '@/app/admin/employees/actions';
import { SkillLevel } from '@/lib/types';

const DEFAULT_SKILLS = {
    hairCut: false, shampoo: false, hairExtensionShampoo: false, earCombo: false, earChuyen: false,
    machineShave: false, razorShave: false, facial: false, thaiBody: false,
    shiatsuBody: false, oilBody: false, hotStoneBody: false, scrubBody: false,
    foot: false, heelScrub: false, nailCombo: false, nailChuyen: false
};

const skillLabels: Record<string, string> = {
    hairCut: 'Cắt Tóc', shampoo: 'Gội đầu', hairExtensionShampoo: 'Gội Tóc Nối',
    earCombo: 'Ráy Combo', earChuyen: 'Ráy Chuyên', machineShave: 'Cạo Máy', razorShave: 'Cạo Dao',
    facial: 'Facial', thaiBody: 'Body Thái', shiatsuBody: 'Shiatsu',
    oilBody: 'Body Dầu', hotStoneBody: 'Body Đá Nóng', scrubBody: 'Scrub Body',
    foot: 'Foot',
    heelScrub: 'Bào Gót', nailCombo: 'Nail Combo', nailChuyen: 'Nail Chuyên',
};

const levelInfo: Record<string, { label: string, color: string }> = {
    'false': { label: 'Chưa có', color: 'text-gray-400 bg-gray-50 border-gray-100 opacity-50' },
    'true': { label: 'Có tay nghề', color: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
};

interface AddEmployeeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function AddEmployeeModal({ isOpen, onClose, onSuccess }: AddEmployeeModalProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        id: '',
        password: '',
        full_name: '',
        email: '',
        phone: '',
        gender: 'Nữ',
        birthday: '',
        id_card: '',
        bank_account: '',
        bank_name: '',
        avatar_url: '',
        position: 'Kỹ Thuật Viên',
        experience: '0 năm',
        join_date: new Date().toISOString().split('T')[0],
        height: '',
        weight: '',
        isActiveVipMenu: false,
        isHomeSpa: false,
        role: 'TECHNICIAN',
        skills: { ...DEFAULT_SKILLS } as Record<string, SkillLevel>,
    });

    const toggleSkill = (skillKey: string) => {
        setFormData(prev => {
            return {
                ...prev,
                skills: { ...prev.skills, [skillKey]: !prev.skills[skillKey] }
            };
        });
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => {
            const nextData = { ...prev, [name]: value };
            if (name === 'role') {
                if (value === 'SUPPORT') nextData.position = 'Nhân viên Hậu Cần';
                else if (value === 'TECHNICIAN') nextData.position = 'Kỹ Thuật Viên';
                else if (value === 'RECEPTION') nextData.position = 'Lễ Tân';
                else if (value === 'MANAGER') nextData.position = 'Quản Lý';
                else if (value === 'ADMIN') nextData.position = 'Quản Trị Viên';
            }
            return nextData;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        const res = await createStaffMember(formData);

        if (res.success) {
            alert('Đã thêm nhân viên thành công!');
            onSuccess();
            onClose();
            // Reset form
            setFormData({
                id: '', password: '', full_name: '', email: '', phone: '',
                gender: 'Nữ', birthday: '', id_card: '', bank_account: '', bank_name: '',
                avatar_url: '', position: 'Kỹ Thuật Viên', experience: '0 năm',
                join_date: new Date().toISOString().split('T')[0], height: '', weight: '',
        isActiveVipMenu: false,
        isHomeSpa: false,
        role: 'TECHNICIAN',
                skills: { ...DEFAULT_SKILLS } as Record<string, SkillLevel>,
            });
        } else {
            setError(res.error || 'Đã xảy ra lỗi không xác định.');
        }
        setIsSubmitting(false);
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={onClose}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] animate-in fade-in duration-200" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl z-[70] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-indigo-50/50">
                        <Dialog.Title className="text-xl font-bold text-gray-900 flex items-center gap-2">
                            <UserPlus size={20} className="text-indigo-600" /> Thêm Nhân Viên Mới
                        </Dialog.Title>
                        <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-white rounded-full transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-6 overflow-y-auto">
                        {error && (
                            <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
                                {error}
                            </div>
                        )}

                        <form id="add-employee-form" onSubmit={handleSubmit} className="space-y-6">
                            {/* Login Info */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest border-b pb-2">Thông tin Đăng nhập & Định danh</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Mã Nhân Viên (id) *</label>
                                        <input required type="text" name="id" value={formData.id} onChange={handleChange} placeholder="VD: NV-001" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Mật khẩu đăng nhập *</label>
                                        <input required type="text" name="password" value={formData.password} onChange={handleChange} placeholder="VD: 123456" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Vai trò hệ thống (Role) *</label>
                                        <select name="role" value={formData.role} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-indigo-50 font-bold text-indigo-700">
                                            <option value="TECHNICIAN">Kỹ Thuật Viên</option>
                                            <option value="SUPPORT">Nhân viên Hậu Cần</option>
                                            <option value="RECEPTION">Lễ Tân</option>
                                            <option value="MANAGER">Quản Lý</option>
                                            <option value="ADMIN">Admin (Toàn quyền)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Personal Info */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest border-b pb-2">Thông tin Cá nhân</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Họ và Tên *</label>
                                        <input required type="text" name="full_name" value={formData.full_name} onChange={handleChange} placeholder="Nguyễn Văn A" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Avatar URL (Link ảnh)</label>
                                        <input type="text" name="avatar_url" value={formData.avatar_url} onChange={handleChange} placeholder="https://..." className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Số điện thoại</label>
                                        <input type="tel" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Email</label>
                                        <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="Tùy chọn, tự sinh nếu trống" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Ngày sinh</label>
                                        <input type="date" name="birthday" value={formData.birthday} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Giới tính</label>
                                        <select name="gender" value={formData.gender} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                                            <option value="Nữ">Nữ</option>
                                            <option value="Nam">Nam</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Chiều cao (cm)</label>
                                        <input type="number" name="height" value={formData.height} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Cân nặng (kg)</label>
                                        <input type="number" name="weight" value={formData.weight} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                </div>
                            </div>

                            {/* Work Info */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest border-b pb-2">Thông tin Chuyên môn</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Vị trí</label>
                                        <input type="text" name="position" value={formData.position} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Kinh nghiệm</label>
                                        <input type="text" name="experience" value={formData.experience} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                </div>
                            </div>

                            {/* Skills Info - Only show for TECHNICIAN */}
                            {formData.role === 'TECHNICIAN' && (
                                <div className="space-y-6">
                                    <div className="flex items-center gap-6 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" name="isActiveVipMenu" checked={formData.isActiveVipMenu} onChange={(e) => setFormData(prev => ({ ...prev, isActiveVipMenu: e.target.checked }))} className="w-5 h-5 text-indigo-600 rounded" />
                                            <span className="text-sm font-bold text-gray-700 uppercase">Nhân viên VIP Menu</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" name="isHomeSpa" checked={formData.isHomeSpa} onChange={(e) => setFormData(prev => ({ ...prev, isHomeSpa: e.target.checked }))} className="w-5 h-5 text-indigo-600 rounded" />
                                            <span className="text-sm font-bold text-gray-700 uppercase">Nhân viên Home Spa</span>
                                        </label>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between border-b pb-2">
                                    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                                        <Award size={16} className="text-indigo-600" /> Kỹ năng chuyên môn
                                    </h3>
                                    <span className="text-[10px] text-indigo-600 font-bold">
                                        Bấm vào kỹ năng để chuyển đổi
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {Object.entries(formData.skills).map(([key, level]) => {
                                        const info = levelInfo[String(level)];
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => toggleSkill(key)}
                                                className={`flex items-center justify-center p-2.5 rounded-lg border text-center transition-all hover:border-indigo-400 hover:shadow-sm cursor-pointer ${info.color}`}
                                            >
                                                <span className="text-xs font-bold truncate w-full">{skillLabels[key]}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                    </div>
                                </div>
                            )}
                        </form>
                    </div>

                    <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                        <button type="button" onClick={onClose} disabled={isSubmitting} className="px-6 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-white font-medium transition-colors">
                            Hủy
                        </button>
                        <button type="submit" form="add-employee-form" disabled={isSubmitting} className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-medium transition-colors disabled:opacity-70 disabled:cursor-not-allowed">
                            {isSubmitting ? (
                                <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin"></div>
                            ) : (
                                <> <Save size={18} /> Lưu Nhân Viên</>
                            )}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
