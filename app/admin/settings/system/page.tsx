'use client';

import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Settings, Save, CheckCircle2, AlertCircle, Loader2, Coins, CalendarDays, Percent, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { SystemConfigsTable } from './SystemConfigsTable';
import { MilestonesEditor } from './MilestonesEditor';
import { KtvFeaturesTable } from './KtvFeaturesTable';
import { KtvTypeDSettingsBlock } from './KtvTypeDSettingsBlock';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

const FormattedNumberInput = ({ value, onChange, className, suffix, suffixColor = 'text-gray-400' }: any) => {
    const [displayValue, setDisplayValue] = useState(value?.toLocaleString('vi-VN') || '');
    
    useEffect(() => {
        setDisplayValue(value !== undefined && value !== null ? value.toLocaleString('vi-VN') : '');
    }, [value]);

    const handleBlur = (e: any) => {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        if (raw) {
            onChange(Number(raw));
            setDisplayValue(Number(raw).toLocaleString('vi-VN'));
        } else {
            onChange(0);
            setDisplayValue('0');
        }
    };

    const handleChange = (e: any) => {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        setDisplayValue(raw ? Number(raw).toLocaleString('vi-VN') : '');
    };

    return (
        <div className="relative">
            <input
                type="text"
                value={displayValue}
                onChange={handleChange}
                onBlur={handleBlur}
                className={className}
            />
            {suffix && <span className={`absolute right-4 top-1/2 -translate-y-1/2 font-bold ${suffixColor}`}>{suffix}</span>}
        </div>
    );
};

export default function SystemSettingsPage() {
    const [configs, setConfigs] = useState<any>({
        // Tạm thời để trống, sẽ được merge từ API về
        enable_web_advance_booking_email: false
    });
    const [initialConfigs, setInitialConfigs] = useState<any>({});
    const [activeTab, setActiveTab] = useState<'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D'>('TYPE_A');
    
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
                setInitialConfigs((prev: any) => ({ ...prev, ...data.data }));
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
                setInitialConfigs((prev: any) => ({ ...prev, ...payload }));
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

    const hasChanges = (keys: string[]) => {
        return keys.some(k => {
            const actualKey = k === 'enable_web_advance_booking_email' ? k : `${k}_${activeTab}`;
            return configs[actualKey] !== initialConfigs[actualKey];
        });
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
                    {(['TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'] as const).map(type => (
                        <button
                            key={type}
                            onClick={() => setActiveTab(type)}
                            className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                                activeTab === type
                                    ? 'bg-white text-indigo-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                            }`}
                        >
                            KTV {type === 'TYPE_A' ? 'Loại A (Cố định)' : type === 'TYPE_B' ? 'Loại B (Hợp tác)' : type === 'TYPE_C' ? 'Loại C (Tự do)' : 'Loại D (Khoán)'}
                        </button>
                    ))}
                </div>

                {activeTab === 'TYPE_D' ? (
                    <KtvTypeDSettingsBlock />
                ) : (
                    <>
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
                            <div className="flex items-center gap-3">
                                {saveStatus === 'success' && savingGroup === 'bonus' && (
                                    <span className="text-emerald-500 text-xs font-bold flex items-center gap-1"><CheckCircle2 size={14} /> Đã lưu</span>
                                )}
                                {hasChanges(['ktv_bonus_rate', 'ktv_shift_1_bonus', 'ktv_shift_2_bonus', 'ktv_shift_3_bonus', 'enable_ktv_bonus']) && (
                                    <button
                                        onClick={() => handleSaveGroup(['ktv_bonus_rate', 'ktv_shift_1_bonus', 'ktv_shift_2_bonus', 'ktv_shift_3_bonus', 'enable_ktv_bonus'], 'bonus')}
                                        disabled={savingGroup === 'bonus'}
                                        className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {savingGroup === 'bonus' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                        Lưu
                                    </button>
                                )}
                            </div>
                        </div>
                        
                        <div className="space-y-5">
                            <div>
                                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
                                    <Percent size={14} className="text-indigo-400" />
                                    Tỷ lệ quy đổi điểm (VNĐ / 1 điểm)
                                </label>
                                <FormattedNumberInput
                                    value={getValue('ktv_bonus_rate') ?? 0}
                                    onChange={(val: number) => handleChange('ktv_bonus_rate', val)}
                                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 text-lg font-bold text-gray-900 focus:border-indigo-400 focus:ring-0 transition-colors"
                                    suffix="VNĐ"
                                />
                                <p className="text-[11px] text-gray-400 mt-1.5 font-medium">Ví dụ: 1000 = 1 điểm tương ứng 1.000đ.</p>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                                <div>
                                    <label className="block text-sm font-black text-gray-900 mb-1">
                                        Nhận điểm thưởng (Bonus)
                                    </label>
                                    <p className="text-[11px] text-gray-500 font-medium">BẬT = KTV nhóm này được nhận điểm thưởng. TẮT = Không được nhận.</p>
                                </div>
                                <button
                                    onClick={() => {
                                        // Default fallback logic matching backend
                                        const defaultVal = activeTab === 'TYPE_B';
                                        const currentVal = getValue('enable_ktv_bonus');
                                        const resolvedVal = currentVal !== undefined ? (currentVal === 'true' || currentVal === true) : defaultVal;
                                        handleChange('enable_ktv_bonus', !resolvedVal);
                                    }}
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                        (() => {
                                            const defaultVal = activeTab === 'TYPE_B';
                                            const currentVal = getValue('enable_ktv_bonus');
                                            return (currentVal !== undefined ? (currentVal === 'true' || currentVal === true) : defaultVal) ? 'bg-teal-500' : 'bg-gray-300';
                                        })()
                                    }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                            (() => {
                                                const defaultVal = activeTab === 'TYPE_B';
                                                const currentVal = getValue('enable_ktv_bonus');
                                                return (currentVal !== undefined ? (currentVal === 'true' || currentVal === true) : defaultVal) ? 'translate-x-5' : 'translate-x-0';
                                            })()
                                        }`}
                                    />
                                </button>
                            </div>

                            <hr className="border-gray-100 my-4" />

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
                                        <CalendarDays size={14} className="text-emerald-500" />
                                        Ca 1 (Sáng)
                                    </label>
                                    <FormattedNumberInput
                                        value={getValue('ktv_shift_1_bonus') ?? 0}
                                        onChange={(val: number) => handleChange('ktv_shift_1_bonus', val)}
                                        className="w-full bg-emerald-50/50 border-2 border-emerald-100 rounded-xl px-4 py-3 text-lg font-bold text-emerald-900 focus:border-emerald-400 focus:ring-0 transition-colors"
                                        suffix="Điểm"
                                        suffixColor="text-emerald-600/50"
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
                                        <CalendarDays size={14} className="text-blue-500" />
                                        Ca 2 (Chiều)
                                    </label>
                                    <FormattedNumberInput
                                        value={getValue('ktv_shift_2_bonus') ?? 0}
                                        onChange={(val: number) => handleChange('ktv_shift_2_bonus', val)}
                                        className="w-full bg-blue-50/50 border-2 border-blue-100 rounded-xl px-4 py-3 text-lg font-bold text-blue-900 focus:border-blue-400 focus:ring-0 transition-colors"
                                        suffix="Điểm"
                                        suffixColor="text-blue-600/50"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
                                    <CalendarDays size={14} className="text-purple-500" />
                                    Ca 3 (Đêm / Giờ vàng)
                                </label>
                                <FormattedNumberInput
                                    value={getValue('ktv_shift_3_bonus') ?? 0}
                                    onChange={(val: number) => handleChange('ktv_shift_3_bonus', val)}
                                    className="w-full bg-purple-50/50 border-2 border-purple-100 rounded-xl px-4 py-3 text-lg font-bold text-purple-900 focus:border-purple-400 focus:ring-0 transition-colors"
                                    suffix="Điểm"
                                    suffixColor="text-purple-600/50"
                                />
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
                            <div className="flex items-center gap-3">
                                {saveStatus === 'success' && savingGroup === 'finance' && (
                                    <span className="text-emerald-500 text-xs font-bold flex items-center gap-1"><CheckCircle2 size={14} /> Đã lưu</span>
                                )}
                                {hasChanges(['ktv_deposit_amount', 'ktv_sudden_off_penalty', 'ktv_instant_reward_enabled']) && (
                                    <button
                                        onClick={() => handleSaveGroup(['ktv_deposit_amount', 'ktv_sudden_off_penalty', 'ktv_instant_reward_enabled'], 'finance')}
                                        disabled={savingGroup === 'finance'}
                                        className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {savingGroup === 'finance' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                        Lưu
                                    </button>
                                )}
                            </div>
                        </div>
                        
                        <div className="space-y-5">
                            <div>
                                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2">
                                    Tiền cọc duy trì (Ví quỹ)
                                </label>
                                <FormattedNumberInput
                                    value={getValue('ktv_deposit_amount') ?? 0}
                                    onChange={(val: number) => handleChange('ktv_deposit_amount', val)}
                                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 text-lg font-bold text-gray-900 focus:border-teal-400 focus:ring-0 transition-colors"
                                    suffix="VNĐ"
                                />
                                <p className="text-[11px] text-gray-400 mt-1.5 font-medium">Số dư tối thiểu mà một KTV cần duy trì trong ví. Nếu số dư thấp hơn định mức này, hệ thống sẽ tự động trích lập từ tiền thu nhập hằng ngày để bù vào.</p>
                            </div>

                            <hr className="border-gray-100 my-4" />

                            <div>
                                <label className="block text-xs font-black uppercase tracking-wider text-rose-500 mb-2 flex items-center gap-2">
                                    <AlertCircle size={14} />
                                    Phạt nghỉ đột xuất / Tan ca sớm
                                </label>
                                <FormattedNumberInput
                                    value={getValue('ktv_sudden_off_penalty') ?? 0}
                                    onChange={(val: number) => handleChange('ktv_sudden_off_penalty', val)}
                                    className="w-full bg-rose-50 border-2 border-rose-100 rounded-xl px-4 py-3 text-lg font-bold text-rose-900 focus:border-rose-400 focus:ring-0 transition-colors"
                                    suffix="VNĐ"
                                    suffixColor="text-rose-600/50"
                                />
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
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                        (getValue('ktv_instant_reward_enabled') ?? true) ? 'bg-teal-500' : 'bg-gray-300'
                                    }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                            (getValue('ktv_instant_reward_enabled') ?? true) ? 'translate-x-5' : 'translate-x-0'
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

                    {/* Card: Phí Bảo Trì Hệ Thống */}
                    <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
                                <Settings size={20} className="text-rose-500" />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-gray-900">Phí Bảo Trì Hệ Thống</h2>
                                <p className="text-[11px] text-gray-400 font-medium">Trừ vào ngày cuối tháng (Cấu hình riêng cho Loại {activeTab.replace('TYPE_', '')})</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            {saveStatus === 'success' && savingGroup === 'maintenance' && (
                                <span className="text-emerald-500 text-xs font-bold flex items-center gap-1"><CheckCircle2 size={14} /> Đã lưu</span>
                            )}
                            {hasChanges(['enable_maintenance_fee', 'maintenance_fee_amount', 'maintenance_fee_deduct_deposit']) && (
                                <button
                                    onClick={() => handleSaveGroup(['enable_maintenance_fee', 'maintenance_fee_amount', 'maintenance_fee_deduct_deposit'], 'maintenance')}
                                    disabled={savingGroup === 'maintenance'}
                                    className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    {savingGroup === 'maintenance' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                    Lưu
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="space-y-5">
                        {/* Toggle: Bật/Tắt tính năng */}
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                            <div>
                                <label className="block text-sm font-black text-gray-900 mb-1">
                                    Tự động trừ phí bảo trì hàng tháng
                                </label>
                                <p className="text-[11px] text-gray-500 font-medium">BẬT = Hệ thống tự trừ tiền cuối mỗi tháng. TẮT = Không trừ.</p>
                            </div>
                            <button
                                onClick={() => handleChange('enable_maintenance_fee', !(getValue('enable_maintenance_fee') ?? true))}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                    (getValue('enable_maintenance_fee') ?? true) ? 'bg-rose-500' : 'bg-gray-300'
                                }`}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                        (getValue('enable_maintenance_fee') ?? true) ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                        </div>

                        {/* Số tiền phí bảo trì */}
                        <div>
                            <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
                                <Coins size={14} className="text-rose-400" />
                                Số tiền trừ mỗi tháng
                            </label>
                            <FormattedNumberInput
                                value={getValue('maintenance_fee_amount') ?? 50000}
                                onChange={(val: number) => handleChange('maintenance_fee_amount', val)}
                                className="w-full bg-rose-50/50 border-2 border-rose-100 rounded-xl px-4 py-3 text-lg font-bold text-rose-900 focus:border-rose-400 focus:ring-0 transition-colors"
                                suffix="VNĐ"
                                suffixColor="text-rose-600/50"
                            />
                            <p className="text-[11px] text-gray-400 mt-1.5 font-medium">Mặc định: 50,000 VND. Ghi chú trên Ví: &quot;Phí bảo trì hệ thống tháng MM/YYYY&quot;</p>
                        </div>

                        <hr className="border-gray-100 my-4" />

                        {/* Toggle: Cho phép trừ vào tiền cọc */}
                        <div className="flex items-center justify-between p-4 bg-amber-50 rounded-xl border border-amber-100">
                            <div>
                                <label className="block text-sm font-black text-gray-900 mb-1">
                                    Cho phép trừ vào tiền cọc
                                </label>
                                <p className="text-[11px] text-amber-700 font-medium">BẬT = Nếu ví không đủ, sẽ trừ vào phần tiền cọc (ký quỹ). TẮT = Ví có thể bị âm nhưng không động vào cọc.</p>
                            </div>
                            <button
                                onClick={() => handleChange('maintenance_fee_deduct_deposit', !(getValue('maintenance_fee_deduct_deposit') ?? true))}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                    (getValue('maintenance_fee_deduct_deposit') ?? true) ? 'bg-amber-500' : 'bg-gray-300'
                                }`}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                        (getValue('maintenance_fee_deduct_deposit') ?? true) ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Card: Kiểm soát Tan ca */}
                <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                                <ShieldAlert size={20} className="text-indigo-500" />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-gray-900">Kiểm soát Tan ca</h2>
                                <p className="text-[11px] text-gray-400 font-medium">Cấu hình riêng cho Loại {activeTab.replace('TYPE_', '')}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            {saveStatus === 'success' && savingGroup === 'checkout_control' && (
                                <span className="text-emerald-500 text-xs font-bold flex items-center gap-1"><CheckCircle2 size={14} /> Đã lưu</span>
                            )}
                            {hasChanges(['block_checkout_incomplete_tasks']) && (
                                <button
                                    onClick={() => handleSaveGroup(['block_checkout_incomplete_tasks'], 'checkout_control')}
                                    disabled={savingGroup === 'checkout_control'}
                                    className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    {savingGroup === 'checkout_control' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                    Lưu
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="space-y-5">
                        {/* Toggle: Chặn tan ca khi chưa xong việc */}
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                            <div>
                                <label className="block text-sm font-black text-gray-900 mb-1">
                                    Chặn tan ca khi chưa xong việc
                                </label>
                                <p className="text-[11px] text-gray-500 font-medium">BẬT = KTV không thể tan ca nếu còn việc chưa được Admin duyệt. TẮT = Không chặn.</p>
                            </div>
                            <button
                                onClick={() => handleChange('block_checkout_incomplete_tasks', !(getValue('block_checkout_incomplete_tasks') ?? false))}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                    (getValue('block_checkout_incomplete_tasks') ?? false) ? 'bg-indigo-500' : 'bg-gray-300'
                                }`}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                        (getValue('block_checkout_incomplete_tasks') ?? false) ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
                </div>
                </div>
                {/* End of grid */}
                {/* Milestones Editor (Tua) */}
                <MilestonesEditor activeTab={activeTab} />

                {/* Staff Features Table */}
                <div className="mt-8">
                    <KtvFeaturesTable activeTab={activeTab} />
                </div>
            </>
            )}
        </div>
    );
}
