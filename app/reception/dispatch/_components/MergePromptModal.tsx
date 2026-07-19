import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Layers, SplitSquareHorizontal } from 'lucide-react';
import { PendingOrder, StaffData } from '../types';

interface MergePromptConfig {
  orderId: string;
  sourceSvcId: string;
  targetSvcId: string;
  rowId: string;
  ktvId: string;
}

interface MergePromptModalProps {
  config: MergePromptConfig | null;
  onConfirm: () => void;
  onCancel: () => void;
  staffs: StaffData[];
  orders: PendingOrder[];
}

export const MergePromptModal = ({ config, onConfirm, onCancel, staffs, orders }: MergePromptModalProps) => {
  if (!config) return null;

  const order = orders.find(o => o.id === config.orderId);
  const sourceSvc = order?.services.find(s => s.id === config.sourceSvcId);
  const targetSvc = order?.services.find(s => s.id === config.targetSvcId);
  const ktvName = staffs.find(s => s.id === config.ktvId)?.full_name || config.ktvId;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col"
        >
          <div className="p-6 bg-indigo-50 border-b border-indigo-100 relative">
            <button
              onClick={onCancel}
              className="absolute top-4 right-4 p-2 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors"
            >
              <X size={20} strokeWidth={2.5} />
            </button>
            <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center mb-4 text-indigo-600">
              <Layers size={24} strokeWidth={2.5} />
            </div>
            <h2 className="text-xl font-black text-indigo-900 leading-tight">Phát hiện KTV trùng lặp</h2>
            <p className="text-sm text-indigo-700/80 mt-1.5 font-medium">
              Bạn vừa gán KTV <strong>{ktvName}</strong> cho <strong>{targetSvc?.serviceName}</strong>, nhưng KTV này đã được phân công cho <strong>{sourceSvc?.serviceName}</strong> trong cùng hóa đơn.
            </p>
          </div>

          <div className="p-6 space-y-4">
            <button
              onClick={onConfirm}
              className="w-full p-4 rounded-2xl border-2 border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 transition-all flex items-start gap-4 active:scale-[0.98] group"
            >
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <Layers size={20} strokeWidth={2.5} />
              </div>
              <div className="text-left flex-1">
                <div className="font-black text-base">Gộp Dịch Vụ (Làm liên tục)</div>
                <div className="text-xs text-indigo-100 font-medium mt-1 opacity-90 group-hover:opacity-100 transition-opacity">
                  Hệ thống sẽ tự tính thời gian nối tiếp nhau. Bạn chỉ cần chọn Phòng/Giường 1 lần cho cả 2 dịch vụ này.
                </div>
              </div>
            </button>

            <button
              onClick={onCancel}
              className="w-full p-4 rounded-2xl border-2 border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50 transition-all flex items-start gap-4 active:scale-[0.98] group"
            >
              <div className="w-10 h-10 rounded-xl bg-gray-100 group-hover:bg-indigo-100 text-gray-500 group-hover:text-indigo-600 flex items-center justify-center shrink-0 transition-colors">
                <SplitSquareHorizontal size={20} strokeWidth={2.5} />
              </div>
              <div className="text-left flex-1">
                <div className="font-black text-base text-gray-900 group-hover:text-indigo-900 transition-colors">Không Gộp (Tách riêng)</div>
                <div className="text-xs text-gray-500 font-medium mt-1">
                  Hai dịch vụ sẽ diễn ra cách quãng (KTV có thời gian nghỉ chuyển phòng). Bạn phải tự chọn lại Phòng/Giường cho dịch vụ thứ hai.
                </div>
              </div>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
