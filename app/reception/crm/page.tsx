'use client';

import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import { ShieldAlert, Search, Filter, Plus, User, Phone, Calendar, Star, MoreHorizontal, Edit2, Check, X, Tag, Building2, MapPin, Mail, FileText, Receipt, Download } from 'lucide-react';

import { Customer } from '@/lib/types';

// 🔧 UI CONFIGURATION
const MODAL_ANIMATION_MS = 200;
const BADGE_COLORS = {
  vat: 'bg-amber-100 text-amber-700 border-amber-200',
  vip: 'bg-amber-100 text-amber-700',
  member: 'bg-blue-100 text-blue-700',
};

export default function CRMPage() {
  const { hasPermission } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Export state
  const [showExport, setShowExport] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      params.set('format', 'csv');
      if (exportFrom) params.set('from', exportFrom);
      if (exportTo) params.set('to', exportTo);
      const res = await fetch(`/api/customers/export?${params.toString()}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFrom && exportTo ? `CRM_${exportFrom}_to_${exportTo}.csv` : `CRM_full_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setShowExport(false);
    } catch (err) {
      alert('Lỗi xuất file: ' + (err as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  React.useEffect(() => {
    setMounted(true);
    const fetchCustomers = async () => {
      try {
        const res = await fetch('/api/customers');
        const data = await res.json();
        if (data.success) {
          setCustomers(data.data);
        }
      } catch (err) {
        console.error('Failed to fetch customers:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchCustomers();
  }, []);

  if (!mounted) return null;

  if (!hasPermission('customer_management')) {
    return (
      <AppLayout title="Khách Hàng">
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <ShieldAlert size={48} className="text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-gray-900">Không có quyền truy cập</h2>
        </div>
      </AppLayout>
    );
  }

  const filteredCustomers = customers.filter(c => 
    (c.fullName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (c.phone || '').includes(searchTerm) ||
    (c.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.taxCode || '').includes(searchTerm) ||
    (c.companyName || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatVND = (n?: number) => n ? new Intl.NumberFormat('vi-VN').format(n) + 'đ' : '0đ';

  return (
    <AppLayout title="Khách Hàng">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-sm text-gray-500">Lưu trữ thông tin, lịch sử dịch vụ và phân hạng thành viên.</p>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button 
                onClick={() => setShowExport(!showExport)}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm transition-colors"
              >
                <Download size={16} />
                Xuất Báo Cáo
              </button>
              {showExport && (
                <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-xl p-4 z-50 w-72 space-y-3">
                  <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">Khoảng thời gian</div>
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] text-gray-500 font-medium">Từ ngày</label>
                      <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-medium">Đến ngày</label>
                      <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400">Bỏ trống = xuất toàn bộ lịch sử</p>
                  <button 
                    onClick={handleExport} 
                    disabled={isExporting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm transition-colors disabled:opacity-50"
                  >
                    <Download size={14} />
                    {isExporting ? 'Đang xuất...' : 'Tải CSV'}
                  </button>
                </div>
              )}
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm transition-colors">
              <Plus size={16} />
              Thêm Khách Hàng
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-center bg-gray-50/50">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input 
                type="text" 
                placeholder="Tìm theo tên, SĐT, Email, MST, công ty..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              />
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors w-full sm:w-auto justify-center">
              <Filter size={16} />
              Lọc & Phân Hạng
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm">Khách Hàng</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm text-center">Giới Tính</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm text-center">Ngôn Ngữ</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm">Đánh Giá & Nhận Diện</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm">Hạng Thành Viên</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm text-right">Tổng Chi Tiêu</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm text-center">Số Lần Đến</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm">Lần Cuối</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-gray-500">
                      Đang tải danh sách khách hàng...
                    </td>
                  </tr>
                ) : filteredCustomers.map(customer => (
                  <CustomerRow key={customer.id} customer={customer} formatVND={formatVND} onViewDetail={setSelectedCustomer} />
                ))}
                {!isLoading && filteredCustomers.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-gray-500">
                      Không tìm thấy khách hàng nào phù hợp.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Customer Detail Modal */}
      {selectedCustomer && (
        <CustomerDetailModal 
          customer={selectedCustomer} 
          formatVND={formatVND}
          onClose={() => setSelectedCustomer(null)} 
        />
      )}
    </AppLayout>
  );
}

// ─── Customer Row ────────────────────────────────────────────────────────────

const CustomerRow = ({ customer, formatVND, onViewDetail }: { 
  customer: Customer; 
  formatVND: (n?: number) => string;
  onViewDetail: (c: Customer) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState(customer.notes || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: customer.id, notes })
      });
      const data = await res.json();
      if (data.success) {
        setIsEditing(false);
      } else {
        alert('Lỗi lưu ghi chú: ' + data.error);
      }
    } catch (e) {
      alert('Lỗi mạng');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="p-4 align-top">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
            {(customer.fullName || '?').charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">{customer.fullName}</span>
              {customer.taxCode && (
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${BADGE_COLORS.vat}`}>
                  <Receipt size={10} />
                  VAT
                </span>
              )}
            </div>
            <div className="text-[11px] text-gray-500 flex flex-col gap-0.5 mt-0.5">
              <div className="flex items-center gap-1.5 line-clamp-1">
                <Phone size={10} className="text-gray-400" /> {customer.phone}
              </div>
              {customer.email && (
                <div className="flex items-center gap-1.5 text-indigo-500 font-medium line-clamp-1 italic">
                  @ {customer.email}
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="p-4 align-top text-center">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
          customer.preferredGender === 'Nữ' ? 'bg-pink-50 text-pink-600 border border-pink-100' : 'bg-blue-50 text-blue-600 border border-blue-100'
        }`}>
          {customer.preferredGender === 'Nữ' ? '👩 Nữ' : '👨 Nam'}
        </span>
      </td>
      <td className="p-4 align-top text-center">
        {customer.preferredLang && customer.preferredLang !== 'N/A' ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-600 border border-sky-100">
            {customer.preferredLang}
          </span>
        ) : (
          <span className="text-gray-400 text-xs">---</span>
        )}
      </td>
      <td className="p-4 align-top w-72">
        <div className="flex flex-col gap-2">
          {/* Tags đánh giá của KTV */}
          {customer.ktvReviews && customer.ktvReviews.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {customer.ktvReviews.map((review, idx) => (
                <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-600 text-[10px] font-medium border border-rose-100">
                  <Tag size={10} /> {review}
                </span>
              ))}
            </div>
          )}
          
          {/* V9 Quick Stats */}
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {customer.frequentTimeFrame && customer.frequentTimeFrame !== 'N/A' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100">
                ⏰ {customer.frequentTimeFrame}
              </span>
            )}
            {customer.topService && customer.topService !== 'N/A' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-100 line-clamp-1 max-w-[120px]" title={customer.topService}>
                💆‍♀️ {customer.topService}
              </span>
            )}
            {(customer.vipMenuCount || 0) > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
                👑 VIP Menu
              </span>
            )}
            {customer.preferredStrength && customer.preferredStrength !== 'N/A' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-600 border border-green-100">
                💪 {customer.preferredStrength}
              </span>
            )}
            {/* Moved preferredLang to the new column */}
          </div>
          
          {/* Ghi chú lễ tân */}
          {isEditing ? (
            <div className="flex flex-col gap-1 mt-1">
              <textarea 
                className="w-full text-xs p-2 border border-indigo-300 rounded-md outline-none focus:ring-1 focus:ring-indigo-500 min-h-[60px]"
                placeholder="Ghi chú sở thích, đặc điểm..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                autoFocus
              />
              <div className="flex items-center gap-1 justify-end mt-1">
                <button onClick={() => { setIsEditing(false); setNotes(customer.notes || ''); }} disabled={isSaving} className="px-2 py-1 bg-gray-100 text-gray-700 rounded-md text-[10px] font-medium hover:bg-gray-200">
                  Hủy
                </button>
                <button onClick={handleSave} disabled={isSaving} className="px-2 py-1 bg-indigo-600 text-white rounded-md text-[10px] font-medium hover:bg-indigo-700 flex items-center gap-1">
                  <Check size={12} /> {isSaving ? 'Đang lưu...' : 'Lưu'}
                </button>
              </div>
            </div>
          ) : (
            <div className="group relative mt-1 bg-amber-50/50 p-2 rounded-lg border border-amber-100 min-h-[40px]">
              <div className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-3">
                {notes || <span className="text-gray-400 italic">Chưa có ghi chú (sở thích, thói quen...)</span>}
              </div>
              <button 
                onClick={() => setIsEditing(true)} 
                className="absolute top-1 right-1 p-1 opacity-0 group-hover:opacity-100 bg-white shadow-sm border border-gray-200 rounded text-gray-500 hover:text-indigo-600 transition-opacity"
                title="Sửa ghi chú"
              >
                <Edit2 size={12} />
              </button>
            </div>
          )}
        </div>
      </td>
      <td className="p-4 align-top">
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
          (customer.visitCount || 0) > 10 ? BADGE_COLORS.vip : BADGE_COLORS.member
        }`}>
          <Star size={12} />
          {(customer.visitCount || 0) > 10 ? 'VIP' : 'Member'}
        </span>
      </td>
      <td className="p-4 text-right font-medium text-gray-900 align-top">
        {formatVND(customer.totalSpent)}
      </td>
      <td className="p-4 text-center text-gray-700 font-medium align-top">
        {customer.visitCount || 0}
      </td>
      <td className="p-4 align-top">
        <div className="text-sm text-gray-600 flex items-center gap-1.5">
          <Calendar size={14} className="text-gray-400" />
          {customer.lastVisited ? new Date(customer.lastVisited).toLocaleDateString('vi-VN') : '---'}
        </div>
      </td>
      <td className="p-4 text-right align-top">
        <button 
          onClick={() => onViewDetail(customer)}
          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
          title="Xem chi tiết"
        >
          <MoreHorizontal size={18} />
        </button>
      </td>
    </tr>
  );
};

// ─── Customer Detail Modal ───────────────────────────────────────────────────

const CustomerDetailModal = ({ customer, formatVND, onClose }: { 
  customer: Customer; 
  formatVND: (n?: number) => string;
  onClose: () => void; 
}) => {
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        style={{ animation: `fadeInScale ${MODAL_ANIMATION_MS}ms ease-out` }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="text-lg font-bold text-gray-900">Chi tiết Khách Hàng</h2>
          <button 
            onClick={onClose} 
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
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
            <div className="min-w-0">
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
                {customer.gender && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-600 border border-purple-100">
                    {customer.gender === 'male' ? '👨 Nam' : customer.gender === 'female' ? '👩 Nữ' : customer.gender}
                  </span>
                )}
                {customer.preferredLang && customer.preferredLang !== 'N/A' && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-600 border border-sky-100">
                    {customer.preferredLang}
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-1">
                <Phone size={12} /> {customer.phone}
              </div>
              {customer.email && (
                <div className="text-sm text-indigo-500 mt-0.5">@ {customer.email}</div>
              )}
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
                  <div className="text-[10px] text-gray-500 font-medium">Dịch vụ thường dùng (≥2 lần)</div>
                  <div className="text-sm font-semibold text-gray-900 line-clamp-3" title={customer.frequentServices || 'N/A'}>
                    {customer.frequentServices || 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 font-medium">KTV quen (≥2 lần)</div>
                  <div className="text-sm font-semibold text-gray-900 line-clamp-3" title={customer.frequentKtvs || 'N/A'}>
                    {customer.frequentKtvs || 'N/A'}
                  </div>
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

          {/* Notes */}
          {customer.notes && (
            <div className="bg-amber-50/70 border border-amber-100 rounded-xl p-4">
              <div className="text-[10px] text-amber-600 uppercase tracking-wider font-bold mb-1.5">📝 Ghi chú</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap">{customer.notes}</div>
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
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-3 flex justify-end rounded-b-2xl">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors"
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
