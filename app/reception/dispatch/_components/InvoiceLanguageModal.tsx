'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

/** Ngôn ngữ hoá đơn quầy có thể in cho khách. */
const INVOICE_LANGS = [
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'cn', label: '中文 (Chinese)', flag: '🇨🇳' },
  { code: 'jp', label: '日本語 (Japanese)', flag: '🇯🇵' },
  { code: 'kr', label: '한국어 (Korean)', flag: '🇰🇷' },
];

/* Giữ nguyên SVG gốc thay vì đổi sang icon lucide — bộ icon này vẽ riêng,
   thay bằng icon khác sẽ lệch so với giao diện quầy đang quen. */
const QrIcon = ({ size = 32, className = '' }: { size?: number; className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <rect x="7" y="7" width="3" height="3" />
    <rect x="14" y="7" width="3" height="3" />
    <rect x="7" y="14" width="3" height="3" />
    <rect x="14" y="14" width="3" height="3" />
  </svg>
);

const DocIcon = ({ size = 32, className = '' }: { size?: number; className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const PrintIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);

/**
 * Chọn ngôn ngữ hoá đơn, rồi hoặc mở tab in hoặc hiện mã QR cho khách tự quét.
 *
 * Ngôn ngữ đang xem QR (`qrLang`) là state NỘI BỘ: trước đây nó nằm trong state
 * của page dưới dạng `showQrForLang`, nhưng không caller nào set — chỉ chính
 * modal bật/tắt. Để ở đây thì page chỉ cần biết mỗi `invoiceId`.
 */
export function InvoiceLanguageModal({
  invoiceId,
  onClose,
}: {
  invoiceId: string | null;
  onClose: () => void;
}) {
  const [qrLang, setQrLang] = useState<string | null>(null);

  // Mở hoá đơn khác thì quay lại bước chọn ngôn ngữ.
  useEffect(() => {
    if (invoiceId) setQrLang(null);
  }, [invoiceId]);

  if (!invoiceId) return null;

  const invoiceUrl = (lang: string) => `/invoice/${invoiceId}?lang=${lang}`;
  const openPrintTab = (lang: string) => {
    window.open(invoiceUrl(lang), '_blank');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col">
        <div className="p-6 text-center border-b border-gray-100 relative">
          <div className="w-16 h-16 bg-sky-100 rounded-full flex items-center justify-center mx-auto mb-4">
            {qrLang ? <QrIcon className="text-sky-600" /> : <DocIcon className="text-sky-600" />}
          </div>
          <h3 className="text-xl font-black text-gray-900 tracking-tight">
            {qrLang ? 'Quét mã để xem hóa đơn' : 'Chọn ngôn ngữ hóa đơn'}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {qrLang ? 'Khách hàng có thể quét mã này' : 'Chọn in hoặc hiển thị mã QR'}
          </p>

          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {qrLang ? (
          <div className="p-6 flex flex-col items-center">
            <div className="bg-white p-2 rounded-2xl shadow-sm border border-gray-100 mb-6">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(`${window.location.origin}${invoiceUrl(qrLang)}`)}`}
                alt="Invoice QR Code"
                className="w-[200px] h-[200px] object-contain"
              />
            </div>
            <div className="flex w-full gap-3">
              <button
                onClick={() => setQrLang(null)}
                className="flex-1 py-3 text-sm font-bold text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Quay lại
              </button>
              <button
                onClick={() => openPrintTab(qrLang)}
                className="flex-1 py-3 text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl transition-colors"
              >
                Mở tab In
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-2">
            {INVOICE_LANGS.map(lang => (
              <div key={lang.code} className="flex items-center gap-2 w-full p-2 rounded-xl hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                <div className="flex items-center gap-3 flex-1 pl-2">
                  <span className="text-2xl">{lang.flag}</span>
                  <span className="font-bold text-gray-700">{lang.label}</span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setQrLang(lang.code)}
                    className="px-3 py-2 text-xs font-bold text-sky-600 bg-sky-50 hover:bg-sky-100 rounded-lg transition-colors flex items-center gap-1"
                  >
                    <QrIcon size={14} />
                    Mã QR
                  </button>
                  <button
                    onClick={() => openPrintTab(lang.code)}
                    className="px-3 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors flex items-center gap-1"
                  >
                    <PrintIcon />
                    In
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
