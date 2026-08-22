import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Clock, Save, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface TimeEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    orderId: string;
    itemId: string;
    onSuccess?: () => void;
}

export function TimeEditorModal({ isOpen, onClose, orderId, itemId, onSuccess }: TimeEditorModalProps) {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [segments, setSegments] = useState<any[]>([]);
    
    // Lưu dưới dạng mảng các object thời gian theo từng KTV (từng segment)
    const [segmentTimes, setSegmentTimes] = useState<{ktvId: string, actualStartTime: string, actualEndTime: string}[]>([]);

    useEffect(() => {
        if (isOpen && itemId) {
            loadItemData();
        }
    }, [isOpen, itemId]);

    const loadItemData = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from('BookingItems').select('segments').eq('id', itemId).single();
            if (error) throw error;
            if (data && data.segments) {
                let segs = typeof data.segments === 'string' ? JSON.parse(data.segments) : data.segments;
                if (!Array.isArray(segs)) segs = [];
                setSegments(segs);
                
                // Khởi tạo state chỉnh sửa
                const initialTimes = segs.map((seg: any) => ({
                    ktvId: seg.ktvId || 'Unknown',
                    actualStartTime: seg.actualStartTime || '',
                    actualEndTime: seg.actualEndTime || '',
                }));
                setSegmentTimes(initialTimes);
            }
        } catch (err) {
            console.error('Error loading item times:', err);
            alert('Lỗi tải dữ liệu thời gian');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const updatedSegments = segments.map((seg, idx) => {
                const newSeg = { ...seg };
                if (segmentTimes[idx]) {
                    newSeg.actualStartTime = segmentTimes[idx].actualStartTime || null;
                    newSeg.actualEndTime = segmentTimes[idx].actualEndTime || null;
                }
                return newSeg;
            });

            const { error } = await supabase.from('BookingItems').update({
                segments: JSON.stringify(updatedSegments)
            }).eq('id', itemId);

            if (error) throw error;

            alert('Đã lưu thời gian thành công! (Dữ liệu sẽ được tự động cập nhật qua Realtime)');
            if (onSuccess) onSuccess();
            onClose();
        } catch (err) {
            console.error('Error saving item times:', err);
            alert('Có lỗi xảy ra khi lưu thời gian');
        } finally {
            setSaving(false);
        }
    };

    const updateTime = (idx: number, field: 'actualStartTime' | 'actualEndTime', value: string) => {
        const newTimes = [...segmentTimes];
        newTimes[idx] = { ...newTimes[idx], [field]: value };
        setSegmentTimes(newTimes);
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    onClick={onClose}
                />
                
                <motion.div 
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="relative bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                >
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center shadow-sm text-blue-600">
                                <Clock size={20} />
                            </div>
                            <div>
                                <h2 className="text-xl font-black text-gray-900">Chỉnh Sửa Thời Gian</h2>
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-0.5">Dịch Vụ ID: {itemId.substring(0,8)}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-xl transition-colors text-gray-400 hover:text-gray-600">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-6 overflow-y-auto">
                        <div className="bg-orange-50 border border-orange-100 p-4 rounded-2xl mb-6">
                            <div className="flex gap-3">
                                <AlertCircle className="text-orange-500 shrink-0 mt-0.5" size={20} />
                                <div className="text-sm font-medium text-orange-800 leading-relaxed">
                                    <strong>Cảnh báo:</strong> Việc chỉnh sửa thời gian có thể ảnh hưởng đến thuật toán phân ca và thu nhập. 
                                    Hãy đảm bảo bạn nhập đúng định dạng giờ hệ thống (VD: <code className="bg-white px-1 py-0.5 rounded text-orange-900 font-mono text-xs">2026-08-17T10:30:00+07:00</code>).
                                </div>
                            </div>
                        </div>

                        {loading ? (
                            <div className="flex justify-center p-8">
                                <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {segmentTimes.map((st, idx) => (
                                    <div key={idx} className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                                        <div className="flex items-center gap-2 mb-4">
                                            <span className="text-xs font-black uppercase tracking-wider text-gray-400">CHẶNG {idx + 1} • KTV:</span>
                                            <span className="text-sm font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                                {st.ktvId}
                                            </span>
                                        </div>
                                        
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Thời Gian Bắt Đầu</label>
                                                <input 
                                                    type="text" 
                                                    value={st.actualStartTime}
                                                    onChange={e => updateTime(idx, 'actualStartTime', e.target.value)}
                                                    placeholder="2026-08-17T..."
                                                    className="w-full text-sm font-medium bg-white border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Thời Gian Kết Thúc</label>
                                                <input 
                                                    type="text" 
                                                    value={st.actualEndTime}
                                                    onChange={e => updateTime(idx, 'actualEndTime', e.target.value)}
                                                    placeholder="2026-08-17T..."
                                                    className="w-full text-sm font-medium bg-white border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                
                                {segmentTimes.length === 0 && (
                                    <div className="text-center p-6 text-gray-400 font-medium">
                                        Không tìm thấy chặng nào cho dịch vụ này.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
                        <button 
                            onClick={onClose}
                            className="flex-1 px-6 py-4 rounded-2xl font-black text-sm uppercase tracking-wider text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
                        >
                            Hủy Bỏ
                        </button>
                        <button 
                            onClick={handleSave}
                            disabled={saving || loading || segmentTimes.length === 0}
                            className="flex-[2] px-6 py-4 rounded-2xl font-black text-sm uppercase tracking-wider text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-indigo-200 flex items-center justify-center gap-2"
                        >
                            {saving ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <Save size={18} />
                                    Lưu Thay Đổi
                                </>
                            )}
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
