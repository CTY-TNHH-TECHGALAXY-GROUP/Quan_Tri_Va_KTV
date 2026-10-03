import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertTriangle, RotateCcw } from 'lucide-react';

/** Nhãn mặc định hệ thống đặt cho từng đơn con khi quầy chưa gõ tên riêng. */
export const defaultGuestName = (suffix: string) => `Khách ${suffix}`;

export const SplitPreviewModal = ({
    isOpen,
    onClose,
    onSaveDraftOnly,
    onSaveAndDispatch,
    splitPlan,
    order,
    allServices
}: {
    isOpen: boolean;
    onClose: () => void;
    onSaveDraftOnly: (guestNames: Record<string, string>) => void;
    onSaveAndDispatch: (guestNames: Record<string, string>) => void;
    splitPlan: { suffix: string, itemIds: string[] }[];
    order: any;
    allServices: any[];
}) => {
    // Chỉ giữ những ô quầy đã gõ; ô chưa đụng tới thì lấy nhãn mặc định lúc render.
    // Modal bị unmount khi đóng nên state tự sạch cho lần mở sau.
    const [names, setNames] = useState<Record<string, string>>({});

    // Hai khách trùng tên thì quầy nhìn hai thẻ không phân biệt được ai với ai.
    // Bỏ trống thì quay về nhãn mặc định, tránh tạo đơn con không tên.
    const resolveName = (suffix: string) =>
        (names[suffix] || '').trim() || defaultGuestName(suffix);

    const duplicatedNames = useMemo(() => {
        const seen = new Map<string, number>();
        splitPlan.forEach(p => {
            const key = ((names[p.suffix] || '').trim() || defaultGuestName(p.suffix)).toLowerCase();
            seen.set(key, (seen.get(key) || 0) + 1);
        });
        return new Set(Array.from(seen.entries()).filter(([, c]) => c > 1).map(([k]) => k));
    }, [names, splitPlan]);

    if (!isOpen || !order) return null;

    const isDuplicated = (suffix: string) => duplicatedNames.has(resolveName(suffix).toLowerCase());

    const collectNames = () => {
        const out: Record<string, string> = {};
        splitPlan.forEach(p => { out[p.suffix] = resolveName(p.suffix); });
        return out;
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/60 backdrop-blur-md"
                    onClick={onClose}
                />
                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
                >
                    <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-amber-50">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                                <AlertTriangle className="text-amber-600" size={24} />
                            </div>
                            <div>
                                <h3 className="font-black text-amber-900 text-lg uppercase tracking-tight">Hệ thống sẽ tách đơn</h3>
                                <p className="text-sm text-amber-700 font-medium mt-0.5">
                                    Đơn hàng của bạn sẽ được tách thành {splitPlan.length} đơn con
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-amber-100 rounded-xl text-amber-600 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-6 overflow-y-auto max-h-[60vh] space-y-4">
                        <p className="text-xs text-gray-500 font-medium">
                            Gõ thẳng vào ô tên để đặt tên khách. Tên này hiện trên thẻ đơn ở quầy và trên máy KTV.
                        </p>
                        {splitPlan.map((plan, idx) => {
                            const value = names[plan.suffix] ?? defaultGuestName(plan.suffix);
                            const isDefault = value.trim() === defaultGuestName(plan.suffix);
                            const dup = isDuplicated(plan.suffix);
                            return (
                                <div key={idx} className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="shrink-0 bg-indigo-600 text-white text-[11px] font-black px-2 py-0.5 rounded-lg">
                                            {plan.suffix}
                                        </span>
                                        <input
                                            type="text"
                                            value={value}
                                            maxLength={40}
                                            onChange={e => setNames(prev => ({ ...prev, [plan.suffix]: e.target.value }))}
                                            placeholder={defaultGuestName(plan.suffix)}
                                            className={`flex-1 min-w-0 font-bold text-gray-900 bg-transparent border-b border-dashed outline-none py-1 transition-colors ${dup ? 'border-rose-400 text-rose-700' : 'border-gray-300 hover:border-indigo-300 focus:border-indigo-500'}`}
                                        />
                                        {!isDefault && (
                                            <button
                                                onClick={() => setNames(prev => ({ ...prev, [plan.suffix]: defaultGuestName(plan.suffix) }))}
                                                title="Trả về tên mặc định"
                                                className="shrink-0 p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-colors"
                                            >
                                                <RotateCcw size={14} />
                                            </button>
                                        )}
                                    </div>
                                    {dup && (
                                        <p className="text-[11px] font-bold text-rose-600 mb-2">
                                            Trùng tên với khách khác — nên đặt khác nhau cho dễ gọi.
                                        </p>
                                    )}
                                    <ul className="space-y-2 mt-2">
                                        {plan.itemIds.map(itemId => {
                                            const svc = order.services?.find((s: any) => s.id === itemId);
                                            if (!svc) return null;
                                            return (
                                                <li key={itemId} className="text-sm text-gray-600 flex items-start gap-2">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                                                    <span>{svc.displayName || svc.serviceName || 'Dịch vụ'}</span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>

                    <div className="p-6 border-t border-gray-100 bg-white flex flex-col sm:flex-row gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                        >
                            Hủy
                        </button>
                        <button
                            onClick={() => onSaveDraftOnly(collectNames())}
                            className="flex-1 py-3.5 rounded-xl font-bold text-indigo-700 bg-indigo-100 hover:bg-indigo-200 transition-colors"
                        >
                            Chỉ Lưu Nháp
                        </button>
                        <button
                            onClick={() => onSaveAndDispatch(collectNames())}
                            className="flex-[1.5] py-3.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-200"
                        >
                            Lưu &amp; Gửi KTV luôn
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
