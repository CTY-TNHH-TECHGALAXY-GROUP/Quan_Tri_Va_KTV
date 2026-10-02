'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { QrCode } from 'lucide-react';
import { displayBookingCode } from '@/lib/booking-display-code';

/** Trang lộ trình khách quét — khác domain với app quản trị. */
const JOURNEY_BASE_URL = 'https://nganha.vercel.app';
const QR_SIZE = 250;

export interface QrJourneyTarget {
  orderId: string;
  billCode?: string | null;
  accessToken?: string | null;
  customerLang?: string | null;
  /** Đơn tách nhiều khách: mỗi khách một link riêng. */
  guestId?: string | null;
}

/**
 * Mã QR để khách tự xem lộ trình đơn của mình.
 *
 * Ưu tiên `accessToken` (link công khai, không lộ id nội bộ); đơn cũ chưa có
 * token thì rơi về `orderId`.
 */
export function QrJourneyModal({
  data,
  onClose,
}: {
  data: QrJourneyTarget | null;
  onClose: () => void;
}) {
  const journeyUrl = data
    ? `${JOURNEY_BASE_URL}/${data.customerLang || 'vi'}/journey/${data.accessToken || data.orderId}`
      + (data.guestId ? `?guestId=${data.guestId}` : '')
    : '';

  return (
    <AnimatePresence>
      {data && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="bg-white rounded-3xl p-8 shadow-2xl max-w-sm w-full mx-4 text-center"
          >
            <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <QrCode size={28} className="text-indigo-600" />
            </div>
            <h3 className="text-lg font-black text-gray-900 mb-1">QR Journey</h3>
            <p className="text-xs text-gray-500 font-medium mb-6">
              Đơn #{displayBookingCode(data.billCode)} — Khách quét để xem lộ trình
            </p>

            <div className="bg-gray-50 rounded-2xl p-6 mb-6 inline-block border border-gray-100">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=${QR_SIZE}x${QR_SIZE}&data=${encodeURIComponent(journeyUrl)}`}
                alt="QR Journey"
                width={QR_SIZE}
                height={QR_SIZE}
                className="mx-auto"
              />
            </div>

            <button
              onClick={onClose}
              className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-black rounded-2xl transition-colors text-sm uppercase tracking-wider"
            >
              Đóng
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
