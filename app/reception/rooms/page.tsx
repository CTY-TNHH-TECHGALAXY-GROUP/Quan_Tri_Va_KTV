'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useRoomConfig, MASTER_PREP_STEPS, MASTER_CLEAN_STEPS } from './RoomConfig.logic';
import { motion, AnimatePresence } from 'motion/react';
import {
    DoorOpen, CheckCircle2, Sparkles, Wrench,
    ChevronRight, Loader2, Check, X, ListChecks,
    ChevronUp, ChevronDown
} from 'lucide-react';

// 🔧 UI CONFIGURATION
const TABS = [
    { id: 'services' as const, label: 'Dịch Vụ', icon: <ListChecks size={16} /> },
    { id: 'reminders' as const, label: 'Nhắc Nhở', icon: <Sparkles size={16} /> },
    { id: 'prep' as const, label: 'Mở Phòng', icon: <DoorOpen size={16} /> },
    { id: 'clean' as const, label: 'Dọn Phòng', icon: <Sparkles size={16} /> },
];

export default function RoomManagementPage() {
    const logic = useRoomConfig();
    const {
        rooms, reminders, selectedRoom, selectedRoomId, setSelectedRoomId,
        isLoading, isSaving, activeTab, setActiveTab,
        servicesByCategory, toggleService, toggleReminder, toggleCategoryServices,
        togglePrepStep, toggleCleanStep,
        selectAllPrepSteps, selectAllCleanSteps,
        clearAllPrepSteps, clearAllCleanSteps,
        addCustomPrepStep, addCustomCleanStep,
        removeCustomPrepStep, removeCustomCleanStep,
        editPrepStep, editCleanStep,
        reorderPrepStep, reorderCleanStep,
    } = logic;

    if (isLoading) {
        return (
            <AppLayout title="Quản Lý Phòng">
                <div className="min-h-[60vh] flex flex-col items-center justify-center">
                    <Loader2 size={32} className="text-indigo-500 animate-spin" />
                    <p className="mt-4 text-gray-500 font-medium">Đang tải dữ liệu phòng...</p>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout title="Quản Lý Phòng">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                            <DoorOpen size={22} className="text-indigo-600" />
                        </div>
                        Quản Lý Phòng
                    </h1>
                    <p className="text-sm text-gray-500 mt-1 ml-[52px]">Cấu hình dịch vụ, nhắc nhở và quy trình cho từng phòng</p>
                </div>

                <div className="flex flex-col lg:flex-row gap-6">
                    {/* Left Panel: Room List */}
                    <div className="lg:w-64 shrink-0">
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-gray-100">
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Danh sách phòng</p>
                            </div>
                            <div className="p-2 space-y-1 max-h-[70vh] overflow-y-auto">
                                {rooms.map(room => {
                                    const isActive = room.id === selectedRoomId;
                                    const prepCount = (room.prep_procedure || []).length;
                                    const cleanCount = (room.clean_procedure || []).length;
                                    const svcCount = (room.allowed_services || []).length;
                                    const remCount = (room.default_reminders || []).length;
                                    return (
                                        <button
                                            key={room.id}
                                            onClick={() => setSelectedRoomId(room.id)}
                                            className={`w-full text-left p-3 rounded-xl transition-all flex items-center justify-between group ${
                                                isActive
                                                    ? 'bg-indigo-50 border border-indigo-200 shadow-sm'
                                                    : 'hover:bg-gray-50 border border-transparent'
                                            }`}
                                        >
                                            <div className="min-w-0">
                                                <p className={`font-bold text-sm truncate ${isActive ? 'text-indigo-700' : 'text-gray-800'}`}>
                                                    {room.name}
                                                </p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    {room.type && (
                                                        <span className="text-[9px] font-bold text-gray-400 uppercase">{room.type}</span>
                                                    )}
                                                    {room.capacity && (
                                                        <span className="text-[9px] font-bold text-gray-400">{room.capacity} giường</span>
                                                    )}
                                                </div>
                                                {/* Config badges */}
                                                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md ${svcCount > 0 ? 'bg-blue-50 text-blue-500' : 'bg-gray-50 text-gray-300'}`}>
                                                        {svcCount} DV
                                                    </span>
                                                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md ${remCount > 0 ? 'bg-purple-50 text-purple-500' : 'bg-gray-50 text-gray-300'}`}>
                                                        {remCount} Nhắc
                                                    </span>
                                                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md ${prepCount > 0 ? 'bg-emerald-50 text-emerald-500' : 'bg-gray-50 text-gray-300'}`}>
                                                        {prepCount} mở
                                                    </span>
                                                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md ${cleanCount > 0 ? 'bg-amber-50 text-amber-500' : 'bg-gray-50 text-gray-300'}`}>
                                                        {cleanCount} dọn
                                                    </span>
                                                </div>
                                            </div>
                                            <ChevronRight size={14} className={`shrink-0 transition-colors ${isActive ? 'text-indigo-400' : 'text-gray-200 group-hover:text-gray-400'}`} />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Right Panel: Config Tabs */}
                    <div className="flex-1 min-w-0">
                        {selectedRoom ? (
                            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                                {/* Room Header */}
                                <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-900">{selectedRoom.name}</h2>
                                        <p className="text-xs text-gray-400 mt-0.5">
                                            {selectedRoom.type || 'Phòng thường'} • {selectedRoom.capacity || '?'} giường
                                        </p>
                                    </div>
                                    {isSaving && (
                                        <div className="flex items-center gap-2 text-indigo-500 text-xs font-bold">
                                            <Loader2 size={14} className="animate-spin" /> Đang lưu...
                                        </div>
                                    )}
                                </div>

                                {/* Tabs */}
                                <div className="flex border-b border-gray-100">
                                    {TABS.map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id)}
                                            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wider transition-all ${
                                                activeTab === tab.id
                                                    ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/30'
                                                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                                            }`}
                                        >
                                            {tab.icon} {tab.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Tab Content */}
                                <div className="p-5">
                                    <AnimatePresence mode="wait">
                                        {activeTab === 'services' && (
                                            <motion.div key="services" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                                                <TabServices
                                                    servicesByCategory={servicesByCategory}
                                                    allowedServices={selectedRoom.allowed_services || []}
                                                    onToggle={toggleService}
                                                    onToggleCategory={toggleCategoryServices}
                                                />
                                            </motion.div>
                                        )}
                                        {activeTab === 'reminders' && (
                                            <motion.div key="reminders" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                                                <TabReminders
                                                    reminders={reminders}
                                                    selectedReminders={selectedRoom.default_reminders || []}
                                                    onToggle={toggleReminder}
                                                />
                                            </motion.div>
                                        )}
                                        {activeTab === 'prep' && (
                                            <motion.div key="prep" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                                                <TabProcedure
                                                    title="Quy trình MỞ PHÒNG"
                                                    masterSteps={MASTER_PREP_STEPS}
                                                    selectedSteps={selectedRoom.prep_procedure || []}
                                                    onSelectAll={selectAllPrepSteps}
                                                    onClearAll={clearAllPrepSteps}
                                                    onAddStep={addCustomPrepStep}
                                                    onRemoveStep={removeCustomPrepStep}
                                                    onEditStep={editPrepStep}
                                                    onReorderStep={reorderPrepStep}
                                                />
                                            </motion.div>
                                        )}
                                        {activeTab === 'clean' && (
                                            <motion.div key="clean" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                                                <TabProcedure
                                                    title="Quy trình DỌN PHÒNG"
                                                    masterSteps={MASTER_CLEAN_STEPS}
                                                    selectedSteps={selectedRoom.clean_procedure || []}
                                                    onSelectAll={selectAllCleanSteps}
                                                    onClearAll={clearAllCleanSteps}
                                                    onAddStep={addCustomCleanStep}
                                                    onRemoveStep={removeCustomCleanStep}
                                                    onEditStep={editCleanStep}
                                                    onReorderStep={reorderCleanStep}
                                                />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
                                <DoorOpen size={48} className="text-gray-200 mx-auto mb-4" />
                                <p className="text-gray-400 font-medium">Chọn một phòng để cấu hình</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}

// ─── Tab: Reminders ────────────────────────────────────────────────────────────

const TabReminders = ({ reminders, selectedReminders, onToggle }: {
    reminders: any[],
    selectedReminders: string[],
    onToggle: (id: string) => void
}) => {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    Nhắc nhở mặc định cho phòng này ({selectedReminders.length} đã chọn)
                </p>
            </div>

            <div className="grid grid-cols-1 gap-2">
                {reminders.map((rem: any) => {
                    const isSelected = selectedReminders.includes(rem.id);
                    return (
                        <button
                            key={rem.id}
                            onClick={() => onToggle(rem.id)}
                            className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left active:scale-[0.98] ${
                                isSelected
                                    ? 'border-purple-400 bg-purple-50 text-purple-700'
                                    : 'border-gray-100 bg-white text-gray-600 hover:border-purple-200'
                            }`}
                        >
                            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                                isSelected ? 'bg-purple-500 border-purple-500 text-white' : 'border-gray-200'
                            }`}>
                                {isSelected && <Check size={12} />}
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-bold">{rem.content}</p>
                            </div>
                        </button>
                    );
                })}

                {reminders.length === 0 && (
                    <p className="text-center text-gray-400 py-8">Chưa có câu nhắc nhở nào trong hệ thống</p>
                )}
            </div>
        </div>
    );
};

// ─── Tab: Services ─────────────────────────────────────────────────────────────

const TabServices = ({ servicesByCategory, allowedServices, onToggle, onToggleCategory }: {
    servicesByCategory: Record<string, any[]>,
    allowedServices: string[],
    onToggle: (id: string) => void,
    onToggleCategory: (serviceIds: string[], action: 'add' | 'remove') => void
}) => {
    const categories = Object.keys(servicesByCategory);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    Dịch vụ phòng này có thể nhận ({allowedServices.length} đã chọn)
                </p>
            </div>

            {categories.map(cat => {
                const catServices = servicesByCategory[cat];
                const catIds = catServices.map((s: any) => s.id);
                const allSelected = catIds.every((id: string) => allowedServices.includes(id));

                return (
                    <div key={cat}>
                        <div className="flex items-center justify-between mb-2 px-1">
                            <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{cat}</p>
                            <button
                                onClick={() => onToggleCategory(catIds, allSelected ? 'remove' : 'add')}
                                className={`text-[10px] font-bold px-3 py-1 rounded-lg active:scale-95 transition-all border ${
                                    allSelected
                                        ? 'text-gray-500 bg-gray-50 border-gray-100'
                                        : 'text-indigo-600 bg-indigo-50 border-indigo-100'
                                }`}
                            >
                                {allSelected ? 'Bỏ tất cả' : 'Chọn tất cả'}
                            </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {catServices.map((svc: any) => {
                                const isSelected = allowedServices.includes(svc.id);
                                return (
                                    <button
                                        key={svc.id}
                                        onClick={() => onToggle(svc.id)}
                                        className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left active:scale-[0.98] ${
                                            isSelected
                                                ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                                                : 'border-gray-100 bg-white text-gray-600 hover:border-indigo-200'
                                        }`}
                                    >
                                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                                            isSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-gray-200'
                                        }`}>
                                            {isSelected && <Check size={12} />}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold truncate">{svc.nameVN || svc.nameEN}</p>
                                            <p className="text-[10px] text-gray-400 font-medium">{svc.code} • {svc.duration} phút</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {categories.length === 0 && (
                <p className="text-center text-gray-400 py-8">Chưa có dịch vụ nào trong hệ thống</p>
            )}
        </div>
    );
};

// ─── Tab: Procedure (Prep / Clean) ─────────────────────────────────────────────
// Hiển thị CHỈ các bước từ DB (selectedSteps).
// Master list = danh sách mẫu collapsible để thêm nhanh.

const TabProcedure = ({ title, masterSteps, selectedSteps, onSelectAll, onClearAll, onAddStep, onRemoveStep, onEditStep, onReorderStep }: {
    title: string,
    masterSteps: string[],
    selectedSteps: string[],
    onSelectAll: () => void,
    onClearAll: () => void,
    onAddStep: (step: string) => void,
    onRemoveStep: (step: string) => void,
    onEditStep: (oldStep: string, newStep: string) => void,
    onReorderStep: (stepIndex: number, direction: 'up' | 'down') => void,
}) => {
    const [newStep, setNewStep] = React.useState('');
    const [showTemplatePicker, setShowTemplatePicker] = React.useState(false);

    // Template steps not yet added to this room's procedure
    const availableTemplateSteps = masterSteps.filter(s => !selectedSteps.includes(s));

    const handleAdd = () => {
        const trimmed = newStep.trim();
        if (!trimmed) return;
        if (selectedSteps.includes(trimmed)) {
            alert('Bước này đã tồn tại!');
            return;
        }
        onAddStep(trimmed);
        setNewStep('');
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {title} ({selectedSteps.length} bước)
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={onSelectAll}
                        className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg active:scale-95 transition-all border border-indigo-100"
                    >
                        Thêm tất cả mẫu
                    </button>
                    <button
                        onClick={onClearAll}
                        className="text-[10px] font-bold text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg active:scale-95 transition-all border border-gray-100"
                    >
                        Xoá tất cả
                    </button>
                </div>
            </div>

            {/* Current procedure steps (from DB) — the REAL steps of this room */}
            {selectedSteps.length > 0 ? (
                <div className="space-y-2">
                    {selectedSteps.map((step, idx) => (
                        <div key={idx} className="relative">
                            <div className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-emerald-400 bg-emerald-50 select-none">
                                <div className="w-7 h-7 rounded-full bg-emerald-500 border-2 border-emerald-500 text-white flex items-center justify-center shrink-0 text-xs font-black">
                                    {idx + 1}
                                </div>
                                <span className="text-sm font-bold text-emerald-700 flex-1">{step}</span>
                                <div className="flex items-center gap-1 shrink-0 px-1 border-l border-emerald-200 pl-4">
                                    <button
                                        onClick={(e) => { 
                                            e.stopPropagation(); 
                                            const newName = prompt('Đổi tên bước:', step); 
                                            if (newName && newName.trim() && newName.trim() !== step) onEditStep(step, newName.trim()); 
                                        }}
                                        className="p-1.5 rounded-lg text-emerald-600 bg-white shadow-sm hover:bg-emerald-100 transition-colors sm:mr-1"
                                        title="Chỉnh sửa"
                                    >
                                        <Wrench size={16} />
                                    </button>
                                    <button
                                        onClick={(e) => { 
                                            e.stopPropagation(); 
                                            if (confirm('Bạn có chắc xoá bước này?')) onRemoveStep(step); 
                                        }}
                                        className="p-1.5 rounded-lg text-rose-600 bg-white shadow-sm hover:bg-rose-100 transition-colors sm:mr-3 mr-1"
                                        title="Xoá"
                                    >
                                        <X size={16} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onReorderStep(idx, 'up'); }}
                                        disabled={idx === 0}
                                        className="p-1.5 rounded-lg text-emerald-600 bg-white shadow-sm hover:bg-emerald-100 disabled:opacity-30 transition-colors"
                                    >
                                        <ChevronUp size={16} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onReorderStep(idx, 'down'); }}
                                        disabled={idx === selectedSteps.length - 1}
                                        className="p-1.5 rounded-lg text-emerald-600 bg-white shadow-sm hover:bg-emerald-100 disabled:opacity-30 transition-colors"
                                    >
                                        <ChevronDown size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-8 text-gray-300">
                    <p className="text-sm font-bold">Chưa có bước nào</p>
                    <p className="text-xs mt-1">Thêm từ danh sách mẫu hoặc tự nhập bên dưới</p>
                </div>
            )}

            {/* Template picker (collapsible) — pick from master list */}
            <div className="border border-gray-100 rounded-xl overflow-hidden">
                <button
                    onClick={() => setShowTemplatePicker(!showTemplatePicker)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                        📋 Danh sách mẫu ({availableTemplateSteps.length} bước chưa thêm)
                    </span>
                    <ChevronRight size={14} className={`text-gray-400 transition-transform ${showTemplatePicker ? 'rotate-90' : ''}`} />
                </button>
                {showTemplatePicker && (
                    <div className="p-2 space-y-1 max-h-60 overflow-y-auto border-t border-gray-100">
                        {availableTemplateSteps.length > 0 ? (
                            availableTemplateSteps.map((step, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => onAddStep(step)}
                                    className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-emerald-50 hover:text-emerald-700 text-gray-500 transition-colors active:scale-[0.98]"
                                >
                                    <div className="w-5 h-5 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-[10px] font-black">
                                        +
                                    </div>
                                    <span className="text-sm font-medium">{step}</span>
                                </button>
                            ))
                        ) : (
                            <p className="text-center text-xs text-gray-300 py-4">Đã thêm hết tất cả bước mẫu</p>
                        )}
                    </div>
                )}
            </div>

            {/* Add custom step */}
            <div className="flex gap-2 pt-2 border-t border-gray-100">
                <input
                    type="text"
                    value={newStep}
                    onChange={(e) => setNewStep(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    placeholder="Thêm bước tuỳ chỉnh..."
                    className="flex-1 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 focus:border-indigo-300 focus:ring-0 outline-none text-sm font-bold text-gray-700 placeholder:text-gray-300"
                />
                <button
                    onClick={handleAdd}
                    disabled={!newStep.trim()}
                    className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider disabled:opacity-30 active:scale-95 transition-all"
                >
                    Thêm
                </button>
            </div>
        </div>
    );
};
