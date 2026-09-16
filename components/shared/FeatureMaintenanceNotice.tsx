'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Wrench } from 'lucide-react';
import { t } from './FeatureMaintenanceNotice.i18n';

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = 0.25;

interface FeatureMaintenanceNoticeProps {
    /**
     * `inline`  — inside a page (History, a wallet tab).
     * `compact` — one-row card in place of a form field (check-in withdraw box).
     */
    variant?: 'inline' | 'compact';
    className?: string;
}

/**
 * The single "Tính năng của bạn đang bảo trì" notice. Every screen that has to
 * tell a KTV a feature is switched off renders THIS, so the sentence and look
 * never drift apart between screens.
 */
export const FeatureMaintenanceNotice = ({
    variant = 'inline',
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

    return (
        <div className={`flex items-center justify-center py-16 ${className}`}>
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
            </motion.div>
        </div>
    );
};
