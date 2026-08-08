'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, AlertCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SystemConfig {
    id: string;
    key: string;
    value: any;
    description: string;
    updated_at: string;
}

export function SystemConfigsTable() {
    const [configs, setConfigs] = useState<SystemConfig[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    
    // States for Editing
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState<string>('');
    const [editDesc, setEditDesc] = useState<string>('');
    
    // States for Adding new
    const [isAdding, setIsAdding] = useState(false);
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');
    const [newDesc, setNewDesc] = useState('');

    useEffect(() => {
        if (isExpanded && configs.length === 0) {
            fetchConfigs();
        }
    }, [isExpanded]);

    const fetchConfigs = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/admin/settings/system/advanced');
            const result = await res.json();
            if (result.success) {
                setConfigs(result.data);
            }
        } catch (error) {
            console.error('Lỗi tải danh sách cấu hình:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEdit = (config: SystemConfig) => {
        setEditingId(config.id);
        // Serialize value to string for editing
        setEditValue(typeof config.value === 'object' ? JSON.stringify(config.value) : String(config.value));
        setEditDesc(config.description || '');
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditValue('');
        setEditDesc('');
    };

    const tryParseValue = (valStr: string) => {
        if (!valStr) return null;
        if (valStr.toLowerCase() === 'true') return true;
        if (valStr.toLowerCase() === 'false') return false;
        if (!isNaN(Number(valStr))) return Number(valStr);
        try {
            return JSON.parse(valStr);
        } catch {
            return valStr;
        }
    };

    const saveEdit = async (id: string) => {
        setIsSaving(true);
        try {
            const parsedValue = tryParseValue(editValue);
            const res = await fetch('/api/admin/settings/system/advanced', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id,
                    value: parsedValue,
                    description: editDesc
                })
            });
            const result = await res.json();
            if (result.success) {
                setConfigs(prev => prev.map(c => c.id === id ? { ...c, value: parsedValue, description: editDesc, updated_at: new Date().toISOString() } : c));
                cancelEdit();
            } else {
                alert('Lỗi: ' + result.error);
            }
        } catch (error) {
            console.error(error);
            alert('Lỗi khi lưu.');
        } finally {
            setIsSaving(false);
        }
    };

    const saveNew = async () => {
        if (!newKey.trim()) {
            alert('Vui lòng nhập Key');
            return;
        }
        setIsSaving(true);
        try {
            const parsedValue = tryParseValue(newValue);
            const res = await fetch('/api/admin/settings/system/advanced', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: newKey.trim(),
                    value: parsedValue,
                    description: newDesc
                })
            });
            const result = await res.json();
            if (result.success && result.data) {
                setConfigs([...configs, result.data]);
                setIsAdding(false);
                setNewKey('');
                setNewValue('');
                setNewDesc('');
            } else {
                alert('Lỗi: ' + result.error);
            }
        } catch (error) {
            console.error(error);
            alert('Lỗi thêm mới.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string, key: string) => {
        if (!confirm(`Bạn có chắc muốn xóa cấu hình "${key}" không? Hành động này có thể gây lỗi hệ thống nếu key đang được sử dụng.`)) {
            return;
        }
        
        try {
            const res = await fetch(`/api/admin/settings/system/advanced?id=${id}`, {
                method: 'DELETE'
            });
            const result = await res.json();
            if (result.success) {
                setConfigs(prev => prev.filter(c => c.id !== id));
            } else {
                alert('Lỗi: ' + result.error);
            }
        } catch (error) {
            console.error(error);
            alert('Lỗi xóa cấu hình.');
        }
    };

    return (
        <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 mt-6 overflow-hidden">
            <div 
                className="flex items-center justify-between cursor-pointer select-none group"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center group-hover:bg-slate-100 transition-colors">
                        <AlertCircle size={20} className="text-slate-500" />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                            Bảng Cấu Hình Nâng Cao (SystemConfigs)
                            {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                        </h2>
                        <p className="text-xs font-medium text-rose-500 mt-0.5">⚠️ Chú ý: Khu vực dành riêng cho Quản trị viên kỹ thuật.</p>
                    </div>
                </div>
                
                {isExpanded && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsAdding(true); }}
                        disabled={isAdding}
                        className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                        <Plus size={16} /> Thêm Cấu Hình
                    </button>
                )}
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0, marginTop: 0 }}
                        animate={{ height: 'auto', opacity: 1, marginTop: 24 }}
                        exit={{ height: 0, opacity: 0, marginTop: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b-2 border-gray-100">
                                        <th className="py-3 px-4 text-xs font-black uppercase text-gray-400 w-1/4">Key</th>
                                        <th className="py-3 px-4 text-xs font-black uppercase text-gray-400 w-1/4">Value</th>
                                        <th className="py-3 px-4 text-xs font-black uppercase text-gray-400 w-1/3">Mô tả</th>
                                        <th className="py-3 px-4 text-xs font-black uppercase text-gray-400 text-right">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                        {/* New Item Form */}
                        <AnimatePresence>
                            {isAdding && (
                                <motion.tr 
                                    initial={{ opacity: 0, backgroundColor: '#f8fafc' }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="bg-slate-50"
                                >
                                    <td className="p-3">
                                        <input 
                                            type="text" 
                                            value={newKey}
                                            onChange={(e) => setNewKey(e.target.value)}
                                            placeholder="Tên biến (VD: my_key)"
                                            className="w-full text-sm font-mono border-gray-200 rounded-lg focus:ring-slate-500 p-2"
                                        />
                                    </td>
                                    <td className="p-3">
                                        <textarea
                                            value={newValue}
                                            onChange={(e) => setNewValue(e.target.value)}
                                            placeholder="Giá trị (số, true/false, chữ...)"
                                            className="w-full text-sm font-mono border-gray-200 rounded-lg focus:ring-slate-500 p-2 min-h-[40px]"
                                        />
                                    </td>
                                    <td className="p-3">
                                        <input
                                            type="text"
                                            value={newDesc}
                                            onChange={(e) => setNewDesc(e.target.value)}
                                            placeholder="Mô tả chức năng"
                                            className="w-full text-sm border-gray-200 rounded-lg focus:ring-slate-500 p-2"
                                        />
                                    </td>
                                    <td className="p-3">
                                        <div className="flex items-center justify-end gap-2">
                                            <button onClick={saveNew} disabled={isSaving} className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-200 disabled:opacity-50">
                                                <Save size={16} />
                                            </button>
                                            <button onClick={() => setIsAdding(false)} disabled={isSaving} className="p-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 disabled:opacity-50">
                                                <X size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </motion.tr>
                            )}
                        </AnimatePresence>

                        {isLoading ? (
                            <tr>
                                <td colSpan={4} className="py-12 text-center text-gray-400">
                                    <Loader2 className="mx-auto animate-spin mb-2" size={24} />
                                    Đang tải dữ liệu...
                                </td>
                            </tr>
                        ) : configs.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="py-12 text-center text-gray-400 font-medium">
                                    Chưa có cấu hình nào.
                                </td>
                            </tr>
                        ) : (
                            configs.map(config => {
                                const isEditing = editingId === config.id;

                                return (
                                    <tr key={config.id} className="hover:bg-gray-50/50 transition-colors group">
                                        <td className="p-4">
                                            <span className="inline-block px-2 py-1 bg-slate-100 text-slate-700 text-xs font-bold font-mono rounded-md">
                                                {config.key}
                                            </span>
                                        </td>
                                        
                                        <td className="p-4">
                                            {isEditing ? (
                                                <textarea
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    className="w-full text-sm font-mono border-gray-200 rounded-lg focus:ring-slate-500 p-2 min-h-[60px]"
                                                />
                                            ) : (
                                                <div className="text-sm font-mono text-gray-600 bg-gray-50 p-2 rounded-lg max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
                                                    {typeof config.value === 'object' ? JSON.stringify(config.value, null, 2) : String(config.value)}
                                                </div>
                                            )}
                                        </td>

                                        <td className="p-4">
                                            {isEditing ? (
                                                <textarea
                                                    value={editDesc}
                                                    onChange={(e) => setEditDesc(e.target.value)}
                                                    className="w-full text-sm border-gray-200 rounded-lg focus:ring-slate-500 p-2 min-h-[60px]"
                                                />
                                            ) : (
                                                <span className="text-sm text-gray-500">
                                                    {config.description || <em className="text-gray-300">Trống</em>}
                                                </span>
                                            )}
                                        </td>

                                        <td className="p-4">
                                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {isEditing ? (
                                                    <>
                                                        <button onClick={() => saveEdit(config.id)} disabled={isSaving} className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-200 disabled:opacity-50" title="Lưu">
                                                            <Save size={16} />
                                                        </button>
                                                        <button onClick={cancelEdit} disabled={isSaving} className="p-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 disabled:opacity-50" title="Hủy">
                                                            <X size={16} />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button onClick={() => handleEdit(config)} className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100" title="Sửa">
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button onClick={() => handleDelete(config.id, config.key)} className="p-1.5 bg-rose-50 text-rose-500 rounded-lg hover:bg-rose-100" title="Xóa">
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
