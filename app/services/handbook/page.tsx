'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ShieldAlert, BookOpen, Search, Clock, ChevronRight, Info, Edit3, Save, Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useServiceHandbook } from './Handbook.logic';
import { t } from './Handbook.i18n';

export default function ServiceHandbookPage() {
    const {
        searchQuery,
        selectedItem,
        isEditing,
        editForm,
        mounted,
        filteredHandbook,
        canEdit,
        canAccessPage,
        setSearchQuery,
        handleSelectItem,
        handleEdit,
        handleSave,
        handleCancelEdit,
        handleAddStep,
        handleRemoveStep,
        handleStepChange,
        handleEditFormChange,
    } = useServiceHandbook();

    if (!mounted) return null;

    if (!canAccessPage) {
        return (
            <AppLayout title="Sổ Tay Dịch Vụ">
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">{t.noAccess}</h2>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout title="Sổ Tay Dịch Vụ">
            <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
                    <div>
                        <p className="text-sm text-gray-500 mt-1">{t.pageSubtitle}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder={t.searchPlaceholder}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex gap-6 overflow-hidden">
                    {/* Sidebar List */}
                    <div className="w-full sm:w-80 flex flex-col bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden shrink-0">
                        <div className="p-4 border-b border-gray-50 bg-gray-50/30">
                            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t.sidebarTitle}</h2>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {filteredHandbook.map(item => (
                                <button
                                    key={item.id}
                                    disabled={isEditing}
                                    onClick={() => handleSelectItem(item)}
                                    className={`w-full text-left p-4 rounded-2xl transition-all flex items-center justify-between group ${
                                        selectedItem.id === item.id
                                            ? 'bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-100/50'
                                            : 'text-gray-600 hover:bg-gray-50'
                                    } ${isEditing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <div>
                                        <div className="font-bold text-sm">{item.title}</div>
                                        <div className="text-[10px] uppercase tracking-widest font-bold opacity-60 mt-0.5">{item.category}</div>
                                    </div>
                                    <ChevronRight size={16} className={`transition-transform ${selectedItem.id === item.id ? 'translate-x-1' : 'opacity-0 group-hover:opacity-100'}`} />
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden flex flex-col relative">
                        <AnimatePresence mode="wait">
                            {!isEditing ? (
                                <motion.div
                                    key={selectedItem.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="flex-1 overflow-y-auto p-8"
                                >
                                    <div className="max-w-3xl mx-auto space-y-8">
                                        <div className="flex justify-between items-start">
                                            <div className="space-y-4">
                                                <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full w-fit">
                                                    {selectedItem.category}
                                                </div>
                                                <h2 className="text-3xl font-bold text-gray-900">{selectedItem.title}</h2>
                                                <div className="flex items-center gap-4 text-sm text-gray-500">
                                                    <div className="flex items-center gap-1.5">
                                                        <Clock size={16} className="text-gray-400" />
                                                        {t.durationLabel} <span className="font-bold text-gray-900">{selectedItem.duration}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            {canEdit && (
                                                <button
                                                    onClick={handleEdit}
                                                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm"
                                                >
                                                    <Edit3 size={16} />
                                                    {t.editButton}
                                                </button>
                                            )}
                                        </div>

                                        <div className="space-y-6">
                                            <h3 className="font-bold text-lg text-gray-900 border-b border-gray-100 pb-2">{t.stepsTitle}</h3>
                                            <div className="space-y-4">
                                                {selectedItem.steps.map((step, index) => (
                                                    <div key={index} className="flex gap-4 group">
                                                        <div className="w-8 h-8 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                                            {index + 1}
                                                        </div>
                                                        <div className="pt-1 text-gray-600 leading-relaxed">{step}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 flex gap-4">
                                            <Info className="text-amber-600 shrink-0" size={24} />
                                            <div className="space-y-1">
                                                <h4 className="font-bold text-amber-900">{t.notesTitle}</h4>
                                                <p className="text-sm text-amber-700 leading-relaxed">{selectedItem.notes}</p>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex-1 overflow-y-auto p-8"
                                >
                                    <div className="max-w-3xl mx-auto space-y-8">
                                        <div className="flex justify-between items-center">
                                            <h2 className="text-2xl font-bold text-gray-900">{t.editTitle}</h2>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={handleCancelEdit}
                                                    className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-xl text-sm font-medium transition-colors"
                                                >
                                                    {t.cancel}
                                                </button>
                                                <button
                                                    onClick={handleSave}
                                                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
                                                >
                                                    <Save size={16} />
                                                    {t.save}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <label className="text-xs font-bold text-gray-400 uppercase">{t.labelServiceName}</label>
                                                <input
                                                    type="text"
                                                    value={editForm.title}
                                                    onChange={(e) => handleEditFormChange('title', e.target.value)}
                                                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-bold text-gray-400 uppercase">{t.labelCategory}</label>
                                                <input
                                                    type="text"
                                                    value={editForm.category}
                                                    onChange={(e) => handleEditFormChange('category', e.target.value)}
                                                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-bold text-gray-400 uppercase">{t.labelDuration}</label>
                                                <input
                                                    type="text"
                                                    value={editForm.duration}
                                                    onChange={(e) => handleEditFormChange('duration', e.target.value)}
                                                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="flex justify-between items-center">
                                                <h3 className="font-bold text-gray-900">{t.stepsTitle}</h3>
                                                <button
                                                    onClick={handleAddStep}
                                                    className="text-indigo-600 text-xs font-bold flex items-center gap-1 hover:underline"
                                                >
                                                    <Plus size={14} /> {t.addStep}
                                                </button>
                                            </div>
                                            <div className="space-y-3">
                                                {editForm.steps.map((step, index) => (
                                                    <div key={index} className="flex gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center font-bold text-sm shrink-0">
                                                            {index + 1}
                                                        </div>
                                                        <textarea
                                                            value={step}
                                                            onChange={(e) => handleStepChange(index, e.target.value)}
                                                            className="flex-1 px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm min-h-[60px]"
                                                        />
                                                        <button
                                                            onClick={() => handleRemoveStep(index)}
                                                            className="p-2 text-gray-400 hover:text-rose-500 transition-colors"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-gray-400 uppercase">{t.labelNotes}</label>
                                            <textarea
                                                value={editForm.notes}
                                                onChange={(e) => handleEditFormChange('notes', e.target.value)}
                                                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm min-h-[100px]"
                                            />
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
