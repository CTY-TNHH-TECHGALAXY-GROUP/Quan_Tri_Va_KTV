'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { useToast } from '@/components/ui/Toast';

export const useKTVWallet = () => {
    const { user, hasPermission } = useAuth();
    const { addToast } = useToast();
    const canViewWallet = hasPermission('ktv_wallet');
    const ktvId = user?.id || '';

    const [activeTab, setActiveTab] = useState<'TUA' | 'BONUS'>('TUA');
    const [canViewTua, setCanViewTua] = useState(true);
    const [canViewBonus, setCanViewBonus] = useState(false);

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
            const accessRes = await apiClient
                .get<any>(API.KTV.WALLET.ACCESS(ktvId))
                .catch(() => ({ data: null }));
            const access = accessRes?.data;

            // Không hỏi được server thì đóng hết — các route ví đằng nào cũng
            // trả 403, mở tab ra chỉ để báo lỗi thì thà đừng mở.
            const hasTuaFlag = access?.TUA === true;
            const hasBonusFlag = access?.BONUS === true;
            
            // If the user doesn't have TUA wallet flag, but TUA is active, switch tab
            if (activeTab === 'TUA' && !hasTuaFlag) {
                if (hasBonusFlag) setActiveTab('BONUS');
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
            addToast('Lỗi: ' + (e.message || 'Hệ thống lỗi khi tạo lệnh rút tiền.'), 'error');
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
            addToast('Lỗi: ' + (e.message || 'Hệ thống lỗi khi tạo lệnh quy đổi.'), 'error');
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
