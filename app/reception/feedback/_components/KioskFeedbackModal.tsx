'use client';

import React from 'react';
import { ChildBookingForFeedback } from '../FeedbackDashboard.logic';
import { useKioskFeedback } from './KioskFeedback.logic';
import { Star, AlertTriangle, UserCircle2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function KioskFeedbackModal({ booking, onClose }: { booking: ChildBookingForFeedback, onClose: () => void }) {
    const {
        step, setStep,
        language, setLanguage,
        mergedKtvGroups,
        ratings, handleRatingChange,
        comments, handleCommentChange,
        isSubmitting, handleSubmit,
        t
    } = useKioskFeedback(booking, onClose);

    return (
        <div className="fixed inset-0 z-50 bg-white flex flex-col overflow-hidden">
            <button 
                onClick={onClose} 
                className="absolute top-6 left-6 p-2 text-gray-300 hover:text-gray-500 rounded-full hover:bg-gray-100 transition-colors z-50"
            >
                <X className="w-8 h-8" />
            </button>

            {/* Language Selector */}
            <div className="absolute top-0 right-0 p-6 flex gap-4 z-50">

                <div className="flex gap-3 bg-gray-50/80 p-2 rounded-full shadow-sm border border-gray-100">
                    {(['VN', 'EN', 'KR', 'JP'] as const).map(lang => (
                        <button
                            key={lang}
                            onClick={() => setLanguage(lang)}
                            className={`px-4 py-2 rounded-full font-bold text-sm transition-all ${
                                language === lang 
                                    ? 'bg-indigo-600 text-white shadow-md' 
                                    : 'text-gray-500 hover:bg-gray-200'
                            }`}
                        >
                            {lang}
                        </button>
                    ))}
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
                            <h2 className="text-4xl font-bold text-gray-800 mb-4">{t.forgotTitle}</h2>
                            <p className="text-xl text-gray-500 mb-12">{t.forgotDesc}</p>
                            
                            <button 
                                onClick={() => setStep(2)}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-2xl font-bold py-6 px-12 rounded-full shadow-xl hover:shadow-2xl transition-all transform hover:scale-105"
                            >
                                {t.btnCheckDone}
                            </button>
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
                                <h2 className="text-4xl font-bold text-gray-800 mb-3">{t.rateTitle}</h2>
                                <p className="text-xl text-gray-500">{t.rateDesc}</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                                {mergedKtvGroups.map((group) => (
                                    <div key={group.ktvId} className="bg-white p-6 rounded-3xl shadow-sm border border-indigo-50 hover:shadow-md transition-shadow">
                                        <div className="flex items-center gap-4 mb-6">
                                            <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-500 shrink-0">
                                                <UserCircle2 className="w-10 h-10" />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-bold text-gray-800">{group.ktvName}</h3>
                                                <p className="text-sm text-gray-500 font-medium">{group.ktvId}</p>
                                                <p className="text-sm text-indigo-600 mt-1 font-medium bg-indigo-50 inline-block px-2 py-0.5 rounded-md">
                                                    {group.serviceNames.join(' + ')}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex justify-center gap-3 mb-6">
                                            {[1, 2, 3, 4, 5].map(star => (
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
                                            className="w-full bg-gray-50 border-none rounded-2xl p-4 text-gray-700 focus:ring-2 focus:ring-indigo-100 resize-none h-24"
                                        />
                                    </div>
                                ))}
                                {mergedKtvGroups.length === 0 && (
                                    <div className="col-span-full text-center p-10 bg-white rounded-3xl border border-gray-100 text-gray-500 text-xl">
                                        Không có nhân viên nào trong hệ thống cho đơn này.
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-center gap-6">
                                <button 
                                    onClick={onClose}
                                    className="px-8 py-5 rounded-full font-bold text-xl text-gray-500 hover:bg-gray-100 transition-colors"
                                >
                                    {t.btnCancel}
                                </button>
                                <button 
                                    onClick={handleSubmit}
                                    disabled={isSubmitting || mergedKtvGroups.length === 0}
                                    className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xl font-bold py-5 px-16 rounded-full shadow-lg hover:shadow-xl transition-all"
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
