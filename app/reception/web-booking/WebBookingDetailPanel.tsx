'use client';

// 🔧 UI CONFIGURATION
const PANEL_ANIMATION_DURATION = 0.25;

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, User, Phone, Mail, CalendarDays, Clock, MessageSquare,
  CheckCircle2, XCircle, Globe, Package, DollarSign, AlertTriangle,
} from 'lucide-react';
import { WebBooking } from './actions';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const formatVND = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';

const formatDatetime = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('vi-VN', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch { return dateStr; }
};

const LANG_LABEL: Record<string, string> = {
  vi: '🇻🇳 Tiếng Việt', en: '🇺🇸 English', cn: '🇨🇳 中文', jp: '🇯🇵 日本語', kr: '🇰🇷 한국어',
};

// ─── PROPS ────────────────────────────────────────────────────────────────────

interface WebBookingDetailPanelProps {
  booking: WebBooking | null;
  onClose: () => void;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  isLoading?: boolean;
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

const WebBookingDetailPanel = ({ booking, onClose, onConfirm, onReject, isLoading }: WebBookingDetailPanelProps) => {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const isNew = booking?.status === 'NEW';
  const totalDuration = booking?.items.reduce((sum, i) => sum + i.duration * i.quantity, 0) ?? 0;

  let parsedNotes: any = null;
  let finalNote = booking?.notes || '';
  if (booking?.notes && typeof booking.notes === 'string' && booking.notes.trim().startsWith('{')) {
      try {
          parsedNotes = JSON.parse(booking.notes);
          if (parsedNotes.type === 'VIP_APPOINTMENT') {
              finalNote = 'Khách đặt trước qua App VIP.';
              if (parsedNotes.warnings && parsedNotes.warnings.length > 0) {
                  finalNote += ` Cảnh báo: ${parsedNotes.warnings.join(', ')}`;
              }
              const cNote = parsedNotes.customerNote || parsedNotes.note;
              if (cNote) {
                  finalNote += ` | Ghi chú khách: ${cNote}`;
              }
          } else if (parsedNotes.type === 'WEB_ADVANCE_BOOKING') {
              finalNote = 'Khách đặt trước qua Web Nội Bộ.';
              const cNote = parsedNotes.customerNote || parsedNotes.note || parsedNotes.receptionNote;
              if (cNote) {
                  finalNote += ` | Ghi chú khách: ${cNote}`;
              }
          } else if (parsedNotes.type === 'CHECKOUT_CART') {
              finalNote = 'Checkout Giỏ Hàng';
              if (parsedNotes.vipCustomerNotes) {
                  finalNote += ` | Ghi chú VIP: ${parsedNotes.vipCustomerNotes}`;
              }
              const cNote = parsedNotes.customerNote || parsedNotes.note || parsedNotes.receptionNote;
              if (cNote) {
                  finalNote += ` | Ghi chú khách: ${cNote}`;
              }
          }
      } catch(e) {}
  }

  const handleReject = () => {
    if (!booking) return;
    onReject(booking.id);
    setShowRejectForm(false);
    setRejectReason('');
  };

  return (
    <AnimatePresence>
      {booking && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: PANEL_ANIMATION_DURATION }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-30"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: PANEL_ANIMATION_DURATION, ease: 'easeOut' }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-40 flex flex-col"
          >
            {/* Panel Header */}
            <div className="p-5 border-b border-gray-100 flex items-start justify-between shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-black text-gray-400 bg-gray-100 px-2 py-0.5 rounded-lg">
                    {booking.billCode}
                  </span>
                  {isNew && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 animate-pulse">
                      🔴 Chờ xác nhận
                    </span>
                  )}
                </div>
                <h2 className="text-lg font-black text-gray-900">Chi tiết đơn đặt lịch</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Customer info section */}
              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">
                  Thông tin khách hàng
                </p>
                <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white font-black text-base shadow-lg shadow-indigo-100 shrink-0">
                      {booking.customerName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-black text-gray-900">{booking.customerName}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {LANG_LABEL[booking.customerLang ?? 'vi'] ?? booking.customerLang}
                      </p>
                    </div>
                  </div>

                  {booking.customerPhone && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Phone size={13} className="text-gray-400 shrink-0" />
                      <a href={`tel:${booking.customerPhone}`} className="hover:text-indigo-600 transition-colors font-medium">
                        {booking.customerPhone}
                      </a>
                    </div>
                  )}
                  {booking.customerEmail && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Mail size={13} className="text-gray-400 shrink-0" />
                      <span className="font-medium truncate">{booking.customerEmail}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Appointment info */}
              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">
                  Thời gian mong muốn
                </p>
                <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100 space-y-2">
                  <div className="flex items-center gap-2 text-sm text-indigo-800 font-bold">
                    <CalendarDays size={14} className="text-indigo-500" />
                    {formatDatetime(booking.bookingDate)}
                  </div>
                  {booking.timeBooking && (
                    <div className="flex items-center gap-2 text-sm text-indigo-700">
                      <Clock size={14} className="text-indigo-500" />
                      <span className="font-black text-xl">{booking.timeBooking}</span>
                      <span className="text-xs text-indigo-500">GMT+7</span>
                    </div>
                  )}
                  {totalDuration > 0 && (
                    <p className="text-xs text-indigo-500 font-medium">
                      Ước tính: ~{totalDuration} phút ({Math.floor(totalDuration / 60)}h{totalDuration % 60 > 0 ? `${totalDuration % 60}p` : ''})
                    </p>
                  )}
                </div>
              </div>

              {/* Services */}
              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-3">
                  Dịch vụ đã chọn ({booking.items.length})
                </p>
                <div className="space-y-2">
                  {booking.items.length === 0 ? (
                    <div className="text-center py-6 text-gray-400">
                      <Package size={24} className="mx-auto mb-2 opacity-50" />
                      <p className="text-xs">Không có dịch vụ nào</p>
                    </div>
                  ) : (
                    booking.items.map((item, idx) => (
                      <div key={item.id} className="bg-white border border-gray-100 rounded-xl p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-gray-900 truncate">{item.serviceName}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {item.duration}p {item.quantity > 1 && `× ${item.quantity}`}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-black text-sm text-gray-900">{formatVND(item.price)}</p>
                          </div>
                        </div>

                        {/* Chi tiết Options từ Web Booking Giỏ hàng */}
                        {item.options && (item.options.strength || item.options.focus?.length > 0 || item.options.avoid?.length > 0 || item.options.tags?.length > 0 || item.options.note || item.options.customerNotes || (item.options.therapist && item.options.therapist !== 'Ngẫu nhiên')) && (
                          <div className="flex flex-col gap-1.5 mt-2 text-[12px] text-gray-600 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                             {(item.options.therapist && item.options.therapist !== 'Ngẫu nhiên') && <p className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-pink-400"></span> <span className="font-medium">Giới tính KTV:</span> <span className="text-pink-600 font-bold">{item.options.therapist}</span></p>}
                             {item.options.strength && <p className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span> <span className="font-medium">Lực massage:</span> {item.options.strength}</p>}
                             {item.options.focus && item.options.focus.length > 0 && <p className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span> <span className="font-medium">Tập trung:</span> {item.options.focus.join(', ')}</p>}
                             {item.options.avoid && item.options.avoid.length > 0 && <p className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400"></span> <span className="font-medium">Tránh vùng:</span> {item.options.avoid.join(', ')}</p>}
                             {item.options.tags && item.options.tags.length > 0 && <p className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span> <span className="font-medium">Yêu cầu khác:</span> {item.options.tags.join(', ')}</p>}
                             {(item.options.note || item.options.customerNotes) && <p className="flex gap-1 mt-0.5 text-gray-500 italic">" {item.options.note || item.options.customerNotes} "</p>}
                          </div>
                        )}
                        {item.requestedKTVs && item.requestedKTVs.length > 0 && (
                          <div className="flex flex-col gap-1.5 mt-1 border-t border-dashed border-gray-100 pt-2">
                            <span className="text-[9px] font-black text-pink-400 uppercase tracking-widest">KTV Yêu Cầu</span>
                            <div className="flex flex-wrap gap-1.5">
                                {item.requestedKTVs.map((ktv, idx) => (
                                  <div key={idx} className="text-[11px] text-pink-700 bg-pink-50 border border-pink-100 rounded-lg px-2 py-1 flex items-center gap-1.5 font-bold shadow-sm">
                                    <User size={12} className="text-pink-400" /> 
                                    {ktv.name} {ktv.skills && <span className="text-pink-600/70 font-medium">({ktv.skills})</span>}
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Total */}
              <div className="flex items-center justify-between py-3 border-t-2 border-dashed border-gray-200">
                <span className="text-sm font-bold text-gray-600">Tổng dự kiến</span>
                <span className="text-xl font-black text-gray-900">{formatVND(booking.totalAmount)}</span>
              </div>

              {/* Notes */}
              {finalNote && (
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">
                    Ghi chú từ khách
                  </p>
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex gap-2">
                    <MessageSquare size={14} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">{finalNote}</p>
                  </div>
                </div>
              )}

              {/* Reject form */}
              <AnimatePresence>
                {showRejectForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-bold text-red-700 flex items-center gap-1">
                        <AlertTriangle size={12} /> Lý do từ chối (không bắt buộc)
                      </p>
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="VD: Hết chỗ ngày này..."
                        className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm focus:ring-2 focus:ring-red-300 outline-none bg-white"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowRejectForm(false)}
                          className="flex-1 py-2 rounded-lg text-xs font-bold text-gray-500 bg-white border border-gray-200 hover:bg-gray-50"
                        >
                          Hủy
                        </button>
                        <button
                          onClick={handleReject}
                          disabled={isLoading}
                          className="flex-1 py-2 rounded-lg text-xs font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50"
                        >
                          Xác nhận từ chối
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer actions — only for NEW orders */}
            {isNew && !showRejectForm && (
              <div className="p-5 border-t border-gray-100 flex gap-3 shrink-0 bg-gray-50/50">
                <button
                  onClick={() => setShowRejectForm(true)}
                  disabled={isLoading}
                  className="flex-1 py-3 rounded-2xl font-bold text-sm text-red-600 bg-white border-2 border-red-100 hover:bg-red-50 hover:border-red-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <XCircle size={16} /> Từ chối
                </button>
                <button
                  onClick={() => onConfirm(booking.id)}
                  disabled={isLoading}
                  className="flex-1 py-3 rounded-2xl font-bold text-sm text-white bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <CheckCircle2 size={16} />
                  {isLoading ? 'Đang xử lý...' : 'Xác nhận đơn'}
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default WebBookingDetailPanel;
