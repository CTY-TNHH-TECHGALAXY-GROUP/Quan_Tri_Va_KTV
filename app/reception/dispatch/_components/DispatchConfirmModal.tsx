'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Send } from 'lucide-react';
import { isUtilityService } from '@/lib/booking.logic';
import { displayBookingCode } from '@/lib/booking-display-code';
import { getDisplayCustomerName } from '../dispatch-display';
import { isNewExternalKtvToken } from '@/lib/constants/staff.constants';

/** Số KTV tối thiểu của một dịch vụ; thiếu field thì coi như cần 1 người. */
const minKtvOf = (svc: any) =>
  typeof svc.min_ktv_required === 'number' ? svc.min_ktv_required : 1;

/** Dịch vụ tiện ích (khăn, nước…) không cần gán KTV nên không tính là thiếu. */
const isUnderstaffed = (svc: any) => {
  if (isUtilityService(svc)) return false;
  const assigned = svc.staffList.filter((st: any) => st.ktvId).length;
  return assigned < minKtvOf(svc);
};

/**
 * Soát lại toàn bộ đơn trước khi bấm gửi cho KTV: tiền, từng dịch vụ, ai làm,
 * phòng/giường và khung giờ từng chặng.
 *
 * Chặn gửi nếu còn dịch vụ chưa đủ KTV — gửi thiếu người thì đơn treo ở màn KTV
 * mà quầy không biết.
 */
export function DispatchConfirmModal({
  open,
  order,
  subOrder,
  rooms,
  beds,
  onConfirm,
  onClose,
}: {
  open: boolean;
  /** Đơn gốc; có thể null khi quầy chọn thẳng một đơn con. */
  order: any;
  subOrder: any;
  rooms: any[];
  beds: any[];
  onConfirm: (serviceIds: string[], orderId: string) => void;
  onClose: () => void;
}) {
  const orderForModal = order || subOrder?.originalOrder;
  if (!open || !orderForModal || !subOrder) return <AnimatePresence />;

  const missingKtv = subOrder.services.some(isUnderstaffed);

  // Đơn con chỉ chứa một phần dịch vụ của đơn gốc → hiện thêm hậu tố (A, B…).
  const isPartial = subOrder.services.length < orderForModal.services.length;
  const billPrefix = displayBookingCode(orderForModal.billCode);
  const billLabel = isPartial ? `${billPrefix}-${subOrder.subSuffix || 'A'}` : billPrefix;

  const total = subOrder.services.reduce(
    (acc: number, svc: any) => acc + ((svc.price || 0) * (svc.quantity || 1)), 0,
  ) || orderForModal.totalAmount || 0;

  // Dịch vụ đã gộp: hiện tên cha + tên các con, giấu dòng riêng của con đi.
  const groupedServices = subOrder.services
    .filter((svc: any) => !svc.options?.mergedIntoId && !svc.mergedIntoId)
    .map((svc: any) => {
      const childIds = svc.options?.mergedServiceIds || svc.mergedServiceIds || [];
      const childNames = subOrder.services
        .filter((child: any) => childIds.includes(child.id))
        .map((c: any) => c.serviceName)
        .join(' + ');
      return { ...svc, displayName: childNames ? `${svc.serviceName} + ${childNames}` : svc.serviceName };
    });

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
          onClick={onClose}
        />
        <motion.div
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="relative bg-white rounded-t-[2.5rem] sm:rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
        >
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-indigo-50">
            <div>
              <h3 className="font-black text-indigo-900 text-lg uppercase tracking-tight">Xác nhận thông tin</h3>
              <p className="text-sm text-indigo-600 font-bold mt-1">
                Đơn #{billLabel} - {getDisplayCustomerName(subOrder)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-3 bg-white hover:bg-gray-100 rounded-2xl text-gray-400 transition-colors shadow-sm"
            >
              <Plus className="rotate-45" size={24} />
            </button>
          </div>

          <div className="p-6 overflow-y-auto no-scrollbar flex-1 space-y-4">
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 flex justify-between items-center">
              <span className="text-gray-500 font-bold">Tổng tiền thu:</span>
              <span className="text-xl font-black text-emerald-600">{total.toLocaleString()}đ</span>
            </div>

            <div className="space-y-3">
              <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs">
                Chi tiết dịch vụ ({groupedServices.length})
              </h4>
              {groupedServices.map((svc: any, sIdx: number) => (
                <div key={svc.id || sIdx} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                  <div className="mb-3 pb-2 border-b border-gray-100">
                    <p className="font-bold text-gray-900 text-sm">{sIdx + 1}. {svc.displayName}</p>
                    {isUnderstaffed(svc) && (
                      <p className="text-xs text-rose-500 font-bold mt-1">
                        ⚠️ Dịch vụ yêu cầu tối thiểu {minKtvOf(svc)} KTV
                        (Đang thiếu {minKtvOf(svc) - svc.staffList.filter((st: any) => st.ktvId).length})
                      </p>
                    )}
                  </div>
                  <div className="space-y-3">
                    {svc.staffList.map((st: any, stIdx: number) => (
                      <div
                        key={st.ktvId ? `${svc.id}-${st.ktvId}` : `${svc.id}-st-${stIdx}`}
                        className="pl-2 border-l-2 border-indigo-200 flex flex-col gap-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md font-bold">KTV</span>
                          <span className="text-sm font-black text-gray-800">
                            {st.ktvName || 'Chưa gán'} {st.ktvId ? (isNewExternalKtvToken(st.ktvId) ? '[KTV ngoài mới]' : `[${st.ktvId}]`) : ''}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 flex flex-col gap-1">
                          {st.segments.map((seg: any, segIdx: number) => {
                            const roomName = rooms.find(r => r.id === seg.roomId)?.name || seg.roomId || 'Chưa xếp phòng';
                            const bedName = beds.find(b => b.id === seg.bedId)?.name || seg.bedId || 'Chưa xếp giường';
                            return (
                              <div key={`${svc.id}-${stIdx}-seg-${segIdx}`} className="flex items-center gap-2 bg-gray-50 rounded-lg p-1.5">
                                <span className="font-semibold text-gray-500">{seg.startTime} - {seg.endTime}</span>
                                <span className="text-gray-300">|</span>
                                <span className="font-semibold text-indigo-600">{roomName}</span>
                                <span className="text-gray-300">|</span>
                                <span className="font-semibold text-amber-600">{bedName}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-6 border-t border-gray-100 bg-white grid grid-cols-2 gap-3 shrink-0">
            <button
              onClick={onClose}
              className="w-full py-4 rounded-2xl font-black text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors uppercase text-sm"
            >
              Quay lại sửa
            </button>
            <button
              disabled={missingKtv}
              onClick={() => {
                onClose();
                onConfirm(subOrder.services.map((s: any) => s.id), subOrder.originalOrder.id);
              }}
              className={`w-full py-4 rounded-2xl font-black text-white transition-colors uppercase text-sm flex items-center justify-center gap-2 shadow-lg ${
                missingKtv
                  ? 'bg-gray-400 cursor-not-allowed shadow-none'
                  : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
              }`}
            >
              <Send size={18} strokeWidth={3} /> XÁC NHẬN GỬI KTV
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
