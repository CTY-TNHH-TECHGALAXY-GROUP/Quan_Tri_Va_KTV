'use client';

import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import { ShieldAlert, Search, Filter, Plus, User, Phone, Calendar, Star, MoreHorizontal, Edit2, Check, X, Tag, Building2, MapPin, Mail, FileText, Receipt, Download } from 'lucide-react';

import { Customer } from '@/lib/types';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { CustomerDetailModal } from './_components/CustomerDetailModal';

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
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(30);


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

  // Pagination Logic
  const totalItems = filteredCustomers.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  
  // Tự động điều chỉnh trang nếu vượt quá giới hạn (không dùng useEffect để tránh lỗi Hook rules)
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const startIndex = (safeCurrentPage - 1) * itemsPerPage;
  const paginatedCustomers = filteredCustomers.slice(startIndex, startIndex + itemsPerPage);

  const formatVND = (n?: number) => n ? new Intl.NumberFormat('vi-VN').format(n) + 'đ' : '0đ';
  
  // Get unique nationalities dynamically for filters
  const uniqueNationalities = Array.from(new Set(customers.map(c => c.nationality).filter(Boolean))) as string[];

  return (
    <AppLayout title="Khách Hàng">
      <div className="space-y-4">
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

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col" style={{ maxHeight: 'calc(100vh - 150px)' }}>
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

          <div className="flex-1 overflow-auto bg-white relative">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-20 shadow-sm">
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
                ) : paginatedCustomers.map(customer => (
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
          
          {/* Pagination Controls */}
          {totalPages > 0 && (
            <div className="shrink-0 flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50/50 rounded-b-xl gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Hiển thị</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="border border-gray-200 rounded-md px-2 py-1 text-sm bg-white font-medium text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                >
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span className="text-sm text-gray-600">trên tổng <span className="font-semibold text-gray-900">{totalItems}</span> khách hàng</span>
              </div>
              
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={safeCurrentPage === 1}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
                >
                  Trước
                </button>
                <div className="px-3 py-1.5 text-sm font-semibold text-indigo-700 bg-indigo-50 rounded-lg">
                  {safeCurrentPage} <span className="text-indigo-400 mx-1">/</span> {totalPages}
                </div>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={safeCurrentPage === totalPages}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
                >
                  Sau
                </button>
              </div>
            </div>
          )}
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

// ─── Customer Detail Modal moved to _components/CustomerDetailModal.tsx ────
