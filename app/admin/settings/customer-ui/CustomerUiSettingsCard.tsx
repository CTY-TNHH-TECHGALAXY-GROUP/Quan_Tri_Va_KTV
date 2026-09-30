'use client';

import React, { useState, useEffect } from 'react';
import { Save, Image as ImageIcon, Loader2, CheckCircle2, RotateCcw, Sparkles, ExternalLink } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?q=80&w=1000&auto=format&fit=crop';

const PRESETS = [
    {
        name: 'Mặc định (Spa Massage Thư Giãn)',
        url: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?q=80&w=1000&auto=format&fit=crop',
    },
    {
        name: 'Nến thơm & Thảo mộc thiên nhiên',
        url: 'https://images.unsplash.com/photo-1600334129128-685c5582fd35?q=80&w=1000&auto=format&fit=crop',
    },
    {
        name: 'Bồn hoa sen & Nước ấm trị liệu',
        url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?q=80&w=1000&auto=format&fit=crop',
    },
    {
        name: 'Đá nóng massage & Tinh dầu thư giãn',
        url: 'https://images.unsplash.com/photo-1519823551278-64ac92734fb1?q=80&w=1000&auto=format&fit=crop',
    }
];

export const CustomerUiSettingsCard = () => {
    const [imageUrl, setImageUrl] = useState<string>(DEFAULT_IMAGE);
    const [initialImageUrl, setInitialImageUrl] = useState<string>(DEFAULT_IMAGE);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        const fetchConfig = async () => {
            setIsLoading(true);
            try {
                const res = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
                if (res?.data) {
                    const loadedUrl = res.data.waiting_room_hero_image || res.data.waiting_room_image_url;
                    if (loadedUrl && typeof loadedUrl === 'string' && loadedUrl.trim()) {
                        setImageUrl(loadedUrl.trim());
                        setInitialImageUrl(loadedUrl.trim());
                    }
                }
            } catch (error) {
                console.error('Lỗi tải cấu hình hình ảnh màn hình chờ:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchConfig();
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        setSaveStatus('idle');
        setErrorMessage('');
        try {
            const cleanUrl = imageUrl.trim() || DEFAULT_IMAGE;
            const result = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, {
                waiting_room_hero_image: cleanUrl
            });

            if (result.success) {
                setInitialImageUrl(cleanUrl);
                setImageUrl(cleanUrl);
                setSaveStatus('success');
                setTimeout(() => setSaveStatus('idle'), 3000);
            } else {
                setSaveStatus('error');
                setErrorMessage(result.error || 'Lỗi khi lưu cài đặt');
            }
        } catch (error: any) {
            console.error('Lỗi lưu cấu hình:', error);
            setSaveStatus('error');
            setErrorMessage(error?.message || 'Lỗi kết nối máy chủ');
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        setImageUrl(DEFAULT_IMAGE);
    };

    const isDirty = imageUrl.trim() !== initialImageUrl.trim();

    if (isLoading) {
        return (
            <div className="bg-white rounded-[2rem] p-12 shadow-sm border border-gray-100 flex justify-center items-center h-64">
                <Loader2 className="animate-spin text-indigo-500" size={32} />
            </div>
        );
    }

    return (
        <div className="bg-white rounded-[2rem] p-6 md:p-8 shadow-sm border border-gray-100 space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-6">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                        <ImageIcon size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-gray-900">Màn Hình Chờ Đơn Hàng (Waiting Room)</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            Tuỳ chỉnh hình ảnh hiển thị trên máy khách hàng & tablet sau khi bấm gửi đơn đặt dịch vụ
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {saveStatus === 'success' && (
                        <span className="text-emerald-600 text-xs font-bold flex items-center gap-1.5 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100">
                            <CheckCircle2 size={16} /> Đã lưu thành công
                        </span>
                    )}
                    {saveStatus === 'error' && (
                        <span className="text-rose-600 text-xs font-bold bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-100">
                            {errorMessage || 'Lưu thất bại'}
                        </span>
                    )}

                    <button
                        onClick={handleReset}
                        disabled={isSaving || imageUrl === DEFAULT_IMAGE}
                        className="px-4 py-2.5 rounded-xl font-bold text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 active:scale-95 transition-all flex items-center gap-2 border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Đặt lại ảnh Unsplash mặc định"
                    >
                        <RotateCcw size={14} />
                        Mặc định
                    </button>

                    <button
                        onClick={handleSave}
                        disabled={isSaving || !isDirty}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold uppercase tracking-wider text-xs active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-100"
                    >
                        {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                        Lưu Cấu Hình
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Form Controls Column */}
                <div className="lg:col-span-6 space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-600 uppercase tracking-wider flex items-center justify-between">
                            <span>Đường dẫn hình ảnh (Image URL)</span>
                            <span className="text-[11px] font-normal text-gray-400">Hỗ trợ JPG, PNG, WEBP, Unsplash</span>
                        </label>
                        <input
                            type="text"
                            value={imageUrl}
                            onChange={(e) => setImageUrl(e.target.value)}
                            placeholder="https://images.unsplash.com/..."
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none text-sm font-mono transition-all"
                        />
                        <p className="text-xs text-gray-500 leading-relaxed">
                            💡 Dán link ảnh mới từ Unsplash, Cloudinary, Imgur, Supabase Storage hoặc bất kỳ CDN công khai nào.
                        </p>
                    </div>

                    {/* Presets */}
                    <div className="space-y-3 pt-2">
                        <label className="text-xs font-black text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                            <Sparkles size={14} className="text-amber-500" />
                            Gợi ý ảnh Spa đẹp sẵn có
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {PRESETS.map((preset, idx) => {
                                const isSelected = imageUrl === preset.url;
                                return (
                                    <button
                                        key={idx}
                                        type="button"
                                        onClick={() => setImageUrl(preset.url)}
                                        className={`p-3 rounded-xl border text-left transition-all flex items-start gap-3 ${
                                            isSelected
                                                ? 'bg-indigo-50/70 border-indigo-300 ring-2 ring-indigo-500/20'
                                                : 'bg-gray-50/50 border-gray-200 hover:border-gray-300 hover:bg-gray-100/50'
                                        }`}
                                    >
                                        <img
                                            src={preset.url}
                                            alt={preset.name}
                                            className="w-12 h-12 rounded-lg object-cover flex-shrink-0 shadow-sm"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <p className={`text-xs font-bold leading-tight ${isSelected ? 'text-indigo-900' : 'text-gray-800'}`}>
                                                {preset.name}
                                            </p>
                                            <span className="text-[10px] text-gray-400 mt-1 block truncate">
                                                {preset.url}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Technical Tips */}
                    <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 space-y-1.5 text-xs text-amber-900">
                        <p className="font-bold flex items-center gap-1.5 text-amber-950">
                            📌 Gợi ý tỉ lệ tối ưu:
                        </p>
                        <ul className="list-disc pl-4 space-y-1 text-amber-800 text-[11px]">
                            <li>Tỉ lệ khuyến nghị: <strong>16:9</strong> hoặc <strong>4:3</strong>, độ phân giải tối thiểu 1000px chiều ngang.</li>
                            <li>Hình ảnh sẽ có lớp phủ tối tự động (opacity 60%) để làm nổi bật số thứ tự đơn (Mã đơn hàng: 020).</li>
                            <li>Khách hàng tải lại trang sẽ nhìn thấy ảnh mới ngay lập tức.</li>
                        </ul>
                    </div>
                </div>

                {/* Live Preview Column */}
                <div className="lg:col-span-6 space-y-3">
                    <label className="text-xs font-black text-gray-600 uppercase tracking-wider flex items-center justify-between">
                        <span>Mô phỏng thực tế (Khách hàng nhìn thấy)</span>
                        <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                            Live Preview
                        </span>
                    </label>

                    {/* Simulation frame matching WaitingRoom.tsx */}
                    <div className="bg-[#0f0f10] p-4 sm:p-6 rounded-[2rem] border border-gray-800 shadow-xl max-w-md mx-auto">
                        <div className="text-center mb-3">
                            <span className="text-[10px] tracking-widest uppercase font-bold text-gray-500">
                                Giao diện Tablet & Điện thoại khách
                            </span>
                        </div>

                        {/* Hero Card Simulation */}
                        <div className="relative w-full aspect-[4/3] bg-[#1c1c1e] rounded-3xl overflow-hidden shadow-md border border-white/10">
                            <img
                                src={imageUrl || DEFAULT_IMAGE}
                                alt="Spa Relax Preview"
                                className="object-cover w-full h-full opacity-60 transition-all duration-300"
                                onError={(e) => {
                                    e.currentTarget.src = DEFAULT_IMAGE;
                                }}
                            />
                            {/* Order ID Badge */}
                            <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md rounded-2xl px-4 py-2.5 flex flex-col items-center justify-center shadow-md border border-[#C9A96E]/20 min-w-[80px]">
                                <span className="text-[#C9A96E] font-bold text-[10px] md:text-xs uppercase tracking-wider">
                                    Mã đơn hàng
                                </span>
                                <span className="text-3xl md:text-4xl font-black text-white tracking-wider leading-none mt-1">
                                    020
                                </span>
                            </div>
                            {/* Status Pill */}
                            <div className="absolute bottom-4 left-4 bg-[#0d0d0d]/90 backdrop-blur-sm border border-white/10 px-4 py-2 rounded-full flex items-center gap-2 shadow-sm">
                                <div className="w-2.5 h-2.5 rounded-full bg-[#C9A96E] animate-pulse"></div>
                                <span className="text-[#C9A96E] font-bold text-xs uppercase tracking-wider">
                                    Chuẩn bị dịch vụ
                                </span>
                            </div>
                        </div>

                        {/* Welcome text preview */}
                        <div className="text-center px-4 mt-4">
                            <p className="text-sm font-bold text-white/90">
                                Cảm ơn Quý khách! Đơn hàng đang được chuẩn bị.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
