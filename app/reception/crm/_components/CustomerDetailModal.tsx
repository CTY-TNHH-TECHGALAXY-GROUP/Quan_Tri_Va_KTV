'use client';

import React, { useState } from 'react';
import { Customer } from '@/lib/types';
import { X, Receipt, Star, Phone, Tag, Building2, MapPin, Mail, FileText, Check, Edit2 } from 'lucide-react';

const MODAL_ANIMATION_MS = 200;
const BADGE_COLORS = {
  vat: 'bg-amber-100 text-amber-700 border-amber-200',
  vip: 'bg-amber-100 text-amber-700',
  member: 'bg-blue-100 text-blue-700',
};

const POPULAR_COUNTRIES = [
  'Việt Nam', 'Hàn Quốc', 'Trung Quốc', 'Nhật Bản', 'Đài Loan', 'Mỹ', 'Anh', 'Úc', 'Singapore', 'Thái Lan', 'Malaysia'
];

export const CustomerDetailModal = ({ customer, formatVND, onClose, onUpdate }: { 
  customer: Customer; 
  formatVND: (n?: number) => string;
  onClose: () => void; 
  onUpdate?: (updated: Customer) => void;
}) => {
  const [showAllServices, setShowAllServices] = useState(false);
  const [showAllKtvs, setShowAllKtvs] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState(customer.notes || '');
  const [gender, setGender] = useState(customer.gender || '');
  const [nationality, setNationality] = useState(customer.nationality || '');
  const [preferredLang, setPreferredLang] = useState(customer.preferredLangCode || 'vi');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: customer.id, 
          notes, 
          gender, 
          nationality, 
          preferredLang 
        })
      });
      const data = await res.json();
      if (data.success) {
        setIsEditing(false);
        if (onUpdate) {
          onUpdate({
            ...customer,
            notes,
            gender,
            nationality,
            preferredLangCode: preferredLang,
            preferredLang: preferredLang === 'en' ? '🇬🇧 English' : preferredLang === 'vi' ? '🇻🇳 Tiếng Việt' : preferredLang === 'jp' ? '🇯🇵 日本語' : preferredLang === 'cn' ? '🇨🇳 中文' : preferredLang === 'kr' ? '🇰🇷 한국어' : preferredLang,
            preferredGender: gender === 'male' ? 'Nam' : gender === 'female' ? 'Nữ' : gender
          });
        }
      } else {
        alert('Lỗi lưu thông tin: ' + data.error);
      }
    } catch (e) {
      alert('Lỗi mạng');
    } finally {
      setIsSaving(false);
    }
  };

  const renderList = (
    items: any, 
    showAll: boolean, 
    setShowAll: (v: boolean) => void, 
    typeLabel: string
  ) => {
    const list = Array.isArray(items) 
      ? items 
      : (items && typeof items === 'string' 
          ? items.split(',').map(s => s.trim()).filter(Boolean) 
          : []);
    
    if (list.length === 0) {
      return <div className="text-xs font-semibold text-gray-400 mt-1 italic">---</div>;
    }

    const visibleItems = showAll ? list : list.slice(0, 3);
    const hasMore = list.length > 3;

    return (
      <div className="space-y-1 mt-1">
        <ul className="list-disc pl-4 space-y-1 text-xs font-semibold text-gray-800">
          {visibleItems.map((item: string, idx: number) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
        {hasMore && (
          <button 
            onClick={() => setShowAll(!showAll)} 
            className="text-[11px] text-indigo-600 hover:text-indigo-800 hover:underline font-bold mt-1 block"
          >
            {showAll ? 'Thu gọn' : `Xem thêm (${list.length - 3} ${typeLabel})`}
          </button>
        )}
      </div>
    );
  };

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onClose(); }}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        style={{ animation: `fadeInScale ${MODAL_ANIMATION_MS}ms ease-out` }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-gray-900">Chi tiết Khách Hàng</h2>
            {isEditing && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700 animate-pulse">
                Chế độ chỉnh sửa
              </span>
            )}
          </div>
          <button 
            onClick={onClose} 
            disabled={isSaving}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Customer Info */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xl font-bold shrink-0">
              {(customer.fullName || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-gray-900 truncate">{customer.fullName}</h3>
                {customer.taxCode && (
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${BADGE_COLORS.vat}`}>
                    <Receipt size={10} />
                    VAT
                  </span>
                )}
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  (customer.visitCount || 0) > 10 ? BADGE_COLORS.vip : BADGE_COLORS.member
                }`}>
                  <Star size={10} />
                  {(customer.visitCount || 0) > 10 ? 'VIP' : 'Member'}
                </span>

                {/* GENDER BADGE / SELECT */}
                {isEditing ? (
                  <div className="inline-flex items-center gap-1 bg-purple-50 px-2 py-0.5 rounded border border-purple-100">
                    <span className="text-[10px] font-bold text-purple-700">Giới tính:</span>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="text-[10px] font-bold bg-transparent text-purple-700 outline-none cursor-pointer"
                    >
                      <option value="">Chưa chọn</option>
                      <option value="male">Nam</option>
                      <option value="female">Nữ</option>
                    </select>
                  </div>
                ) : (
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    (customer.gender || customer.preferredGender) ? 'bg-purple-50 text-purple-600 border border-purple-100' : 'bg-gray-50 text-gray-500 border border-gray-100'
                  }`}>
                    {customer.gender === 'male' ? 'Nam' : customer.gender === 'female' ? 'Nữ' : (customer.preferredGender || customer.gender || 'Giới tính: Chưa chọn')}
                  </span>
                )}

                {/* LANG BADGE / SELECT */}
                {isEditing ? (
                  <div className="inline-flex items-center gap-1 bg-sky-50 px-2 py-0.5 rounded border border-sky-100">
                    <span className="text-[10px] font-bold text-sky-700">Ngôn ngữ:</span>
                    <select
                      value={preferredLang}
                      onChange={(e) => setPreferredLang(e.target.value)}
                      className="text-[10px] font-bold bg-transparent text-sky-700 outline-none cursor-pointer"
                    >
                      <option value="vi">VN Tiếng Việt</option>
                      <option value="en">EN English</option>
                      <option value="cn">CN 中文</option>
                      <option value="kr">KR 한국어</option>
                      <option value="jp">JP 日本語</option>
                    </select>
                  </div>
                ) : (
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    customer.preferredLang && customer.preferredLang !== 'N/A' ? 'bg-sky-50 text-sky-600 border border-sky-100' : 'bg-gray-50 text-gray-500 border border-gray-100'
                  }`}>
                    Ngôn ngữ: {customer.preferredLang && customer.preferredLang !== 'N/A' ? customer.preferredLang.split(' ')[0].toUpperCase() : 'Chưa chọn'}
                  </span>
                )}

                {/* NATIONALITY BADGE / INPUT WITH CUSTOM DROPDOWN */}
                {isEditing ? (
                  <div className="relative inline-block text-left">
                    <div className="inline-flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded border border-emerald-200 text-[10px] font-bold text-emerald-700">
                      <span>Quốc tịch:</span>
                      <input
                        type="text"
                        value={nationality}
                        onChange={(e) => {
                          setNationality(e.target.value);
                          setDropdownOpen(true);
                        }}
                        onFocus={() => setDropdownOpen(true)}
                        placeholder="Nhập quốc tịch..."
                        className="text-[10px] font-bold bg-transparent text-emerald-700 outline-none w-28 placeholder-emerald-600/40"
                      />
                      <button 
                        type="button"
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className="text-[8px] text-emerald-600 hover:text-emerald-800 focus:outline-none ml-0.5"
                      >
                        ▼
                      </button>
                    </div>

                    {dropdownOpen && (
                      <>
                        <div 
                          className="fixed inset-0 z-40" 
                          onClick={() => setDropdownOpen(false)}
                        />
                        <div className="absolute top-full left-0 mt-2 z-50 bg-[#1e1e1e] text-white rounded-2xl shadow-xl w-44 py-1.5 border border-zinc-800 text-[11px] font-medium min-w-[160px] select-none">
                          <div className="absolute -top-1 left-6 w-2 h-2 bg-[#1e1e1e] border-t border-l border-zinc-800 rotate-45" />
                          <div className="max-h-48 overflow-y-auto relative z-10 scrollbar-thin scrollbar-thumb-zinc-700">
                            {POPULAR_COUNTRIES.filter(c => 
                              !nationality || c.toLowerCase().includes(nationality.toLowerCase())
                            ).map((c) => (
                              <div
                                key={c}
                                onClick={() => {
                                  setNationality(c);
                                  setDropdownOpen(false);
                                }}
                                className="px-4 py-2 hover:bg-zinc-800 cursor-pointer transition-colors text-left font-medium text-gray-200 hover:text-white"
                              >
                                {c}
                              </div>
                            ))}
                            {POPULAR_COUNTRIES.filter(c => 
                              !nationality || c.toLowerCase().includes(nationality.toLowerCase())
                            ).length === 0 && (
                              <div className="px-4 py-2 text-gray-500 italic text-left">
                                Nhập tự do...
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    customer.nationality ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-gray-50 text-gray-500 border border-gray-100'
                  }`}>
                    {customer.nationality ? `Quốc tịch: ${customer.nationality}` : 'Quốc tịch: Chưa chọn'}
                  </span>
                )}

                {customer.guestType && (
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    customer.guestType === 'Khách nhóm' ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-gray-100 text-gray-700 border border-gray-200'
                  }`}>
                    {customer.guestType}
                  </span>
                )}
                {customer.maxGuestCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-600 border border-orange-100">
                    SL: {customer.maxGuestCount}
                  </span>
                )}
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  (customer.visitCount || 0) > 1 ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-green-50 text-green-600 border border-green-100'
                }`}>
                  {(customer.visitCount || 0) > 1 ? 'Khách cũ' : 'Khách mới'}
                </span>
              </div>
              <div className="text-sm text-gray-500 mt-1 flex items-center gap-3">
                <span className="flex items-center gap-1"><Phone size={12} /> {customer.phone}</span>
                {customer.email && (
                  <span className="text-indigo-500 flex items-center gap-1">@ {customer.email}</span>
                )}
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Tổng chi tiêu</div>
              <div className="text-base font-bold text-gray-900 mt-1">{formatVND(customer.totalSpent)}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Số lần đến</div>
              <div className="text-base font-bold text-gray-900 mt-1">{customer.visitCount || 0}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Lần cuối</div>
              <div className="text-sm font-bold text-gray-900 mt-1">
                {customer.lastVisited ? new Date(customer.lastVisited).toLocaleDateString('vi-VN') : '---'}
              </div>
            </div>
            
            <div className="bg-blue-50/50 rounded-xl p-3 text-center">
              <div className="text-[10px] text-blue-600 uppercase tracking-wider font-semibold">Trong 30 ngày</div>
              <div className="text-base font-bold text-blue-900 mt-1">{customer.visitsLast30Days || 0} lần</div>
            </div>
            <div className="bg-blue-50/50 rounded-xl p-3 text-center">
              <div className="text-[10px] text-blue-600 uppercase tracking-wider font-semibold">Khung giờ tới</div>
              <div className="text-sm font-bold text-blue-900 mt-1">{customer.frequentTimeFrame || 'N/A'}</div>
            </div>
            <div className="bg-blue-50/50 rounded-xl p-3 text-center">
              <div className="text-[10px] text-blue-600 uppercase tracking-wider font-semibold">💆‍♀️ Dịch vụ nhiều nhất</div>
              <div className="text-xs font-bold text-blue-900 mt-1.5 truncate" title={customer.topService || 'N/A'}>
                {customer.topService || 'N/A'}
              </div>
            </div>
            <div className="bg-blue-50/50 rounded-xl p-3 text-center">
              <div className="text-[10px] text-blue-600 uppercase tracking-wider font-semibold">VIP Menu</div>
              <div className="text-sm font-bold text-blue-900 mt-1">{(customer.vipMenuCount || 0) > 0 ? `${customer.vipMenuCount || 0} lần` : 'Chưa'}</div>
            </div>
            <div className="bg-green-50/50 rounded-xl p-3 text-center">
              <div className="text-[10px] text-green-600 uppercase tracking-wider font-semibold">💪 Lực ưa thích</div>
              <div className="text-sm font-bold text-green-900 mt-1">{customer.preferredStrength || 'N/A'}</div>
            </div>
          </div>

          {/* V9 Preferences Row */}
          <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 space-y-3">
             <div className="text-[10px] text-indigo-600 uppercase tracking-wider font-bold mb-1.5 flex items-center gap-1.5">
               <Star size={12} /> Thói quen & Sở thích (Hệ thống phân tích)
             </div>
             
             <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                <div>
                  <div className="text-[10px] text-gray-500 font-medium">Dịch vụ thường dùng</div>
                  {renderList(customer.frequentServices, showAllServices, setShowAllServices, 'dịch vụ')}
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 font-medium">KTV quen</div>
                  {renderList(customer.frequentKtvs, showAllKtvs, setShowAllKtvs, 'KTV')}
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 font-medium">Loại đơn sử dụng</div>
                  <div className="text-xs font-medium text-gray-700 line-clamp-2" title={customer.usedSources || 'N/A'}>
                    {customer.usedSources || 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 font-medium">Tất cả KTV đã làm</div>
                  <div className="text-xs font-medium text-gray-700 line-clamp-2" title={customer.allKtvs || 'N/A'}>
                    {customer.allKtvs || 'N/A'}
                  </div>
                </div>
             </div>
          </div>

          {/* Notes (Editable in isEditing mode) */}
          {isEditing ? (
            <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4">
              <div className="text-[10px] text-indigo-600 uppercase tracking-wider font-bold mb-1.5">📝 Ghi chú sở thích, đặc điểm</div>
              <textarea 
                className="w-full text-xs p-2 border border-gray-300 rounded outline-none focus:ring-1 focus:ring-indigo-500 min-h-[60px] bg-white font-medium text-gray-700"
                placeholder="Nhập ghi chú sở thích, đặc điểm..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          ) : (
            <div className="bg-amber-50/70 border border-amber-100 rounded-xl p-4">
              <div className="text-[10px] text-amber-600 uppercase tracking-wider font-bold mb-1.5">📝 Ghi chú</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap">
                {customer.notes || <span className="text-gray-400 italic">Chưa có ghi chú (sở thích, thói quen...)</span>}
              </div>
            </div>
          )}

          {/* KTV Reviews */}
          {customer.ktvReviews && customer.ktvReviews.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2">Đánh giá từ KTV</div>
              <div className="flex flex-wrap gap-1.5">
                {customer.ktvReviews.map((review, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 text-rose-600 text-xs font-medium border border-rose-100">
                    <Tag size={10} /> {review}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ──── VAT Invoice Section ──── */}
          {customer.taxCode && (
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
                  <FileText size={14} className="text-amber-700" />
                </div>
                <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                  Thông tin xuất hoá đơn VAT
                </h4>
              </div>

              <div className="space-y-2.5 pl-1">
                {/* MST */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-amber-600 uppercase tracking-widest font-bold bg-amber-100 px-2 py-0.5 rounded">MST</span>
                  <span className="text-sm font-mono font-bold text-amber-900">{customer.taxCode}</span>
                </div>

                {/* Company Name */}
                {customer.companyName && (
                  <div className="flex items-start gap-2.5">
                    <Building2 size={14} className="text-amber-600 mt-0.5 shrink-0" />
                    <span className="text-sm font-semibold text-gray-800">{customer.companyName}</span>
                  </div>
                )}

                {/* Address */}
                {customer.companyAddress && (
                  <div className="flex items-start gap-2.5">
                    <MapPin size={14} className="text-gray-400 mt-0.5 shrink-0" />
                    <span className="text-sm text-gray-600">{customer.companyAddress}</span>
                  </div>
                )}

                {/* Email */}
                {customer.companyEmail && (
                  <div className="flex items-start gap-2.5">
                    <Mail size={14} className="text-gray-400 mt-0.5 shrink-0" />
                    <span className="text-sm text-gray-600">{customer.companyEmail}</span>
                  </div>
                )}

                {/* Phone */}
                {customer.companyPhone && (
                  <div className="flex items-start gap-2.5">
                    <Phone size={14} className="text-gray-400 mt-0.5 shrink-0" />
                    <span className="text-sm text-gray-600">{customer.companyPhone}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-3 flex justify-between rounded-b-2xl">
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <button 
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Check size={14} /> {isSaving ? 'Đang lưu...' : 'Lưu'}
                </button>
                <button 
                  onClick={() => {
                    setIsEditing(false);
                    setNotes(customer.notes || '');
                    setGender(customer.gender || '');
                    setNationality(customer.nationality || '');
                    setPreferredLang(customer.preferredLangCode || 'vi');
                  }}
                  disabled={isSaving}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Hủy
                </button>
              </>
            ) : (
              <button 
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 text-sm font-semibold transition-colors flex items-center gap-1.5"
              >
                <Edit2 size={14} /> Chỉnh sửa
              </button>
            )}
          </div>
          <button 
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* Animation keyframes */}
      <style jsx>{`
        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
};
