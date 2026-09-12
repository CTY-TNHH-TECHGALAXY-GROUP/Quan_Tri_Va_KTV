import React, { useState } from 'react';
import { X, Send, AlertTriangle } from 'lucide-react';
import { SubOrder } from './dispatch-timeline';
import { PendingOrder } from '../types';

interface KtvCommentModalProps {
    subOrder: SubOrder;
    order: PendingOrder;
    onClose: () => void;
    onSuccess: () => void;
}

export function KtvCommentModal({ subOrder, order, onClose, onSuccess }: KtvCommentModalProps) {
    const [selectedKtv, setSelectedKtv] = useState<string>(subOrder.ktvIds[0] || '');
    const [note, setNote] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        if (!selectedKtv) {
            setError('Vui lòng chọn KTV để nhận xét.');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const res = await fetch('/api/reception/ktv-comment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingItemId: subOrder.id,
                    ktvId: selectedKtv,
                    note: note
                })
            });

            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Có lỗi xảy ra');
            }

            onSuccess();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/80">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600">
                            <AlertTriangle size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-900 text-lg">Nhận xét KTV</h3>
                            <p className="text-sm text-gray-500">
                                Đơn: <span className="font-medium text-gray-700">{(order.billCode || '').split('-')[0]}</span>
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 flex-1 overflow-y-auto">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100 flex items-center gap-2">
                            <AlertTriangle size={16} />
                            {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Chọn KTV bị nhận xét</label>
                            <div className="flex flex-wrap gap-2">
                                {subOrder.ktvIds.map(ktv => (
                                    <button
                                        key={ktv}
                                        onClick={() => setSelectedKtv(ktv)}
                                        className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                                            selectedKtv === ktv 
                                                ? 'bg-red-50 border-red-200 text-red-700' 
                                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                        }`}
                                    >
                                        {ktv}
                                    </button>
                                ))}
                                {subOrder.ktvIds.length === 0 && (
                                    <span className="text-sm text-gray-500 italic">Không có KTV nào</span>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nội dung (Lý do giam tiền)</label>
                            <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="Ghi chú về thái độ, chất lượng phục vụ... (Nếu để trống sẽ huỷ giam tiền)"
                                className="w-full border-gray-300 rounded-xl p-3 text-sm min-h-[120px] focus:ring-2 focus:ring-red-500/20 focus:border-red-500 resize-none transition-shadow"
                            />
                            <p className="text-xs text-gray-500 mt-2">
                                Nếu nhập nhận xét, tiền tua của KTV này sẽ bị giữ lại (Hold) cho đến khi được giải quyết.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-gray-100 bg-gray-50 flex items-center gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
                        disabled={isSubmitting}
                    >
                        Hủy
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || subOrder.ktvIds.length === 0}
                        className="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isSubmitting ? (
                            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <Send size={16} />
                        )}
                        Lưu nhận xét
                    </button>
                </div>
            </div>
        </div>
    );
}
