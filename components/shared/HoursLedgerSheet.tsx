'use client';

import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { fmtHours, fmtShortDate } from '@/lib/hours-format';

/**
 * Một dòng sổ giờ. Cùng hình dạng ở mọi nơi vì đều lấy từ
 * `KtvOfficeScoreService.hoursLedger` — trang Xếp Hạng Giờ, trang Lịch Sử và màn
 * Office của quầy không bao giờ được ra số khác nhau.
 */
export interface HoursLedgerEntry {
  id: string;
  date: string;
  earned: number;
  penalty: number;
  /** Số dư dồn của cả tháng tính tới dòng này. */
  balance: number;
  note: string | null;
  /** Có giá trị nghĩa là dòng PHẠT, không phải tua làm. */
  penaltyLabel: string | null;
  orderCode: string | null;
}

interface Props {
  /** Dòng phụ dưới tiêu đề — mỗi trang tự nói phạm vi mình đang xem. */
  subtitle: string;
  earned: number;
  penalty: number;
  net: number;
  rows: HoursLedgerEntry[];
  /** Chữ nhỏ dưới ba ô tổng, ví dụ tổng của cả tháng để đối chiếu. */
  note?: React.ReactNode;
  emptyText?: string;
  onClose: () => void;
}

/**
 * Sổ giờ chi tiết dạng dòng thời gian.
 *
 * Mốc thời gian dọc cho dễ đọc trên điện thoại, và cột "còn lại" chạy dồn để KTV
 * thấy giờ mình lớn dần qua từng tua thay vì chỉ thấy một con số tổng.
 */
export const HoursLedgerSheet = ({
  subtitle, earned, penalty, net, rows, note, emptyText, onClose,
}: Props) => (
  <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center">
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

    <div className="relative bg-white w-full sm:max-w-lg rounded-t-[32px] sm:rounded-[32px] shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">
      <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h3 className="font-black text-slate-900 text-lg leading-tight">Sổ giờ của bạn</h3>
          <p className="text-xs text-slate-400 font-medium mt-0.5">{subtitle}</p>
        </div>
        <button onClick={onClose} aria-label="Đóng" className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
          <X size={18} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 p-5 pb-4 shrink-0">
        <div className="bg-slate-50 rounded-2xl p-3 text-center">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Làm thực</p>
          <p className="text-base font-black tabular-nums mt-1 text-slate-700">{fmtHours(earned)}</p>
        </div>
        <div className="bg-slate-50 rounded-2xl p-3 text-center">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Bị phạt</p>
          <p className={`text-base font-black tabular-nums mt-1 ${penalty > 0 ? 'text-rose-500' : 'text-slate-700'}`}>
            {penalty > 0 ? `− ${fmtHours(penalty)}` : fmtHours(0)}
          </p>
        </div>
        <div className="bg-blue-600 rounded-2xl p-3 text-center">
          <p className="text-[9px] font-bold uppercase tracking-widest text-blue-100">Thực nhận</p>
          <p className="text-base font-black tabular-nums mt-1 text-white">{fmtHours(net)}</p>
        </div>
      </div>

      {note && (
        <div className="px-5 pb-4 shrink-0">
          <p className="text-[11px] text-slate-400 font-medium leading-relaxed bg-slate-50 rounded-2xl px-3 py-2.5">
            {note}
          </p>
        </div>
      )}

      <div className="px-5 shrink-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Dòng thời gian · mới nhất trước
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {rows.length === 0 ? (
          <p className="text-center text-slate-400 text-sm font-medium py-10">
            {emptyText || 'Tháng này chưa có tua nào được ghi sổ.'}
          </p>
        ) : (
          <div className="relative pl-6">
            {/* Sợi dọc của dòng thời gian */}
            <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-slate-100 rounded-full" />

            {rows.map((r) => {
              const isPenalty = !!r.penaltyLabel;
              return (
                <div key={r.id} className="relative pb-4 last:pb-0">
                  <div className={`absolute -left-6 top-1.5 w-4 h-4 rounded-full border-[3px] border-white shadow-sm flex items-center justify-center ${isPenalty ? 'bg-rose-500' : 'bg-blue-500'}`}>
                    {isPenalty && <AlertTriangle size={7} className="text-white" />}
                  </div>

                  <div className={`rounded-2xl p-3 border ${isPenalty ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-100'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                          {fmtShortDate(r.date)}
                        </p>
                        <p className={`text-sm font-bold leading-snug mt-0.5 ${isPenalty ? 'text-rose-700' : 'text-slate-800'}`}>
                          {isPenalty ? r.penaltyLabel : (r.note || 'Tua phục vụ')}
                        </p>
                        {r.orderCode && (
                          <p className="text-[10px] font-mono font-bold text-slate-400 mt-0.5 truncate">{r.orderCode}</p>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <p className={`text-sm font-black tabular-nums ${isPenalty ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {isPenalty ? `− ${fmtHours(r.penalty)}` : `+ ${fmtHours(r.earned)}`}
                        </p>
                        <p className="text-[10px] font-medium text-slate-400 mt-0.5">
                          Còn {fmtHours(r.balance)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-slate-100 shrink-0">
        <button onClick={onClose} className="w-full h-12 rounded-2xl font-black bg-slate-900 text-white active:scale-[0.98] transition-transform">
          Đóng
        </button>
      </div>
    </div>
  </div>
);

export default HoursLedgerSheet;
