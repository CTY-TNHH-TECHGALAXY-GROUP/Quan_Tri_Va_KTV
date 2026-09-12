import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertTriangle } from 'lucide-react';

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
    onSaveDraftOnly: () => void;
    onSaveAndDispatch: () => void;
    splitPlan: { suffix: string, itemIds: string[] }[];
    order: any;
    allServices: any[];
}) => {
    if (!isOpen || !order) return null;

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
                        {splitPlan.map((plan, idx) => {
                            const subName = `Khách ${plan.suffix}`;
                            return (
                                <div key={idx} className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
                                    <h4 className="font-bold text-gray-900 mb-2">{subName}</h4>
                                    <ul className="space-y-2">
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
                            onClick={onSaveDraftOnly}
                            className="flex-1 py-3.5 rounded-xl font-bold text-indigo-700 bg-indigo-100 hover:bg-indigo-200 transition-colors"
                        >
                            Chỉ Lưu Nháp
                        </button>
                        <button
                            onClick={onSaveAndDispatch}
                            className="flex-[1.5] py-3.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-200"
                        >
                            Lưu & Gửi KTV luôn
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
