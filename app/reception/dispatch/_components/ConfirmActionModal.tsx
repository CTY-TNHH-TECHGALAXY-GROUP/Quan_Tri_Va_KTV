'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';

/**
 * Hộp xác nhận dùng chung của màn điều phối.
 *
 * Thay cho `window.confirm()` — confirm gốc chặn luồng chính nên đo INP rất tệ
 * trên máy quầy.
 */
export function ConfirmActionModal({
  open,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message?: string;
  onConfirm?: () => void;
  onCancel: () => void;
}) {
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
                  <AlertTriangle size={24} />
                </div>
                <h3 className="text-[17px] font-black">Xác nhận</h3>
              </div>
              <p className="text-[14px] font-medium text-gray-600 leading-relaxed px-1 whitespace-pre-line">
                {message}
              </p>
            </div>
            <div className="p-4 bg-gray-50/80 border-t border-gray-100 flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 py-3 rounded-2xl text-[13px] font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 active:scale-95 transition-all"
              >
                Hủy bỏ
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 py-3 rounded-2xl text-[13px] font-bold text-white bg-orange-600 hover:bg-orange-700 active:scale-95 transition-all shadow-sm"
              >
                Đồng ý
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
