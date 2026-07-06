'use client';
import { parseDbDate } from "@/lib/utils";

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import {
  ShieldAlert, History, Clock, Star, TrendingUp,
  Gift, CalendarDays, ChevronRight, ChevronDown,
  Loader2, CheckCircle2, Award
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { useKTVHistory, HistoryRecord } from './KTVHistory.logic';
import PullToRefresh from '@/components/PullToRefresh/PullToRefresh';

// 🔧 UI CONFIGURATION
const PRESET_BUTTONS = [
  { key: 'today',     label: 'Hôm nay' },
  { key: 'yesterday', label: 'Hôm qua' },
  { key: '7days',     label: '7 ngày' },
  { key: 'custom',    label: 'Tuỳ chọn' },
] as const;

const RATING_CONFIG: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: 'Tệ',          color: 'text-red-600',     bg: 'bg-red-50'     },
  2: { label: 'Bình thường',  color: 'text-yellow-600',  bg: 'bg-yellow-50'  },
  3: { label: 'Tốt',          color: 'text-emerald-700', bg: 'bg-emerald-50' },
  4: { label: 'Xuất sắc',     color: 'text-indigo-700',  bg: 'bg-indigo-50'  },
  5: { label: 'Xuất sắc',     color: 'text-indigo-700',  bg: 'bg-indigo-50'  },
};

// ─── Expandable Order Card ────────────────────────────────────────────────────

const OrderCard = ({ order, getStatusLabel, techCode, refetch }: {
  order: HistoryRecord;
  getStatusLabel: (s: string) => { label: string; color: string };
  techCode: string;
  refetch: () => void;
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const [tipValue, setTipValue] = React.useState(String(order.tip || ''));
  const [savingTip, setSavingTip] = React.useState(false);
  const [tipSaved, setTipSaved] = React.useState(false);

  const statusInfo = getStatusLabel(order.status);
  const isDone = order.status === 'DONE' || order.status === 'COMPLETED';
  const ratingCfg = order.rating ? RATING_CONFIG[order.rating] : null;

  const handleSaveTip = async () => {
    const tip = parseInt(tipValue.replace(/\D/g, ''), 10) || 0;
    setSavingTip(true);
    try {
      await fetch('/api/ktv/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: order.id, techCode, tip }),
      });
      setTipSaved(true);
      refetch();
      setTimeout(() => setTipSaved(false), 2000);
    } catch { /* silent */ }
    setSavingTip(false);
  };

  return (
    <motion.div
      layout
      className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
    >
      {/* ─── Compact Row (always visible) ─── */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left active:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {isDone ? (
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          ) : (
            <Clock size={16} className="text-gray-300 shrink-0" />
          )}
          <div className="min-w-0">
            <span className="text-sm font-black text-indigo-600">#{order.billCode}</span>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {format(parseDbDate(), 'HH:mm — dd/MM/yyyy')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown size={16} className="text-gray-300" />
          </motion.div>
        </div>
      </button>

      {/* ─── Expanded Detail ─── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-gray-50 pt-3">
              {/* Dịch vụ */}
              <div className="flex justify-between items-start">
                <span className="text-[11px] text-gray-400 uppercase font-bold tracking-wider">Dịch vụ</span>
                <span className="text-sm font-medium text-gray-700 text-right">{order.serviceName}</span>
              </div>

              {/* Thời lượng */}
              {order.duration > 0 && (
                <div className="flex justify-between items-start">
                  <span className="text-[11px] text-gray-400 uppercase font-bold tracking-wider">Thời lượng</span>
                  <span className="text-sm text-gray-600">{order.duration} phút</span>
                </div>
              )}

              {/* Tiền tua */}
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-gray-400 uppercase font-bold tracking-wider">Tiền tua</span>
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-indigo-400" />
                  <span className="text-sm font-black text-indigo-700">
                    {order.commission > 0 ? `${order.commission.toLocaleString('vi-VN')}đ` : '—'}
                  </span>
                </div>
              </div>

              {/* Đánh giá + Bonus */}
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-gray-400 uppercase font-bold tracking-wider">Đánh giá</span>
                <div className="flex items-center gap-2">
                  {ratingCfg ? (
                    <div className="flex items-center gap-1.5">
                      <Star size={12} className="text-amber-400 fill-amber-400" />
                      <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${ratingCfg.color} ${ratingCfg.bg}`}>
                        {ratingCfg.label}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>
              </div>

              {/* Bonus Points */}
              {order.bonusPoints > 0 && (
                <div className="flex justify-between items-center bg-amber-50 rounded-xl px-3 py-2 -mx-1">
                  <div className="flex items-center gap-1.5">
                    <Award size={14} className="text-amber-500" />
                    <span className="text-[11px] text-amber-700 font-bold uppercase tracking-wider">Bonus Xuất Sắc</span>
                  </div>
                  <span className="text-sm font-black text-amber-600">+{order.bonusPoints}đ</span>
                </div>
              )}

              {/* ─── Tip Input ─── */}
              <div className="pt-2 border-t border-gray-50">
                <label className="text-[11px] text-gray-400 uppercase font-bold tracking-wider block mb-2">
                  💰 Tiền Tip
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Gift size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400" />
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={tipValue}
                      onChange={e => {
                        const raw = e.target.value.replace(/\D/g, '');
                        setTipValue(raw);
                        setTipSaved(false);
                      }}
                      className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 transition-all"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-bold">đ</span>
                  </div>
                  <button
                    onClick={handleSaveTip}
                    disabled={savingTip}
                    className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm min-w-[70px] flex items-center justify-center gap-1 ${
                      tipSaved
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95'
                    }`}
                  >
                    {savingTip ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : tipSaved ? (
                      <><CheckCircle2 size={14} /> OK</>
                    ) : (
                      'Lưu'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function KTVHistoryPage() {
  const [mounted, setMounted] = React.useState(false);
  const { hasPermission } = useAuth();
  const {
    user,
    history, isLoading,
    datePreset, setDatePreset,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    applyCustomDate,
    summary,
    getStatusLabel,
    refetch,
  } = useKTVHistory();

  React.useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  if (!hasPermission('ktv_history')) {
    return (
      <AppLayout title="Lịch Sử">
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <ShieldAlert size={48} className="text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-gray-900">Không có quyền truy cập</h2>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Lịch Sử" disablePullToRefresh>
      <PullToRefresh onRefresh={async () => { await refetch(); }}>
        <div className="space-y-4 max-w-xl mx-auto pb-6">

          {/* Header */}
          <div>
              <p className="text-xs text-gray-400">Bấm vào đơn để xem chi tiết & nhập tip</p>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-indigo-600 text-white rounded-2xl px-2.5 py-3 shadow-lg shadow-indigo-100">
              <p className="text-[8px] font-bold uppercase tracking-widest text-indigo-200">Tiền tua</p>
              <p className="text-base font-black tabular-nums mt-0.5">{summary.totalCommission.toLocaleString('vi-VN')}đ</p>
            </div>
            <div className="bg-emerald-500 text-white rounded-2xl px-2.5 py-3 shadow-lg shadow-emerald-100">
              <p className="text-[8px] font-bold uppercase tracking-widest text-emerald-100">Tip</p>
              <p className="text-base font-black tabular-nums mt-0.5">{summary.totalTip.toLocaleString('vi-VN')}đ</p>
            </div>
            <div className="bg-amber-500 text-white rounded-2xl px-2.5 py-3 shadow-lg shadow-amber-100">
              <p className="text-[8px] font-bold uppercase tracking-widest text-amber-100">Bonus</p>
              <p className="text-base font-black tabular-nums mt-0.5">{summary.totalBonus}đ</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl px-2.5 py-3 shadow-sm">
              <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Đơn</p>
              <p className="text-base font-black text-gray-900 tabular-nums mt-0.5">{summary.totalOrders}</p>
            </div>
          </div>

          {/* Date Picker */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-3 py-3 space-y-2.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <CalendarDays size={14} className="text-gray-400 shrink-0" />
              {PRESET_BUTTONS.map(b => (
                <button
                  key={b.key}
                  onClick={() => setDatePreset(b.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    datePreset === b.key
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {datePreset === 'custom' && (
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="border border-gray-200 rounded-xl px-2.5 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 flex-1 min-w-[120px]"
                />
                <ChevronRight size={14} className="text-gray-300 shrink-0" />
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="border border-gray-200 rounded-xl px-2.5 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 flex-1 min-w-[120px]"
                />
                <button
                  onClick={applyCustomDate}
                  className="px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold active:scale-95 transition-all"
                >
                  Xem
                </button>
              </div>
            )}
          </div>

          {/* Order List */}
          <div className="space-y-2.5">
            {isLoading ? (
              <div className="py-20 text-center">
                <Loader2 size={28} className="animate-spin text-indigo-400 mx-auto" />
                <p className="mt-3 text-sm text-gray-400">Đang tải...</p>
              </div>
            ) : history.length === 0 ? (
              <div className="py-20 text-center">
                <History size={36} className="text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-400">Chưa có đơn hàng nào.</p>
              </div>
            ) : (
              history.map(order => (
                <OrderCard key={order.id} order={order} getStatusLabel={getStatusLabel} techCode={user?.id || ''} refetch={refetch} />
              ))
            )}
          </div>
        </div>
      </PullToRefresh>
    </AppLayout>
  );
}
