'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Save, Plus, Trash2, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useMilestonesEditorLogic } from './MilestonesEditor.logic';
import { t } from './MilestonesEditor.i18n';

export const MilestonesEditor = ({ activeTab }: { activeTab: 'TYPE_A' | 'TYPE_B' | 'TYPE_C' }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const {
        milestonesA,
        milestonesB,
        milestonesC,
        isLoading,
        isSaving,
        saveStatus,
        handleSave,
        updateMilestone,
        deleteMilestone,
        addMilestone
    } = useMilestonesEditorLogic();

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center p-12 bg-white rounded-[2rem] border border-gray-100 shadow-sm">
                <Loader2 size={32} className="text-indigo-500 animate-spin" />
                <p className="mt-4 text-gray-500 font-medium">Đang tải cấu hình...</p>
            </div>
        );
    }

    const currentMilestones = activeTab === 'TYPE_A' ? milestonesA : activeTab === 'TYPE_B' ? milestonesB : milestonesC;
    const currentType = activeTab === 'TYPE_A' ? 'A' : activeTab === 'TYPE_B' ? 'B' : 'C';
    
    // Sort milestones by minutes
    const sortedEntries = Object.entries(currentMilestones).sort((a, b) => Number(a[0]) - Number(b[0]));

    return (
        <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 mt-6">
            <div 
                className="flex items-center justify-between cursor-pointer group"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div>
                    <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
                        {t.title}
                        <button className="text-gray-400 group-hover:text-indigo-600 transition-colors p-1 rounded-full hover:bg-gray-50">
                            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </button>
                    </h2>
                    <p className="text-sm text-gray-500 mt-1 font-medium">{t.description}</p>
                </div>
                
                <div className="flex items-center gap-3">
                    {saveStatus === 'success' && (
                        <motion.span initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="text-emerald-600 font-bold text-sm flex items-center gap-1.5">
                            <CheckCircle2 size={16} /> {t.messages.saveSuccess}
                        </motion.span>
                    )}
                    {saveStatus === 'error' && (
                        <motion.span initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="text-rose-600 font-bold text-sm flex items-center gap-1.5">
                            <AlertCircle size={16} /> {t.messages.saveError}
                        </motion.span>
                    )}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleSave();
                        }}
                        disabled={isSaving}
                        className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold uppercase tracking-wider text-sm hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        {t.actions.save}
                    </button>
                </div>
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="pt-6">
                            <div className="p-4 bg-orange-50 rounded-xl border border-orange-100 mb-6">
                                <h3 className="text-xs font-black uppercase tracking-wider text-orange-600 mb-2 flex items-center gap-2">
                                    <AlertCircle size={14} /> Ghi chú quan trọng
                                </h3>
                                <p className="text-[11px] text-orange-800 font-medium leading-relaxed">
                                    {t.warnings.importantNote}
                                </p>
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-gray-100">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50 border-b border-gray-100">
                                            <th className="p-4 text-xs font-black uppercase tracking-wider text-gray-500">{t.table.minutes}</th>
                                            <th className="p-4 text-xs font-black uppercase tracking-wider text-gray-500">{t.table.bonus}</th>
                                            <th className="p-4 text-xs font-black uppercase tracking-wider text-gray-500 w-24 text-center">{t.table.actions}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedEntries.map(([minutes, value], index) => (
                                            <tr key={index} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                                <td className="p-4">
                                                    <div className="relative">
                                                        <input
                                                            type="number"
                                                            value={minutes}
                                                            onChange={(e) => updateMilestone(currentType, minutes, e.target.value, value)}
                                                            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:border-indigo-400 focus:ring-0 transition-colors"
                                                            placeholder="Phút"
                                                        />
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="relative">
                                                        <input
                                                            type="number"
                                                            value={value}
                                                            onChange={(e) => updateMilestone(currentType, minutes, minutes, Number(e.target.value))}
                                                            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:border-indigo-400 focus:ring-0 transition-colors text-emerald-600"
                                                            placeholder="VNĐ"
                                                        />
                                                    </div>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <button
                                                        onClick={() => deleteMilestone(currentType, minutes)}
                                                        className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                                        title={t.actions.delete}
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <button
                                onClick={() => addMilestone(currentType)}
                                className="mt-4 w-full py-4 border-2 border-dashed border-gray-200 rounded-xl text-gray-500 font-bold text-sm uppercase tracking-wider hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all flex items-center justify-center gap-2"
                            >
                                <Plus size={18} />
                                {t.actions.add}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
