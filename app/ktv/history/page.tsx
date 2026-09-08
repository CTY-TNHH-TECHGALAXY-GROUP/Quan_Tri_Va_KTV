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

import { HistoryCalendar } from './_components/HistoryCalendar';

// 🔧 UI CONFIGURATION
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

const OrderCard = ({ order, getStatusLabel }: {
  order: HistoryRecord;
  getStatusLabel: (s: string) => { label: string; color: string };
}) => {
  const [expanded, setExpanded] = React.useState(false);

  const statusInfo = getStatusLabel(order.status);
  const isDone = order.status === 'DONE' || order.status === 'COMPLETED';
  const ratingCfg = order.rating ? RATING_CONFIG[order.rating] : null;

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

              {/* Thời lượng DV */}
              {order.duration > 0 && (
                <div className="flex justify-between items-start">
                  <span className="text-[11px] text-gray-400 uppercase font-bold tracking-wider">Thời lượng DV</span>
                  <span className="text-sm text-gray-600">{order.duration} phút</span>
                </div>
              )}

              {/* Thời gian làm DV (thực tế) */}
              {order.actualDuration != null && order.actualDuration > 0 && (
                <div className="flex justify-between items-start">
                  <span className="text-[11px] text-gray-400 uppercase font-bold tracking-wider">Thời gian làm DV</span>
                  <span className={`text-sm font-medium ${order.actualDuration > order.duration ? 'text-amber-600' : 'text-gray-600'}`}>
                    {order.actualDuration} phút
                  </span>
                </div>
              )}

              {/* Tiền tua */}
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-gray-400 uppercase font-bold tracking-wider">Tiền tua</span>
                <div className="flex items-center gap-1.5">
                  {order.isFeedbackDone ? (
                    <>
                      <TrendingUp size={13} className="text-indigo-400" />
                      <span className="text-sm font-black text-indigo-700">
                        {(() => {
                          const displayComm = order.isTypeD ? (order.commissionBeforeDeduction || order.commission) : order.commission;
                          return displayComm != null && displayComm > 0 ? `${displayComm.toLocaleString('vi-VN')}đ` : '—';
                        })()}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] font-bold text-amber-500 bg-amber-50 px-2.5 py-0.5 rounded-full">
                      ⏳ Chờ FB
                    </span>
                  )}
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
                  {/* ⚠️ Trước đây chỉ tách APPROVED / REJECTED, MỌI thứ còn lại đổ
                      vào "Chờ duyệt". Mà 'PENDING' là GIÁ TRỊ MẶC ĐỊNH của cột —
                      đơn chưa từng bàn giao, đơn bị bỏ qua, đơn đã huỷ đều mang nó.
                      Nên KTV thấy "Chờ duyệt" và tưởng quầy đang ngâm, trong khi
                      thật ra chưa ai nộp gì cả. */}
                  {order.status === 'CANCELLED' ? (
                    <span className="text-xs text-gray-300">—</span>
                  ) : order.handover_status === 'APPROVED' ? (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-full text-emerald-700 bg-emerald-50">
                      Đã duyệt
                    </span>
                  ) : order.handover_status === 'REJECTED' ? (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-full text-red-700 bg-red-50">
                      Bị trả lại
                    </span>
                  ) : order.handover_status === 'SKIPPED' ? (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-full text-amber-700 bg-amber-50">
                      Nợ bàn giao
                    </span>
                  ) : order.handover_submitted ? (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-full text-blue-700 bg-blue-50">
                      Chờ duyệt
                    </span>
                  ) : (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded-full text-gray-500 bg-gray-100">
                      Chưa bàn giao
                    </span>
                  )}
                </div>
              </div>
              {order.handover_comment && (
                <div className="bg-gray-50 rounded-lg p-2.5 text-xs text-gray-600 italic -mt-1">
                  &ldquo;{order.handover_comment}&rdquo;
                </div>
              )}

              {/* Khách tích ô góp ý nào thì hiện ra đây. Tích lỗi kéo trần đánh giá
                  xuống 3 sao, tức là trừ tiền — nên phải cho KTV biết lý do. */}
              {Array.isArray(order.violations) && order.violations.length > 0 && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-2.5 -mt-1">
                  <p className="text-[10px] font-black text-rose-700 uppercase tracking-wider mb-1">
                    Khách phản ánh
                  </p>
                  {order.violations.map((v: any) => (
                    <p key={v.id} className="text-xs text-rose-600 font-medium leading-snug">
                      • {v.text || v.id}
                    </p>
                  ))}
                </div>
              )}

              {/* Bonus Points */}
              {order.bonusPoints > 0 && (
                <div className="flex justify-between items-center bg-amber-50 rounded-xl px-3 py-2 -mx-1">
                  <div className="flex items-center gap-1.5">
                    <Award size={14} className="text-amber-500" />
                    <span className="text-[11px] text-amber-700 font-bold uppercase tracking-wider">Bonus Xuất Sắc</span>
                  </div>
                  <div className="text-right leading-tight">
                    <span className="text-sm font-black text-amber-600">+{order.bonusPoints}đ</span>
                    {!!order.bonusValue && order.bonusValue !== order.bonusPoints && (
                      <p className="text-[10px] text-amber-500 font-semibold">
                        = {order.bonusValue.toLocaleString('vi-VN')}đ
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ─── Trừ đánh giá, Thuế TNCN & thực nhận ─── */}
              {order.isTypeD && order.type !== 'DISCIPLINE' && (
                <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5 -mx-1 space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Tổng thu nhập đơn</span>
                    <span className="text-sm font-bold text-gray-700">
                      {((order.grossIncome || 0) + (order.ratingDeductionAmount || 0)).toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                  {(order.ratingDeductionAmount || 0) > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-orange-500 font-bold uppercase tracking-wider">
                        Trừ đánh giá ({Math.round((order.ratingDeductionRate || 0) * 100)}%)
                      </span>
                      <span className="text-sm font-bold text-orange-600">
                        −{(order.ratingDeductionAmount || 0).toLocaleString('vi-VN')}đ
                      </span>
                    </div>
                  )}
                  {(order.taxAmount || 0) > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-rose-500 font-bold uppercase tracking-wider">
                        Thuế TNCN ({Math.round((order.taxRate || 0) * 100)}%)
                      </span>
                      <span className="text-sm font-bold text-rose-600">
                        −{(order.taxAmount || 0).toLocaleString('vi-VN')}đ
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-1.5 border-t border-gray-200">
                    <span className={`text-[11px] font-black uppercase tracking-wider ${order.isProvisional ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {order.isProvisional ? 'Tạm tính' : 'Thực nhận'}
                    </span>
                    <span className={`text-base font-black ${order.isProvisional ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {(order.netIncome || 0).toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                </div>
              )}


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
  const [showCalendar, setShowCalendar] = React.useState(false);
  const { hasPermission } = useAuth();
  const {
    user,
    history, isLoading,
    selectedDates, setSelectedDates,
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
              <p className="text-xs text-gray-400">Bấm vào đơn để xem chi tiết</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-indigo-600 text-white rounded-2xl px-2 py-3 shadow-lg shadow-indigo-100 flex flex-col justify-between">
              <p className="text-[8px] font-bold uppercase tracking-widest text-indigo-200">Thu nhập</p>
              <p className="text-sm font-black tabular-nums mt-0.5 break-words">{(summary.totalGross || 0).toLocaleString('vi-VN')}đ</p>
            </div>
            <div className="bg-emerald-500 text-white rounded-2xl px-2 py-3 shadow-lg shadow-emerald-100 flex flex-col justify-between">
              <p className="text-[8px] font-bold uppercase tracking-widest text-emerald-100">Thực nhận</p>
              <p className="text-sm font-black tabular-nums mt-0.5 break-words">{(summary.totalNet || 0).toLocaleString('vi-VN')}đ</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl px-2 py-3 shadow-sm flex flex-col justify-between items-center text-center">
              <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Đơn</p>
              <p className="text-base font-black text-gray-900 tabular-nums mt-0.5">{summary.totalOrders}</p>
            </div>
            <button 
                onClick={() => setShowCalendar(!showCalendar)} 
                className={`flex flex-col items-center justify-center rounded-2xl border active:scale-95 transition-all shadow-sm ${showCalendar ? 'bg-indigo-600 border-indigo-600 text-white shadow-indigo-200' : 'bg-white border-gray-100 text-indigo-600'}`}
            >
                <CalendarDays size={22} className="mb-1" />
                <span className="text-[8px] font-bold uppercase tracking-widest opacity-80">Chọn ngày</span>
            </button>
          </div>

          {/* Date Picker (Toggled via button) */}
          <AnimatePresence>
              {showCalendar && (
                  <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                  >
                      <HistoryCalendar selectedDates={selectedDates} onSelectDates={(dates, isComplete) => {
                          setSelectedDates(dates);
                          if (isComplete) {
                            setTimeout(() => setShowCalendar(false), 300);
                          }
                      }} />
                  </motion.div>
              )}
          </AnimatePresence>

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
                  : <OrderCard key={item.id} order={item} getStatusLabel={getStatusLabel} />
              ))
            )}
          </div>
        </div>
      </PullToRefresh>
    </AppLayout>
  );
}
