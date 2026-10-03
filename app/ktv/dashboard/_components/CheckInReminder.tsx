'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { t } from './CheckInReminder.i18n';

// 🔧 UI CONFIGURATION
const REFRESH_INTERVAL_MS = 60_000;

/**
 * Nhắc KTV bấm "Oria xin chào" khi đang có đơn mà hôm nay chưa điểm danh.
 *
 * Từ 14/09/2026 quầy được phân đơn cho KTV chưa điểm danh (xác nhận qua popup),
 * nhưng loại D không điểm danh vẫn bị cron phạt vắng — nên phải nhắc ngay trên app.
 *
 * Tự gọi API trạng thái chấm công, KHÔNG đọc/ghi state của `KTVDashboard.logic.ts`
 * (CLAUDE.md mục 8 — không đụng 4 luồng lõi của dashboard).
 */
export const CheckInReminder = ({ hasOrder }: { hasOrder: boolean }) => {
    const { user } = useAuth();
    const [status, setStatus] = useState<{ checkStatus?: string; workType?: string } | null>(null);

    const refresh = useCallback(async () => {
        if (!user?.id) return;
        try {
            const res = await apiClient.get<any>(API.KTV.ATTENDANCE_STATUS(user.id));
            if (res?.success) setStatus({ checkStatus: res.checkStatus, workType: res.workType });
        } catch {
            // Nhắc chỉ là phụ — lỗi mạng thì im, không được chặn dashboard.
        }
    }, [user?.id]);

    useEffect(() => {
        if (!hasOrder) return;
        refresh();
        const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [hasOrder, refresh]);

    if (!hasOrder || status?.checkStatus !== 'IDLE') return null;

    return (
        <Link
            href="/ktv/attendance"
            className="flex items-start gap-3 p-4 min-h-[44px] rounded-3xl border border-amber-200 bg-amber-50 shadow-sm active:scale-[0.99] transition-transform"
        >
            <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
                <p className="text-sm font-black text-amber-900">{t.title}</p>
                <p className="text-xs font-medium text-amber-800 mt-0.5">{t.action}</p>
                {status?.workType === 'TYPE_D' && (
                    <p className="text-xs font-bold text-rose-600 mt-1">{t.typeDPenalty}</p>
                )}
            </div>
        </Link>
    );
};
