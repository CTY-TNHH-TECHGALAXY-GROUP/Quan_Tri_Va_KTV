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
        ratings, handleRatingChange,
        comments, handleCommentChange,
        isSubmitting, handleSubmit,
        t
    } = useKioskFeedback(currentBooking, onClose);

    return (
        <div className="fixed inset-0 z-50 bg-white flex flex-col overflow-hidden">
            <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start z-50 pointer-events-none">
                <div className="pointer-events-auto">
                    <button 
                        onClick={onClose} 
                        className="p-3 text-gray-300 hover:text-gray-500 rounded-full hover:bg-gray-100 transition-colors shadow-sm bg-white/50 backdrop-blur-sm"
                    >
                        <X className="w-8 h-8" />
                    </button>
                </div>
                
                <div className="pointer-events-auto flex items-center gap-4">
                    {/* Language Selector */}
                    <div className="flex gap-2 bg-gray-50/80 p-1.5 rounded-full shadow-sm border border-gray-100 pointer-events-auto">
                        {(['VN', 'EN', 'KR', 'JP', 'ZH'] as const).map(lang => (
                            <button
                                key={lang}
                                onClick={() => setLanguage(lang)}
                                className={`px-4 py-2 rounded-full font-bold text-sm transition-all ${
                                    language === lang 
                                        ? 'bg-[#5A00FF] text-white shadow-md' 
                                        : 'text-gray-500 hover:bg-gray-200'
                                }`}
                            >
                                {lang}
                            </button>
                        ))}
                    </div>

                    {/* Booking Dropdown (Chỉ hiện khi đoàn có nhiều hơn 1 khách) */}
                    {group.childBookings.length > 1 && (
                        <div className="pointer-events-auto bg-white/90 p-1.5 rounded-full shadow-sm border border-gray-100 min-w-[280px]">
                            <select
                                value={currentBooking.id}
                                onChange={(e) => {
                                    const child = group.childBookings.find((c: any) => c.id === e.target.value);
                                    if (child) setCurrentBooking(child);
                                }}
                                className="w-full bg-transparent p-2 outline-none text-gray-700 font-medium cursor-pointer text-sm truncate rounded-full"
                            >
                                {group.childBookings.map((child: any) => {
                                    const isCompleted = child.status === 'COMPLETED' || child.status === 'DONE';
                                    const hasFeedback = child.status === 'FEEDBACK';
                                    const ktvNames = child.ktvList.map((k: any) => k.ktvName).join(', ');
                                    const label = `${child.customerName} - KTV: ${ktvNames}`;
                                    
                                    return (
                                        <option 
                                            key={child.id} 
                                            value={child.id}
                                            disabled={(!isCompleted && currentBooking.id !== child.id) || hasFeedback}
                                        >
                                            {label} {hasFeedback ? ' ✓ (Đã đánh giá)' : !isCompleted ? ' (Đang phục vụ)' : ''}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-indigo-50/50 via-white to-purple-50/50">
                <AnimatePresence mode="wait">
                    {step === 1 && (
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

                    {step === 2 && (
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

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                                {mergedKtvGroups.map((group) => (
                                    <div key={group.ktvId} className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                                        <div className="flex items-start gap-4 mb-8">
                                            <div className="w-14 h-14 bg-[#F3E8FF] rounded-full flex items-center justify-center text-[#7C3AED] shrink-0 mt-1">
                                                <UserCircle2 className="w-8 h-8" />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-bold text-gray-900 leading-tight">{group.ktvName}</h3>
                                                <p className="text-sm text-gray-500 font-medium mb-1">{group.ktvId}</p>
                                                <p className="text-sm text-[#7C3AED] bg-[#F3E8FF] inline-block px-3 py-1 rounded-md">
                                                    {group.serviceNames.join(' + ')}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex justify-center gap-4 mb-8">
                                            {[1, 2, 3, 4].map(star => (
                                                <button
                                                    key={star}
                                                    onClick={() => handleRatingChange(group.ktvId, star)}
                                                    className="focus:outline-none transform hover:scale-110 transition-transform"
                                                >
                                                    <Star 
                                                        className={`w-12 h-12 ${
                                                            (ratings[group.ktvId] || 0) >= star 
                                                                ? 'fill-amber-400 text-amber-400' 
                                                                : 'text-gray-200 hover:text-gray-300'
                                                        }`} 
                                                    />
                                                </button>
                                            ))}
                                        </div>

                                        <textarea 
                                            placeholder={t.notePlaceholder}
                                            value={comments[group.ktvId] || ''}
                                            onChange={(e) => handleCommentChange(group.ktvId, e.target.value)}
                                            className="w-full bg-gray-50 border-none rounded-2xl p-5 text-gray-700 focus:ring-2 focus:ring-[#7C3AED]/20 resize-none h-28"
                                        />
                                    </div>
                                ))}
                                {mergedKtvGroups.length === 0 && (
                                    <div className="col-span-full text-center p-10 bg-white rounded-3xl border border-gray-100 text-gray-500 text-xl">
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
    );
}
