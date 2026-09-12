'use client';
import { parseDbDate } from "@/lib/utils";

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import {
  ShieldAlert, History, Clock, Star, TrendingUp,
  Gift, CalendarDays, ChevronRight, ChevronDown,
  Loader2, CheckCircle2, Award, AlertCircle, FileImage, X
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { useKTVHistory, HistoryRecord } from './KTVHistory.logic';
import PullToRefresh from '@/components/PullToRefresh/PullToRefresh';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

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

// ─── Image Modal ──────────────────────────────────────────────────────────────

const ImageModal = ({ src, onClose }: { src: string; onClose: () => void }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <button className="absolute top-4 right-4 p-2 bg-black/50 text-white rounded-full">
        <X size={24} />
      </button>
      <img src={src} alt="Bằng chứng" className="max-w-full max-h-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
};

// ─── Discipline Card ──────────────────────────────────────────────────────────

const DisciplineCard = ({ item }: { item: HistoryRecord }) => {
  const [selectedImg, setSelectedImg] = React.useState<string | null>(null);
  
  // Format the raw DB rule_code into readable title
  const title = item.rule_code === 'RECEPTION_COMPLAINT' ? 'Quầy đánh giá / Phàn nàn' 
              : item.rule_code === 'HANDOVER_REJECT' ? 'Lỗi bàn giao phòng'
              : item.rule_code === 'ORDER_REJECT' ? 'Từ chối nhận tua'
              : item.rule_code || 'Vi phạm chuyên cần';

  const images = Array.isArray(item.images) ? item.images : [];

  return (
    <>
      <div className="bg-red-50/50 rounded-2xl border border-red-100 shadow-sm p-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-red-100/50 to-transparent rounded-bl-3xl"></div>
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <AlertCircle size={20} className="text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start gap-2">
              <h4 className="text-sm font-bold text-red-900 leading-tight">{title}</h4>
              <span className="text-sm font-black text-red-600 shrink-0">-{item.points_deducted}đ</span>
            </div>
            <p className="text-[11px] text-red-400 mt-1">
              {format(parseDbDate(item.createdAt), 'HH:mm — dd/MM/yyyy')}
            </p>
            {item.reason && (
              <div className="mt-2 text-xs text-red-800 bg-red-100/50 p-2 rounded-lg italic">
                "{item.reason}"
              </div>
            )}
            
            {/* Ảnh bằng chứng */}
            {images.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {images.map((img: string, idx: number) => (
                  <button 
                    key={idx} 
                    onClick={() => setSelectedImg(img)}
                    className="relative w-16 h-16 rounded-xl overflow-hidden border border-red-200 shrink-0 bg-white"
                  >
                    <img src={img} alt="Evidence" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/10 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                      <FileImage size={16} className="text-white" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {selectedImg && <ImageModal src={selectedImg} onClose={() => setSelectedImg(null)} />}
    </>
  );
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
      await apiClient.post<any>(API.KTV.HISTORY_UPDATE, { bookingId: order.id, techCode, tip });
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
            <span className="text-sm font-black text-indigo-600">#{(order.billCode || '').split('-')[0]}</span>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {format(parseDbDate(order.createdAt), 'HH:mm — dd/MM/yyyy')}
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

              {/* Số lượng khách */}
              {order.guestCount && order.guestCount > 0 && (
                <div className="flex justify-between items-start">
                  <span className="text-[11px] text-gray-400 uppercase font-bold tracking-wider">Số lượng khách</span>
                  <span className="text-sm text-gray-600">{order.guestCount} khách</span>
                </div>
              )}

              {/* KTV làm cùng */}
              {order.coWorkers && order.coWorkers.length > 0 && (
                <div className="flex justify-between items-start">
                  <span className="text-[11px] text-gray-400 uppercase font-bold tracking-wider">Số lượng KTV</span>
                  <span className="text-sm text-gray-600">{order.coWorkers.length + 1} KTV</span>
                </div>
              )}

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

              {/* Bàn giao phòng */}
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-gray-400 uppercase font-bold tracking-wider">Quầy duyệt</span>
                <div className="flex items-center gap-2">
                  {order.handover_status === 'APPROVED' ? (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-full text-emerald-700 bg-emerald-50">
                      Đã duyệt
                    </span>
                  ) : order.handover_status === 'REJECTED' ? (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-full text-red-700 bg-red-50">
                      Từ chối
                    </span>
                  ) : (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-full text-blue-700 bg-blue-50">
                      Chờ duyệt
                    </span>
                  )}
                </div>
              </div>
              {order.handover_comment && (
                <div className="bg-gray-50 rounded-lg p-2.5 text-xs text-gray-600 italic -mt-1">
                  &ldquo;{order.handover_comment}&rdquo;
                </div>
              )}

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
          <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl px-4 py-3 shadow-lg shadow-indigo-100/50 flex justify-between items-center text-white mb-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-100">Điểm Chuyên Cần Tháng Này</p>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-2xl font-black">{summary.disciplinePoints}</span>
                <span className="text-sm font-medium text-indigo-200">/ 100đ</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Award size={24} className="text-white" />
            </div>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
              history.map(item => (
                item.type === 'DISCIPLINE'
                  ? <DisciplineCard key={item.id} item={item} />
                  : <OrderCard key={item.id} order={item} getStatusLabel={getStatusLabel} techCode={user?.id || ''} refetch={refetch} />
              ))
            )}
          </div>
        </div>
      </PullToRefresh>
    </AppLayout>
  );
}
