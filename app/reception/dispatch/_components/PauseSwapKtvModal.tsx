'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, PauseCircle, PlayCircle, UserMinus, UserPlus, Clock, AlertTriangle } from 'lucide-react';
import { PendingOrder, StaffData } from '../types';

interface PauseSwapKtvModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: PendingOrder | null;
  availableKtvs: StaffData[];
  onConfirm: (
    bookingItemId: string,
    action: 'PAUSE' | 'RESUME' | 'SWAP',
    oldKtvId?: string,
    newKtvId?: string,
    extraTimeMins?: number
  ) => Promise<void>;
}

export default function PauseSwapKtvModal({ isOpen, onClose, order, availableKtvs, onConfirm }: PauseSwapKtvModalProps) {
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [selectedOldKtv, setSelectedOldKtv] = useState<string>('');
  const [selectedNewKtv, setSelectedNewKtv] = useState<string>('');
  const [extraTimeMins, setExtraTimeMins] = useState<number>(0);
  const [actionType, setActionType] = useState<'PAUSE' | 'RESUME' | 'SWAP'>('PAUSE');
  const [loading, setLoading] = useState(false);

  // Filter services that can be paused or swapped
  const activeServices = order?.services.filter(s => 
    s.status === 'IN_PROGRESS' || s.status === 'PAUSED'
  ) || [];

  const selectedService = activeServices.find(s => s.id === selectedServiceId);
  const isPaused = selectedService?.status === 'PAUSED';

  // Find KTVs currently working on the selected service
  const currentKtvs = selectedService?.staffList.filter(staff => 
    !staff.segments.some(seg => seg.endTime) // Find active segments without endTime
  ) || [];

  const handleConfirm = async () => {
    if (!selectedServiceId) return;
    
    setLoading(true);
    try {
      if (actionType === 'SWAP') {
        if (!selectedOldKtv || !selectedNewKtv) {
          alert('Vui lòng chọn KTV cần đổi và KTV mới!');
          return;
        }
        if (selectedService && extraTimeMins > selectedService.duration) {
          alert(`Thời gian bù thêm không được vượt quá thời gian của dịch vụ (${selectedService.duration} phút)`);
          return;
        }
        await onConfirm(selectedServiceId, 'SWAP', selectedOldKtv, selectedNewKtv, extraTimeMins);
      } else {
        await onConfirm(selectedServiceId, actionType);
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
                  className="w-full border-2 border-gray-200 rounded-xl p-3 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none font-medium transition-all"
                  value={selectedServiceId}
                  onChange={(e) => {
                    setSelectedServiceId(e.target.value);
                    setActionType('PAUSE');
                    setSelectedOldKtv('');
                  }}
                >
                  <option value="">-- Chọn dịch vụ --</option>
                  {activeServices.map(svc => (
                    <option key={svc.id} value={svc.id}>
                      {svc.serviceName} ({svc.status === 'PAUSED' ? 'Đang tạm ngưng' : 'Đang làm'})
                    </option>
                  ))}
                </select>
              </div>

              {selectedServiceId && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="flex gap-3 mb-4">
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
                      <div className="p-3 bg-rose-50 text-rose-600 rounded-lg text-sm font-medium flex gap-2">
                        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                        KTV bị đổi sẽ bị hủy tua (Lương 0đ) và mất 1 lượt chờ. KTV mới sẽ nhận trọn lương của tua gốc.
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                            <UserMinus size={14} /> KTV Bị phạt
                          </label>
                          <select 
                            className="w-full border-2 border-gray-200 rounded-lg p-2 text-sm focus:border-rose-500 outline-none font-medium"
                            value={selectedOldKtv}
                            onChange={(e) => setSelectedOldKtv(e.target.value)}
                          >
                            <option value="">-- Chọn --</option>
                            {currentKtvs.map(staff => (
                              <option key={staff.ktvId} value={staff.ktvId}>{staff.ktvName}</option>
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
                            {availableKtvs.map(ktv => (
                              <option key={ktv.id} value={ktv.id}>{ktv.full_name} ({ktv.id})</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
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
                        <p className="text-[11px] text-gray-500 mt-1">*KTV mới luôn được hưởng tối thiểu bằng số tiền tua gốc. Bạn có thể nhập thêm giờ để KTV mới gánh bù.</p>
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
