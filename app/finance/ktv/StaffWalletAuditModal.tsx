'use client';

import React, { useState, useEffect } from 'react';
import { X, Clock, Calendar, ArrowUpRight, ArrowDownLeft, FileSpreadsheet, RefreshCw, Loader2, Zap, ShieldCheck } from 'lucide-react';
import { formatVnd } from '@/lib/format.logic';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

interface StaffWalletAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffId: string | null;
  staffName: string;
  workType?: string;
}

export function StaffWalletAuditModal({
  isOpen,
  onClose,
  staffId,
  staffName,
  workType,
}: StaffWalletAuditModalProps) {
  const [timeline, setTimeline] = useState<any[]>([]);
  const [balance, setBalance] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [filterDirection, setFilterDirection] = useState<'ALL' | 'IN' | 'OUT'>('IN');

  useEffect(() => {
    if (!isOpen || !staffId) return;

    let isMounted = true;
    setIsLoading(true);

    Promise.all([
      apiClient.get<any>(API.KTV.WALLET.TIMELINE(staffId)).catch(() => ({ data: [] })),
      apiClient.get<any>(API.KTV.WALLET.BALANCE(staffId)).catch(() => ({ data: null })),
    ])
      .then(([timeRes, balRes]) => {
        if (!isMounted) return;
        setTimeline(timeRes.data || []);
        setBalance(balRes.data || null);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, staffId]);

  if (!isOpen || !staffId) return null;

  const filteredTimeline = timeline.filter(item => {
    const amt = Number(item.amount || 0);
    if (filterDirection === 'IN') return amt > 0;
    if (filterDirection === 'OUT') return amt < 0;
    return true;
  });

  const exportCSV = () => {
    if (timeline.length === 0) return;
    const BOM = '\uFEFF';
    let csv = `${BOM}THỜI GIAN,NGÀY LÀM VIỆC,KHOẢN MỤC,LOẠI,DIỄN GIẢI,SỐ TIỀN,SỐ DƯ LŨY KẾ\n`;
    timeline.forEach(row => {
      const dt = row.created_at ? new Date(row.created_at).toLocaleString('vi-VN') : '';
      const bDate = row.business_date || '';
      const title = (row.title || '').replace(/"/g, '""');
      const type = row.type || '';
      const note = (row.note || '').replace(/"/g, '""');
      const amt = row.amount || 0;
      const bal = row.running_balance ?? '';
      csv += `"${dt}","${bDate}","${title}","${type}","${note}",${amt},${bal}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Doi_Soat_Vi_${staffId}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in">
      <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[28px] shadow-2xl border border-slate-100 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between gap-4 bg-slate-50/50">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-lg">
                {staffId}
              </span>
              <h3 className="text-xl font-black text-slate-800 tracking-tight">
                {staffName}
              </h3>
              {workType && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200">
                  {workType}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Nhật ký dòng tiền chi tiết & số dư ví phục vụ đối soát giao dịch
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              disabled={isLoading || timeline.length === 0}
              className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
              title="Xuất file CSV đối soát"
            >
              <FileSpreadsheet size={15} />
              <span className="hidden sm:inline">Xuất CSV</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all active:scale-95"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Quick Balance Cards */}
        {balance && (
          <div className="p-4 sm:px-6 bg-indigo-50/40 border-b border-indigo-100/50 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-white p-3 rounded-2xl border border-indigo-100/80 shadow-2xs">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tiền khả dụng</p>
              <p className="text-base font-black text-emerald-600 mt-0.5">{formatVnd(balance.available_balance || 0)}</p>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-indigo-100/80 shadow-2xs">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Số dư thực tế</p>
              <p className="text-base font-black text-indigo-700 mt-0.5">{formatVnd(balance.actual_balance || 0)}</p>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-indigo-100/80 shadow-2xs">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tiền cọc giữ lại</p>
              <p className="text-base font-bold text-slate-700 mt-0.5">{formatVnd(balance.min_deposit || 500000)}</p>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-indigo-100/80 shadow-2xs">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tổng rút lũy kế</p>
              <p className="text-base font-bold text-rose-600 mt-0.5">{formatVnd(balance.total_withdrawn || 0)}</p>
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap bg-white">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              onClick={() => setFilterDirection('ALL')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                filterDirection === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tất cả dòng ({timeline.length})
            </button>
            <button
              onClick={() => setFilterDirection('IN')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                filterDirection === 'IN'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🟢 Tiền cộng vào ({timeline.filter(t => Number(t.amount) > 0).length})
            </button>
            <button
              onClick={() => setFilterDirection('OUT')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                filterDirection === 'OUT'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🔴 Tiền trừ ra ({timeline.filter(t => Number(t.amount) < 0).length})
            </button>
          </div>

          <span className="text-[11px] font-semibold text-slate-400">
            Hiển thị {filteredTimeline.length} giao dịch
          </span>
        </div>

        {/* Transaction Table */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center text-slate-400">
              <Loader2 size={32} className="animate-spin text-indigo-500 mb-3" />
              <p className="text-xs font-medium">Đang tải lịch sử ví...</p>
            </div>
          ) : filteredTimeline.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              Không có giao dịch nào khớp với bộ lọc
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden bg-white shadow-2xs">
              {filteredTimeline.map((item, idx) => {
                const amt = Number(item.amount || 0);
                const isPositive = amt > 0;
                const dt = item.created_at ? new Date(item.created_at) : null;
                const formattedTime = dt && !isNaN(dt.getTime())
                  ? dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                  : '';
                const formattedDate = dt && !isNaN(dt.getTime())
                  ? dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
                  : '';

                return (
                  <div key={item.id || idx} className="p-3.5 hover:bg-slate-50/70 transition-colors flex items-center justify-between gap-4 text-xs">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                          isPositive
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/60'
                            : 'bg-rose-50 text-rose-600 border border-rose-200/60'
                        }`}
                      >
                        {isPositive ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                      </div>

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-sm">{item.title}</span>
                          {item.business_date && (
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                              Ngày lv: {item.business_date}
                            </span>
                          )}
                        </div>
                        {item.note && (
                          <p className="text-[11px] text-slate-500 font-medium break-words leading-relaxed">
                            {item.note}
                          </p>
                        )}
                        <p className="text-[10px] text-slate-400">
                          {formattedTime} • {formattedDate}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p
                        className={`text-sm font-black tracking-tight ${
                          isPositive ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {isPositive ? '+' : ''}{formatVnd(amt)}
                      </p>
                      {item.running_balance !== undefined && item.running_balance !== null && (
                        <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                          Dư: {formatVnd(item.running_balance)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
