'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, PauseCircle, PlayCircle, UserMinus, UserPlus, Clock, AlertTriangle } from 'lucide-react';
import { PendingOrder, StaffData } from '../types';
import { WORK_TYPE_LABELS } from '@/lib/constants/staff.constants';
import { workedMsOf } from '@/lib/segment-time';
import { fmtHours } from '@/lib/hours-format';

/**
 * Chặng này còn đang làm dở chưa?
 *
 * ⚠️ Mốc đã xong là `actualEndTime`, KHÔNG phải `endTime`.
 * `endTime` là GIỜ DỰ KIẾN dạng "21:19", được ghi ngay lúc điều phối cho mọi
 * chặng. Lọc bằng `!seg.endTime` thì chuỗi "21:19" luôn truthy — mọi KTV đều
 * bị coi là đã xong, danh sách "KTV bị phạt" rỗng trơn và không ai đổi được
 * người. Đây là lỗi có thật, quan sát 10/09/2026 trên đơn WB-10092026-016.
 */
const conDangLam = (seg: any) => !seg?.actualEndTime;

interface PauseSwapKtvModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: PendingOrder | null;
  subOrder?: any;
  availableKtvs: StaffData[];
  onConfirm: (
    bookingItemId: string,
    action: 'PAUSE' | 'RESUME' | 'SWAP',
    oldKtvId?: string,
    newKtvId?: string,
    extraTimeMins?: number,
    keepTurnForOldKtv?: boolean,
    assignedMins?: number
  ) => Promise<void>;
  /**
   * Mở thẳng vào một hành động, bỏ bước chọn.
   * Thẻ Kanban của đơn tạm dừng đã có sẵn nút riêng cho từng việc, nên khi bấm
   * "Đổi" thì vào luôn phần đổi KTV — không bắt lễ tân chọn lại lần nữa.
   */
  lockAction?: 'SWAP';
}

export default function PauseSwapKtvModal({ isOpen, onClose, order, subOrder, availableKtvs, onConfirm, lockAction }: PauseSwapKtvModalProps) {
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [selectedOldKtv, setSelectedOldKtv] = useState<string>('');
  const [selectedNewKtv, setSelectedNewKtv] = useState<string>('');
  const [extraTimeMins, setExtraTimeMins] = useState<number>(0);
  // 'REMAIN' = KTV mới làm phần còn lại (+ giờ bù). 'MANUAL' = quầy gán tay số phút.
  const [timeMode, setTimeMode] = useState<'REMAIN' | 'MANUAL'>('REMAIN');
  const [manualMins, setManualMins] = useState<number>(0);
  const [keepTurnForOldKtv, setKeepTurnForOldKtv] = useState<boolean>(false);
  const [actionType, setActionType] = useState<'PAUSE' | 'RESUME' | 'SWAP'>('PAUSE');
  const [loading, setLoading] = useState(false);

  const activeServices = (subOrder?.services || order?.services || []).filter((s: any) => 
    s.status === 'IN_PROGRESS' || s.status === 'PAUSED'
  );

  // Auto-select based on single item or subOrder
  React.useEffect(() => {
    if (isOpen && activeServices.length > 0) {
      if (activeServices.length === 1) {
        setSelectedServiceId(activeServices[0].id);
      } else if (subOrder?.services?.length > 0) {
        setSelectedServiceId(subOrder.services[0].id);
      }
      
      if (subOrder?.ktvIds?.length > 0) {
        setSelectedOldKtv(subOrder.ktvIds[0]);
      }
    }
  }, [isOpen, subOrder, activeServices.length]);

  // Auto-select old KTV if there is only 1 working on this service
  React.useEffect(() => {
    if (isOpen && selectedServiceId) {
      const ktvs = activeServices.find((s: any) => s.id === selectedServiceId)?.staffList.filter((staff: any) => 
        staff.segments.some(conDangLam)
      ) || [];
      if (ktvs.length === 1) {
        setSelectedOldKtv(ktvs[0].ktvId);
      }
    }
  }, [isOpen, selectedServiceId, activeServices]);

  const selectedService = activeServices.find((s: any) => s.id === selectedServiceId);
  const isPaused = selectedService?.status === 'PAUSED';

  // Mở từ nút "Đổi" của thẻ tạm dừng → vào thẳng phần đổi KTV.
  React.useEffect(() => {
    if (isOpen && lockAction === 'SWAP' && isPaused) setActionType('SWAP');
  }, [isOpen, lockAction, isPaused, selectedServiceId]);

  // Find KTVs currently working on the selected service
  const currentKtvs = selectedService?.staffList.filter((staff: any) =>
    staff.segments.some(conDangLam)
  ) || [];

  // ── Số phút KTV mới sẽ nhận khi chọn "Làm phần còn lại" ──────────────
  // Phải ra ĐÚNG con số mà swapKtvOnPausedItem tính ở server:
  //   max(0, thời lượng dịch vụ − giờ KTV cũ đã làm thật) + giờ bù
  // Giờ làm thật chốt tại MỐC BẤM DỪNG (`pauseStart`), không phải bây giờ —
  // khoảng quầy ngồi cân nhắc là KTV không làm, xem lib/counter-action-log.ts.
  const changKtvCu = currentKtvs
    .find((st: any) => st.ktvId === selectedOldKtv)?.segments?.find(conDangLam);
  const mocChot = selectedService?.pauseStart || Date.now();
  const msDaLam = changKtvCu ? workedMsOf(changKtvCu, mocChot) : null;
  const phutDaLam = msDaLam == null ? null : Math.round(msDaLam / 60000);
  const tongThoiLuong = selectedService?.duration || 0;
  const phutConLai = phutDaLam == null
    ? null
    : Math.max(0, tongThoiLuong - phutDaLam) + (Number(extraTimeMins) || 0);

  const handleConfirm = async () => {
    if (!selectedServiceId) return;
    
    setLoading(true);
    try {
      if (actionType === 'SWAP') {
        if (!selectedOldKtv) {
          alert('Vui lòng chọn KTV cần rút/đổi!');
          return;
        }
        if (selectedService && extraTimeMins > selectedService.duration) {
          alert(`Thời gian bù thêm không được vượt quá thời gian của dịch vụ (${selectedService.duration} phút)`);
          return;
        }
        await onConfirm(
          selectedServiceId, 'SWAP', selectedOldKtv, selectedNewKtv || undefined,
          timeMode === 'MANUAL' ? 0 : extraTimeMins,
          false,
          timeMode === 'MANUAL' ? manualMins : 0
        );
      } else {
        await onConfirm(selectedServiceId, actionType, undefined, undefined, undefined, false);
      }
      onClose();
    } catch (err: any) {
      alert(err.message || 'Có lỗi xảy ra');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 overflow-hidden"
          >
            <div className="flex items-center justify-between pb-4 border-b">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <PauseCircle className="text-amber-500" />
                Quản lý Tạm dừng & Đổi KTV
              </h3>
              <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div className="mt-6 space-y-5">
              {/* Chọn Dịch vụ */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Chọn Dịch vụ Đang làm / Tạm ngưng</label>
                <select 
                  className={`w-full border-2 border-gray-200 rounded-xl p-3 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none font-medium transition-all ${activeServices.length === 1 ? 'bg-gray-100 text-gray-600' : ''}`}
                  value={selectedServiceId}
                  onChange={(e) => {
                    setSelectedServiceId(e.target.value);
                    setActionType(lockAction === 'SWAP' ? 'SWAP' : 'PAUSE');
                    setSelectedOldKtv('');
                  }}
                  disabled={activeServices.length === 1}
                >
                  <option value="">-- Chọn dịch vụ --</option>
                  {activeServices.map((svc: any) => (
                    <option key={svc.id} value={svc.id}>
                      {svc.serviceName} ({svc.status === 'PAUSED' ? 'Đang tạm ngưng' : 'Đang làm'})
                    </option>
                  ))}
                </select>
              </div>

              {selectedServiceId && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  {/* lockAction: đã biết muốn làm gì rồi thì không hiện lại hàng nút chọn. */}
                  <div className={`flex gap-3 mb-4 ${lockAction === 'SWAP' && isPaused ? 'hidden' : ''}`}>
                    {!isPaused ? (
                      <button
                        onClick={() => setActionType('PAUSE')}
                        className={`flex-1 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 border-2 transition-all ${
                          actionType === 'PAUSE' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-amber-200'
                        }`}
                      >
                        <PauseCircle size={18} />
                        Tạm dừng
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => setActionType('RESUME')}
                          className={`flex-1 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 border-2 transition-all ${
                            actionType === 'RESUME' ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-600 border-gray-200 hover:border-green-200'
                          }`}
                        >
                          <PlayCircle size={18} />
                          Tiếp tục
                        </button>
                        <button
                          onClick={() => setActionType('SWAP')}
                          className={`flex-1 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 border-2 transition-all ${
                            actionType === 'SWAP' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-200'
                          }`}
                        >
                          <UserMinus size={18} />
                          Đổi KTV
                        </button>
                      </>
                    )}
                  </div>

                  {/* UI Đổi KTV */}
                  {actionType === 'SWAP' && isPaused && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-4"
                    >
                      <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium flex gap-2">
                        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                        KTV bị đổi MẤT HẾT tiền tua, giờ tích luỹ và lượt tua — kể cả phần đã làm. Tên vẫn được giữ trong đơn kèm số phút đã làm để đối soát.
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                            <UserMinus size={14} /> KTV Bị phạt
                          </label>
                          <select 
                            className={`w-full border-2 border-gray-200 rounded-lg p-2 text-sm focus:border-rose-500 outline-none font-medium ${currentKtvs.length === 1 ? 'bg-gray-100 text-gray-600' : ''}`}
                            value={selectedOldKtv}
                            onChange={(e) => setSelectedOldKtv(e.target.value)}
                            disabled={currentKtvs.length === 1}
                          >
                            <option value="">-- Chọn --</option>
                            {currentKtvs.map((staff: any) => (
                              <option key={staff.ktvId} value={staff.ktvId}>{staff.ktvName || staff.ktvId}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                            <UserPlus size={14} /> KTV Vào thay
                          </label>
                          <select 
                            className="w-full border-2 border-gray-200 rounded-lg p-2 text-sm focus:border-indigo-500 outline-none font-medium"
                            value={selectedNewKtv}
                            onChange={(e) => setSelectedNewKtv(e.target.value)}
                          >
                            <option value="">-- Chọn --</option>
                            {/* Bỏ chính người đang bị rút ra — đổi một người sang
                                chính họ là vô nghĩa. Người đang bận vẫn liệt kê
                                (quầy có thể cố ý điều), nhưng ghi rõ trạng thái. */}
                            {availableKtvs
                              .filter(ktv => ktv.id !== selectedOldKtv)
                              .map(ktv => {
                                const tt = (ktv as any).turnStatus;
                                const nhan = tt === 'working' ? ' · đang làm'
                                  : tt === 'assigned' ? ' · đã xếp lịch'
                                  : '';
                                return (
                                  <option key={ktv.id} value={ktv.id}>
                                    {ktv.full_name} ({ktv.id}) [{WORK_TYPE_LABELS[ktv.work_type as keyof typeof WORK_TYPE_LABELS] || 'A'}]{nhan}
                                  </option>
                                );
                              })}
                          </select>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setTimeMode('REMAIN')}
                          className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition-all ${
                            timeMode === 'REMAIN' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'
                          }`}
                        >
                          Làm phần còn lại
                        </button>
                        <button
                          type="button"
                          onClick={() => setTimeMode('MANUAL')}
                          className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition-all ${
                            timeMode === 'MANUAL' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'
                          }`}
                        >
                          Quầy gán tay
                        </button>
                      </div>

                      {/* Chọn "Làm phần còn lại" thì phải thấy NGAY con số KTV mới
                          nhận, khỏi phải nhẩm. Con số này khớp đúng công thức
                          server dùng — xem chú thích chỗ tính `phutConLai`. */}
                      {timeMode === 'REMAIN' && (
                        <div className="rounded-lg border-2 border-indigo-100 bg-indigo-50/60 px-3 py-2">
                          {phutConLai == null ? (
                            <span className="text-[12px] font-semibold text-gray-500">
                              Chọn KTV bị phạt để xem số phút KTV mới nhận.
                            </span>
                          ) : (
                            <>
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-[11px] font-black uppercase tracking-wider text-indigo-500">
                                  KTV mới nhận
                                </span>
                                <span className="text-lg font-black leading-none text-indigo-700">
                                  {phutConLai} phút
                                  {phutConLai >= 60 && (
                                    <span className="ml-1.5 text-[12px] font-bold text-indigo-400">
                                      ({fmtHours(phutConLai / 60)})
                                    </span>
                                  )}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] font-medium leading-snug text-gray-500">
                                Dịch vụ {tongThoiLuong} phút − {selectedOldKtv} đã làm {phutDaLam} phút
                                {(Number(extraTimeMins) || 0) > 0 ? ` + bù ${extraTimeMins} phút` : ''}
                              </p>
                            </>
                          )}
                        </div>
                      )}

                      {timeMode === 'MANUAL' && (
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                            <Clock size={14} /> Số phút gán cho KTV mới
                          </label>
                          <input
                            type="number"
                            min="0"
                            max={selectedService?.duration || 0}
                            className="w-full border-2 border-gray-200 rounded-lg p-2 text-sm focus:border-indigo-500 outline-none font-bold text-indigo-600"
                            value={manualMins}
                            onChange={(e) => {
                              let val = Number(e.target.value) || 0;
                              const maxVal = selectedService?.duration || 0;
                              if (val > maxVal) val = maxVal;   // trần = thời lượng dịch vụ, không cho vượt
                              setManualMins(val);
                            }}
                          />
                          <p className="text-[11px] text-gray-500 mt-1">*Tối đa {selectedService?.duration || 0} phút — bằng đúng thời lượng dịch vụ, không thể hơn.</p>
                        </div>
                      )}

                      <div className={timeMode === 'MANUAL' ? 'hidden' : ''}>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                          <Clock size={14} /> Thời gian bù thêm (Phút)
                        </label>
                        <input 
                          type="number"
                          min="0"
                          max={selectedService?.duration || 0}
                          className="w-full border-2 border-gray-200 rounded-lg p-2 text-sm focus:border-indigo-500 outline-none font-bold text-indigo-600"
                          value={extraTimeMins}
                          onChange={(e) => {
                            let val = Number(e.target.value) || 0;
                            const maxVal = selectedService?.duration || 0;
                            if (val > maxVal) val = maxVal;
                            setExtraTimeMins(val);
                          }}
                        />
                        <p className="text-[11px] text-gray-500 mt-1">*Thời gian tính lương KTV mới = (Tổng giờ dịch vụ - Giờ KTV cũ đã làm) + Giờ bù thêm.</p>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-8 flex gap-3">
              <button
                type="button"
                className="flex-1 px-4 py-3 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                onClick={onClose}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={!selectedServiceId || loading || (actionType === 'SWAP' && (!selectedOldKtv || !selectedNewKtv))}
                className="flex-[2] px-4 py-3 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-md hover:shadow-lg shadow-indigo-200 flex justify-center items-center gap-2"
                onClick={handleConfirm}
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  'Xác nhận'
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
