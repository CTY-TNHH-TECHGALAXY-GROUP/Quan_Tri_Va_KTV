'use client';

import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import { ShieldAlert, Search, Filter, Plus, User, Phone, Calendar, Star, MoreHorizontal, Edit2, Check, X, Tag, Building2, MapPin, Mail, FileText, Receipt, Download } from 'lucide-react';

import { Customer } from '@/lib/types';
import { DropdownMenu } from '@/components/ui/DropdownMenu';

// 🔧 UI CONFIGURATION
const MODAL_ANIMATION_MS = 200;
const BADGE_COLORS = {
  vat: 'bg-amber-100 text-amber-700 border-amber-200',
  vip: 'bg-amber-100 text-amber-700',
  member: 'bg-blue-100 text-blue-700',
};

const POPULAR_COUNTRIES = [
  'Việt Nam',
  'Hàn Quốc',
  'Trung Quốc',
  'Nhật Bản',
  'Đài Loan',
  'Mỹ',
  'Anh',
  'Úc',
  'Singapore',
  'Thái Lan',
  'Malaysia',
  'Nga',
  'Pháp',
  'Đức',
  'Canada'
];

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

  // Filter state
  const [showFilter, setShowFilter] = useState(false);
  const [filterVip, setFilterVip] = useState('all'); // 'all', 'vip', 'member'
  const [filterVipMenu, setFilterVipMenu] = useState('all'); // 'all', 'used'
  const [filterVisit, setFilterVisit] = useState('all'); // 'all', 'new', 'old'
  const [filterGuestType, setFilterGuestType] = useState('all'); // 'all', 'group', 'single'
  const [filterNationality, setFilterNationality] = useState('all'); // 'all', dynamic values


  const handleExport = async (format: 'csv' | 'xlsx') => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      params.set('format', format);
      if (exportFrom) params.set('from', exportFrom);
      if (exportTo) params.set('to', exportTo);
      const res = await fetch(`/api/customers/export?${params.toString()}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFrom && exportTo ? `CRM_${exportFrom}_to_${exportTo}.${format}` : `CRM_full_${new Date().toISOString().slice(0,10)}.${format}`;
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

  const handlePrintReport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      params.set('format', 'json');
      if (exportFrom) params.set('from', exportFrom);
      if (exportTo) params.set('to', exportTo);
      
      const res = await fetch(`/api/customers/export?${params.toString()}`);
      const data = await res.json();
      if (!data.success) throw new Error('Failed to fetch data');

      const { header, rows } = data.data;

      // Build HTML for print window
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Báo Cáo Thống Kê</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
            h1 { text-align: center; margin-bottom: 5px; }
            .subtitle { text-align: center; color: #666; margin-bottom: 20px; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #ddd; padding: 8px 4px; text-align: left; }
            th { background-color: #f4f6f8; font-weight: bold; }
            @media print {
              @page { margin: 1cm; size: landscape; }
              body { -webkit-print-color-adjust: exact; padding: 0; }
            }
          </style>
        </head>
        <body>
          <h1>Báo Cáo Thống Kê Khách Hàng</h1>
          <div class="subtitle">Khoảng thời gian: ${exportFrom && exportTo ? exportFrom + ' đến ' + exportTo : 'Toàn bộ lịch sử'}</div>
          <table>
            <thead>
              <tr>${header.map((h: string) => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows.map((r: string[]) => `<tr>${r.map(c => `<td>${c || ''}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
          <script>
            window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 500); }
          </script>
        </body>
        </html>
      `;

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      } else {
        alert('Vui lòng cho phép popup trên trình duyệt để mở cửa sổ in báo cáo.');
      }
      setShowExport(false);
    } catch (err) {
      alert('Lỗi khi chuẩn bị báo cáo in: ' + (err as Error).message);
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

  const filteredCustomers = customers.filter(c => {
    // 1. Search filter
    const matchesSearch = 
      (c.fullName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
      (c.phone || '').includes(searchTerm) ||
      (c.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.taxCode || '').includes(searchTerm) ||
      (c.companyName || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchesSearch) return false;

    // 2. VIP Filter
    const isVip = (c.visitCount || 0) > 10;
    if (filterVip === 'vip' && !isVip) return false;
    if (filterVip === 'member' && isVip) return false;

    // 3. VIP Menu Filter
    if (filterVipMenu === 'used' && (c.vipMenuCount || 0) === 0) return false;

    // 4. Visit count Filter
    const visits = c.visitCount || 0;
    if (filterVisit === 'new' && visits > 1) return false;
    if (filterVisit === 'old' && visits <= 1) return false;

    // 5. Guest Type Filter
    if (filterGuestType === 'group' && c.guestType !== 'Khách nhóm') return false;
    if (filterGuestType === 'single' && c.guestType !== 'Khách lẻ') return false;

    // 6. Nationality Filter
    if (filterNationality !== 'all' && c.nationality !== filterNationality) return false;

    return true;
  });

  const formatVND = (n?: number) => n ? new Intl.NumberFormat('vi-VN').format(n) + 'đ' : '0đ';
  
  // Get unique nationalities dynamically for filters
  const uniqueNationalities = Array.from(new Set(customers.map(c => c.nationality).filter(Boolean))) as string[];

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
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleExport('csv')} 
                      disabled={isExporting}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-xs transition-colors disabled:opacity-50"
                    >
                      <Download size={12} />
                      {isExporting ? '...' : 'CSV'}
                    </button>
                    <button 
                      onClick={() => handleExport('xlsx')} 
                      disabled={isExporting}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-xs transition-colors disabled:opacity-50"
                    >
                      <Download size={12} />
                      {isExporting ? '...' : 'Excel'}
                    </button>
                  </div>
                    <button 
                      onClick={handlePrintReport}
                      disabled={isExporting}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-xs transition-colors mt-2 disabled:opacity-50"
                    >
                      {isExporting ? 'Đang chuẩn bị dữ liệu...' : 'In PDF (Print Báo Cáo)'}
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

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="p-4 border-b border-gray-100 flex flex-col xl:flex-row gap-3 items-stretch xl:items-center bg-gray-50/50 rounded-t-2xl">
            {/* Search Input */}
            <div className="relative w-full xl:w-96 shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input 
                type="text" 
                placeholder="Tìm theo tên, SĐT, Email, MST, công ty..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-xs"
              />
            </div>

            {/* Inline Filters */}
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
              {/* Member type filter */}
              <DropdownMenu 
                button={{ label: filterVip === 'vip' ? 'Hạng: VIP' : filterVip === 'member' ? 'Hạng: Thường' : 'Hạng: Tất cả', size: 'sm' }}
                items={[
                  { label: 'Hạng: Tất cả', onClick: () => setFilterVip('all') },
                  { label: 'Hạng: VIP', onClick: () => setFilterVip('vip') },
                  { label: 'Hạng: Thường', onClick: () => setFilterVip('member') }
                ]}
              />

              {/* Visit frequency filter */}
              <DropdownMenu 
                button={{ label: filterVisit === 'new' ? 'Phân loại: Khách mới' : filterVisit === 'old' ? 'Phân loại: Khách cũ' : 'Phân loại: Tất cả', size: 'sm' }}
                items={[
                  { label: 'Phân loại: Tất cả', onClick: () => setFilterVisit('all') },
                  { label: 'Phân loại: Khách mới', onClick: () => setFilterVisit('new') },
                  { label: 'Phân loại: Khách cũ', onClick: () => setFilterVisit('old') }
                ]}
              />

              {/* VIP Menu filter */}
              <DropdownMenu 
                button={{ label: filterVipMenu === 'used' ? 'VIP Menu: Đã dùng' : 'VIP Menu: Tất cả', size: 'sm' }}
                items={[
                  { label: 'VIP Menu: Tất cả', onClick: () => setFilterVipMenu('all') },
                  { label: 'VIP Menu: Đã dùng', onClick: () => setFilterVipMenu('used') }
                ]}
              />

              {/* Group / Single Guest Filter */}
              <DropdownMenu 
                button={{ label: filterGuestType === 'group' ? 'Đoàn/Lẻ: Đi nhóm' : filterGuestType === 'single' ? 'Đoàn/Lẻ: Đi lẻ' : 'Đoàn/Lẻ: Tất cả', size: 'sm' }}
                items={[
                  { label: 'Đoàn/Lẻ: Tất cả', onClick: () => setFilterGuestType('all') },
                  { label: 'Đoàn/Lẻ: Đi nhóm', onClick: () => setFilterGuestType('group') },
                  { label: 'Đoàn/Lẻ: Đi lẻ', onClick: () => setFilterGuestType('single') }
                ]}
              />

              {/* Nationality filter */}
              <DropdownMenu 
                button={{ label: filterNationality === 'all' ? 'Quốc tịch: Tất cả' : `Quốc tịch: ${filterNationality}`, size: 'sm' }}
                items={[
                  { label: 'Quốc tịch: Tất cả', onClick: () => setFilterNationality('all') },
                  ...uniqueNationalities.map(nat => ({ label: nat, onClick: () => setFilterNationality(nat) }))
                ]}
              />

              {/* Reset button (Only show if active) */}
              {(filterVip !== 'all' || filterVisit !== 'all' || filterVipMenu !== 'all' || filterGuestType !== 'all' || filterNationality !== 'all') && (
                <button 
                  onClick={() => { setFilterVip('all'); setFilterVipMenu('all'); setFilterVisit('all'); setFilterGuestType('all'); setFilterNationality('all'); }} 
                  className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-semibold transition-colors border border-red-200"
                >
                  Xóa lọc
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-b-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm">Khách Hàng</th>
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
                    <td colSpan={7} className="p-8 text-center text-gray-500">
                      Đang tải danh sách khách hàng...
                    </td>
                  </tr>
                ) : filteredCustomers.map(customer => (
                  <CustomerRow 
                    key={customer.id} 
                    customer={customer} 
                    formatVND={formatVND} 
                    onViewDetail={setSelectedCustomer} 
                    onUpdate={(updated) => {
                      setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
                    }}
                  />
                ))}
                {!isLoading && filteredCustomers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-500">
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
          onUpdate={(updated) => {
            setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c));
            setSelectedCustomer(updated);
          }}
        />
      )}
      <datalist id="crm-countries">
        <option value="Việt Nam" />
        <option value="Hàn Quốc" />
        <option value="Trung Quốc" />
        <option value="Nhật Bản" />
        <option value="Đài Loan" />
        <option value="Mỹ" />
        <option value="Anh" />
        <option value="Úc" />
        <option value="Singapore" />
        <option value="Thái Lan" />
        <option value="Malaysia" />
        <option value="Nga" />
        <option value="Pháp" />
        <option value="Đức" />
        <option value="Canada" />
      </datalist>
    </AppLayout>
  );
}

// ─── Customer Row ────────────────────────────────────────────────────────────

const CustomerRow = ({ customer, formatVND, onViewDetail, onUpdate }: { 
  customer: Customer; 
  formatVND: (n?: number) => string;
  onViewDetail: (c: Customer) => void;
  onUpdate: (updated: Customer) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState(customer.notes || '');
  const [gender, setGender] = useState(customer.gender || '');
  const [nationality, setNationality] = useState(customer.nationality || '');
  const [preferredLang, setPreferredLang] = useState(customer.preferredLangCode || 'vi');
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
        onUpdate({
          ...customer,
          notes,
          gender,
          nationality,
          preferredLangCode: preferredLang,
          preferredLang: preferredLang === 'en' ? '🇬🇧 English' : preferredLang === 'vi' ? '🇻🇳 Tiếng Việt' : preferredLang === 'jp' ? '🇯🇵 日本語' : preferredLang === 'cn' ? '🇨🇳 中文' : preferredLang === 'kr' ? '🇰🇷 한국어' : preferredLang,
          preferredGender: gender === 'male' ? 'Nam' : gender === 'female' ? 'Nữ' : gender
        });
      } else {
        alert('Lỗi lưu thông tin: ' + data.error);
      }
    } catch (e) {
      alert('Lỗi mạng');
    } finally {
      setIsSaving(false);
    }
  };

  const isVipCustomer = (customer.visitCount || 0) > 10;
  const usedVipMenu = (customer.vipMenuCount || 0) > 0;
  const isHighlighted = isVipCustomer || usedVipMenu;

  return (
    <tr className={`transition-colors ${isHighlighted ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-gray-50'}`}>
      <td className="p-4 align-top">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
            {(customer.fullName || '?').charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`font-medium ${isHighlighted ? 'text-amber-900' : 'text-gray-900'}`}>
                {customer.fullName}
                {isVipCustomer && <span className="ml-1.5 inline-flex" title="Khách VIP">👑</span>}
              </span>
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
            <div className="flex flex-col gap-2 mt-2 bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100">
              <div className="grid grid-cols-3 gap-2">
                {/* Giới tính */}
                <div>
                  <label className="text-[9px] text-gray-500 font-bold block mb-0.5">Giới tính</label>
                  <select 
                    value={gender} 
                    onChange={(e) => setGender(e.target.value)} 
                    className="w-full text-[11px] px-1.5 py-1 border border-gray-300 rounded bg-white outline-none font-medium text-gray-700"
                  >
                    <option value="">Chưa chọn</option>
                    <option value="male">Nam</option>
                    <option value="female">Nữ</option>
                  </select>
                </div>

                {/* Quốc tịch */}
                <div>
                  <label className="text-[9px] text-gray-500 font-bold block mb-0.5">Quốc tịch</label>
                  <input 
                    type="text" 
                    list="crm-countries"
                    value={nationality} 
                    onChange={(e) => setNationality(e.target.value)} 
                    placeholder="Nhập tay..."
                    className="w-full text-[11px] px-1.5 py-1 border border-gray-300 rounded bg-white outline-none font-semibold text-gray-700"
                  />
                </div>

                {/* Ngôn ngữ */}
                <div>
                  <label className="text-[9px] text-gray-500 font-bold block mb-0.5">Ngôn ngữ</label>
                  <select 
                    value={preferredLang} 
                    onChange={(e) => setPreferredLang(e.target.value)} 
                    className="w-full text-[11px] px-1.5 py-1 border border-gray-300 rounded bg-white outline-none font-medium text-gray-700"
                  >
                    <option value="vi">VN Tiếng Việt</option>
                    <option value="en">EN English</option>
                    <option value="cn">CN 中文</option>
                    <option value="kr">KR 한국어</option>
                    <option value="jp">JP 日本語</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[9px] text-gray-500 font-bold block mb-0.5">Ghi chú sở thích, đặc điểm</label>
                <textarea 
                  className="w-full text-[11px] p-2 border border-gray-300 rounded outline-none focus:ring-1 focus:ring-indigo-500 min-h-[45px] bg-white font-medium text-gray-700"
                  placeholder="Nhập ghi chú..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-1 justify-end">
                <button 
                  onClick={() => { 
                    setIsEditing(false); 
                    setNotes(customer.notes || ''); 
                    setGender(customer.gender || '');
                    setNationality(customer.nationality || '');
                    setPreferredLang(customer.preferredLangCode || 'vi');
                  }} 
                  disabled={isSaving} 
                  className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-[10px] font-medium hover:bg-gray-200"
                >
                  Hủy
                </button>
                <button 
                  onClick={handleSave} 
                  disabled={isSaving} 
                  className="px-2.5 py-1 bg-indigo-600 text-white rounded text-[10px] font-medium hover:bg-indigo-700 flex items-center gap-1"
                >
                  <Check size={12} /> {isSaving ? 'Lưu...' : 'Lưu'}
                </button>
              </div>
            </div>
          ) : (
            <div className="group relative mt-1 bg-amber-50/70 p-2 rounded-lg border border-amber-100 min-h-[40px]">
              <div className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-3">
                {notes || <span className="text-gray-400 italic">Chưa có ghi chú (sở thích, thói quen...)</span>}
              </div>
              <button 
                onClick={() => setIsEditing(true)} 
                className="absolute top-1 right-1 p-1 opacity-0 group-hover:opacity-100 bg-white shadow-sm border border-gray-200 rounded text-gray-500 hover:text-indigo-600 transition-opacity"
                title="Chỉnh sửa thông tin"
              >
                <Edit2 size={12} />
              </button>
            </div>
          )}
        </div>
      </td>
      <td className="p-4 align-top">
        <div className="flex flex-col sm:flex-row gap-1.5 items-start">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
            (customer.visitCount || 0) > 10 ? BADGE_COLORS.vip : BADGE_COLORS.member
          }`}>
            <Star size={12} />
            {(customer.visitCount || 0) > 10 ? 'VIP' : 'Member'}
          </span>
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
            (customer.visitCount || 0) > 1 ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-green-50 text-green-600 border border-green-100'
          }`}>
            {(customer.visitCount || 0) > 1 ? 'Khách cũ' : 'Khách mới'}
          </span>
        </div>
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

const CustomerDetailModal = ({ customer, formatVND, onClose, onUpdate }: { 
  customer: Customer; 
  formatVND: (n?: number) => string;
  onClose: () => void; 
  onUpdate: (updated: Customer) => void;
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
        onUpdate({
          ...customer,
          notes,
          gender,
          nationality,
          preferredLangCode: preferredLang,
          preferredLang: preferredLang === 'en' ? '🇬🇧 English' : preferredLang === 'vi' ? '🇻🇳 Tiếng Việt' : preferredLang === 'jp' ? '🇯🇵 日本語' : preferredLang === 'cn' ? '🇨🇳 中文' : preferredLang === 'kr' ? '🇰🇷 한국어' : preferredLang,
          preferredGender: gender === 'male' ? 'Nam' : gender === 'female' ? 'Nữ' : gender
        });
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
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
                    customer.gender ? 'bg-purple-50 text-purple-600 border border-purple-100' : 'bg-gray-50 text-gray-500 border border-gray-100'
                  }`}>
                    {customer.gender === 'male' ? 'Nam' : customer.gender === 'female' ? 'Nữ' : (customer.gender || 'Giới tính: Chưa chọn')}
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
                    Ngôn ngữ: {customer.preferredLang && customer.preferredLang !== 'N/A' ? customer.preferredLang : 'Chưa chọn'}
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
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  (customer.visitCount || 0) > 1 ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-green-50 text-green-600 border border-green-100'
                }`}>
                  {(customer.visitCount || 0) > 1 ? 'Khách cũ' : 'Khách mới'}
                </span>
              </div>
              <div className="text-sm text-gray-500 mt-1 flex items-center gap-1">
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
