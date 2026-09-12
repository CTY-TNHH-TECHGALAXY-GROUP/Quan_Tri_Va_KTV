'use client';

import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import { useSupportTasksAdmin } from './SupportTasksAdmin.logic';
import {
    ClipboardList, CheckSquare, Plus, Send,
    User, MapPin, CheckCircle, Clock, Image as ImageIcon, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Image from 'next/image';

export default function SupportTasksAdmin() {
    const { user } = useAuth();
    const {
        templates, areas, staffs, tasks, loading,
        addTemplate, addArea, assignTasks
    } = useSupportTasksAdmin();

    const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
    const [selectedStaff, setSelectedStaff] = useState<string>('');
    const [selectedArea, setSelectedArea] = useState<string>('');

    const [newTemplateName, setNewTemplateName] = useState('');
    const [newAreaName, setNewAreaName] = useState('');
    const [showPhotoModal, setShowPhotoModal] = useState<string | null>(null);

    const handleAssign = async () => {
        if (selectedTemplates.length === 0 || !selectedStaff) {
            alert('Vui lòng chọn ít nhất 1 công việc và 1 nhân viên.');
            return;
        }

        const payload = selectedTemplates.map(templateId => {
            const tpl = templates.find(t => t.id === templateId);
            return {
                task_id: templateId,
                task_name: tpl?.task_name || 'Công việc không tên',
                assignee_id: selectedStaff,
                area_id: selectedArea || null,
                created_by: user?.id,
                status: 'PENDING'
            };
        });

        await assignTasks(payload);
        setSelectedTemplates([]);
        setSelectedStaff('');
        setSelectedArea('');
    };

    const toggleTemplate = (id: string) => {
        if (selectedTemplates.includes(id)) {
            setSelectedTemplates(prev => prev.filter(t => t !== id));
        } else {
            setSelectedTemplates(prev => [...prev, id]);
        }
    };

    if (loading) return <AppLayout title="Quản Lý Hậu Cần"><div className="p-8 text-center">Đang tải...</div></AppLayout>;

    return (
        <AppLayout title="Quản Lý Hậu Cần">
            <div className="max-w-7xl mx-auto p-4 lg:p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Column 1 & 2: Giao việc & Danh mục */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Bảng Giao Việc */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <Send size={20} className="text-indigo-500" /> Bảng Giao Việc
                        </h2>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">Nhân viên thực hiện <span className="text-red-500">*</span></label>
                                <select 
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={selectedStaff}
                                    onChange={(e) => setSelectedStaff(e.target.value)}
                                >
                                    <option value="">-- Chọn nhân viên Hậu cần --</option>
                                    {staffs.map(s => (
                                        <option key={s.id} value={s.id}>{s.fullName}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">Khu vực (Không bắt buộc)</label>
                                <select 
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={selectedArea}
                                    onChange={(e) => setSelectedArea(e.target.value)}
                                >
                                    <option value="">-- Chọn khu vực --</option>
                                    {areas.map(a => (
                                        <option key={a.id} value={a.id}>{a.area_name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Chọn công việc <span className="text-red-500">*</span></label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {templates.map(tpl => {
                                    const isSelected = selectedTemplates.includes(tpl.id);
                                    return (
                                        <button
                                            key={tpl.id}
                                            onClick={() => toggleTemplate(tpl.id)}
                                            className={`p-3 rounded-xl border text-left flex items-start gap-2 transition-all ${
                                                isSelected 
                                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' 
                                                : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'
                                            }`}
                                        >
                                            <div className="mt-0.5">
                                                <CheckSquare size={16} className={isSelected ? 'text-indigo-600' : 'text-slate-300'} />
                                            </div>
                                            <span className="text-sm font-medium line-clamp-2">{tpl.task_name}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <button 
                            onClick={handleAssign}
                            disabled={selectedTemplates.length === 0 || !selectedStaff}
                            className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            <Send size={20} /> Giao {selectedTemplates.length} công việc
                        </button>
                    </div>

                    {/* Quản lý danh mục */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                            <h3 className="text-base font-bold text-slate-800 mb-4">Thêm Mẫu Công Việc</h3>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                                    placeholder="Ví dụ: Dọn rác nhà vệ sinh"
                                    value={newTemplateName}
                                    onChange={(e) => setNewTemplateName(e.target.value)}
                                />
                                <button 
                                    onClick={() => { addTemplate(newTemplateName); setNewTemplateName(''); }}
                                    className="p-2 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200"
                                >
                                    <Plus size={20} />
                                </button>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                            <h3 className="text-base font-bold text-slate-800 mb-4">Thêm Khu Vực</h3>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                                    placeholder="Ví dụ: Tầng 1"
                                    value={newAreaName}
                                    onChange={(e) => setNewAreaName(e.target.value)}
                                />
                                <button 
                                    onClick={() => { addArea(newAreaName); setNewAreaName(''); }}
                                    className="p-2 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200"
                                >
                                    <Plus size={20} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Column 3: Tiến độ hôm nay */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-[calc(100vh-8rem)] overflow-hidden flex flex-col">
                    <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ClipboardList size={20} className="text-emerald-500" /> 
                            Tiến độ hôm nay
                        </div>
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">{tasks.length} Việc</span>
                    </h2>
                    
                    <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                        {tasks.length === 0 ? (
                            <div className="text-center py-10 text-slate-400 text-sm">Chưa có công việc nào được giao hôm nay.</div>
                        ) : (
                            tasks.map(task => (
                                <div key={task.id} className="p-4 rounded-xl border border-slate-100 bg-slate-50 relative overflow-hidden group">
                                    {task.status === 'DONE' && (
                                        <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                                    )}
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className={`font-semibold text-sm ${task.status === 'DONE' ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                                            {task.task_name}
                                        </h4>
                                        {task.status === 'DONE' ? (
                                            <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded flex items-center gap-1">
                                                <CheckCircle size={12} /> Xong
                                            </span>
                                        ) : (
                                            <span className="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded flex items-center gap-1">
                                                <Clock size={12} /> Đang chờ
                                            </span>
                                        )}
                                    </div>
                                    
                                    <div className="flex items-center gap-3 text-xs text-slate-500 mb-3">
                                        <div className="flex items-center gap-1"><User size={12} /> {task.Staff?.fullName || '---'}</div>
                                        {task.SupportAreas && (
                                            <div className="flex items-center gap-1 text-indigo-600"><MapPin size={12} /> {task.SupportAreas.area_name}</div>
                                        )}
                                    </div>

                                    {task.status === 'DONE' && task.photo_url && (
                                        <button 
                                            onClick={() => setShowPhotoModal(task.photo_url)}
                                            className="w-full py-2 bg-white border border-emerald-200 text-emerald-700 text-xs font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-emerald-50 transition-colors"
                                        >
                                            <ImageIcon size={14} /> Xem ảnh minh chứng
                                        </button>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

            </div>

            {/* Photo View Modal */}
            <AnimatePresence>
                {showPhotoModal && (
                    <motion.div 
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4"
                        onClick={() => setShowPhotoModal(null)}
                    >
                        <button className="absolute top-4 right-4 text-white p-2 hover:bg-white/20 rounded-full">
                            <X size={24} />
                        </button>
                        <div className="relative max-w-2xl w-full max-h-[90vh] rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                            <img src={showPhotoModal} alt="Minh chứng" className="w-full h-auto object-contain" />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </AppLayout>
    );
}
