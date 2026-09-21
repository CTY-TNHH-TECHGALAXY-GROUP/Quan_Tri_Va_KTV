'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle, ChevronDown, ChevronUp, Dumbbell, Target, Ban } from 'lucide-react';
import { formatBodyAreas, normalizeStrength } from '@/lib/booking.logic';
import { THEME } from './ui';

/** Mảnh UI dùng lại giữa các màn của KTV Dashboard. Không chứa logic nghiệp vụ. */


export function ActionGridButton({ onClick, icon, label, color }: { onClick: () => void, icon: React.ReactNode, label: string, color: string }) {
  return (
    <button
      onClick={onClick}
      className={`bg-white border border-slate-100 p-4 rounded-3xl flex flex-col items-center justify-center gap-2 shadow-sm active:scale-95 transition-all ${color}`}
    >
      <div className="opacity-80">{icon}</div>
      <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
    </button>
  );
}

export function ChecklistItem({ label, checked, onChange }: { label: string, checked: boolean, onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`w-full flex items-center justify-between p-4 ${THEME.radius} border-2 transition-all
      ${checked ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 bg-slate-50/50 hover:border-emerald-200'}`}
    >
      <span className={`text-sm font-bold ${checked ? 'text-emerald-700' : 'text-slate-600'}`}>{label}</span>
      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
        ${checked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 bg-white'}`}>
        {checked && <CheckCircle size={14} />}
      </div>
    </button>
  );
}

export function RatingCard({ icon, title, desc, isSelected, onClick }: { icon: React.ReactNode, title: string, desc: string, isSelected: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 ${THEME.radius} border-2 transition-all flex items-start gap-4
      ${isSelected ? 'border-emerald-500 bg-emerald-50' : 'border-slate-100 bg-white hover:border-emerald-200'}`}
    >
      <div className={`mt-1 ${isSelected ? 'text-emerald-600' : 'text-slate-400'}`}>
        {icon}
      </div>
      <div>
        <h4 className={`font-bold ${isSelected ? 'text-emerald-800' : 'text-slate-800'}`}>{title}</h4>
        <p className={`text-sm ${isSelected ? 'text-emerald-600/80' : 'text-slate-500'}`}>{desc}</p>
      </div>
    </button>
  );
}

export function CollapsibleRequirements({ booking }: { booking: any }) {
  const [isOpen, setIsOpen] = useState(true);
  
  // Lấy đúng item được gán
  const item = booking?.assignedItemId 
    ? booking.BookingItems?.find((i: any) => i.id === booking.assignedItemId)
    : (booking?.BookingItems?.[0] || {});

  if (!booking) return null;

  // Parse dispatcher note to avoid showing raw JSON from AI
  let displayDispatcherNote = booking?.dispatcherNote;
  if (displayDispatcherNote && typeof displayDispatcherNote === 'string') {
    let currentStr = displayDispatcherNote.trim();
    while (currentStr.startsWith('{')) {
      try {
        const parsed = JSON.parse(currentStr);
        if (parsed.receptionNote || parsed.note) {
          currentStr = parsed.receptionNote || parsed.note;
        } else if (parsed.type === 'VIP_APPOINTMENT' || parsed.selectedSkills) {
          currentStr = ''; // Hide raw AI metadata
          break;
        } else if (parsed.type === 'WEB_ADVANCE_BOOKING') {
          currentStr = 'Khách đặt trước qua Web/App Nội Bộ.';
          break;
        } else {
          currentStr = ''; // Hide other raw JSON objects
          break;
        }
      } catch (e) {
        break; // Not a valid JSON string, leave as is
      }
    }
    displayDispatcherNote = currentStr || null;
  }

  const customerNote = item?.customerNote || booking?.customerNote;
  const hasCustomerPrefs = Boolean(item?.strength || item?.focus || item?.avoid || customerNote);
  const hasDispatcherNote = Boolean(displayDispatcherNote);
  const hasKtvNote = Boolean(item?.noteForKtv);

  // Chỉ hiển thị khi có note hoặc yêu cầu chi tiết
  if (!hasCustomerPrefs && !hasDispatcherNote && !hasKtvNote) {
    return null;
  }

  return (
    <div className="border-t border-slate-50 mt-2">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-4 group"
      >
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-emerald-600 transition-colors">
          Yêu cầu chi tiết
        </span>
        <div className="text-slate-300">
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pb-6 space-y-5">
              {/* 1. Yêu cầu của khách */}
              {hasCustomerPrefs && (
                <div className="flex flex-col gap-3">
                  <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest px-1">Từ phía khách hàng</span>
                  <div className="flex flex-wrap gap-2">
                    {/* Giới tính KTV: ẩn vì KTV không cần xem thông tin này */}
                    {item.strength && (
                      <div className="px-4 py-2 bg-orange-50 text-orange-700 rounded-xl text-[13px] font-black border border-orange-100 flex items-center gap-2">
                        <Dumbbell size={16} /> Lực: {normalizeStrength(item.strength)}
                      </div>
                    )}
                    {item.focus && (
                      <div className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-[13px] font-black border border-emerald-100 flex items-center gap-2">
                        <Target size={16} /> Tập trung: {formatBodyAreas(item.focus)}
                      </div>
                    )}
                    {item.avoid && (
                      <div className="px-4 py-2 bg-rose-50 text-rose-700 rounded-xl text-[13px] font-black border border-rose-100 flex items-center gap-2">
                        <Ban size={16} /> Tránh: {formatBodyAreas(item.avoid)}
                      </div>
                    )}
                  </div>
                  {customerNote && (
                    <div className="bg-slate-50 p-3.5 rounded-2xl text-xs text-slate-600 font-bold italic border border-slate-100 shadow-sm">
                      &quot;{customerNote}&quot;
                    </div>
                  )}
                </div>
              )}

              {/* 2. Ghi chú của quầy */}
              {displayDispatcherNote && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Ghi chú của quầy</span>
                  <div className="bg-slate-50 p-3.5 rounded-2xl text-xs text-slate-600 font-medium whitespace-pre-wrap border border-slate-100 shadow-sm leading-relaxed break-words overflow-hidden">
                    {displayDispatcherNote}
                  </div>
                </div>
              )}

              {/* 3. Ghi chú cho KTV */}
              {item.noteForKtv && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest px-1">Ghi chú cho kỹ thuật viên</span>
                  <div className="bg-rose-50/50 p-3.5 rounded-2xl text-xs text-rose-700 font-bold border border-rose-100 whitespace-pre-wrap shadow-sm leading-relaxed">
                    {item.noteForKtv}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
