'use client';

import React, { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Send } from 'lucide-react';
import { isUtilityService } from '@/lib/booking.logic';
import { isLiveKtvSegment } from '@/lib/ktvUtils';
import { dispatchFormMissingInfo } from '@/lib/dispatch-form-draft';
import { displayBookingCode } from '@/lib/booking-display-code';
import { getDisplayCustomerName } from '../dispatch-display';
import { isNewExternalKtvToken } from '@/lib/constants/staff.constants';

/** Số KTV tối thiểu của một dịch vụ; thiếu field thì coi như cần 1 người. */
const minKtvOf = (svc: any) =>
  typeof svc.min_ktv_required === 'number' ? svc.min_ktv_required : 1;

const activeStaff = (svc: any) => (svc.staffList || []).filter((st: any) => st.ktvId
  && (st.segments || []).some((seg: any) => isLiveKtvSegment({ ...seg, ktvId: seg.ktvId || st.ktvId }, st.ktvId)));

/** Dịch vụ tiện ích (khăn, nước…) không cần gán KTV nên không tính là thiếu. */
const isUnderstaffed = (svc: any) => {
  if (isUtilityService(svc)) return false;
  const assigned = activeStaff(svc).length;
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
  pending = false,
}: {
  open: boolean;
  /** Đơn gốc; có thể null khi quầy chọn thẳng một đơn con. */
  order: any;
  subOrder: any;
  rooms: any[];
  beds: any[];
  onConfirm: (serviceIds: string[], orderId: string) => void | boolean | Promise<void | boolean>;
  pending?: boolean;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const busy = pending || confirming;
  const close = () => { if (!busy && !submittingRef.current) { setError(''); onClose(); } };
  const orderForModal = order || subOrder?.originalOrder;
  if (!open || !orderForModal || !subOrder) return <AnimatePresence />;

  const missingInfo = dispatchFormMissingInfo(subOrder.services);
  const invalid = missingInfo.length > 0;

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
      <Dialog.Root open={open} onOpenChange={value => { if (!value) close(); }}>
        <Dialog.Portal>
          <Dialog.Overlay asChild>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-md" />
          </Dialog.Overlay>
          <Dialog.Content asChild
            onOpenAutoFocus={() => { returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
            onCloseAutoFocus={event => { event.preventDefault(); returnFocusRef.current?.focus(); }}
            onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
            onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              aria-busy={busy}
              className="fixed z-[61] bottom-0 sm:bottom-auto sm:top-1/2 left-1/2 -translate-x-1/2 sm:-translate-y-1/2 bg-white rounded-t-[2.5rem] sm:rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-indigo-50">
            <div>
              <Dialog.Title className="font-black text-indigo-900 text-lg uppercase tracking-tight">Xác nhận điều phối</Dialog.Title>
              <Dialog.Description className="text-sm text-indigo-600 font-bold mt-1">
                Đơn #{billLabel} - {getDisplayCustomerName(subOrder)}
              </Dialog.Description>
            </div>
            <button type="button" aria-label="Đóng xác nhận điều phối" disabled={busy}
              onClick={close}
              className="p-3 bg-white hover:bg-gray-100 rounded-2xl text-gray-400 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 shadow-sm"
            >
              <Plus className="rotate-45" size={24} />
            </button>
          </div>

          <div className="p-6 overflow-y-auto overscroll-contain no-scrollbar flex-1 space-y-4">
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
                        (Đang thiếu {minKtvOf(svc) - activeStaff(svc).length})
                      </p>
                    )}
                  </div>
                  <div className="space-y-3">
                    {activeStaff(svc).map((st: any, stIdx: number) => (
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
                          {st.segments.filter((seg: any) => isLiveKtvSegment({ ...seg, ktvId: seg.ktvId || st.ktvId }, st.ktvId)).map((seg: any, segIdx: number) => {
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

          {invalid && <p role="status" className="px-6 py-2 text-sm font-semibold text-amber-700">{missingInfo.join(' · ')}</p>}
          {error && <p role="alert" className="px-6 py-2 text-sm font-semibold text-rose-600">{error}</p>}
          <div className="p-6 border-t border-gray-100 bg-white grid grid-cols-2 gap-3 shrink-0">
            <button type="button" disabled={busy}
              onClick={close}
              className="w-full py-4 rounded-2xl font-black text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 uppercase text-sm"
            >
              Quay lại sửa
            </button>
            <button type="button"
              disabled={invalid || busy}
              onClick={async () => {
                if (busy || submittingRef.current) return;
                submittingRef.current = true; setConfirming(true); setError('');
                try {
                  const result = await onConfirm(subOrder.services.map((s: any) => s.id), subOrder.originalOrder?.id || orderForModal.id);
                  if (result !== false) onClose();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Không điều phối được. Vui lòng thử lại.');
                } finally { submittingRef.current = false; setConfirming(false); }
              }}
              className={`w-full py-4 rounded-2xl font-black text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 uppercase text-sm flex items-center justify-center gap-2 shadow-lg ${
                invalid || busy
                  ? 'bg-gray-400 cursor-not-allowed shadow-none'
                  : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
              }`}
            >
              <Send size={18} strokeWidth={3} /> {busy ? 'Đang điều phối…' : 'Lưu và điều phối'}
            </button>
          </div>
            </motion.div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </AnimatePresence>
  );
}
