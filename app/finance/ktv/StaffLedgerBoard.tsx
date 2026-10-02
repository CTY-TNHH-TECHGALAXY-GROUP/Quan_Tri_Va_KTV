'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Search, FileSpreadsheet, RefreshCw, 
  Loader2, Filter, Calendar, User, DollarSign, Eye, 
  Sparkles, CheckCircle2, ChevronRight, Layers, HelpCircle
} from 'lucide-react';
import { formatVnd } from '@/lib/format.logic';
import { apiClient } from '@/lib/apiClient';

interface LedgerItem {
  id: string;
  sourceId: string;
  staffId: string;
  staffName: string;
  workType?: string;
  type: 'COMMISSION' | 'TIP' | 'GIFT' | 'ADJUSTMENT' | 'WITHDRAWAL' | 'TAX';
  direction: 'IN' | 'OUT';
  title: string;
  amount: number;
  note?: string;
  billCode?: string;
  serviceName?: string;
  createdAt: string;
  workDate?: string;
  status: string;
}

interface LedgerSummary {
  totalIn: number;
  totalOut: number;
  netTotal: number;
  countIn: number;
  countOut: number;
  totalCount: number;
}

interface StaffLedgerBoardProps {
  onOpenStaffAudit?: (staffId: string, staffName: string, workType?: string) => void;
  staffList?: Array<{ id: string; name: string }>;
}

export function StaffLedgerBoard({ onOpenStaffAudit, staffList = [] }: StaffLedgerBoardProps) {
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [summary, setSummary] = useState<LedgerSummary>({
    totalIn: 0,
    totalOut: 0,
    netTotal: 0,
    countIn: 0,
    countOut: 0,
    totalCount: 0,
  });
  const [isLoading, setIsLoading] = useState(false);

  // Filters
  const [direction, setDirection] = useState<'IN' | 'OUT' | 'ALL'>('IN'); // Mặc định chỉ xem tiền cộng vào (+)
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('ALL');
  const [dateFilterMode, setDateFilterMode] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM'>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Date range calculation
  const calculatedDateRange = useMemo(() => {
    const now = new Date();
    const toDateStr = (d: Date) => d.toISOString().split('T')[0];

    if (dateFilterMode === 'TODAY') {
      const today = toDateStr(now);
      return { from: today, to: today };
    }
    if (dateFilterMode === 'WEEK') {
      const startOfWeek = new Date(now);
      const day = startOfWeek.getDay();
      const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Monday
      startOfWeek.setDate(diff);
      return { from: toDateStr(startOfWeek), to: toDateStr(now) };
    }
    if (dateFilterMode === 'MONTH') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toDateStr(startOfMonth), to: toDateStr(now) };
    }
    if (dateFilterMode === 'CUSTOM') {
      return { from: fromDate, to: toDate };
    }
    return { from: '', to: '' };
  }, [dateFilterMode, fromDate, toDate]);

  // Fetch data
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (direction !== 'ALL') params.set('direction', direction);
      if (selectedStaffId && selectedStaffId !== 'ALL') params.set('staffId', selectedStaffId);
      if (typeFilter && typeFilter !== 'ALL') params.set('type', typeFilter);
      if (calculatedDateRange.from) params.set('fromDate', calculatedDateRange.from);
      if (calculatedDateRange.to) params.set('toDate', calculatedDateRange.to);
      if (debouncedSearch) params.set('search', debouncedSearch);
      params.set('limit', '500');

      const res = await apiClient.get<any>(`/api/finance/staff-ledger?${params.toString()}`);
      if (res?.data) {
        setItems(res.data.items || []);
        if (res.data.summary) {
          setSummary(res.data.summary);
        }
      }
    } catch (err: any) {
      console.error('[StaffLedgerBoard] Error fetching:', err);
    } finally {
      setIsLoading(false);
    }
  }, [direction, selectedStaffId, typeFilter, calculatedDateRange, debouncedSearch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Export CSV
  const handleExportCSV = () => {
    if (items.length === 0) return;
    const BOM = '\uFEFF';
    let csv = `${BOM}THỜI GIAN,NGÀY LÀM VIỆC,MÃ KTV,TÊN KTV,LOẠI HỢP ĐỒNG,KHOẢN MỤC,HƯỚNG TIỀN,MÃ ĐƠN,DIỄN GIẢI,SỐ TIỀN,TRẠNG THÁI\n`;
    
    items.forEach(row => {
      const dt = row.createdAt ? new Date(row.createdAt).toLocaleString('vi-VN') : '';
      const workDate = row.workDate || '';
      const sId = row.staffId || '';
      const sName = (row.staffName || '').replace(/"/g, '""');
      const wType = row.workType || '';
      const title = (row.title || '').replace(/"/g, '""');
      const dirText = row.direction === 'IN' ? 'Tiền cộng (+)' : 'Tiền trừ (-)';
      const bill = row.billCode || '';
      const note = (row.note || '').replace(/"/g, '""');
      const amt = row.amount || 0;
      const status = row.status || '';
      
      csv += `"${dt}","${workDate}","${sId}","${sName}","${wType}","${title}","${dirText}","${bill}","${note}",${amt},"${status}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `So_Doi_Soat_Tien_KTV_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getTypeBadge = (type: string, direction: 'IN' | 'OUT') => {
    switch (type) {
      case 'COMMISSION':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">Tiền tua</span>;
      case 'TIP':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">★ Tip khách</span>;
      case 'GIFT':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Thưởng quản lý</span>;
      case 'ADJUSTMENT':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">Điều chỉnh / Phạt</span>;
      case 'WITHDRAWAL':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Rút tiền mặt</span>;
      case 'TAX':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Thuế TNCN</span>;
      default:
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-gray-100 text-gray-700">{type}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. KPI SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Card 1: Tất cả dòng (Phát sinh ròng) */}
        <div 
          onClick={() => setDirection('ALL')}
          className={`cursor-pointer p-5 rounded-2xl border transition-all ${
            direction === 'ALL'
              ? 'bg-gradient-to-br from-indigo-500/10 to-blue-500/5 border-indigo-500 shadow-md ring-2 ring-indigo-500/20'
              : 'bg-white border-slate-200/80 hover:border-indigo-300 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
              <Layers size={16} className="text-indigo-600 stroke-[2.5]" />
              Tất Cả Dòng (Phát Sinh Ròng)
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-800">
              {summary.totalCount} tổng dòng
            </span>
          </div>
          <div className="mt-3">
            <h4 className={`text-2xl font-black tracking-tight ${summary.netTotal >= 0 ? 'text-indigo-700' : 'text-rose-600'}`}>
              {summary.netTotal >= 0 ? '+' : ''}{formatVnd(summary.netTotal)}
            </h4>
            <p className="text-[11px] text-slate-500 mt-1">
              Chênh lệch giữa tổng thu nhập và các khoản trừ trong kỳ
            </p>
          </div>
        </div>

        {/* Card 2: Tổng tiền cộng vào */}
        <div 
          onClick={() => setDirection('IN')}
          className={`cursor-pointer p-5 rounded-2xl border transition-all ${
            direction === 'IN'
              ? 'bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border-emerald-500 shadow-md ring-2 ring-emerald-500/20'
              : 'bg-white border-slate-200/80 hover:border-emerald-300 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-700">
              Tổng Tiền Cộng Vào (+)
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">
              {summary.countIn} giao dịch
            </span>
          </div>
          <div className="mt-3">
            <h4 className="text-2xl font-black text-emerald-600 tracking-tight">
              +{formatVnd(summary.totalIn)}
            </h4>
            <p className="text-[11px] text-slate-500 mt-1">
              Bao gồm Tiền tua, Thưởng 4★, Tip khách, Thưởng quản lý
            </p>
          </div>
        </div>

        {/* Card 3: Tổng tiền trừ ra */}
        <div 
          onClick={() => setDirection('OUT')}
          className={`cursor-pointer p-5 rounded-2xl border transition-all ${
            direction === 'OUT'
              ? 'bg-gradient-to-br from-rose-500/10 to-orange-500/5 border-rose-500 shadow-md ring-2 ring-rose-500/20'
              : 'bg-white border-slate-200/80 hover:border-rose-300 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-rose-700">
              Tổng Tiền Trừ Ra (-)
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800">
              {summary.countOut} giao dịch
            </span>
          </div>
          <div className="mt-3">
            <h4 className="text-2xl font-black text-rose-600 tracking-tight">
              -{formatVnd(summary.totalOut)}
            </h4>
            <p className="text-[11px] text-slate-500 mt-1">
              Bao gồm Rút tiền mặt, Thuế TNCN, Tiền phạt / Giặt đồ
            </p>
          </div>
        </div>
      </div>

      {/* 2. FILTER & TOOLBAR */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        {/* Row 1: Direction Switcher & Search & Actions */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Direction Pill Switcher */}
          <div className="inline-flex bg-slate-100 p-1 rounded-xl text-xs font-bold self-start md:self-auto">
            <button
              onClick={() => setDirection('ALL')}
              className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
                direction === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers size={14} />
              Tất cả dòng ({summary.totalCount})
            </button>
            <button
              onClick={() => setDirection('IN')}
              className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
                direction === 'IN'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🟢 Tiền cộng vào (+)
            </button>
            <button
              onClick={() => setDirection('OUT')}
              className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
                direction === 'OUT'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🔴 Tiền trừ ra (-)
            </button>
          </div>

          {/* Search Box & Refresh & Export CSV */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 sm:w-64">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm mã KTV, tên, đơn, ghi chú..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <button
              onClick={handleExportCSV}
              disabled={items.length === 0}
              className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
              title="Xuất bảng đối soát ra file Excel/CSV"
            >
              <FileSpreadsheet size={15} />
              <span>Xuất CSV</span>
            </button>

            <button
              onClick={fetchData}
              disabled={isLoading}
              className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
              title="Tải lại dữ liệu"
            >
              <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Row 2: Secondary Dropdowns (Staff, Category, Date range) */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          {/* Staff Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider">KTV:</span>
            <select
              value={selectedStaffId}
              onChange={e => setSelectedStaffId(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 max-w-[170px] truncate"
            >
              <option value="ALL">Tất cả KTV</option>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>
                  {s.id} - {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider">Khoản mục:</span>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="ALL">Tất cả khoản mục</option>
              <option value="COMMISSION">Tiền tua</option>
              <option value="TIP">Tiền Tip khách</option>
              <option value="GIFT">Thưởng quản lý</option>
              <option value="ADJUSTMENT">Phạt / Khấu trừ</option>
              <option value="WITHDRAWAL">Rút tiền mặt</option>
              <option value="TAX">Thuế TNCN</option>
            </select>
          </div>

          {/* Date Range Mode */}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider">Kỳ:</span>
            <div className="inline-flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
              {(['ALL', 'TODAY', 'WEEK', 'MONTH', 'CUSTOM'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setDateFilterMode(mode)}
                  className={`px-2 py-1 rounded-md text-[11px] transition-all ${
                    dateFilterMode === mode
                      ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {mode === 'ALL' && 'Tất cả'}
                  {mode === 'TODAY' && 'Hôm nay'}
                  {mode === 'WEEK' && 'Tuần này'}
                  {mode === 'MONTH' && 'Tháng này'}
                  {mode === 'CUSTOM' && 'Tùy chọn'}
                </button>
              ))}
            </div>

            {dateFilterMode === 'CUSTOM' && (
              <div className="flex items-center gap-1.5 pl-2 animate-in fade-in">
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 font-medium"
                />
                <span className="text-slate-400">-</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 font-medium"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. DATA TABLE / LIST */}
      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
        {/* Table header count */}
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between text-xs bg-slate-50/50">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">Danh Sách Nhật Ký Đối Soát</span>
            <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-black text-[11px]">
              {items.length} bản ghi
            </span>
          </div>
          {direction === 'IN' && (
            <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full">
              🟢 Đang lọc: Chỉ hiển thị các khoản tiền cộng vào (+)
            </span>
          )}
        </div>

        {/* Loading state */}
        {isLoading ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400">
            <Loader2 size={32} className="animate-spin text-indigo-500 mb-3" />
            <p className="text-xs font-medium">Đang truy vấn sổ đối soát tiền KTV...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center text-slate-400 space-y-2">
            <HelpCircle size={40} className="mx-auto text-slate-300 stroke-[1.5]" />
            <p className="text-sm font-bold text-slate-600">Không tìm thấy giao dịch nào khớp với bộ lọc</p>
            <p className="text-xs text-slate-400">Hãy thử đổi khoảng thời gian hoặc chọn "Tất cả dòng"</p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase font-black text-[10px] tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3.5">Thời gian / Ngày</th>
                    <th className="px-4 py-3.5">Nhân viên</th>
                    <th className="px-4 py-3.5">Khoản mục</th>
                    <th className="px-4 py-3.5">Mã đơn / Căn cứ</th>
                    <th className="px-4 py-3.5">Diễn giải</th>
                    <th className="px-4 py-3.5 text-right">Số tiền</th>
                    <th className="px-4 py-3.5 text-center">Đối soát ví</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {items.map(item => {
                    const isPositive = item.amount > 0;
                    const dt = item.createdAt ? new Date(item.createdAt) : null;
                    const timeStr = dt && !isNaN(dt.getTime()) ? dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
                    const dateStr = dt && !isNaN(dt.getTime()) ? dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

                    return (
                      <tr 
                        key={item.id} 
                        className={`hover:bg-indigo-50/30 transition-colors ${
                          isPositive ? 'hover:bg-emerald-50/20' : 'hover:bg-rose-50/20'
                        }`}
                      >
                        {/* 1. Thời gian */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="font-bold text-slate-800 text-xs">{timeStr}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{dateStr}</div>
                          {item.workDate && item.workDate !== dateStr && (
                            <span className="inline-block mt-0.5 text-[9px] font-bold text-slate-400 bg-slate-100 px-1 py-0.2 rounded">
                              Lv: {item.workDate}
                            </span>
                          )}
                        </td>

                        {/* 2. Nhân viên */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-800 text-xs">{item.staffName}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.2 rounded">
                              {item.staffId}
                            </span>
                            {item.workType && (
                              <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-1 py-0.2 rounded uppercase">
                                {item.workType}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 3. Khoản mục */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {getTypeBadge(item.type, item.direction)}
                        </td>

                        {/* 4. Mã đơn / Căn cứ */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {item.billCode ? (
                            <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                              #{item.billCode}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">-</span>
                          )}
                        </td>

                        {/* 5. Diễn giải */}
                        <td className="px-4 py-3.5 max-w-xs">
                          <p className="font-bold text-slate-800 text-xs truncate" title={item.title}>
                            {item.title}
                          </p>
                          {item.note && (
                            <p className="text-[11px] text-slate-500 truncate mt-0.5" title={item.note}>
                              {item.note}
                            </p>
                          )}
                        </td>

                        {/* 6. Số tiền */}
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <span
                            className={`text-sm font-black tracking-tight ${
                              isPositive ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            {isPositive ? '+' : ''}{formatVnd(item.amount)}
                          </span>
                        </td>

                        {/* 7. Action: Mở ví KTV */}
                        <td className="px-4 py-3.5 text-center whitespace-nowrap">
                          {onOpenStaffAudit && (
                            <button
                              onClick={() => onOpenStaffAudit(item.staffId, item.staffName, item.workType)}
                              className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 transition-colors inline-flex items-center gap-1 text-[11px] font-bold active:scale-95"
                              title={`Xem toàn bộ lịch sử ví của ${item.staffName}`}
                            >
                              <Eye size={13} />
                              <span>Ví</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View */}
            <div className="block md:hidden divide-y divide-slate-100 p-3 space-y-3">
              {items.map(item => {
                const isPositive = item.amount > 0;
                const dt = item.createdAt ? new Date(item.createdAt) : null;
                const timeStr = dt && !isNaN(dt.getTime()) ? dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
                const dateStr = dt && !isNaN(dt.getTime()) ? dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

                return (
                  <div key={item.id} className="p-3.5 bg-slate-50/60 rounded-xl border border-slate-100 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-slate-800 text-xs">{item.staffName}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.2 rounded">
                            {item.staffId}
                          </span>
                          {getTypeBadge(item.type, item.direction)}
                        </div>
                      </div>

                      <div className="text-right">
                        <span
                          className={`text-sm font-black tracking-tight ${
                            isPositive ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {isPositive ? '+' : ''}{formatVnd(item.amount)}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-0.5">{timeStr} · {dateStr}</div>
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 bg-white p-2 rounded-lg border border-slate-100">
                      <div className="font-bold text-slate-700">{item.title}</div>
                      {item.note && <div className="text-[11px] text-slate-500 mt-0.5">{item.note}</div>}
                      {item.billCode && (
                        <div className="text-[10px] font-mono text-indigo-600 mt-1 font-bold">
                          Đơn: #{item.billCode}
                        </div>
                      )}
                    </div>

                    {onOpenStaffAudit && (
                      <div className="flex justify-end pt-1">
                        <button
                          onClick={() => onOpenStaffAudit(item.staffId, item.staffName, item.workType)}
                          className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[11px] font-bold flex items-center gap-1"
                        >
                          <Eye size={12} />
                          <span>Xem sổ ví {item.staffId}</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
