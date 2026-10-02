'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { useToast } from '@/components/ui/Toast';
import { isFeatureMaintenanceError } from '@/lib/featureMaintenance';
import { FEATURE_MAINTENANCE_MESSAGE } from '@/lib/constants/featureMaintenance.i18n';
import {
    DEFAULT_FEATURE_FLAGS_TYPE_A,
    DEFAULT_FEATURE_FLAGS_TYPE_B,
    DEFAULT_FEATURE_FLAGS_TYPE_C,
    DEFAULT_FEATURE_FLAGS_TYPE_D,
} from '@/lib/constants/staff.constants';

/**
 * Is the BONUS wallet part of this work type's normal package?
 *
 * The "maintenance" rule is: feature OFF while the permission is still ON. The
 * wallet permission (`ktv_wallet`) covers the whole page, not each wallet, so
 * it cannot tell "admin switched Ví Bonus off" from "this type never had Ví
 * Bonus" (Types B/C are created with bonus_wallet=false). Listing a Ví Bonus
 * entry that says "đang bảo trì" forever to people who never had one would be
 * misleading, so the type's default package is the proxy for "was granted".
 * Ví Tua is in every package, so it is always listed.
 */
const bonusInPackage = (workType?: string | null): boolean => {
    const defaults: Record<string, any> = {
        TYPE_A: DEFAULT_FEATURE_FLAGS_TYPE_A,
        TYPE_B: DEFAULT_FEATURE_FLAGS_TYPE_B,
        TYPE_C: DEFAULT_FEATURE_FLAGS_TYPE_C,
        TYPE_D: DEFAULT_FEATURE_FLAGS_TYPE_D,
    };
    return defaults[workType || 'TYPE_A']?.bonus_wallet === true;
};

export const useKTVWallet = () => {
    const { user, hasPermission } = useAuth();
    const { addToast } = useToast();
    const canViewWallet = hasPermission('ktv_wallet');
    const ktvId = user?.id || '';

    const [activeTab, setActiveTab] = useState<'TUA' | 'BONUS'>('TUA');
    const [canViewTua, setCanViewTua] = useState(true);
    const [canViewBonus, setCanViewBonus] = useState(false);
    // The access check itself failed (network/server). Must NOT be shown as
    // "maintenance" — that would claim the admin switched the wallet off.
    const [accessError, setAccessError] = useState(false);
    // Land on a working wallet ONCE, on first load. Doing it on every fetch
    // would bounce the KTV off a switched-off wallet they just tapped, so they
    // would never see the maintenance notice for it.
    const initialTabResolvedRef = useRef(false);

    // Ví Tua
    const [walletBalance, setWalletBalance] = useState<any>(null);
    const [walletTimeline, setWalletTimeline] = useState<any[]>([]);
    
    // Ví Bonus
    const [bonusBalance, setBonusBalance] = useState<any>(null);
    const [bonusTimeline, setBonusTimeline] = useState<any[]>([]);

    // Ví Tích Lũy

    const [isLoading, setIsLoading] = useState(true);

    const fetchWallet = useCallback(async () => {
        if (!ktvId) return;
        setIsLoading(true);
        try {
            // Quyền xem ví do SERVER quyết (công tắc cả loại VÀ cờ cá nhân).
            // Trước đây chỗ này tự đọc feature_flags và tự chế mặc định, lệch
            // hẳn với bảng admin: cờ thiếu thì admin thấy OFF mà KTV vẫn xem được.
            let accessFailed = false;
            const accessRes = await apiClient
                .get<any>(API.KTV.WALLET.ACCESS(ktvId))
                .catch(() => { accessFailed = true; return { data: null }; });
            const access = accessRes?.data;
            setAccessError(accessFailed);

            // Không hỏi được server thì đóng hết — các route ví đằng nào cũng
            // trả 403, mở tab ra chỉ để báo lỗi thì thà đừng mở.
            const hasTuaFlag = access?.TUA === true;
            const hasBonusFlag = access?.BONUS === true;
            
            // First load only: TUA is off but BONUS is on → open on BONUS.
            if (!initialTabResolvedRef.current && !accessFailed) {
                initialTabResolvedRef.current = true;
                if (activeTab === 'TUA' && !hasTuaFlag && hasBonusFlag) {
                    setActiveTab('BONUS');
                }
            }

            setCanViewTua(hasTuaFlag);
            setCanViewBonus(hasBonusFlag);

            if (activeTab === 'TUA' && hasTuaFlag) {
                const [balanceRes, timelineRes] = await Promise.all([
                    apiClient.get<any>(API.KTV.WALLET.BALANCE(ktvId)).catch(() => ({ data: null })),
                    apiClient.get<any>(API.KTV.WALLET.TIMELINE(ktvId)).catch(() => ({ data: [] }))
                ]);
                if (balanceRes.data) setWalletBalance(balanceRes.data);
                if (timelineRes.data) setWalletTimeline(timelineRes.data);
            } else if (activeTab === 'BONUS' && hasBonusFlag) {
                const [bonusBalRes, bonusTimeRes] = await Promise.all([
                    apiClient.get<any>(API.KTV.WALLET.BONUS_BALANCE(ktvId)).catch(() => ({ data: null })),
                    apiClient.get<any>(API.KTV.WALLET.BONUS_TIMELINE(ktvId)).catch(() => ({ data: [] }))
                ]);
                if (bonusBalRes.data) setBonusBalance(bonusBalRes.data);
                if (bonusTimeRes.data) setBonusTimeline(bonusTimeRes.data);
            }
        } catch (err) {
            console.error('Lỗi khi tải dữ liệu ví:', err);
        } finally {
            setIsLoading(false);
        }
    }, [ktvId, activeTab]);

    useEffect(() => {
        if (ktvId && canViewWallet) {
            fetchWallet();
        }
    }, [ktvId, canViewWallet, fetchWallet]);

    // Yêu cầu: Tắt tính năng kiểm tra trong ca mới được rút tiền

    const submitWithdraw = async (amount: number) => {
        if (!walletBalance) return false;

        try {
            await apiClient.post<any>(API.KTV.WALLET.WITHDRAW, { techCode: ktvId, amount, walletType: 'TUA' });
            addToast('✅ Yêu cầu rút tiền của bạn đã được duyệt.\nHãy đến quầy Lễ tân/Thu ngân để nhận tiền mặt nhé!', 'success');
            fetchWallet();
            return true;
        } catch (e: any) {
            if (isFeatureMaintenanceError(e)) {
                // Wallet was switched off after the page loaded: say so plainly
                // (no "Lỗi:" prefix) and refresh so the tab shows the notice.
                addToast(FEATURE_MAINTENANCE_MESSAGE, 'error');
                fetchWallet();
            } else {
                addToast('Lỗi: ' + (e.message || 'Hệ thống lỗi khi tạo lệnh rút tiền.'), 'error');
            }
            return false;
        }
    };

    const submitRedeemBonus = async (pointsToRedeem: number) => {
        if (!bonusBalance || bonusBalance.points <= 0) return false;

        if (pointsToRedeem > bonusBalance.points) {
            addToast('Số điểm vượt quá mức khả dụng!', 'error');
            return false;
        }
        const vndAmount = pointsToRedeem * 1000;
        
        try {
            await apiClient.post<any>(API.KTV.WALLET.WITHDRAW, { 
                techCode: ktvId, 
                amount: vndAmount,
                walletType: 'BONUS',
                note: `[QUY ĐỔI BONUS] ${pointsToRedeem} điểm`
            });
            
            await supabase.from('KTVBonusLedger').insert({
                staff_id: ktvId,
                points: -pointsToRedeem,
                type: 'REDEEM',
                description: `Quy đổi ${pointsToRedeem} điểm sang ${vndAmount.toLocaleString()}đ`,
                date: new Date().toISOString().split('T')[0]
            });
            
            addToast(`✅ Yêu cầu quy đổi ${pointsToRedeem} điểm thành ${vndAmount.toLocaleString()}đ đã được gửi.\nHãy báo với Lễ tân/Thu ngân nhé!`, 'success');
            fetchWallet();
            return true;
        } catch (e: any) {
            if (isFeatureMaintenanceError(e)) {
                addToast(FEATURE_MAINTENANCE_MESSAGE, 'error');
                fetchWallet();
            } else {
                addToast('Lỗi: ' + (e.message || 'Hệ thống lỗi khi tạo lệnh quy đổi.'), 'error');
            }
            return false;
        }
    };

    return {
        user,
        canViewWallet,
        activeTab,
        setActiveTab,
        canViewTua,
        canViewBonus,
        // Entries listed in the selector even when switched off (tapping one
        // shows the maintenance notice instead of the wallet silently vanishing).
        showTuaEntry: true,
        showBonusEntry: canViewBonus || bonusInPackage(user?.work_type),
        accessError,
        walletBalance,
        walletTimeline,
        bonusBalance,
        bonusTimeline,
        isLoading,
        submitWithdraw,
        submitRedeemBonus,
        refresh: fetchWallet
    };
};
