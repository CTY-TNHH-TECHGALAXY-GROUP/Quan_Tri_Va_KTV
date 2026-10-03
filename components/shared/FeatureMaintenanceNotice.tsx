'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Wrench } from 'lucide-react';
import { t } from './FeatureMaintenanceNotice.i18n';

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = 0.25;
// Toasts render at z-[9999]; the full-screen notice must sit above them or a
// stale error toast floats over the only message the KTV is supposed to read.
const FULLSCREEN_Z_CLASS = 'z-[10000]';

interface FeatureMaintenanceNoticeProps {
    /**
     * `inline`     — inside a page (History, a wallet tab, a modal body).
     * `compact`    — one-row card in place of a dashboard tile.
     * `fullscreen` — replaces the whole app (manual account lock).
     */
    variant?: 'inline' | 'compact' | 'fullscreen';
    /** Shown only in the fullscreen variant: a locked KTV has nowhere else to go. */
    onLogout?: () => void;
    className?: string;
}

/**
 * The single "Tính năng của bạn đang bảo trì" notice. Every screen that has to
 * tell a KTV a feature is switched off renders THIS, so the sentence and look
 * never drift apart between screens.
 */
export const FeatureMaintenanceNotice = ({
    variant = 'inline',
    onLogout,
    className = '',
}: FeatureMaintenanceNoticeProps) => {
    if (variant === 'compact') {
        return (
            <div className={`w-full bg-slate-100 p-4 rounded-[32px] flex items-center gap-3 ${className}`}>
                <div className="w-10 h-10 shrink-0 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center">
                    <Wrench size={18} />
                </div>
                <p className="text-sm font-bold text-slate-700 text-left">{t.title}</p>
            </div>
        );
    }

    const body = (
        <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: ANIMATION_DURATION }}
            className="w-full max-w-sm px-6 py-8 text-center"
        >
            <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-5">
                <Wrench size={28} />
            </div>
            <p className="text-lg font-bold text-gray-900">{t.title}</p>
            {variant === 'fullscreen' && onLogout && (
                <button
                    onClick={onLogout}
                    className="mt-8 w-full min-h-[44px] bg-gray-900 hover:bg-gray-800 text-white font-medium py-3 rounded-xl transition-colors"
                >
                    {t.logout}
                </button>
            )}
        </motion.div>
    );

    if (variant === 'fullscreen') {
        return (
            <div className={`fixed inset-0 ${FULLSCREEN_Z_CLASS} flex items-center justify-center bg-white ${className}`}>
                {body}
            </div>
        );
    }

    return (
        <div className={`flex items-center justify-center py-16 ${className}`}>
            {body}
        </div>
    );
};
