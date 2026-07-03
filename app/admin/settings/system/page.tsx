'use client';

import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Settings, Save, CheckCircle2, AlertCircle, Loader2, Coins, CalendarDays, Percent } from 'lucide-react';
import { motion } from 'motion/react';
import { SystemConfigsTable } from './SystemConfigsTable';

export default function SystemSettingsPage() {
    const [configs, setConfigs] = useState({
        ktv_bonus_rate: 1000,
        ktv_shift_1_bonus: 20,
        ktv_shift_2_bonus: 20,
        ktv_shift_3_bonus: 40,
        ktv_deposit_amount: 3000000,
        ktv_sudden_off_penalty: 50000,
        enable_web_advance_booking_email: false
    });
    
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        fetchConfigs();
    }, []);

    const fetchConfigs = async () => {
        try {
            const res = await fetch('/api/admin/settings/system');
            const data = await res.json();
            if (data.data) {
                setConfigs(prev => ({ ...prev, ...data.data }));
            }
        } catch (error) {
            console.error('Lỗi tải cấu hình:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        setSaveStatus('idle');
        try {
            const res = await fetch('/api/admin/settings/system', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configs)
            });
            const result = await res.json();
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
        setConfigs(prev => ({ ...prev, [key]: value }));
    };

    if (isLoading) {
        return (
            <AppLayout title="Cấu Hình Hệ Thống">
                <div className="flex flex-col items-center justify-center min-h-[60vh]">
                    <Loader2 size={32} className="text-indigo-500 animate-spin" />
                    <p className="mt-4 text-gray-500 font-medium">Đang tải cấu hình...</p>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout title="Cấu Hình Hệ Thống">
            <div className="max-w-4xl mx-auto space-y-6">
                
                {/* Header */}
                <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center">
                            <Settings size={28} className="text-indigo-600" />
                        </div>
                        <div>
                            <h1 className="text-xl font-black text-gray-900">Cấu hình hệ thống</h1>
                            <p className="text-sm text-gray-500 mt-1 font-medium">Quản lý các định mức điểm thưởng và tài chính chung</p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                        {saveStatus === 'success' && (
                            <motion.span initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="text-emerald-600 font-bold text-sm flex items-center gap-1.5">
                                <CheckCircle2 size={16} /> Đã lưu thành công
                            </motion.span>
                        )}
                        {saveStatus === 'error' && (
                            <motion.span initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="text-rose-600 font-bold text-sm flex items-center gap-1.5">
                                <AlertCircle size={16} /> Lỗi khi lưu
                            </motion.span>
                        )}
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-sm hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                            Lưu Cấu Hình
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Card: Điểm Thưởng */}
                    <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                                <Coins size={20} className="text-amber-500" />
                            </div>
                            <h2 className="text-lg font-black text-gray-900">Mốc Điểm Thưởng (Bonus)</h2>
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
                                        value={configs.ktv_bonus_rate}
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
                                            value={configs.ktv_shift_1_bonus}
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
                                            value={configs.ktv_shift_2_bonus}
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
                                        value={configs.ktv_shift_3_bonus}
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
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center">
                                <Coins size={20} className="text-teal-500" />
                            </div>
                            <h2 className="text-lg font-black text-gray-900">Tài Chính & Ký Quỹ KTV</h2>
                        </div>
                        
                        <div className="space-y-5">
                            <div>
                                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2">
                                    Tiền cọc duy trì (Ví quỹ)
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={configs.ktv_deposit_amount}
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
                                        value={configs.ktv_sudden_off_penalty}
                                        onChange={(e) => handleChange('ktv_sudden_off_penalty', Number(e.target.value))}
                                        className="w-full bg-rose-50 border-2 border-rose-100 rounded-xl px-4 py-3 text-lg font-bold text-rose-900 focus:border-rose-400 focus:ring-0 transition-colors"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-rose-600/50 font-bold">VNĐ</span>
                                </div>
                                <p className="text-[11px] text-gray-400 mt-1.5 font-medium">Mức phạt áp dụng cho mỗi bản ghi "Nghỉ đột xuất" được tạo tự động khi KTV tan ca sớm hoặc nghỉ không phép.</p>
                            </div>

                            <div className="p-4 bg-orange-50 rounded-xl border border-orange-100">
                                <h3 className="text-xs font-black uppercase tracking-wider text-orange-600 mb-2 flex items-center gap-2">
                                    <AlertCircle size={14} /> Ghi chú quan trọng
                                </h3>
                                <p className="text-[11px] text-orange-800 font-medium leading-relaxed">
                                    Mọi thay đổi trong bảng cấu hình này sẽ lập tức có hiệu lực và ảnh hưởng đến các lần thanh toán, chia thưởng phát sinh <strong>TỪ THỜI ĐIỂM LƯU TRỞ ĐI</strong>. Vui lòng cân nhắc kỹ trước khi thay đổi.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Card: Tính năng Web Booking */}
                    <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                                <AlertCircle size={20} className="text-amber-500" />
                            </div>
                            <h2 className="text-lg font-black text-gray-900">Tính năng Web Booking</h2>
                        </div>
                        
                        <div className="space-y-5">
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                                <div>
                                    <h3 className="text-sm font-bold text-gray-900">Gửi Email Yêu Cầu Đặt Cọc</h3>
                                    <p className="text-xs text-gray-500 mt-1">Tự động gửi email yêu cầu đặt cọc cho khách khi Lễ tân bấm Xác nhận đơn từ Web.</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                    <input 
                                        type="checkbox" 
                                        className="sr-only peer"
                                        checked={configs.enable_web_advance_booking_email}
                                        onChange={(e) => handleChange('enable_web_advance_booking_email', e.target.checked)}
                                    />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bảng cấu hình nâng cao sẽ nằm ngoài Grid để full width */}
                <SystemConfigsTable />
            </div>
        </AppLayout>
    );
}
