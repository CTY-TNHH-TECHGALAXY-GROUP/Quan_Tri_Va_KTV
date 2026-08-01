'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, MessageSquare, AlertCircle, ChevronLeft, ChevronRight, Maximize2, RotateCcw, Banknote, ShieldX } from 'lucide-react';
import { ServiceBlock } from '../types';

// 🔧 UI CONFIGURATION
const REJECT_OPTIONS = [
    { 
        key: 'REDO' as const, 
        label: 'Dọn lại', 
        description: 'KTV phải dọn lại phòng (tối đa 2 lần)',
        icon: RotateCcw, 
        color: 'text-amber-700', 
        bg: 'bg-amber-50 hover:bg-amber-100 border-amber-200',
        needsReason: false 
    },
    { 
        key: 'DEDUCT' as const, 
        label: 'Trừ tiền', 
        description: 'Duyệt ảnh nhưng trừ phạt 50,000đ',
        icon: Banknote, 
        color: 'text-rose-700', 
        bg: 'bg-rose-50 hover:bg-rose-100 border-rose-200',
        needsReason: true 
    },
    { 
        key: 'CONFISCATE' as const, 
        label: 'Tước tiền tua', 
        description: 'Tước toàn bộ tiền tua đơn này',
        icon: ShieldX, 
        color: 'text-red-800', 
        bg: 'bg-red-50 hover:bg-red-100 border-red-200',
        needsReason: true 
    },
];

type RejectOption = 'REDO' | 'DEDUCT' | 'CONFISCATE';

interface ReviewHandoverModalProps {
    isOpen: boolean;
    onClose: () => void;
    service: ServiceBlock | null;
    onApprove: (itemId: string, comment: string) => Promise<void>;
    onReject: (itemId: string, rejectOption: RejectOption, reason: string) => Promise<void>;
}

export function ReviewHandoverModal({ isOpen, onClose, service, onApprove, onReject }: ReviewHandoverModalProps) {
    const [comment, setComment] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState<number | null>(null);
    
    // V5: 2-step rejection flow
    const [rejectStep, setRejectStep] = useState<'idle' | 'select-option' | 'confirm'>('idle');
    const [selectedRejectOption, setSelectedRejectOption] = useState<RejectOption | null>(null);

    let handoverImages: Record<string, string> = {};
    if (service?.handover_images && Object.keys(service.handover_images).length > 0) {
        try {
            handoverImages = typeof service.handover_images === 'string' 
                ? JSON.parse(service.handover_images) 
                : service.handover_images;
        } catch (e) {
            console.error('Failed to parse handover images', e);
        }
    }

    // Fallback: scan segments for photos
    if (Object.keys(handoverImages).length === 0 && service?.staffList) {
        let count = 1;
        service.staffList.forEach(staff => {
            staff.segments?.forEach((seg: any) => {
                if (seg.handoverPhotoUrl) {
                    handoverImages[`Bàn giao ${count++} (${staff.ktvId})`] = seg.handoverPhotoUrl;
                }
                if (seg.handoverPhotoUrls) {
                    seg.handoverPhotoUrls.forEach((url: string) => {
                        handoverImages[`Bàn giao ${count++} (${staff.ktvId})`] = url;
                    });
                }
            });
        });
    }
    
    let startImages: Record<string, string> = {};
    if (service?.staffList) {
        let count = 1;
        service.staffList.forEach(staff => {
            staff.segments?.forEach((seg: any) => {
                if (seg.startPhotoUrl) {
                    startImages[`Bắt đầu ${count++} (${staff.ktvId})`] = seg.startPhotoUrl;
                }
                if (seg.startPhotoUrls) {
                    seg.startPhotoUrls.forEach((url: string) => {
                        startImages[`Bắt đầu ${count++} (${staff.ktvId})`] = url;
                    });
                }
            });
        });
    }

    const handoverList = Object.entries(handoverImages).map(([label, url]) => ({ label, url, type: 'handover' }));
    const startList = Object.entries(startImages).map(([label, url]) => ({ label, url, type: 'start' }));
    const imageList = [...startList, ...handoverList];

    const handleApprove = async () => {
        setIsSubmitting(true);
        try {
            await onApprove(service!.id, comment);
            onClose();
            resetState();
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRejectConfirm = async () => {
        if (!selectedRejectOption) return;
        const opt = REJECT_OPTIONS.find(o => o.key === selectedRejectOption);
        if (opt?.needsReason && !comment.trim()) {
            alert('Vui lòng nhập lý do cho hành động này.');
            return;
        }
        setIsSubmitting(true);
        try {
            await onReject(service!.id, selectedRejectOption, comment || 'Không đạt yêu cầu');
            onClose();
            resetState();
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetState = () => {
        setComment('');
        setRejectStep('idle');
        setSelectedRejectOption(null);
    };

    const handleClose = () => {
        if (!isSubmitting) {
            onClose();
            resetState();
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
                            onClick={handleClose}
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
                            onClick={handleClose}
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
                                {startList.length > 0 && (
                                    <div className="mb-6">
                                        <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                            Ảnh Bắt Đầu ({startList.length})
                                        </h3>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                            {startList.map((img) => {
                                                const idx = imageList.findIndex(x => x.url === img.url && x.label === img.label);
                                                return (
                                                    <div 
                                                        key={img.label} 
                                                        onClick={() => setCurrentImageIndex(idx)}
                                                        className="group relative aspect-square bg-gray-100 rounded-xl overflow-hidden border border-emerald-200 shadow-sm cursor-pointer"
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
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                        Ảnh Bàn Giao ({handoverList.length})
                                    </h3>
                                    
                                    {handoverList.length > 0 ? (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                            {handoverList.map((img) => {
                                                const idx = imageList.findIndex(x => x.url === img.url && x.label === img.label);
                                                return (
                                                    <div 
                                                        key={img.label} 
                                                        onClick={() => setCurrentImageIndex(idx)}
                                                        className="group relative aspect-square bg-gray-100 rounded-xl overflow-hidden border border-blue-200 shadow-sm cursor-pointer"
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
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 flex items-center gap-3 text-orange-700">
                                            <AlertCircle size={20} className="shrink-0" />
                                            <p className="text-sm">Không có ảnh bàn giao nào được gửi kèm.</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* V5: Reject Options (Step 2) */}
                            {rejectStep === 'select-option' && (
                                <motion.div 
                                    initial={{ opacity: 0, y: 10 }} 
                                    animate={{ opacity: 1, y: 0 }}
                                    className="space-y-3"
                                >
                                    <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                        Chọn hành động từ chối
                                    </h3>
                                    <div className="space-y-2">
                                        {REJECT_OPTIONS.map((opt) => {
                                            const Icon = opt.icon;
                                            return (
                                                <button
                                                    key={opt.key}
                                                    onClick={() => {
                                                        setSelectedRejectOption(opt.key);
                                                        setRejectStep('confirm');
                                                    }}
                                                    className={`w-full p-4 rounded-xl border-2 text-left transition-all active:scale-[0.98] flex items-center gap-4 ${opt.bg}`}
                                                >
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${opt.color} bg-white/80`}>
                                                        <Icon size={20} />
                                                    </div>
                                                    <div>
                                                        <span className={`font-bold text-sm ${opt.color}`}>{opt.label}</span>
                                                        <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <button
                                        onClick={() => setRejectStep('idle')}
                                        className="text-sm text-gray-500 hover:text-gray-700 font-medium"
                                    >
                                        ← Quay lại
                                    </button>
                                </motion.div>
                            )}

                            {/* V5: Confirm Step (Step 3) */}
                            {rejectStep === 'confirm' && selectedRejectOption && (
                                <motion.div 
                                    initial={{ opacity: 0, y: 10 }} 
                                    animate={{ opacity: 1, y: 0 }}
                                    className="space-y-3"
                                >
                                    {(() => {
                                        const opt = REJECT_OPTIONS.find(o => o.key === selectedRejectOption)!;
                                        const Icon = opt.icon;
                                        return (
                                            <div className={`p-4 rounded-xl border-2 ${opt.bg}`}>
                                                <div className="flex items-center gap-3 mb-3">
                                                    <Icon size={20} className={opt.color} />
                                                    <span className={`font-bold ${opt.color}`}>Xác nhận: {opt.label}</span>
                                                </div>
                                                <p className="text-xs text-gray-600 mb-3">{opt.description}</p>
                                            </div>
                                        );
                                    })()}
                                    
                                    <textarea
                                        value={comment}
                                        onChange={(e) => setComment(e.target.value)}
                                        placeholder={selectedRejectOption === 'REDO' ? 'Lý do dọn lại (tùy chọn)...' : 'Nhập lý do (BẮT BUỘC)...'}
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-4 text-sm focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 transition-all outline-none resize-none min-h-[80px]"
                                    />

                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => { setRejectStep('select-option'); setSelectedRejectOption(null); }}
                                            className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-600 font-bold text-sm active:scale-95"
                                        >
                                            ← Quay lại
                                        </button>
                                        <button
                                            onClick={handleRejectConfirm}
                                            disabled={isSubmitting}
                                            className="flex-1 py-3 rounded-xl bg-rose-600 text-white font-bold text-sm active:scale-95 shadow-lg disabled:opacity-50"
                                        >
                                            {isSubmitting ? 'Đang xử lý...' : 'Xác nhận'}
                                        </button>
                                    </div>
                                </motion.div>
                            )}

                            {/* Comment Input (only show on idle/approve mode) */}
                            {rejectStep === 'idle' && (
                                <div>
                                    <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                        <MessageSquare size={16} className="text-gray-400" />
                                        Ghi chú / Nhận xét
                                    </h3>
                                    <textarea
                                        value={comment}
                                        onChange={(e) => setComment(e.target.value)}
                                        placeholder="Nhập nhận xét của bạn về tình trạng phòng... (Tùy chọn)"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-4 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none resize-none min-h-[100px]"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer Actions — only show on idle mode */}
                    {rejectStep === 'idle' && (
                        <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
                            <button
                                onClick={() => setRejectStep('select-option')}
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
                    )}
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
