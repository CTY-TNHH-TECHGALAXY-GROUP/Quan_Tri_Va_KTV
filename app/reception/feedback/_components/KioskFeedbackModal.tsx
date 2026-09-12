'use client';

import React, { useState } from 'react';
import { ChildBookingForFeedback } from '../FeedbackDashboard.logic';
import { useKioskFeedback } from './KioskFeedback.logic';
import { Star, AlertTriangle, UserCircle2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function KioskFeedbackModal({ group, initialBooking, onClose }: { group: any, initialBooking: ChildBookingForFeedback, onClose: () => void }) {
    const [currentBooking, setCurrentBooking] = useState(initialBooking);

    const {
        step, setStep,
        language, setLanguage,
        mergedKtvGroups,
        globalRating, handleRatingChange,
        globalComment, handleCommentChange,
        reminders, violations, getReminderText, toggleViolation,
        isSubmitting, handleSubmit,
        t, isSuccess
    } = useKioskFeedback(currentBooking, onClose);

    const getKtvDisplay = (child: any) => {
        if (!child.ktvList || child.ktvList.length === 0) return 'Chưa có KTV';
        const parts = child.ktvList.map((k: any) => {
            const isTypeC = k.workType === 'C' || k.workType === 'c' || (k.ktvId && (k.ktvId.toUpperCase().startsWith('C_') || k.ktvId.toUpperCase().startsWith('EXT_')));
            const displayName = isTypeC ? k.ktvName : k.ktvId;
            const svcs = k.serviceNames && k.serviceNames.length > 0 ? ` (${k.serviceNames.join(', ')})` : '';
            return `${displayName}${svcs}`;
        });
        const fullText = parts.join(' + ');
        if (fullText.length > 35) return fullText.slice(0, 35) + '...';
        return fullText;
    };

    return (
        <div className="fixed inset-0 z-50 bg-white flex flex-col overflow-hidden">
            {/* HEADER: Chuyển sang relative và sắp xếp flex-col trên mobile để không đè nội dung */}
            <div className="relative w-full p-4 sm:p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 z-50 bg-white/90 backdrop-blur-md shadow-sm border-b border-gray-100 shrink-0">
                <div className="flex justify-between items-center w-full sm:w-auto">
                    <button 
                        onClick={onClose} 
                        className="p-2 sm:p-3 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors shadow-sm bg-white"
                    >
                        <X className="w-6 h-6 sm:w-8 sm:h-8" />
                    </button>
                    {/* Booking Dropdown trên mobile sẽ hiện cạnh nút X */}
                    <div className="sm:hidden block w-full max-w-[200px] ml-2">
                        {group.childBookings.length > 1 && (
                            <div className="bg-gray-50 p-1.5 rounded-2xl shadow-inner border border-gray-100">
                                <select
                                    value={currentBooking.id}
                                    onChange={(e) => {
                                        const child = group.childBookings.find((c: any) => c.id === e.target.value);
                                        if (child) setCurrentBooking(child);
                                    }}
                                    className="w-full bg-transparent outline-none text-gray-700 font-bold cursor-pointer text-xs truncate"
                                >
                                    {group.childBookings.map((child: any) => {
                                        const isEvaluated = child.status === 'DONE' || (child.ktvList && child.ktvList.length > 0 && child.ktvList.every((k: any) => k.rating && k.rating > 0));
                                        const isReady = child.status === 'COMPLETED' || child.status === 'FEEDBACK';
                                        const ktvNames = getKtvDisplay(child);
                                        return (
                                            <option key={child.id} value={child.id} disabled={(!isReady && currentBooking.id !== child.id) || isEvaluated}>
                                                {ktvNames}{isEvaluated ? ' ✓' : !isReady ? ' (Đang làm)' : ''}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>
                        )}
                    </div>
                </div>
                
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                    {/* Language Selector */}
                    <div className="flex flex-wrap gap-1 sm:gap-2 bg-gray-50 p-1.5 rounded-2xl shadow-inner border border-gray-100 justify-center">
                        {(['VN', 'EN', 'KR', 'JP', 'ZH'] as const).map(lang => (
                            <button
                                key={lang}
                                onClick={() => setLanguage(lang)}
                                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl font-bold text-xs sm:text-sm transition-all flex-1 sm:flex-none ${
                                    language === lang 
                                        ? 'bg-[#5A00FF] text-white shadow-md' 
                                        : 'text-gray-500 hover:bg-gray-200'
                                }`}
                            >
                                {lang}
                            </button>
                        ))}
                    </div>

                    {/* Booking Dropdown trên Desktop */}
                    {group.childBookings.length > 1 && (
                        <div className="hidden sm:block bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100 min-w-[280px]">
                            <select
                                value={currentBooking.id}
                                onChange={(e) => {
                                    const child = group.childBookings.find((c: any) => c.id === e.target.value);
                                    if (child) setCurrentBooking(child);
                                }}
                                className="w-full bg-transparent p-2 outline-none text-gray-700 font-medium cursor-pointer text-sm truncate"
                            >
                                {group.childBookings.map((child: any) => {
                                    const isEvaluated = child.status === 'DONE' || (child.ktvList && child.ktvList.length > 0 && child.ktvList.every((k: any) => k.rating && k.rating > 0));
                                    const isReady = child.status === 'COMPLETED' || child.status === 'FEEDBACK';
                                    const ktvNames = getKtvDisplay(child);
                                    
                                    return (
                                        <option key={child.id} value={child.id} disabled={(!isReady && currentBooking.id !== child.id) || isEvaluated}>
                                            {ktvNames}{isEvaluated ? ' ✓' : !isReady ? ' (Đang làm)' : ''}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            {/* CONTENT AREA: Sửa lại để cuộn được nếu dài quá màn hình */}
            <div className="flex-1 overflow-y-auto bg-gradient-to-br from-indigo-50/50 via-white to-purple-50/50 p-4 sm:p-8">
                <div className="min-h-full flex flex-col justify-start max-w-4xl w-full mx-auto pb-12 pt-4 sm:justify-center sm:pt-0">
                <AnimatePresence mode="wait">
                    {isSuccess && (
                        <motion.div
                            key="success"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.4, type: 'spring' }}
                            className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 p-12 text-center flex flex-col items-center justify-center min-h-[400px]"
                        >
                            <div className="w-32 h-32 bg-green-100 rounded-full flex items-center justify-center mb-8 mx-auto">
                                <motion.div 
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                                >
                                    <svg className="w-16 h-16 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                                    </svg>
                                </motion.div>
                            </div>
                            <h2 className="text-4xl font-bold text-gray-900 mb-4">
                                {language === 'VN' ? 'Cảm ơn quý khách!' :
                                 language === 'EN' ? 'Thank You!' :
                                 language === 'ZH' ? '谢谢您！' :
                                 'Thank You!'}
                            </h2>
                            <p className="text-xl text-gray-500 max-w-md mx-auto">
                                {language === 'VN' ? 'Đánh giá của quý khách đã được ghi nhận.' :
                                 language === 'EN' ? 'Your feedback has been recorded.' :
                                 language === 'ZH' ? '您的评价已记录。' :
                                 'Your feedback has been recorded.'}
                            </p>
                        </motion.div>
                    )}

                    {!isSuccess && step === 1 && (
                        <motion.div 
                            key="step1"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="max-w-2xl w-full mx-auto p-8 text-center"
                        >
                            <div className="w-24 h-24 bg-amber-100 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-sm">
                                <AlertTriangle className="w-12 h-12" />
                            </div>
                            <h2 className="text-4xl font-bold text-gray-900 mb-4">{t.forgotTitle}</h2>
                            <p className="text-xl text-gray-500 mb-8">{t.forgotDesc}</p>
                            
                            <div className="flex flex-col gap-4 mb-12 max-w-md mx-auto text-left">
                                <div className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-gray-100">
                                    <span className="text-3xl">📱</span>
                                    <span className="text-gray-800 text-xl font-bold">{t.itemPhone}</span>
                                </div>
                                <div className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-gray-100">
                                    <span className="text-3xl">👛</span>
                                    <span className="text-gray-800 text-xl font-bold">{t.itemWallet}</span>
                                </div>
                                <div className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-gray-100">
                                    <span className="text-3xl">⌚</span>
                                    <span className="text-gray-800 text-xl font-bold">{t.itemJewelry}</span>
                                </div>
                                <div className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-gray-100">
                                    <span className="text-3xl">🔑</span>
                                    <span className="text-gray-800 text-xl font-bold">{t.itemKeys}</span>
                                </div>
                            </div>
                            
                            <motion.button 
                                onClick={() => setStep(2)}
                                animate={{ 
                                    scale: [1, 1.03, 1], 
                                    boxShadow: ["0px 0px 0px rgba(124, 58, 237, 0)", "0px 0px 20px rgba(124, 58, 237, 0.4)", "0px 0px 0px rgba(124, 58, 237, 0)"] 
                                }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                                className="bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-2xl font-bold py-6 px-12 rounded-full shadow-xl"
                            >
                                {t.btnCheckDone}
                            </motion.button>
                        </motion.div>
                    )}

                    {!isSuccess && step === 2 && (
                        <motion.div 
                            key="step2"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="max-w-4xl w-full mx-auto p-8"
                        >
                            <div className="text-center mb-10">
                                <h2 className="text-4xl font-bold text-gray-900 mb-3">{t.rateTitle}</h2>
                                <p className="text-xl text-gray-500">{t.rateDesc}</p>
                            </div>

                            {/* Khối Service Feedback (Violations) */}
                            {reminders.length > 0 && (
                                <div className="w-full bg-white rounded-3xl p-6 shadow-sm border border-gray-100 mb-12">
                                    <h3 className="text-gray-800 font-bold text-xl mb-4 flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${violations.length > 0 ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                                        </div>
                                        {t.violationsSectionTitle || 'Service feedback (if any)'}
                                    </h3>
                                    <div className="space-y-3">
                                        {reminders.map((reminder) => {
                                            const rId = reminder.id.toString();
                                            const isSelected = violations.includes(rId);
                                            return (
                                                <div 
                                                    key={rId}
                                                    onClick={() => toggleViolation(rId)}
                                                    className={`flex items-start gap-4 p-4 bg-white rounded-2xl cursor-pointer transition-all border ${isSelected ? 'border-amber-200 shadow-sm ring-1 ring-amber-100' : 'border-gray-100 shadow-[0_2px_8px_rgba(0,0,0,0.01)]'}`}
                                                >
                                                    <div className={`mt-0.5 w-6 h-6 rounded-lg border-2 flex-shrink-0 flex items-center justify-center transition-colors ${isSelected ? 'border-amber-500 bg-amber-500' : 'border-gray-300 bg-white'}`}>
                                                        {isSelected && (
                                                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                                                        )}
                                                    </div>
                                                    <span className={`text-lg leading-snug font-medium ${isSelected ? 'text-amber-900' : 'text-gray-500'}`}>
                                                        {getReminderText(reminder)}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="max-w-2xl mx-auto mb-12">
                                <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
                                        <div className="w-16 h-16 bg-[#F3E8FF] rounded-full flex items-center justify-center text-[#7C3AED] shrink-0">
                                            <UserCircle2 className="w-10 h-10" />
                                        </div>
                                        <div className="text-center sm:text-left">
                                            <h3 className="text-2xl font-bold text-gray-900 leading-tight mb-2">{t.experienceTitle || 'Trải nghiệm của bạn'}</h3>
                                            <p className="text-sm text-[#7C3AED] bg-[#F3E8FF] inline-block px-3 py-1 rounded-md font-medium">
                                                {t.staffLbl || 'Nhân viên phục vụ'}: {mergedKtvGroups.map(g => {
                                                    const isTypeC = (g as any).workType === 'C' || (g as any).workType === 'c' || (g.ktvId && (g.ktvId.toUpperCase().startsWith('C_') || g.ktvId.toUpperCase().startsWith('EXT_')));
                                                    return isTypeC ? g.ktvName : g.ktvId;
                                                }).join(', ')}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-4 gap-2 sm:gap-4 mb-8">
                                        {[
                                            { score: 1, emoji: '😡', label: t.rateBad || 'Tệ' },
                                            { score: 2, emoji: '😐', label: t.rateOk || 'Bình thường' },
                                            { score: 3, emoji: '🙂', label: t.rateGood || 'Tốt' },
                                            { score: 4, emoji: '🤩', label: t.rateExcellent || 'Tuyệt vời' }
                                        ].map((r) => {
                                            const isSelected = globalRating === r.score;
                                            return (
                                                <button
                                                    key={r.score}
                                                    onClick={() => handleRatingChange(r.score)}
                                                    className={`p-3 sm:p-5 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all ${
                                                        isSelected 
                                                            ? 'bg-amber-100 border-2 border-amber-400 scale-105 shadow-sm' 
                                                            : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                                                    }`}
                                                >
                                                    <span className="text-3xl sm:text-5xl">{r.emoji}</span>
                                                    <span className={`text-xs sm:text-sm font-bold text-center mt-1 ${isSelected ? 'text-amber-700' : 'text-gray-500'}`}>
                                                        {r.label}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <textarea 
                                        placeholder={t.notePlaceholder}
                                        value={globalComment}
                                        onChange={(e) => handleCommentChange(e.target.value)}
                                        className="w-full bg-gray-50 border-none rounded-2xl p-5 text-gray-700 focus:ring-2 focus:ring-[#7C3AED]/20 resize-none h-32 text-base sm:text-lg"
                                    />
                                </div>
                                {mergedKtvGroups.length === 0 && (
                                    <div className="text-center p-10 mt-6 bg-white rounded-3xl border border-gray-100 text-gray-500 text-xl">
                                        Không có nhân viên nào trong hệ thống cho đơn này.
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-center gap-8 items-center">
                                <button 
                                    onClick={onClose}
                                    className="font-bold text-xl text-gray-500 hover:text-gray-700 transition-colors"
                                >
                                    {t.btnCancel}
                                </button>
                                <button 
                                    onClick={handleSubmit}
                                    disabled={isSubmitting || mergedKtvGroups.length === 0}
                                    className="bg-[#5A00FF] hover:bg-[#4A00E0] disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xl font-bold py-4 px-12 rounded-full shadow-lg hover:shadow-xl transition-all"
                                >
                                    {isSubmitting ? '...' : t.btnSubmit}
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
