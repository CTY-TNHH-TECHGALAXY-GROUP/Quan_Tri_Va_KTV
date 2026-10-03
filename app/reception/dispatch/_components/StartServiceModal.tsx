'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Clock } from 'lucide-react';

/**
 * Chọn mốc bắt đầu tính giờ cho một dịch vụ.
 *
 * Quầy hay bấm muộn vài phút so với lúc khách thật sự vào phòng, nên ngoài
 * "giờ hiện tại" còn cho nhập tay. Giờ tuỳ chỉnh được ghép vào NGÀY LÀM VIỆC
 * đang xem (`selectedDate`), không phải hôm nay — ca đêm xem lại ngày hôm trước
 * mà lấy ngày hệ thống thì lệch hẳn một ngày.
 */
export function StartServiceModal({
  open,
  selectedDate,
  onConfirm,
  onClose,
}: {
  open: boolean;
  /** Ngày làm việc đang xem, dạng 'YYYY-MM-DD'. */
  selectedDate: string;
  onConfirm?: (startedAtIso: string) => void;
  onClose: () => void;
}) {
  // State cục bộ: ô giờ này không ai ngoài modal cần đọc.
  const [customTime, setCustomTime] = useState('');

  // Mỗi lần mở, điền sẵn giờ hiện tại (hành vi cũ: page.tsx set trước khi mở),
  // vừa tiện bấm Áp dụng ngay vừa không dính giờ đã gõ lần trước.
  useEffect(() => {
    if (open) {
      setCustomTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    }
  }, [open]);

  const confirmNow = () => {
    onClose();
    onConfirm?.(new Date().toISOString());
  };

  const confirmCustom = () => {
    if (!customTime) return;
    onClose();
    const [h, m] = customTime.split(':');
    const d = new Date(selectedDate);
    d.setHours(Number(h), Number(m), 0, 0);
    onConfirm?.(d.toISOString());
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden border border-gray-100"
          >
            <div className="p-5 pb-6">
              <div className="flex items-center gap-3 text-orange-600 mb-4">
                <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center border border-orange-100">
                  <Clock size={24} />
                </div>
                <h3 className="text-[17px] font-black">Bắt đầu dịch vụ</h3>
              </div>
              <p className="text-[14px] font-medium text-gray-600 leading-relaxed px-1">
                Hệ thống sẽ bắt đầu tính giờ làm. Vui lòng chọn mốc thời gian:
              </p>
              <div className="mt-5 flex flex-col gap-3 px-1">
                <button
                  onClick={confirmNow}
                  className="w-full py-3.5 rounded-2xl text-[14px] font-bold text-white bg-orange-600 hover:bg-orange-700 active:scale-95 transition-all shadow-sm"
                >
                  Lấy giờ hiện tại ({new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})
                </button>
                <div className="mt-2 pt-4 border-t border-gray-100">
                  <p className="text-[13px] font-medium text-gray-500 mb-2">Hoặc nhập giờ tùy chỉnh:</p>
                  <div className="flex gap-2">
                    <input
                      type="time"
                      value={customTime}
                      onChange={(e) => setCustomTime(e.target.value)}
                      className="flex-1 px-4 py-3 rounded-2xl border border-gray-200 text-[15px] font-semibold text-gray-700 outline-none focus:border-orange-500 transition-all bg-gray-50"
                    />
                    <button
                      onClick={confirmCustom}
                      className="px-6 py-3 rounded-2xl text-[14px] font-bold text-white bg-orange-600 hover:bg-orange-700 active:scale-95 transition-all shadow-sm whitespace-nowrap"
                    >
                      Áp dụng
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 bg-gray-50/80 border-t border-gray-100 flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl text-[13px] font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 active:scale-95 transition-all"
              >
                Hủy bỏ
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
