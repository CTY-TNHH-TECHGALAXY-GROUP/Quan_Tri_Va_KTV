'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Clock, Pause, QrCode, Receipt, Send, Trash2, X } from 'lucide-react';

export interface OrderContextMenuState {
  x: number;
  y: number;
  orderId: string;
  itemId?: string | null;
  guestId?: string | null;
  [k: string]: any;
}

/** Gom hành động thành một object thay vì 8 prop rời — menu này gọi khá nhiều thứ. */
export interface OrderContextActions {
  updateStatus: (orderId: string, status: string) => void;
  cancelBooking: (orderId: string) => void;
  cancelBookingItem: (orderId: string, itemId: string) => void;
  dispatch: (skipValidation: boolean, svcIds: any, orderId: string) => void;
  showInvoice: (v: { invoiceId: string }) => void;
  showQr: (v: any) => void;
  openTimeEditor: (v: any) => void;
  openPauseSwap: (order: any) => void;
}

/**
 * Menu chuột phải trên thẻ đơn ở bảng Kanban.
 *
 * Các nút chuyển trạng thái hiện theo `dispatchStatus` hiện tại của đơn — quầy
 * chỉ thấy bước kế tiếp hợp lệ, không thấy toàn bộ trạng thái.
 */
export function OrderContextMenu({
  menu,
  orders,
  subOrders,
  actions,
  onClose,
}: {
  menu: OrderContextMenuState | null;
  orders: any[];
  subOrders: any[];
  actions: OrderContextActions;
  onClose: () => void;
}) {
  return (
      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            style={{ top: menu.y, left: menu.x }}
            className="fixed z-[100] bg-white rounded-2xl shadow-2xl border border-gray-100 p-1.5 min-w-[180px] overflow-hidden"
          >
            {/* Các nút chức năng dựa trên trạng thái */}
            {(() => {
              const order = orders.find(o => o.id === menu.orderId);
              if (!order) return null;

              if (order.dispatchStatus === 'PREPARING') {
                return (
                  <button
                    onClick={() => actions.updateStatus(menu.orderId, 'IN_PROGRESS')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1 text-left"
                  >
                    <CheckCircle2 size={18} className="shrink-0" />
                    Bắt đầu làm (Thay KTV)
                  </button>
                );
              }
              if (order.dispatchStatus === 'IN_PROGRESS') {
                return (
                  <>
                  <button
                    onClick={() => actions.updateStatus(menu.orderId, 'CLEANING')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-purple-600 hover:bg-purple-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1 text-left"
                  >
                    <CheckCircle2 size={18} className="shrink-0" />
                    Hết giờ ➔ Bắt đầu dọn phòng
                  </button>
                  <button
                    onClick={() => { actions.openPauseSwap(order); onClose(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-amber-600 hover:bg-amber-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1 text-left"
                  >
                    <AlertTriangle size={18} className="shrink-0" />
                    Tạm dừng / Đổi KTV
                  </button>
                  </>
                );
              }
              if (order.dispatchStatus === 'CLEANING') {
                return (
                  <button
                    onClick={() => actions.updateStatus(menu.orderId, 'FEEDBACK')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1 text-left"
                  >
                    <CheckCircle2 size={18} className="shrink-0" />
                    Dọn xong → Khách đánh giá
                  </button>
                );
              }
              if (order.dispatchStatus === 'FEEDBACK') {
                return (
                  <button
                    onClick={() => actions.updateStatus(menu.orderId, 'DONE')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1 text-left"
                  >
                    <CheckCircle2 size={18} className="shrink-0" />
                    Đã đánh giá → Đóng bill
                  </button>
                );
              }
              return null;
            })()}

            {/* QR Journey button */}
            <button
              onClick={() => {
                const order = orders.find(o => o.id === menu.orderId);
                const invoiceId = order?.parentBookingId || menu.orderId;
                actions.showInvoice({ invoiceId });
                onClose();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sky-600 hover:bg-sky-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
              Hiện Hoá Đơn
            </button>

            <button
              onClick={() => {
                const order = orders.find(o => o.id === menu.orderId);
                if (order) {
                  let finalBillCode = order.billCode;
                  if (menu.guestId) {
                     const so = subOrders.find(s => s.id === menu.guestId || (s.services && s.services.some((x: any) => x.guestId === menu.guestId || x.customerGroupId === menu.guestId)));
                     if (so) finalBillCode = (so as any).billCode || so.originalOrder?.billCode || order.billCode;
                  }
                  const invoiceId = order.parentBookingId || menu.orderId;
                  actions.showQr({ orderId: invoiceId, billCode: finalBillCode, accessToken: order.accessToken, customerLang: order.customerLang, guestId: menu.guestId });
                }
                onClose();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1"
            >
              <QrCode size={18} />
              Hiện QR Journey
            </button>

            {/* Force Dispatch - Skip validation */}
            <button
              onClick={() => {
                if (!confirm('⚡ Xác nhận GỬI ĐƠN ngay? (Bỏ qua kiểm tra thiếu thông tin)')) return;
                actions.dispatch(true, undefined, menu.orderId);
                onClose();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1"
            >
              <Send size={18} />
              Gửi đơn ngay (bỏ qua kiểm tra)
            </button>

            {menu.itemId && (
              <>
                <button
                  onClick={() => {
                    actions.openTimeEditor({ isOpen: true, orderId: menu.orderId, itemId: menu.itemId! });
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1"
                >
                  <Clock size={18} />
                  Sửa thời gian dịch vụ
                </button>
                <button
                  onClick={() => actions.cancelBookingItem(menu.orderId, menu.itemId!)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-orange-600 hover:bg-orange-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1"
                >
                  <Trash2 size={18} />
                  Hủy dịch vụ này
                </button>
              </>
            )}

            <button
              onClick={() => actions.cancelBooking(menu.orderId)}
              className="w-full flex items-center gap-3 px-4 py-3 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider"
            >
              <Trash2 size={18} />
              Hủy toàn bộ đơn hàng
            </button>
            <button
              onClick={() => onClose()}
              className="w-full flex items-center gap-3 px-4 py-3 text-gray-400 hover:bg-gray-50 rounded-xl transition-colors font-bold text-xs uppercase tracking-wider"
            >
              Đóng menu
            </button>
          </motion.div>
        )}
      </AnimatePresence>
  );
}
