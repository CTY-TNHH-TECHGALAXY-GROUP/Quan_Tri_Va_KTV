'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Check, X, AlertCircle } from 'lucide-react';
import { getReminders, createReminder, updateReminder, deleteReminder, ReminderInput } from './actions';
import { motion, AnimatePresence } from 'motion/react';
import { AppLayout } from '@/components/layout/AppLayout';

export default function CustomerRemindersPage() {
    const [reminders, setReminders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<ReminderInput>({
        contentVN: '',
        contentEN: '',
        contentCN: '',
        contentJP: '',
        contentKR: '',
        is_active: true,
        order_index: 0
    });

    const [isSaving, setIsSaving] = useState(false);

    const loadReminders = async () => {
        setLoading(true);
        const res = await getReminders();
        if (res.success && res.data) {
            setReminders(res.data);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadReminders();
    }, []);

    const handleOpenModal = (reminder?: any) => {
        if (reminder) {
            setEditingId(reminder.id);
            setFormData({
                contentVN: reminder.contentVN || '',
                contentEN: reminder.contentEN || '',
                contentCN: reminder.contentCN || '',
                contentJP: reminder.contentJP || '',
                contentKR: reminder.contentKR || '',
                is_active: reminder.is_active,
                order_index: reminder.order_index || 0
            });
        } else {
            setEditingId(null);
            setFormData({
                contentVN: '',
                contentEN: '',
                contentCN: '',
                contentJP: '',
                contentKR: '',
                is_active: true,
                order_index: reminders.length > 0 ? Math.max(...reminders.map(r => r.order_index || 0)) + 1 : 0
            });
        }
        setIsModalOpen(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        if (editingId) {
            await updateReminder(editingId, formData);
        } else {
            await createReminder(formData);
        }
        setIsSaving(false);
        setIsModalOpen(false);
        loadReminders();
    };

    const handleDelete = async (id: string) => {
        if (confirm('Bạn có chắc chắn muốn xóa câu hỏi này không?')) {
            await deleteReminder(id);
            loadReminders();
        }
    };

    const handleToggleActive = async (id: string, currentStatus: boolean) => {
        await updateReminder(id, { is_active: !currentStatus });
        loadReminders();
    };

    return (
        <AppLayout title="Câu Hỏi Khảo Sát">
            <div className="p-6 max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-black text-gray-900 mb-2">Câu Hỏi Khảo Sát (Reminders)</h1>
                    <p className="text-gray-500 font-medium">Quản lý các câu hỏi hiển thị cho khách hàng ở trang Journey.</p>
                </div>
                <button
                    onClick={() => handleOpenModal()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-colors"
                >
                    <Plus size={20} />
                    Thêm Câu Hỏi
                </button>
            </div>

            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
                {loading ? (
                    <div className="py-20 text-center text-gray-400 font-medium">Đang tải dữ liệu...</div>
                ) : reminders.length === 0 ? (
                    <div className="py-20 flex flex-col items-center text-gray-400">
                        <AlertCircle size={48} className="mb-4 text-gray-300" />
                        <p className="font-medium">Chưa có câu hỏi nào. Bấm "Thêm Câu Hỏi" để bắt đầu.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-gray-100 text-sm font-bold text-gray-400 uppercase tracking-wider">
                                    <th className="py-4 pl-4 font-black">STT (Thứ tự)</th>
                                    <th className="py-4 px-2 font-black">Nội dung (Tiếng Việt)</th>
                                    <th className="py-4 px-2 font-black">Hiển thị</th>
                                    <th className="py-4 pr-4 text-right font-black">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reminders.map((reminder) => (
                                    <tr key={reminder.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                        <td className="py-4 pl-4 font-bold text-gray-700">
                                            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                                                {reminder.order_index}
                                            </div>
                                        </td>
                                        <td className="py-4 px-2">
                                            <div className="font-bold text-gray-900 line-clamp-2">{reminder.contentVN}</div>
                                            <div className="text-xs text-gray-500 font-medium truncate mt-1">EN: {reminder.contentEN}</div>
                                        </td>
                                        <td className="py-4 px-2">
                                            <button
                                                onClick={() => handleToggleActive(reminder.id, reminder.is_active)}
                                                className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out flex ${reminder.is_active ? 'bg-emerald-500 justify-end' : 'bg-gray-300 justify-start'}`}
                                            >
                                                <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
                                            </button>
                                        </td>
                                        <td className="py-4 pr-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleOpenModal(reminder)}
                                                    className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-100 transition-colors"
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(reminder.id)}
                                                    className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-100 transition-colors"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal */}
            <AnimatePresence>
                {isModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-3xl p-6 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
                        >
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-black text-gray-900">{editingId ? 'Cập nhật Câu Hỏi' : 'Thêm Câu Hỏi Mới'}</h2>
                                <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:bg-gray-100 p-2 rounded-xl transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            <form onSubmit={handleSave} className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2 sm:col-span-1">
                                        <label className="block text-sm font-bold text-gray-700 mb-1">Thứ tự hiển thị (Order Index)</label>
                                        <input
                                            type="number"
                                            required
                                            value={formData.order_index}
                                            onChange={(e) => setFormData({ ...formData, order_index: parseInt(e.target.value) || 0 })}
                                            className="w-full px-4 py-2.5 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-0 font-medium"
                                        />
                                    </div>
                                    <div className="col-span-2 sm:col-span-1 flex items-center pt-6">
                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <div
                                                onClick={() => setFormData({ ...formData, is_active: !formData.is_active })}
                                                className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out flex ${formData.is_active ? 'bg-emerald-500 justify-end' : 'bg-gray-300 justify-start'}`}
                                            >
                                                <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
                                            </div>
                                            <span className="font-bold text-gray-700">{formData.is_active ? 'Đang bật' : 'Đang ẩn'}</span>
                                        </label>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Tiếng Việt (VN) *</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.contentVN}
                                        onChange={(e) => setFormData({ ...formData, contentVN: e.target.value })}
                                        className="w-full px-4 py-2.5 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-0 font-medium"
                                        placeholder="Ví dụ: Bạn có hài lòng với dịch vụ không?"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Tiếng Anh (EN)</label>
                                    <input
                                        type="text"
                                        value={formData.contentEN}
                                        onChange={(e) => setFormData({ ...formData, contentEN: e.target.value })}
                                        className="w-full px-4 py-2.5 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-0 font-medium"
                                        placeholder="Ví dụ: Are you satisfied with our service?"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Tiếng Trung (CN)</label>
                                    <input
                                        type="text"
                                        value={formData.contentCN}
                                        onChange={(e) => setFormData({ ...formData, contentCN: e.target.value })}
                                        className="w-full px-4 py-2.5 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-0 font-medium"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Tiếng Nhật (JP)</label>
                                    <input
                                        type="text"
                                        value={formData.contentJP}
                                        onChange={(e) => setFormData({ ...formData, contentJP: e.target.value })}
                                        className="w-full px-4 py-2.5 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-0 font-medium"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Tiếng Hàn (KR)</label>
                                    <input
                                        type="text"
                                        value={formData.contentKR}
                                        onChange={(e) => setFormData({ ...formData, contentKR: e.target.value })}
                                        className="w-full px-4 py-2.5 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-0 font-medium"
                                    />
                                </div>

                                <div className="pt-4 flex justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setIsModalOpen(false)}
                                        className="px-5 py-2.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                                    >
                                        Hủy Bỏ
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSaving}
                                        className="px-5 py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                                    >
                                        {isSaving ? 'Đang lưu...' : (editingId ? 'Cập nhật' : 'Thêm mới')}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
        </AppLayout>
    );
}
