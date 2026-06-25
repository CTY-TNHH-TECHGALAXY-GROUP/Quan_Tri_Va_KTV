'use client';

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = 0.2;
const CARD_BORDER_RADIUS = 'rounded-2xl';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, User, Phone, DollarSign, MessageSquare, CheckCircle2, XCircle, ChevronRight, CalendarDays, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { WebBooking } from './actions';

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  NEW:        { label: 'Chờ xác nhận', color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', dot: 'bg-orange-500', badgeBg: 'bg-orange-100' },
  PREPARING:  { label: 'Chuẩn bị',     color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-200', dot: 'bg-violet-500', badgeBg: 'bg-violet-100' },
  IN_PROGRESS:{ label: 'Đang phục vụ', color: 'text-emerald-600',bg: 'bg-emerald-50',border: 'border-emerald-200',dot: 'bg-emerald-500',badgeBg: 'bg-emerald-100'},
  COMPLETED:  { label: 'Đang dọn',     color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', dot: 'bg-purple-500', badgeBg: 'bg-purple-100' },
  DONE:       { label: 'Hoàn tất',     color: 'text-gray-500',   bg: 'bg-gray-50',   border: 'border-gray-200',   dot: 'bg-gray-400',   badgeBg: 'bg-gray-100' },
  FEEDBACK:   { label: 'Chờ đánh giá', color: 'text-gray-500',   bg: 'bg-gray-50',   border: 'border-gray-200',   dot: 'bg-gray-400',   badgeBg: 'bg-gray-100' },
  CANCELLED:  { label: 'Đã hủy',       color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200',    dot: 'bg-red-500',    badgeBg: 'bg-red-100' },
} as const;

const LANG_FLAG: Record<string, string> = {
  vi: '🇻🇳', en: '🇺🇸', cn: '🇨🇳', jp: '🇯🇵', kr: '🇰🇷',
};

const SOURCE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  WEB_BOOKING: { label: 'Web Booking', color: 'text-blue-600', bg: 'bg-blue-50' },
  HOME_BOOKING: { label: 'Đặt tại nhà', color: 'text-indigo-600', bg: 'bg-indigo-50' },
  VIP_BOOKING: { label: 'App VIP', color: 'text-amber-600', bg: 'bg-amber-50' },
  VIP_WALK_IN: { label: 'App VIP (Walk-in)', color: 'text-orange-600', bg: 'bg-orange-50' },
  STANDARD_BOOKING: { label: 'App Standard', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  STANDARD_WALK_IN: { label: 'Tại quầy', color: 'text-gray-600', bg: 'bg-gray-100' },
  MIXED_WALK_IN: { label: 'Hỗn hợp (Tại quầy)', color: 'text-rose-600', bg: 'bg-rose-50' },
  MIXED_BOOKING: { label: 'Web đặt (Hỗn hợp)', color: 'text-teal-600', bg: 'bg-teal-50' },
};

const formatVND = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';

const formatDate = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
  } catch {
    return dateStr;
  }
};

// ─── PROPS ────────────────────────────────────────────────────────────────────

interface WebBookingCardProps {
  booking: WebBooking;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  onViewDetail: (booking: WebBooking) => void;
  isLoading?: boolean;
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

const WebBookingCard = ({ booking, onConfirm, onReject, onViewDetail, isLoading }: WebBookingCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const cfg = STATUS_CONFIG[booking.status] ?? STATUS_CONFIG.NEW;
  const isNew = booking.status === 'NEW';
  const flag = LANG_FLAG[booking.customerLang ?? 'vi'] ?? '🌐';
  const totalDuration = booking.items.reduce((sum, i) => sum + i.duration * i.quantity, 0);

  let parsedNotes: any = null;
  let finalNote = booking.notes || '';
  if (booking.notes && typeof booking.notes === 'string' && booking.notes.trim().startsWith('{')) {
      try {
          parsedNotes = JSON.parse(booking.notes);
          if (parsedNotes.type === 'VIP_APPOINTMENT') {
              finalNote = 'Ghi chú VIP: Khách đặt trước.';
              if (parsedNotes.warnings && parsedNotes.warnings.length > 0) {
                  finalNote += ` Cảnh báo: ${parsedNotes.warnings.join(', ')}`;
              }
              const cNote = parsedNotes.customerNote || parsedNotes.note;
              if (cNote) {
                  finalNote += ` | Ghi chú khách: ${cNote}`;
              }
          } else if (parsedNotes.type === 'WEB_ADVANCE_BOOKING') {
              finalNote = 'Ghi chú: Khách đặt trước qua Web Nội Bộ.';
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

  const displayTime = parsedNotes?.timeSlot || booking.timeBooking;
  const sourceCfg = SOURCE_MAP[booking.source] ?? { label: booking.source || 'N/A', color: 'text-gray-600', bg: 'bg-gray-100' };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: ANIMATION_DURATION }}
      className={`bg-white ${CARD_BORDER_RADIUS} border-2 ${isNew ? 'border-orange-200 shadow-orange-50' : 'border-gray-100'} shadow-sm hover:shadow-md transition-all overflow-hidden`}
    >
      {/* Top accent bar for NEW orders */}
      {isNew && (
        <div className="h-1 w-full bg-gradient-to-r from-orange-400 to-rose-400" />
      )}

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-black text-gray-400 bg-gray-50 px-2 py-0.5 rounded-lg shrink-0">
              {booking.billCode}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.badgeBg} ${cfg.color} flex items-center gap-1 shrink-0`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
          </div>
          <span className="text-[10px] text-gray-400 shrink-0">{flag}</span>
        </div>

        {/* Customer info */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-black text-sm shadow-lg shadow-indigo-100 shrink-0">
            {booking.customerName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-black text-sm text-gray-900 truncate">{booking.customerName}</p>
            {booking.customerPhone && (
              <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                <Phone size={9} /> {booking.customerPhone}
              </p>
            )}
            {booking.customerEmail && !booking.customerEmail.includes('no-email.com') && (
              <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5 truncate">
                <span className="font-bold">@</span> {booking.customerEmail}
              </p>
            )}
          </div>
        </div>

        {/* Booking info chips */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className="flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded-lg font-medium">
            <CalendarDays size={10} className="text-indigo-400" />
            {formatDate(booking.bookingDate)}
          </span>
          {displayTime && (
            <span className="flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded-lg font-medium">
              <Clock size={10} className="text-indigo-400" />
              {displayTime}
            </span>
          )}
          <span className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg ${sourceCfg.color} ${sourceCfg.bg}`}>
            <Globe size={10} />
            {sourceCfg.label}
          </span>
          {totalDuration > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg font-bold">
              ~{totalDuration}p
            </span>
          )}
        </div>

        {/* Services preview */}
        {booking.items.length > 0 && (
          <div className="bg-gray-50/80 rounded-xl p-2.5 mb-3 space-y-1.5 transition-all">
            <AnimatePresence initial={false}>
              {booking.items.slice(0, isExpanded ? booking.items.length : 2).map((item) => (
                <motion.div 
                  key={item.id} 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex flex-col gap-0.5 overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-gray-600 font-medium truncate">{item.serviceName}</span>
                    <span className="text-[10px] text-gray-400 shrink-0">{item.duration}p</span>
                  </div>
                  {/* Options Preview cho Web Booking Cart */}
                  {item.options && (item.options.strength || item.options.focus?.length > 0 || item.options.avoid?.length > 0 || item.options.note || item.options.customerNotes || (item.options.therapist && item.options.therapist !== 'Ngẫu nhiên')) && (
                      <div className="text-[9.5px] text-gray-500 truncate mt-0.5 mb-0.5">
                         {[
                           item.options.strength && `Lực: ${item.options.strength}`,
                           item.options.focus?.length > 0 && `Tập trung: ${item.options.focus.join(', ')}`,
                           item.options.avoid?.length > 0 && `Né: ${item.options.avoid.join(', ')}`,
                           (item.options.therapist && item.options.therapist !== 'Ngẫu nhiên') && `KTV: ${item.options.therapist}`,
                           (item.options.note || item.options.customerNotes) && `Ghi chú: ${item.options.note || item.options.customerNotes}`
                         ].filter(Boolean).join(' | ')}
                      </div>
                  )}
                  {item.requestedKTVs && item.requestedKTVs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {item.requestedKTVs.map((ktv, idx) => (
                        <span key={idx} className="text-[9px] text-pink-700 bg-pink-100/50 border border-pink-100 rounded-[4px] px-1.5 py-0.5 flex items-center gap-1 font-bold shadow-sm">
                          <User size={8} className="text-pink-500" /> 
                          {ktv.name} {ktv.skills && <span className="text-pink-500/80 font-normal">({ktv.skills})</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {booking.items.length > 2 && (
              <button 
                onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                className="text-[10px] text-indigo-500 font-bold hover:text-indigo-700 transition-colors flex items-center gap-1 mt-1 pt-1 border-t border-gray-200/50 w-full"
              >
                {isExpanded ? (
                  <><ChevronUp size={12} /> Thu gọn</>
                ) : (
                  <><ChevronDown size={12} /> +{booking.items.length - 2} dịch vụ khác</>
                )}
              </button>
            )}
          </div>
        )}

        {/* Note preview */}
        {finalNote && (
          <div className="flex items-start gap-1.5 mb-3 text-[11px] text-amber-700 bg-amber-50 px-2.5 py-2 rounded-lg">
            <MessageSquare size={10} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{finalNote}</span>
          </div>
        )}

        {/* Footer: price + actions */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-100">
          <span className="font-black text-base text-gray-900">
            {formatVND(booking.totalAmount)}
          </span>

          <div className="flex items-center gap-1.5">
            {/* Detail button */}
            <button
              onClick={() => onViewDetail(booking)}
              className="p-2 rounded-xl text-gray-400 bg-gray-50 hover:bg-gray-100 transition-colors"
              title="Xem chi tiết"
            >
              <ChevronRight size={14} />
            </button>

            {/* Only show confirm/reject for NEW orders */}
            {isNew && (
              <>
                <button
                  onClick={() => onReject(booking.id)}
                  disabled={isLoading}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 transition-all disabled:opacity-50"
                >
                  <XCircle size={12} /> Từ chối
                </button>
                <button
                  onClick={() => onConfirm(booking.id)}
                  disabled={isLoading}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 shadow-sm shadow-emerald-200 transition-all disabled:opacity-50"
                >
                  <CheckCircle2 size={12} /> Xác nhận
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default WebBookingCard;
