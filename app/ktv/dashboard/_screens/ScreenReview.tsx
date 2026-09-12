'use client';

import React, { useState, Suspense } from 'react';
import { AlertCircle, AlertTriangle, BellRing, CheckCircle2, Heart, MicOff, Users } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

export function ScreenReview({ logic }: { logic: any }) {
  const { addToast } = useToast();
  const { booking, handleSubmitReview } = logic;
  const [selectedTraits, setSelectedTraits] = useState<string[]>([]);

  // 🔧 UI CONFIGURATION — Personality categories matching mockup
  const PERSONALITY_CATEGORIES = [
    {
      id: 'de_xom',
      label: 'Khách Dê Xồm',
      subtitle: 'Thiếu tôn trọng KTV',
      icon: <AlertTriangle size={20} />,
      selectedStyle: 'bg-rose-50 border-rose-400 text-rose-700',
      iconBg: 'bg-rose-100 text-rose-600',
    },
    {
      id: 'ky_tinh',
      label: 'Khách Kỹ Tính + Khó Chịu',
      subtitle: 'Yêu cầu sự tinh tế',
      icon: <AlertCircle size={20} />,
      selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
      iconBg: 'bg-slate-100 text-slate-500',
    },
    {
      id: 'de_thuong',
      label: 'Khách Dễ Thương',
      subtitle: 'Thân thiện, cởi mở',
      icon: <Heart size={20} />,
      selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
      iconBg: 'bg-slate-100 text-slate-500',
    },
    {
      id: 'huong_noi',
      label: 'Khách Hướng Nội',
      subtitle: 'Thích yên tĩnh, ít nói',
      icon: <MicOff size={20} />,
      selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
      iconBg: 'bg-slate-100 text-slate-500',
    },
    {
      id: 'huong_ngoai',
      label: 'Khách Hướng Ngoại',
      subtitle: 'Thích giao lưu, kết nối',
      icon: <Users size={20} />,
      selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
      iconBg: 'bg-slate-100 text-slate-500',
    },
  ];

  const toggleTrait = (label: string) => {
    setSelectedTraits(prev =>
      prev.includes(label) ? prev.filter(t => t !== label) : [...prev, label]
    );
  };

  return (
    <div className="p-5 pt-10 space-y-6 max-w-lg mx-auto pb-28">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="text-emerald-500" size={36} />
        </div>
        <h2 className="text-2xl font-black text-slate-800">Dịch vụ hoàn tất!</h2>
        <p className="text-sm text-slate-400 font-medium">Đánh giá hồ sơ khách hàng</p>
      </div>

      {/* Warning Banner */}
      <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
        <div className="w-8 h-8 bg-rose-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
          <AlertTriangle className="text-rose-500" size={16} />
        </div>
        <p className="text-xs font-black text-rose-700 leading-relaxed uppercase tracking-tight">
          Nhắc khách kiểm tra lại điện thoại, ví tiền và nữ trang trước khi rời phòng
        </p>
      </div>

      {logic.booking?.nextBookingId && (
        <div className="bg-amber-50 border-2 border-amber-200 p-4 rounded-2xl flex items-center gap-3 shadow-md shadow-amber-100/50">
          <div className="w-10 h-10 bg-amber-200 rounded-full flex items-center justify-center shrink-0">
            <BellRing className="text-amber-700 animate-bounce" size={20} />
          </div>
          <div className="flex-1">
             <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Sắp tới</p>
             <p className="text-xs font-bold text-amber-800">{logic.booking.nextServiceName || 'Đơn mới'}{logic.booking.nextStartTime ? <span className="ml-1 text-amber-600">• {logic.booking.nextStartTime}</span> : ''}</p>
          </div>
        </div>
      )}

      {/* Personality Categories */}
      <div className="space-y-3">
        {PERSONALITY_CATEGORIES.map((cat) => {
          const isSelected = selectedTraits.includes(cat.label);
          return (
            <button
              key={cat.id}
              onClick={() => toggleTrait(cat.label)}
              className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all active:scale-[0.98] ${
                isSelected
                  ? cat.selectedStyle
                  : 'bg-white border-slate-100 text-slate-700 hover:border-slate-200'
              }`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                isSelected
                  ? (cat.id === 'de_xom' ? 'bg-rose-200 text-rose-600' : 'bg-emerald-200 text-emerald-600')
                  : cat.iconBg
              }`}>
                {cat.icon}
              </div>
              <div className="text-left flex-1">
                <p className="font-black text-sm">{cat.label}</p>
                <p className={`text-xs font-medium mt-0.5 ${isSelected ? 'opacity-80' : 'text-slate-400'}`}>
                  {cat.subtitle}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Submit Button */}
      <div className="pt-2">
        <button
          onClick={() => handleSubmitReview({ personality: selectedTraits })}
          disabled={logic.isLoading}
          className="w-full py-4 rounded-2xl font-black text-base shadow-lg transition-all active:scale-[0.97] bg-emerald-600 text-white shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50"
        >
          {/* Chọn tính cách khách là TUỲ Ý. Nút ghi "Lưu hồ sơ" lúc chưa chọn gì
              khiến KTV tưởng bắt buộc phải tích mới đi tiếp được. */}
          {logic.isLoading
            ? 'Đang lưu...'
            : selectedTraits.length > 0
              ? `Lưu hồ sơ (${selectedTraits.length})`
              : 'Đánh giá KH hoặc bỏ qua'}
        </button>
      </div>
    </div>
  );
}
