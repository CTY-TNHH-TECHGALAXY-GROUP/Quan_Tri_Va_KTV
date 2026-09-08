'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Trash2, AlertTriangle } from 'lucide-react';

/**
 * Hộp thoại huỷ dịch vụ.
 *
 * Cố ý KHÔNG có danh mục lý do — quầy gõ tay, lưu vào `options.cancelReason`.
 * ⚠️ Lý do là chữ tự do nên KHÔNG được dùng để quyết định tiền; chỉ công tắc
 * "Cộng giờ đã làm" mới điều khiển. Nếu không, "khach ban" với "khách bận" sẽ
 * ra hai kết quả khác nhau.
 */
export default function CancelItemModal({
    isOpen,
    onClose,
    onConfirm,
    ktvLabel,
    customerName,
    workedMinutes,
    wholeBooking,
    canhBao,
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (reason: string, cancelCredit: 'NONE' | 'WORKED') => Promise<void>;
    ktvLabel?: string;
    customerName?: string;
    workedMinutes?: number | null;
    /** true = huỷ cả bill, false/undefined = chỉ huỷ đơn con của một KTV. */
    wholeBooking?: boolean;
    /** Cảnh báo khi thao tác đi ngược với những gì KTV đã bấm báo. */
    canhBao?: string | null;
}) {
    const [reason, setReason] = useState('');
    const [credit, setCredit] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) { setReason(''); setCredit(false); setLoading(false); }
    }, [isOpen]);

    const submit = async () => {
        setLoading(true);
        try {
            await onConfirm(reason.trim(), credit ? 'WORKED' : 'NONE');
            onClose();
        } catch (err: any) {
            alert(err?.message || 'Có lỗi xảy ra khi huỷ');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6"
                    >
                        <div className="flex items-center justify-between pb-4 border-b">
                            <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                                <Trash2 className="text-rose-500" size={20} />
                                {wholeBooking ? 'Huỷ toàn bộ đơn hàng' : 'Huỷ đơn con'}
                            </h3>
                            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                                <X size={18} className="text-gray-500" />
                            </button>
                        </div>

                        <p className="mt-4 text-sm text-gray-600 font-medium">
                            {ktvLabel ? <span className="font-black text-gray-900">{ktvLabel}</span> : null}
                            {ktvLabel && customerName ? ' · ' : null}
                            {customerName ? <span className="font-black text-gray-900">{customerName}</span> : null}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-400 font-medium">
                            {wholeBooking
                                ? 'Huỷ TẤT CẢ dịch vụ chưa hoàn tất của bill này, mọi khách trong bill đều bị huỷ.'
                                : 'Chỉ huỷ đơn con này, các khách khác trong cùng bill không bị ảnh hưởng.'}
                        </p>

                        {canhBao && (
                            <div className="mt-4 flex gap-2 p-3 bg-rose-50 border-2 border-rose-300 text-rose-800 rounded-xl text-xs font-bold leading-snug">
                                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                                <span>{canhBao}</span>
                            </div>
                        )}

                        <div className="mt-5">
                            <label className="block text-sm font-bold text-gray-700 mb-2">Lý do huỷ</label>
                            <textarea
                                autoFocus
                                rows={3}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Vd: KTV bỏ khách không báo / khách đổi ý / phòng hỏng máy…"
                                className="w-full border-2 border-gray-200 rounded-xl p-3 text-sm focus:border-rose-400 focus:ring-4 focus:ring-rose-50 outline-none font-medium transition-all resize-none"
                            />
                        </div>

                        <button
                            type="button"
                            onClick={() => setCredit(v => !v)}
                            className={`mt-4 w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                                credit ? 'bg-emerald-50 border-emerald-300' : 'bg-gray-50 border-gray-200'
                            }`}
                        >
                            <span className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                                credit ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-gray-300'
                            }`}>
                                {credit && <span className="text-white text-[11px] font-black leading-none">✓</span>}
                            </span>
                            <span className="flex-1">
                                <span className="block text-sm font-bold text-gray-800">Cộng giờ đã làm cho KTV</span>
                                <span className="block text-[11px] text-gray-500 font-medium mt-0.5">
                                    {credit
                                        ? `KTV được tính tiền và giờ tích luỹ theo ${workedMinutes != null ? `${workedMinutes} phút` : 'số phút'} đã làm, giữ nguyên lượt tua.`
                                        : `KTV mất sạch tiền, giờ tích luỹ và lượt tua${workedMinutes != null ? ` (đã làm ${workedMinutes} phút)` : ''}.`}
                                </span>
                            </span>
                        </button>

                        {!credit && (
                            <div className="mt-3 flex gap-2 p-3 bg-amber-50 text-amber-700 rounded-xl text-[11px] font-medium">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                Mặc định là không cộng. Nếu lỗi từ phía khách chứ không phải KTV, hãy bật công tắc trên.
                            </div>
                        )}

                        <div className="mt-6 flex gap-3">
                            <button
                                type="button" onClick={onClose}
                                className="flex-1 px-4 py-3 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                            >
                                Thôi
                            </button>
                            <button
                                type="button" onClick={submit} disabled={loading}
                                className="flex-[2] px-4 py-3 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl transition-all shadow-md flex justify-center items-center gap-2"
                            >
                                {loading
                                    ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    : 'Xác nhận huỷ'}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
