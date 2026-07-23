'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, MessageSquare, AlertCircle } from 'lucide-react';
import { ServiceBlock } from '../types';

interface ReviewHandoverModalProps {
    isOpen: boolean;
    onClose: () => void;
    service: ServiceBlock | null;
    onApprove: (itemId: string, comment: string) => Promise<void>;
    onReject: (itemId: string, comment: string) => Promise<void>;
}

export function ReviewHandoverModal({ isOpen, onClose, service, onApprove, onReject }: ReviewHandoverModalProps) {
    const [comment, setComment] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen || !service) return null;

    let images: Record<string, string> = {};
    if (service.handover_images) {
        try {
            images = typeof service.handover_images === 'string' 
                ? JSON.parse(service.handover_images) 
                : service.handover_images;
        } catch (e) {
            console.error('Failed to parse handover images', e);
        }
    }

    const handleApprove = async () => {
        setIsSubmitting(true);
        try {
            await onApprove(service.id, comment);
            onClose();
            setComment('');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReject = async () => {
        if (!comment.trim()) {
            alert('Vui lòng nhập lý do từ chối để KTV khắc phục.');
            return;
        }
        setIsSubmitting(true);
        try {
            await onReject(service.id, comment);
            onClose();
            setComment('');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-0">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    onClick={!isSubmitting ? onClose : undefined}
                />
                
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden max-h-[90vh]"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Duyệt Bàn Giao Phòng</h2>
                            <p className="text-sm text-gray-500 mt-0.5">{service.serviceName} - P.{service.selectedRoomId}</p>
                        </div>
                        <button 
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-50"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                        <div className="space-y-6">
                            {/* Images Grid */}
                            <div>
                                <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                    Ảnh Bàn Giao ({Object.keys(images).length})
                                </h3>
                                
                                {Object.keys(images).length > 0 ? (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                        {Object.entries(images).map(([label, url]) => (
                                            <div key={label} className="group relative aspect-square bg-gray-100 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                                                <img 
                                                    src={url} 
                                                    alt={label} 
                                                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                />
                                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-6">
                                                    <p className="text-white text-xs font-medium truncate">{label}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 flex items-center gap-3 text-orange-700">
                                        <AlertCircle size={20} className="shrink-0" />
                                        <p className="text-sm">Không có ảnh bàn giao nào được gửi kèm.</p>
                                    </div>
                                )}
                            </div>

                            {/* Comment Input */}
                            <div>
                                <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                    <MessageSquare size={16} className="text-gray-400" />
                                    Ghi chú / Nhận xét
                                </h3>
                                <textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    placeholder="Nhập nhận xét của bạn về tình trạng phòng... (Bắt buộc nếu từ chối)"
                                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-4 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none resize-none min-h-[100px]"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
                        <button
                            onClick={handleReject}
                            disabled={isSubmitting}
                            className="px-5 py-2.5 rounded-xl font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <X size={18} />
                            Từ chối bàn giao
                        </button>
                        <button
                            onClick={handleApprove}
                            disabled={isSubmitting}
                            className="px-5 py-2.5 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Check size={18} />
                            Duyệt hoàn tất
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
} 
