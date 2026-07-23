'use client';

import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Settings, Save, CheckCircle2, AlertCircle, Loader2, Coins, CalendarDays, Percent } from 'lucide-react';
import { motion } from 'motion/react';
import { SystemConfigsTable } from './SystemConfigsTable';
import { MilestonesEditor } from './MilestonesEditor';
import { KtvFeaturesTable } from './KtvFeaturesTable';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

export default function SystemSettingsPage() {
    const [configs, setConfigs] = useState<any>({
        // Tạm thời để trống, sẽ được merge từ API về
        enable_web_advance_booking_email: false
    });
    const [activeTab, setActiveTab] = useState<'TYPE_A' | 'TYPE_B' | 'TYPE_C'>('TYPE_A');
    
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        fetchConfigs();
    }, []);

    const fetchConfigs = async () => {
        try {
            const data = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
            if (data.data) {
                setConfigs((prev: any) => ({ ...prev, ...data.data }));
            }
        } catch (error) {
            console.error('Lỗi tải cấu hình:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const [savingGroup, setSavingGroup] = useState<string | null>(null);

    const handleSaveGroup = async (keys: string[], groupName: string) => {
        setSavingGroup(groupName);
        setSaveStatus('idle');
        try {
            const payload: any = {};
            keys.forEach(k => {
                const actualKey = k === 'enable_web_advance_booking_email' ? k : `${k}_${activeTab}`;
                payload[actualKey] = configs[actualKey];
            });
            const result = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, payload);
            if (result.success) {
                setSaveStatus('success');
                setTimeout(() => setSaveStatus('idle'), 3000);
            } else {
                setSaveStatus('error');
            }
        } catch (error) {
            console.error('Lỗi lưu cấu hình:', error);
            setSaveStatus('error');
        } finally {
            setSavingGroup(null);
        }
    };

    const handleSaveField = async (actualKey: string, value: any) => {
        setIsSaving(true);
        setSaveStatus('idle');
        try {
            const result = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, { [actualKey]: value });
            if (result.success) {
                setSaveStatus('success');
                setTimeout(() => setSaveStatus('idle'), 3000);
            } else {
                setSaveStatus('error');
            }
        } catch (error) {
            console.error('Lỗi lưu cấu hình:', error);
            setSaveStatus('error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleChange = (key: string, value: any) => {
        if (key === 'enable_web_advance_booking_email') {
            setConfigs((prev: any) => ({ ...prev, [key]: value }));
        } else {
            setConfigs((prev: any) => ({ ...prev, [`${key}_${activeTab}`]: value }));
        }
    };
    
    // Helper để lấy giá trị theo tab hiện tại (fallback về mặc định cũ nếu không có)
    const getValue = (key: string) => {
        const val = configs[`${key}_${activeTab}`];
        return val !== undefined ? val : configs[key];
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <Loader2 size={32} className="text-indigo-500 animate-spin" />
                <p className="mt-4 text-gray-500 font-medium">Đang tải cấu hình...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">

                {/* Tabs KTV Types */}
                <div className="flex gap-2 p-1.5 bg-gray-100/80 backdrop-blur rounded-2xl w-fit">
                    {(['TYPE_A', 'TYPE_B', 'TYPE_C'] as const).map(type => (
                        <button
                            key={type}
                            onClick={() => setActiveTab(type)}
                            className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                                activeTab === type
                                    ? 'bg-white text-indigo-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                            }`}
                        >
                            KTV {type === 'TYPE_A' ? 'Loại A (Cố định)' : type === 'TYPE_B' ? 'Loại B (Hợp tác)' : 'Loại C (Tự do)'}
                        </button>
                    ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Card: Điểm Thưởng */}
                    <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                                    <Coins size={20} className="text-amber-500" />
                                </div>
                                <h2 className="text-lg font-black text-gray-900">Mốc Điểm Thưởng (Bonus)</h2>
                            </div>
                            <button
                                onClick={() => handleSaveGroup(['ktv_bonus_rate', 'ktv_shift_1_bonus', 'ktv_shift_2_bonus', 'ktv_shift_3_bonus'], 'bonus')}
                                disabled={savingGroup === 'bonus'}
                                className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {savingGroup === 'bonus' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                Lưu
                            </button>
                        </div>
                        
                        <div className="space-y-5">
                            <div>
                                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
                                    <Percent size={14} className="text-indigo-400" />
                                    Tỷ lệ quy đổi điểm (VNĐ / 1 điểm)
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={getValue('ktv_bonus_rate') ?? 0}
                                        onChange={(e) => handleChange('ktv_bonus_rate', Number(e.target.value))}
                                        className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 text-lg font-bold text-gray-900 focus:border-indigo-400 focus:ring-0 transition-colors"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">VNĐ</span>
                                </div>
                                <p className="text-[11px] text-gray-400 mt-1.5 font-medium">Ví dụ: 1000 = 1 điểm tương ứng 1.000đ.</p>
                            </div>

                            <hr className="border-gray-100 my-4" />

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
                                        <CalendarDays size={14} className="text-emerald-500" />
                                        Ca 1 (Sáng)
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={getValue('ktv_shift_1_bonus') ?? 0}
                                            onChange={(e) => handleChange('ktv_shift_1_bonus', Number(e.target.value))}
                                            className="w-full bg-emerald-50/50 border-2 border-emerald-100 rounded-xl px-4 py-3 text-lg font-bold text-emerald-900 focus:border-emerald-400 focus:ring-0 transition-colors"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-600/50 font-bold">Điểm</span>
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
                                        <CalendarDays size={14} className="text-blue-500" />
                                        Ca 2 (Chiều)
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={getValue('ktv_shift_2_bonus') ?? 0}
                                            onChange={(e) => handleChange('ktv_shift_2_bonus', Number(e.target.value))}
                                            className="w-full bg-blue-50/50 border-2 border-blue-100 rounded-xl px-4 py-3 text-lg font-bold text-blue-900 focus:border-blue-400 focus:ring-0 transition-colors"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-600/50 font-bold">Điểm</span>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
                                    <CalendarDays size={14} className="text-purple-500" />
                                    Ca 3 (Đêm / Giờ vàng)
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={getValue('ktv_shift_3_bonus') ?? 0}
                                        onChange={(e) => handleChange('ktv_shift_3_bonus', Number(e.target.value))}
                                        className="w-full bg-purple-50/50 border-2 border-purple-100 rounded-xl px-4 py-3 text-lg font-bold text-purple-900 focus:border-purple-400 focus:ring-0 transition-colors"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-purple-600/50 font-bold">Điểm</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Card: Tài Chính & Ký Quỹ */}
                    <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center">
                                    <Coins size={20} className="text-teal-500" />
                                </div>
                                <h2 className="text-lg font-black text-gray-900">Tài Chính & Ký Quỹ KTV</h2>
                            </div>
                            <button
                                onClick={() => handleSaveGroup(['ktv_deposit_amount', 'ktv_sudden_off_penalty', 'ktv_instant_reward_enabled'], 'finance')}
                                disabled={savingGroup === 'finance'}
                                className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {savingGroup === 'finance' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                Lưu
                            </button>
                        </div>
                        
                        <div className="space-y-5">
                            <div>
                                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2">
                                    Tiền cọc duy trì (Ví quỹ)
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={getValue('ktv_deposit_amount') ?? 0}
                                        onChange={(e) => handleChange('ktv_deposit_amount', Number(e.target.value))}
                                        className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 text-lg font-bold text-gray-900 focus:border-teal-400 focus:ring-0 transition-colors"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">VNĐ</span>
                                </div>
                                <p className="text-[11px] text-gray-400 mt-1.5 font-medium">Số dư tối thiểu mà một KTV cần duy trì trong ví. Nếu số dư thấp hơn định mức này, hệ thống sẽ tự động trích lập từ tiền thu nhập hằng ngày để bù vào.</p>
                            </div>

                            <hr className="border-gray-100 my-4" />

                            <div>
                                <label className="block text-xs font-black uppercase tracking-wider text-rose-500 mb-2 flex items-center gap-2">
                                    <AlertCircle size={14} />
                                    Phạt nghỉ đột xuất / Tan ca sớm
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={getValue('ktv_sudden_off_penalty') ?? 0}
                                        onChange={(e) => handleChange('ktv_sudden_off_penalty', Number(e.target.value))}
                                        className="w-full bg-rose-50 border-2 border-rose-100 rounded-xl px-4 py-3 text-lg font-bold text-rose-900 focus:border-rose-400 focus:ring-0 transition-colors"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-rose-600/50 font-bold">VNĐ</span>
                                </div>
                                <p className="text-[11px] text-gray-400 mt-1.5 font-medium">Mức phạt áp dụng cho mỗi bản ghi "Nghỉ đột xuất" được tạo tự động khi KTV tan ca sớm hoặc nghỉ không phép.</p>
                            </div>

                            <hr className="border-gray-100 my-4" />

                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                                <div>
                                    <label className="block text-sm font-black text-gray-900 mb-1">
                                        Hiển thị & cộng tiền tua tức thì
                                    </label>
                                    <p className="text-[11px] text-gray-500 font-medium">BẬT = Hiện tiền tua ngay khi xong. TẮT = Chờ quầy & khách duyệt (tiền tính ngầm, KTV nhận Push sau).</p>
                                </div>
                                <button
                                    onClick={() => {
                                        const newVal = !(getValue('ktv_instant_reward_enabled') ?? true);
                                        handleChange('ktv_instant_reward_enabled', newVal);
                                    }}
                                    className={`relative w-12 h-6 rounded-full transition-colors ${
                                        (getValue('ktv_instant_reward_enabled') ?? true) ? 'bg-teal-500' : 'bg-gray-300'
                                    }`}
                                >
                                    <span
                                        className={`absolute left-1 top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                                            (getValue('ktv_instant_reward_enabled') ?? true) ? 'translate-x-6' : 'translate-x-0'
                                        }`}
                                    />
                                </button>
                            </div>

                            <div className="p-4 bg-orange-50 rounded-xl border border-orange-100 mt-4">
                                <h3 className="text-xs font-black uppercase tracking-wider text-orange-600 mb-2 flex items-center gap-2">
                                    <AlertCircle size={14} /> Ghi chú quan trọng
                                </h3>
                                <p className="text-[11px] text-orange-800 font-medium leading-relaxed">
                                    Mọi thay đổi trong bảng cấu hình này sẽ lập tức có hiệu lực và ảnh hưởng đến các lần thanh toán, chia thưởng phát sinh <strong>TỪ THỜI ĐIỂM LƯU TRỞ ĐI</strong>. Vui lòng cân nhắc kỹ trước khi thay đổi.
                                </p>
                            </div>
                        </div>
                    </div>


                </div>

                {/* Milestones Editor (Tua) */}
                <MilestonesEditor activeTab={activeTab} />

                {/* Staff Features Table */}
                <div className="mt-8">
                    <KtvFeaturesTable activeTab={activeTab} />
                </div>
            </div>
    );
}
