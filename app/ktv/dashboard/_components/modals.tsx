'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X, AlertTriangle, Camera, Trash2, Loader2, ShieldAlert, Crown, BookOpen,
  Clock, CheckCircle2, XCircle, Ban, CalendarDays, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { shiftMonth, currentMonthVn } from '@/lib/hours-format';
import { ROOM_ISSUE_OPTIONS } from '../KTVDashboard.logic';
import { useToast } from '@/components/ui/Toast';
import { roomLabel } from '@/lib/room-label';
import { fmtHours } from '@/lib/hours-format';
import { THEME } from '../_shared/ui';
import { FeatureMaintenanceNotice } from '@/components/shared/FeatureMaintenanceNotice';

/** Các hộp thoại của KTV Dashboard. Mỗi cái tự quản state riêng, nhận dữ liệu qua props. */


export function ProcedureModal({ isOpen, onClose, procedure, serviceName, isVip }: { isOpen: boolean, onClose: () => void, procedure: any, serviceName: string, isVip?: boolean }) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
       <motion.div 
         initial={{ opacity: 0, scale: 0.9, y: 30 }}
         animate={{ opacity: 1, scale: 1, y: 0 }}
         className="bg-white w-full max-w-lg max-h-[80vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col"
       >
          <div className="bg-emerald-600 p-8 text-white flex items-center justify-between">
             <div>
                <h3 className="text-xl font-black uppercase tracking-tight">{serviceName}</h3>
                <p className="text-[10px] font-bold text-emerald-100 uppercase tracking-widest mt-1">Quy trình thực hiện chuẩn</p>
             </div>
             <button onClick={onClose} className="bg-white/20 p-2 rounded-full hover:bg-white/30 transition-colors">
                <X size={24} />
             </button>
          </div>
          <div className="flex-1 overflow-y-auto p-8 font-bold text-slate-600 leading-relaxed text-sm">
             {isVip ? (
                 <div className="space-y-4">
                     <div className="flex gap-4">
                        <span className="text-emerald-500 font-black">01.</span>
                        <p>Làm theo: {serviceName}</p>
                     </div>
                 </div>
             ) : procedure ? (
                <div className="space-y-4">
                   {Array.isArray(procedure) ? (
                      procedure.map((step: string, idx: number) => (
                         <div key={idx} className="flex gap-4">
                            <span className="text-emerald-500 font-black">{(idx + 1).toString().padStart(2, '0')}.</span>
                            <p>{step}</p>
                         </div>
                      ))
                   ) : (
                      <p className="whitespace-pre-line">{procedure}</p>
                   )}
                </div>
             ) : (
                <p className="italic text-slate-400 text-center py-10">Quy trình đang được cập nhật...</p>
             )}
          </div>
          <div className="p-8 border-t border-slate-100">
             <button onClick={onClose} className="w-full bg-slate-900 text-white py-5 rounded-[24px] font-black text-xs uppercase tracking-widest">Đã hiểu quy trình</button>
          </div>
       </motion.div>
    </div>
  );
}

export function RoomIssueModal({
  isOpen, onClose, onSubmit, roomId }: { isOpen: boolean, onClose: () => void, onSubmit: (issues: string[], note: string) => void, roomId: string }) {
  const { addToast } = useToast();
  const [selectedIssues, setSelectedIssues] = React.useState<string[]>([]);
  const [note, setNote] = React.useState('');

  if (!isOpen) return null;

  const toggleIssue = (issue: string) => {
    setSelectedIssues(prev => prev.includes(issue) ? prev.filter(i => i !== issue) : [...prev, issue]);
  };

  const handleSubmit = () => {
    if (selectedIssues.length === 0 && !note.trim()) {
      addToast('Vui lòng chọn hoặc nhập mô tả sự cố!', 'error');
      return;
    }
    onSubmit(selectedIssues, note.trim());
    setSelectedIssues([]);
    setNote('');
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full sm:max-w-md max-h-[90vh] rounded-t-[32px] sm:rounded-[32px] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="bg-rose-600 p-6 text-white flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
              <AlertTriangle size={20} />
              Báo Sự Cố Phòng
            </h3>
            {roomId && <p className="text-[10px] font-bold text-rose-100 uppercase tracking-widest mt-1">Phòng {roomLabel(roomId)}</p>}
          </div>
          <button onClick={onClose} className="bg-white/20 p-2 rounded-full hover:bg-white/30 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Quick Options */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Chọn loại sự cố</p>
          <div className="grid grid-cols-2 gap-2">
            {ROOM_ISSUE_OPTIONS.map((issue) => (
              <button
                key={issue}
                onClick={() => toggleIssue(issue)}
                className={`p-3 rounded-2xl border-2 text-xs font-black text-left transition-all active:scale-95 ${
                  selectedIssues.includes(issue)
                    ? 'border-rose-500 bg-rose-50 text-rose-700'
                    : 'border-slate-100 bg-white text-slate-600 hover:border-rose-200'
                }`}
              >
                {issue}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ghi chú thêm</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Mô tả chi tiết sự cố..."
              className="w-full p-4 rounded-2xl border-2 border-slate-100 focus:border-rose-300 focus:ring-0 outline-none text-sm font-bold text-slate-700 resize-none h-24 placeholder:text-slate-300"
            />
          </div>
        </div>

        {/* Submit */}
        <div className="p-5 border-t border-slate-100 space-y-2">
          <button
            onClick={handleSubmit}
            className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-rose-200 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <ShieldAlert size={16} />
            Gửi báo cáo về Lễ tân
          </button>
          <button
            onClick={onClose}
            className="w-full py-3 text-slate-400 font-bold text-xs uppercase tracking-widest"
          >
            Huỷ
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/** Một dịch vụ của KTV trong đơn — dùng cho ô chọn khi đơn có nhiều dịch vụ. */
export interface RejectableService {
  id: string;
  name: string;
  minutes: number;
}

export function RejectOrderModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  isExempted, 
  disciplineStatus,
  isTypeD = false,
  services = []
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onSubmit: (reason: string, itemId?: string) => void, 
  isExempted: boolean,
  disciplineStatus: any,
  /** Loại D ăn theo quy chế GIỜ TÍCH LŨY, không phải điểm chuyên cần. */
  isTypeD?: boolean,
  /**
   * Các dịch vụ của chính KTV này trong đơn. Nhiều hơn một thì BẮT BUỘC chọn:
   * mức phạt tính theo thời lượng của đúng gói bị từ chối, nên gói 30 phút và
   * gói 90 phút ra hai mức phạt khác hẳn nhau. Để hệ thống tự đoán là KTV bị
   * trừ số giờ không ai giải thích được.
   */
  services?: RejectableService[]
}) {
  const { addToast } = useToast();
  const [reason, setReason] = React.useState('');
  const mustPick = services.length > 1;
  const [pickedId, setPickedId] = React.useState<string>('');

  // Mở lại modal cho đơn khác thì bỏ lựa chọn cũ.
  React.useEffect(() => {
    if (!isOpen) { setPickedId(''); setReason(''); }
  }, [isOpen]);

  const multiplier = disciplineStatus?.rejectMultiplier ?? 3;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full sm:max-w-md max-h-[90vh] rounded-t-[32px] sm:rounded-[32px] shadow-2xl overflow-hidden flex flex-col"
      >
        <div className={`${(isExempted && !isTypeD) ? 'bg-emerald-600' : 'bg-rose-600'} p-6 text-white flex items-center justify-between`}>
          <div>
            <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
              <Ban size={20} />
              Từ Chối Nhận Đơn
            </h3>
          </div>
          <button onClick={onClose} className="bg-white/20 p-2 rounded-full hover:bg-white/30 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isTypeD ? (
            /* Loại D: trừ GIỜ TÍCH LŨY, và có cửa chặn hạn mức. Không có miễn
               phạt theo giờ làm liên tục — cái đó thuộc hệ điểm của A/B/C. */
            <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl text-rose-800 text-sm font-bold flex gap-3 items-start">
               <ShieldAlert size={20} className="shrink-0 text-rose-600 mt-0.5" />
               <div className="space-y-1.5">
                 <p>
                   ⚠️ Từ chối tua sẽ bị trừ <b>{disciplineStatus?.rejectMultiplier ?? 3} lần thời lượng gói</b> vào
                   giờ tích lũy (gói 60 phút → trừ {disciplineStatus?.rejectMultiplier ?? 3} giờ).
                 </p>
                 <p>
                   Quỹ giờ phải <b>nhiều hơn {disciplineStatus?.minHoursToReject ?? 3} giờ</b> mới được từ chối.
                   Chưa đủ mà vẫn từ chối thì <b>tài khoản bị khoá</b>.
                 </p>
               </div>
            </div>
          ) : isExempted ? (
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl text-emerald-800 text-sm font-bold flex gap-3 items-start">
               <ShieldAlert size={20} className="shrink-0 text-emerald-600 mt-0.5" />
               <p>
                 ✅ Bạn đã làm việc liên tục {Math.floor((disciplineStatus?.continuousWorkMins || 0) / 60)}h {(disciplineStatus?.continuousWorkMins || 0) % 60}m (đạt ngưỡng miễn phạt). <br/>
                 Bạn có thể từ chối đơn này để nghỉ ngơi mà <b>KHÔNG bị trừ điểm.</b>
               </p>
            </div>
          ) : (
            <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl text-rose-800 text-sm font-bold flex gap-3 items-start">
               <ShieldAlert size={20} className="shrink-0 text-rose-600 mt-0.5" />
               <p>
                 ⚠️ Từ chối nhận đơn sẽ bị <b>trừ 10 điểm chuyên cần</b>.<br/> 
                 Việc này sẽ ảnh hưởng trực tiếp đến thi đua và cấp bậc KTV của bạn!
               </p>
            </div>
          )}

          {mustPick && (
            <div className="space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Đơn này có {services.length} dịch vụ của bạn — chọn dịch vụ muốn từ chối
              </p>
              <div className="space-y-2">
                {services.map(sv => (
                  <button
                    key={sv.id}
                    onClick={() => setPickedId(sv.id)}
                    className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all ${
                      pickedId === sv.id
                        ? 'border-rose-400 bg-rose-50'
                        : 'border-slate-100 bg-white active:scale-[0.99]'
                    }`}
                  >
                    <p className="text-sm font-black text-slate-700">{sv.name}</p>
                    <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                      {sv.minutes} phút
                      {isTypeD && ` · từ chối sẽ trừ ${Math.round((sv.minutes / 60) * multiplier * 100) / 100} giờ tích lũy`}
                    </p>
                  </button>
                ))}
              </div>
              <p className="text-[11px] font-bold text-slate-400">
                Chỉ dịch vụ được chọn bị từ chối. Các dịch vụ còn lại bạn vẫn phải làm.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Lý do từ chối (bắt buộc)</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="VD: Sức khoẻ không đảm bảo, kẹt xe..."
              className="w-full p-4 rounded-2xl border-2 border-slate-100 focus:border-indigo-300 focus:ring-0 outline-none text-sm font-bold text-slate-700 resize-none h-24 placeholder:text-slate-300"
            />
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 space-y-2">
          <button
            onClick={() => {
               if (mustPick && !pickedId) {
                 return addToast('Hãy chọn dịch vụ bạn muốn từ chối.', 'error');
               }
               if (!reason.trim()) return addToast('Vui lòng nhập lý do từ chối!', 'error');
               onSubmit(reason, mustPick ? pickedId : services[0]?.id);
            }}
            className={`w-full py-4 ${isExempted ? 'bg-emerald-600 shadow-emerald-200' : 'bg-rose-600 shadow-rose-200'} text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2`}
          >
            Xác nhận từ chối đơn
          </button>
          <button
            onClick={onClose}
            className="w-full py-3 text-slate-400 font-bold text-xs uppercase tracking-widest"
          >
            Huỷ, tôi sẽ nhận đơn
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function TurnQueueTypeDModal({ isOpen, onClose, turnData, ktvId }: { isOpen: boolean, onClose: () => void, turnData: any, ktvId: string }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white w-full max-w-sm rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="p-6 bg-gradient-to-br from-blue-500 to-indigo-600 text-white relative flex-shrink-0">
          <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-white/10 rounded-full text-white/80 hover:text-white hover:bg-white/20 transition-colors">
            <X size={20} />
          </button>
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-4">
            <Clock size={24} className="text-white" />
          </div>
          <h2 className="text-2xl font-black mb-1">Thứ tự tua</h2>
          <p className="text-blue-100 text-xs font-medium opacity-90">Sổ hàng đợi tua được sắp xếp theo thời gian làm việc trong tháng.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 bg-slate-50">
          <div className="space-y-2">
            {turnData.allTypeD?.map((ktv: any, idx: number) => {
              const isMe = ktv.employee_id === ktvId;
              return (
                <div 
                  key={ktv.employee_id} 
                  className={`flex items-center justify-between p-4 rounded-2xl border ${
                    isMe 
                      ? 'bg-blue-50 border-blue-200 shadow-md shadow-blue-100/50' 
                      : 'bg-white border-slate-100 shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black ${
                      idx === 0 ? 'bg-amber-100 text-amber-600' : 
                      idx === 1 ? 'bg-slate-200 text-slate-600' :
                      idx === 2 ? 'bg-orange-100 text-orange-600' :
                      'bg-slate-100 text-slate-400'
                    }`}>
                      #{idx + 1}
                    </div>
                    <div>
                      <p className={`text-sm font-bold ${isMe ? 'text-blue-700' : 'text-slate-700'}`}>
                        {ktv.staff_name || ktv.employee_id} {isMe && <span className="text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded ml-1">BẠN</span>}
                      </p>
                      <p className="text-[10px] font-medium text-slate-400">{ktv.employee_id}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-black text-lg ${isMe ? 'text-blue-600' : 'text-slate-600'}`}>
                      {/* ⚠️ Phải dùng chung fmtHours với ô "Thứ tự tua" ngoài trang.
                          Bản viết tay ở đây dùng Math.floor — với số ÂM nó làm tròn
                          XUỐNG (xa số 0), nên −0.23 giờ (tức −14 phút) ra
                          Math.floor = −1 và phần dư thành +46 phút → hiện "−1h 46P".
                          Cùng một người, ngoài trang ghi −0h14P mà mở bảng ra thành
                          −1h46P. */}
                      {fmtHours(ktv.net_hours || 0)}
                    </p>
                    <p className="text-[9px] uppercase tracking-widest text-slate-400 font-bold">Giờ làm</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/** Ngày đầy đủ cho ô chọn ngày: '2026-09-05' → '05/09/2026'. */
function fmtDayFull(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Lịch chọn ngày trong tháng.
 *
 * Tuần bắt đầu THỨ 2 cho khớp cách người Việt đọc lịch: `getUTCDay()` trả CN = 0
 * nên phải dịch đi, nếu không cả lưới lệch một ô.
 */
function MonthCalendar({ month, byDate, selected, today, onPick }: {
  month: string;
  byDate: Record<string, any>;
  selected: string;
  today: string;
  onPick: (iso: string) => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(d => (
          <div key={d} className="text-center text-[9px] font-black uppercase text-slate-300 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstWeekday }).map((_, i) => <div key={`pad-${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const iso = `${month}-${String(day).padStart(2, '0')}`;
          const entry = byDate[iso];
          const isSelected = iso === selected;
          // Ngày không đi làm vẫn bấm được — bấm vào để thấy rõ "ngày này bạn không
          // đi làm", đỡ phải hỏi quầy.
          const tone = isSelected
            ? 'bg-indigo-600 text-white shadow-md'
            : !entry
              ? 'bg-slate-50 text-slate-300'
              : entry.hits.length > 0
                ? 'bg-rose-50 text-rose-600 border border-rose-100'
                : 'bg-emerald-50 text-emerald-600 border border-emerald-100';

          return (
            <button
              key={iso}
              onClick={() => onPick(iso)}
              className={`aspect-square rounded-xl text-xs font-black flex flex-col items-center justify-center ${tone} ${iso === today && !isSelected ? 'ring-2 ring-indigo-400' : ''}`}
            >
              {day}
              {entry && entry.hits.length > 0 && (
                <span className={`text-[8px] font-bold leading-none ${isSelected ? 'text-white/80' : ''}`}>
                  {entry.dayScore}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Xem ảnh minh chứng của một phiếu trừ điểm Office.
 *
 * Nằm trên modal Office (z cao hơn) và nuốt click nền để bấm ra ngoài chỉ đóng
 * ảnh, không đóng luôn cả bảng điểm phía sau.
 */
function EvidenceViewer({ hit, onClose }: { hit: any, onClose: () => void }) {
  const urls: string[] = hit?.photoUrls || [];
  const [idx, setIdx] = useState(0);
  const i = Math.min(idx, Math.max(0, urls.length - 1));

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-[28px] overflow-hidden shadow-2xl flex flex-col"
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-800 truncate">{hit.label}</p>
            <p className="text-[11px] font-bold text-slate-400">
              Ảnh minh chứng{urls.length > 1 ? ` ${i + 1}/${urls.length}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="relative bg-slate-900 aspect-[3/4] flex items-center justify-center">
          {urls.length === 0
            ? <p className="text-xs font-bold text-slate-400">Không có ảnh</p>
            : <img src={urls[i]} alt={`Ảnh minh chứng ${i + 1}`} className="w-full h-full object-contain" />}

          {urls.length > 1 && (
            <>
              <button
                onClick={() => setIdx(i > 0 ? i - 1 : urls.length - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => setIdx(i < urls.length - 1 ? i + 1 : 0)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center"
              >
                <ChevronRight size={18} />
              </button>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 px-3 py-1.5 rounded-full bg-black/40">
                {urls.map((_, k) => (
                  <i key={k} className={`w-1.5 h-1.5 rounded-full ${k === i ? 'bg-white' : 'bg-white/40'}`} />
                ))}
              </div>
            </>
          )}
        </div>

        {hit.note && <p className="px-4 py-3 text-[11px] text-slate-500 font-medium border-t border-slate-100">{hit.note}</p>}
      </motion.div>
    </div>
  );
}

export function OfficeScoreModal({ data, onClose }: { data: any, onClose: () => void }) {
  const today = data.today;
  // Tháng và ngày đang xem tự quản trong modal. Dashboard chỉ đưa dữ liệu tháng
  // hiện tại làm điểm khởi đầu; tra tháng cũ thì modal tự gọi API.
  const initialMonth = data.month || today.slice(0, 7);
  const [month, setMonth] = useState<string>(initialMonth);
  const [view, setView] = useState<any>(data);
  // Points wallet switched off while the modal is open (server says disabled):
  // show the maintenance notice instead of keeping the previous month's numbers.
  const [disabled, setDisabled] = useState(false);
  const [selected, setSelected] = useState<string>(today);
  const [showCalendar, setShowCalendar] = useState(false);
  const [loading, setLoading] = useState(false);
  // Phiếu trừ đang mở ảnh minh chứng. null = không mở.
  const [evidence, setEvidence] = useState<any>(null);

  const thisMonth = currentMonthVn();

  React.useEffect(() => {
    // Tháng đang xem trùng tháng dashboard đã tải sẵn thì dùng lại, khỏi gọi API.
    if (month === initialMonth) { setView(data); return; }
    let alive = true;
    setLoading(true);
    apiClient.get<any>(`/api/ktv/office-score?month=${month}`)
      .then(res => {
        if (!alive) return;
        if (res?.disabled) { setDisabled(true); setView(null); return; }
        if (res?.data) setView(res.data);
      })
      .catch(() => { if (alive) setView(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [month, initialMonth, data]);

  const byDate: Record<string, any> = {};
  (view?.days || []).forEach((d: any) => { byDate[d.workDate] = d; });

  const entry = byDate[selected];
  const isToday = selected === today;
  // Ngày đi làm mà không có phiếu trừ nào vẫn là 100 — đúng nguyên tắc "bắt đầu
  // từ 100, trừ dần". Ngày không đi làm thì không có điểm để hiện.
  const dayScore = entry ? entry.dayScore : (isToday ? (view?.todayScore ?? 100) : null);
  const hits = entry ? entry.hits : (isToday ? (view?.todayHits || []) : []);
  // Phiếu đã được quản lý hoàn điểm trong đúng ngày đang xem. Giữ lại cho KTV
  // thấy "trừ rồi hoàn", chứ phiếu tự biến mất thì họ không biết đã được xử lý.
  const revokedHits = (view?.revokedHits || []).filter((h: any) => h.workDate === selected);

  const changeMonth = (delta: number) => {
    const next = shiftMonth(month, delta);
    if (next > thisMonth) return;
    setMonth(next);
    // Nhảy tháng thì chọn ngày 1, trừ khi quay về tháng này thì về hôm nay.
    setSelected(next === thisMonth ? today : `${next}-01`);
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="bg-white w-full sm:max-w-md max-h-[85vh] rounded-t-[32px] sm:rounded-[32px] shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-black text-slate-800">Điểm Office</h3>
            <p className="text-[11px] text-slate-400 font-bold">
              {loading ? 'Đang tải…' : `${view?.workDays ?? 0} ngày đi làm trong tháng ${month}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Ô ngày kiêm nút mở lịch — ngày đang xem hiện ngay tại đây nên các ô
                bên dưới không phải lặp lại nó nữa. */}
            <button
              onClick={() => setShowCalendar(v => !v)}
              title="Chọn ngày"
              className={`h-9 pl-3 pr-2 rounded-xl border flex items-center gap-2 transition-colors ${
                showCalendar
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300'
              }`}
            >
              <span className="text-xs font-black tabular-nums">{fmtDayFull(selected)}</span>
              <CalendarDays size={16} className={showCalendar ? 'text-white' : 'text-indigo-500'} />
            </button>
            <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {disabled ? <FeatureMaintenanceNotice /> : <>
          {showCalendar && (
            <div className="bg-slate-50 rounded-2xl p-3">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => changeMonth(-1)} className="w-8 h-8 rounded-lg bg-white text-slate-500 flex items-center justify-center shadow-sm">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs font-black text-slate-600">Tháng {month}</span>
                <button
                  onClick={() => changeMonth(1)}
                  disabled={month >= thisMonth}
                  className="w-8 h-8 rounded-lg bg-white text-slate-500 flex items-center justify-center shadow-sm disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {loading
                ? <p className="py-8 text-center text-slate-400 text-xs font-bold">Đang tải…</p>
                : <MonthCalendar month={month} byDate={byDate} selected={selected} today={today} onPick={iso => { setSelected(iso); setShowCalendar(false); }} />}

              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-200">
                <div className="flex items-center gap-2 text-[9px] font-bold text-slate-400">
                  <span className="flex items-center gap-1"><i className="w-2 h-2 rounded bg-emerald-200" /> Không lỗi</span>
                  <span className="flex items-center gap-1"><i className="w-2 h-2 rounded bg-rose-200" /> Có lỗi</span>
                  <span className="flex items-center gap-1"><i className="w-2 h-2 rounded bg-slate-200" /> Nghỉ</span>
                </div>
                <button
                  onClick={() => { setMonth(thisMonth); setSelected(today); setShowCalendar(false); }}
                  className="text-[10px] font-black uppercase tracking-widest text-indigo-600 shrink-0"
                >Hôm nay</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-2xl p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {isToday ? 'Hôm nay' : 'Điểm ngày'}
              </p>
              <p className="text-2xl font-black text-slate-800 mt-1">
                {dayScore === null ? '—' : `${dayScore}/100`}
              </p>
              <p className="text-[11px] text-slate-400 font-bold mt-1">
                {dayScore === null
                  ? 'Ngày này bạn không đi làm'
                  : hits.length === 0 ? 'Chưa bị trừ lỗi nào' : `${hits.length} lỗi bị trừ`}
              </p>
            </div>
            <div className="bg-slate-50 rounded-2xl p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Trung bình tháng</p>
              {/* Chưa có ngày công thì trung bình không có mẫu số. */}
              {view?.hasData === false ? (
                <>
                  <p className="text-2xl font-black text-slate-400 mt-1">—</p>
                  <p className="text-[11px] font-medium text-slate-400 mt-0.5">Chưa có dữ liệu</p>
                </>
              ) : (
                <p className="text-2xl font-black text-slate-800 mt-1">{view?.monthScore ?? '—'}</p>
              )}
            </div>
          </div>

          {view && view.hasData === false && (
            <div className="rounded-2xl p-4 border bg-slate-50 border-slate-200">
              <p className="text-[11px] font-bold text-slate-500">Quỹ nội bộ tháng {month}</p>
              <p className="text-xl font-black mt-1 text-slate-400">Chưa có dữ liệu</p>
              <p className="text-[11px] text-slate-500 font-medium mt-1">
                Tháng này bạn chưa có ngày công nào — điểm và mức quỹ sẽ hiện sau buổi đi làm đầu tiên.
              </p>
            </div>
          )}

          {view && view.hasData !== false && (
            <div className={`rounded-2xl p-4 border ${view.fundDue === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className="text-[11px] font-bold text-slate-500">Quỹ nội bộ tháng {month} bạn phải đóng</p>
              <p className={`text-xl font-black mt-1 ${view.fundDue === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                {view.fundDue.toLocaleString('vi-VN')}đ
              </p>
              <p className="text-[11px] text-slate-500 font-medium mt-1">
                {view.exemptPct > 0 ? `Đã được miễn ${view.exemptPct}% trên quỹ gốc 250.000đ` : 'Chưa đạt mức được miễn'}
              </p>
            </div>
          )}

          {hits.length > 0 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Lỗi bị trừ {isToday ? 'hôm nay' : 'trong ngày'}
              </p>
              <div className="space-y-2">
                {hits.map((h: any, i: number) => (
                  <div key={i} className="bg-rose-50 border border-rose-100 rounded-2xl p-3">
                    <div className="flex justify-between gap-3">
                      <span className="text-sm font-bold text-rose-800">{h.label}</span>
                      <span className="text-sm font-black text-rose-600 shrink-0">−{h.points}đ</span>
                    </div>
                    {h.note && <p className="text-[11px] text-slate-500 mt-1">{h.note}</p>}
                    {h.photoCount > 0 && (
                      (h.photoUrls || []).length > 0
                        ? (
                          <button
                            onClick={() => setEvidence(h)}
                            className="text-[11px] font-black text-rose-600 underline underline-offset-2 mt-1"
                          >📷 Xem {h.photoCount} ảnh minh chứng</button>
                        )
                        : <p className="text-[11px] text-slate-400 font-bold mt-1">📷 {h.photoCount} ảnh minh chứng</p>
                    )}
                    {/* Phiếu ghi trước bản vá "ảnh theo từng lỗi" dùng chung một
                        rổ ảnh cho mọi lỗi trong ngày. Nói thẳng ra, đừng để KTV
                        tưởng mình bị chụp riêng từng lỗi bằng ấy lần. */}
                    {h.sharedPhotos && (
                      <p className="text-[10px] text-slate-400 font-medium mt-1">
                        Ảnh dùng chung cho các lỗi cùng ngày (phiếu chấm đợt cũ).
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {revokedHits.length > 0 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Đã hoàn điểm
              </p>
              <div className="space-y-2">
                {revokedHits.map((h: any, i: number) => (
                  <div key={i} className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
                    <div className="flex justify-between gap-3">
                      <span className="text-sm font-bold text-slate-500 line-through">{h.label}</span>
                      <span className="text-sm font-black text-emerald-600 shrink-0">+{h.points}đ</span>
                    </div>
                    <p className="text-[11px] text-emerald-700 font-bold mt-1">
                      Đã hoàn lại {h.points}đ — phiếu này được thu hồi
                    </p>
                    {h.revokeReason && <p className="text-[11px] text-slate-500 mt-0.5">Lý do: {h.revokeReason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(view?.repeats || []).length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
              <p className="text-[11px] font-black text-amber-800 uppercase tracking-widest mb-1">Lỗi lặp lại</p>
              {view.repeats.map((r: any) => (
                <p key={r.criteriaId} className="text-[12px] text-amber-800 font-medium">
                  {r.label} — lặp {r.times} lần, bị trừ thêm {r.points}đ vào điểm tháng
                </p>
              ))}
            </div>
          )}

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Mỗi ngày đi làm bắt đầu từ 100 điểm, trừ dần theo lỗi trong ngày đó. Điểm tháng là trung bình các ngày đi làm.
            Cùng một lỗi bị trừ từ 3 lần trong tháng sẽ bị trừ thêm một lần nữa vào điểm tháng.
          </p>
          </>}
        </div>
      </motion.div>

      <AnimatePresence>
        {evidence && <EvidenceViewer hit={evidence} onClose={() => setEvidence(null)} />}
      </AnimatePresence>
    </div>
  );
}
