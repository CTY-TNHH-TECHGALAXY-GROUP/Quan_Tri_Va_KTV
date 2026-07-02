'use client';

import React, { useState } from 'react';
import { Calendar, Users, Clock, AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Download, X, Coffee, Star, LogOut, Edit2 } from 'lucide-react';
import { motion } from 'motion/react';
import { format, addMonths, subMonths, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';
import { usePayrollLogic } from './Payroll.logic';
import { t } from './Payroll.i18n';

// 🔧 UI CONFIGURATION
const STATUS_COLORS = {
  present: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  late: 'bg-amber-50 text-amber-700 border-amber-100',
  off: 'bg-gray-50 text-gray-500 border-gray-100',
  suddenOff: 'bg-rose-50 text-rose-700 border-rose-100',
  absent: 'bg-slate-100 text-slate-400 border-slate-200',
  free: 'bg-sky-50 text-sky-700 border-sky-100',
  request: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
};

// --- MODAL COMPONENT ---
const PayrollEditModal = ({ isOpen, onClose, record, onSave }: any) => {
  const [newStatus, setNewStatus] = useState<string>('absent');
  const [isSaving, setIsSaving] = useState(false);

  // Cập nhật state khi record thay đổi
  React.useEffect(() => {
    if (record) {
      if (record.status === 'off') setNewStatus('off');
      else if (record.status === 'suddenOff') setNewStatus('suddenOff');
      else setNewStatus('absent'); // Default for all others to "Vắng" when editing
    }
  }, [record]);

  if (!isOpen || !record) return null;

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(record.employeeId, record.employeeName, record.date, newStatus);
    setIsSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-[24px] shadow-2xl p-6 w-full max-w-sm border border-slate-100"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-black text-slate-900">Chỉnh Sửa Điểm Danh</h3>
          <button onClick={onClose} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
            <X size={16} />
          </button>
        </div>
        
        <div className="space-y-4 mb-8">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Nhân sự</p>
            <p className="text-sm font-black text-slate-900">{record.employeeName}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px] font-black">{record.employeeId}</span>
              <span className="text-xs font-bold text-slate-500">{format(parseISO(record.date), 'dd/MM/yyyy')}</span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Chọn trạng thái mới</p>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => setNewStatus('absent')}
                className={`p-3 rounded-xl border text-left text-sm font-bold transition-all ${newStatus === 'absent' ? 'border-slate-400 bg-slate-100 text-slate-700' : 'border-slate-100 bg-white text-slate-400 hover:border-slate-300'}`}
              >
                Vắng mặt (Xoá điểm danh)
              </button>
              <button
                onClick={() => setNewStatus('off')}
                className={`p-3 rounded-xl border text-left text-sm font-bold transition-all ${newStatus === 'off' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-500/20' : 'border-slate-100 bg-white text-slate-400 hover:border-slate-300'}`}
              >
                Nghỉ phép (Có phép)
              </button>
              <button
                onClick={() => setNewStatus('suddenOff')}
                className={`p-3 rounded-xl border text-left text-sm font-bold transition-all ${newStatus === 'suddenOff' ? 'border-rose-500 bg-rose-50 text-rose-700 ring-2 ring-rose-500/20' : 'border-slate-100 bg-white text-slate-400 hover:border-slate-300'}`}
              >
                Nghỉ đột xuất (Không phép)
              </button>
              <button
                onClick={() => setNewStatus('free')}
                className={`p-3 rounded-xl border text-left text-sm font-bold transition-all ${newStatus === 'free' ? 'border-sky-500 bg-sky-50 text-sky-700 ring-2 ring-sky-500/20' : 'border-slate-100 bg-white text-slate-400 hover:border-slate-300'}`}
              >
                Có mặt (Làm tự do)
              </button>
              <button
                onClick={() => setNewStatus('request')}
                className={`p-3 rounded-xl border text-left text-sm font-bold transition-all ${newStatus === 'request' ? 'border-fuchsia-500 bg-fuchsia-50 text-fuchsia-700 ring-2 ring-fuchsia-500/20' : 'border-slate-100 bg-white text-slate-400 hover:border-slate-300'}`}
              >
                Có mặt (Làm yêu cầu)
              </button>
            </div>
          </div>
        </div>

        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50"
        >
          {isSaving ? 'Đang lưu...' : 'Lưu Thay Đổi'}
        </button>
      </motion.div>
    </div>
  );
};


export const Payroll = () => {
  const { 
    selectedMonth, 
    setSelectedMonth, 
    dateRange, 
    setDateRange, 
    selectedStaffId, 
    setSelectedStaffId, 
    staffList, 
    processedData,
    displayData,
    summary, 
    loading, 
    refresh,
    activeCardFilter,
    setActiveCardFilter,
    handleOverrideAttendance
  } = usePayrollLogic();
  const lang = 'vi'; // Default to Vietnamese for now

  const [editingRecord, setEditingRecord] = useState<any>(null);

  const nextMonth = () => setSelectedMonth(addMonths(selectedMonth, 1));
  const prevMonth = () => setSelectedMonth(subMonths(selectedMonth, 1));

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 md:p-8 space-y-8 pb-20">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-100">
              <Calendar className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">{t[lang].title}</h1>
              <p className="text-sm font-bold text-slate-400">{t[lang].subtitle}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="p-2 hover:bg-slate-50 rounded-xl transition-colors text-slate-400 hover:text-indigo-600">
              <ChevronLeft size={20} />
            </button>
            <div className="px-4 py-1 text-center min-w-[140px]">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t[lang].filters.month}</p>
              <p className="text-base font-black text-slate-900 capitalize">
                {format(selectedMonth, 'MMMM yyyy', { locale: vi })}
              </p>
            </div>
            <button onClick={nextMonth} className="p-2 hover:bg-slate-50 rounded-xl transition-colors text-slate-400 hover:text-indigo-600">
              <ChevronRight size={20} />
            </button>
          </div>
          
          <div className="w-px h-8 bg-slate-100 hidden md:block" />

          {/* Staff Filter */}
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-xl border border-slate-100">
            <Users size={14} className="text-slate-400" />
            <div className="flex flex-col">
              <span className="text-[9px] font-black text-slate-400 uppercase leading-none">Nhân viên</span>
              <select 
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                className="bg-transparent text-sm font-bold text-slate-900 focus:outline-none cursor-pointer w-[120px] truncate"
              >
                <option value="ALL">Tất cả nhân sự</option>
                {staffList.map(staff => (
                  <option key={staff.id} value={staff.id}>{staff.full_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="w-px h-8 bg-slate-100 hidden md:block" />

          {/* Date Range Picker */}
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-xl border border-slate-100">
            <Calendar size={14} className="text-slate-400" />
            <div className="flex items-center gap-2">
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-slate-400 uppercase leading-none">Từ ngày</span>
                <input 
                  type="date" 
                  value={dateRange?.start || ''}
                  onChange={(e) => setDateRange(prev => ({ start: e.target.value, end: prev?.end || e.target.value }))}
                  className="bg-transparent text-sm font-bold text-slate-900 focus:outline-none cursor-pointer w-28"
                />
              </div>
              <span className="text-slate-300">-</span>
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-slate-400 uppercase leading-none">Đến ngày</span>
                <input 
                  type="date" 
                  value={dateRange?.end || ''}
                  onChange={(e) => setDateRange(prev => ({ start: prev?.start || e.target.value, end: e.target.value }))}
                  className="bg-transparent text-sm font-bold text-slate-900 focus:outline-none cursor-pointer w-28"
                />
              </div>
            </div>
            {dateRange && (
              <button 
                onClick={() => setDateRange(null)}
                className="p-1 hover:bg-slate-200 rounded-md text-slate-400 hover:text-rose-500 transition-colors ml-1"
              >
                <X size={12} />
              </button>
            )}
          </div>
          
          <div className="w-px h-8 bg-slate-100 mx-1 hidden lg:block" />
          
          <button 
            onClick={refresh}
            className={`p-2.5 rounded-xl transition-all ${loading ? 'animate-spin text-indigo-400' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4 md:gap-6">
        {[
          { id: 'working', label: selectedStaffId === 'ALL' ? 'ĐIỂM DANH HÔM NAY' : t[lang].summary.totalDays, value: selectedStaffId === 'ALL' ? summary.totalWorkingStaff : summary.totalDays, icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { id: 'late', label: t[lang].summary.totalLate, value: summary.totalLate, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
          { id: 'suddenOff', label: t[lang].summary.totalSuddenOff, value: summary.totalSuddenOff, icon: AlertTriangle, color: 'text-rose-600', bg: 'bg-rose-50' },
          { id: 'off', label: t[lang].summary.totalLeave, value: summary.totalLeave, icon: Calendar, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { id: 'free', label: t[lang].summary.freeShifts, value: summary.freeShifts, icon: Coffee, color: 'text-sky-600', bg: 'bg-sky-50' },
          { id: 'request', label: t[lang].summary.requestShifts, value: summary.requestShifts, icon: Star, color: 'text-fuchsia-600', bg: 'bg-fuchsia-50' },
          { id: 'forgotCheckOut', label: t[lang].summary.forgotCheckOut, value: summary.forgotCheckOut, icon: LogOut, color: 'text-orange-600', bg: 'bg-orange-50' },
        ].map((item, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            onClick={() => setActiveCardFilter(prev => prev === item.id ? null : item.id)}
            className={`bg-white p-5 rounded-3xl border shadow-sm space-y-3 cursor-pointer transition-all hover:-translate-y-1 ${activeCardFilter === item.id ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-100 hover:border-indigo-200'}`}
          >
            <div className={`w-10 h-10 ${item.bg} ${item.color} rounded-xl flex items-center justify-center`}>
              <item.icon size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{item.label}</p>
              <p className="text-2xl font-black text-slate-900">{item.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Table Section */}
      <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900 tracking-tight">Chi Tiết Chấm Công</h2>
          <button className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all active:scale-95 shadow-lg shadow-slate-200">
            <Download size={14} /> Xuất Báo Cáo
          </button>
        </div>

        {selectedStaffId === 'ALL' && !activeCardFilter ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <Users className="text-slate-400" size={24} />
            </div>
            <p className="text-sm font-black text-slate-400 uppercase tracking-widest">
              Vui lòng chọn 1 KTV hoặc nhấp vào 1 Thẻ Thống Kê ở trên để xem chi tiết
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50">
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t[lang].table.date}</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t[lang].table.staff}</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t[lang].table.shift}</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t[lang].table.checkIn}</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t[lang].table.checkOut}</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t[lang].table.lateMins}</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t[lang].table.status}</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={7} className="px-6 py-4"><div className="h-10 bg-slate-50 rounded-xl" /></td>
                    </tr>
                  ))
                ) : displayData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center text-sm font-bold text-slate-400 uppercase italic tracking-widest">
                      Chưa có dữ liệu cho tháng này
                    </td>
                  </tr>
                ) : (
                  displayData
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) // Sort by date desc
                    .map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <p className="text-xs font-black text-slate-700">{format(parseISO(row.date), 'dd/MM')}</p>
                        <p className="text-[10px] font-bold text-slate-400">{format(parseISO(row.date), 'EEEE', { locale: vi })}</p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center text-[10px] font-black border border-indigo-100">
                            {row.employeeId}
                          </span>
                          <p className="text-sm font-black text-slate-800">{row.employeeName}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${row.status === 'off' ? 'bg-slate-50 text-slate-400' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
                          {/* @ts-ignore */}
                          {row.status === 'off' ? 'OFF' : (t[lang].shifts[row.shiftType] || row.shiftType)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <p className={`text-sm font-black ${row.status === 'late' ? 'text-rose-600' : 'text-slate-700'}`}>
                          {row.checkIn || '--:--'}
                        </p>
                      </td>
                      <td className="px-6 py-4 text-sm font-black text-slate-700">{row.checkOut || '--:--'}</td>
                      <td className="px-6 py-4">
                        {row.lateMins > 0 ? (
                          <span className="text-xs font-black text-rose-600">+{row.lateMins}m</span>
                        ) : (
                          <span className="text-xs font-bold text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1.5 rounded-full text-[10px] font-black border uppercase tracking-tighter ${STATUS_COLORS[row.status]}`}>
                          {t[lang].status[row.status]}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => setEditingRecord(row)}
                          className="p-2 bg-slate-50 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-xl transition-colors border border-slate-100 hover:border-indigo-100"
                          title="Chỉnh sửa điểm danh"
                        >
                          <Edit2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PayrollEditModal 
        isOpen={!!editingRecord} 
        onClose={() => setEditingRecord(null)}
        record={editingRecord}
        onSave={handleOverrideAttendance}
      />
    </div>
  );
};
