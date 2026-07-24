'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, MessageSquare, AlertCircle, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
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
    const [currentImageIndex, setCurrentImageIndex] = useState<number | null>(null);

    let images: Record<string, string> = {};
    if (service?.handover_images && Object.keys(service.handover_images).length > 0) {
        try {
            images = typeof service.handover_images === 'string' 
                ? JSON.parse(service.handover_images) 
                : service.handover_images;
        } catch (e) {
            console.error('Failed to parse handover images', e);
        }
    }

    // Fallback: Nếu không có handover_images trong DB, quét trực tiếp từ segments
    if (Object.keys(images).length === 0 && service?.staffList) {
        let count = 1;
        service.staffList.forEach(staff => {
            staff.segments?.forEach((seg: any) => {
                if (seg.handoverPhotoUrl) {
                    images[`Ảnh ${count++} (${staff.ktvId})`] = seg.handoverPhotoUrl;
                }
                if (seg.handoverPhotoUrls) {
                    seg.handoverPhotoUrls.forEach((url: string) => {
                        images[`Ảnh ${count++} (${staff.ktvId})`] = url;
                    });
                }
            });
        });
    }
    
    const imageList = Object.entries(images).map(([label, url]) => ({ label, url }));

    const handleApprove = async () => {
        setIsSubmitting(true);
        try {
            await onApprove(service!.id, comment);
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
            await onReject(service!.id, comment);
            onClose();
            setComment('');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <AnimatePresence>
                {isOpen && service && (
                    <div key="handover-modal-backdrop" className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-0">
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
                                
                                {imageList.length > 0 ? (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                        {imageList.map((img, idx) => (
                                            <div 
                                                key={img.label} 
                                                onClick={() => setCurrentImageIndex(idx)}
                                                className="group relative aspect-square bg-gray-100 rounded-xl overflow-hidden border border-gray-200 shadow-sm cursor-pointer"
                                            >
                                                <img 
                                                    src={img.url} 
                                                    alt={img.label} 
                                                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                />
                                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-6">
                                                    <p className="text-white text-xs font-medium truncate">{img.label}</p>
                                                </div>
                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                                    <div className="bg-white/90 p-2 rounded-full shadow-lg">
                                                        <Maximize2 size={16} className="text-gray-700" />
                                                    </div>
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
                )}
            </AnimatePresence>

            {/* Gallery Fullscreen Overlay */}
            <AnimatePresence>
                {isOpen && service && currentImageIndex !== null && imageList.length > 0 && (
                    <motion.div
                        key="gallery-fullscreen-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm"
                        onClick={() => setCurrentImageIndex(null)}
                    >
                        <button 
                            className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-[101]"
                            onClick={(e) => { e.stopPropagation(); setCurrentImageIndex(null); }}
                        >
                            <X size={24} />
                        </button>
                        
                        {imageList.length > 1 && (
                            <button 
                                className="absolute left-4 p-4 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-[101]"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentImageIndex((prev) => (prev! === 0 ? imageList.length - 1 : prev! - 1));
                                }}
                            >
                                <ChevronLeft size={32} />
                            </button>
                        )}

                        <motion.img 
                            key={currentImageIndex}
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            src={imageList[currentImageIndex].url}
                            alt={imageList[currentImageIndex].label}
                            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
                            onClick={(e) => e.stopPropagation()}
                        />
                        
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/50 px-4 py-2 rounded-full text-white text-sm font-medium backdrop-blur-md">
                            {imageList[currentImageIndex].label} ({currentImageIndex + 1} / {imageList.length})
                        </div>

                        {imageList.length > 1 && (
                            <button 
                                className="absolute right-4 p-4 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-[101]"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentImageIndex((prev) => (prev! === imageList.length - 1 ? 0 : prev! + 1));
                                }}
                            >
                                <ChevronRight size={32} />
                            </button>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
} 
