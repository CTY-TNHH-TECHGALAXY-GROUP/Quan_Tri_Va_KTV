'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

export const useKTVWallet = () => {
    const { user, hasPermission } = useAuth();
    const canViewWallet = hasPermission('ktv_wallet');
    const ktvId = user?.id || '';

    const [activeTab, setActiveTab] = useState<'TUA' | 'BONUS' | 'TICH_LUY'>('TUA');
    const [canViewBonus, setCanViewBonus] = useState(false);
    const [canViewPiggyBank, setCanViewPiggyBank] = useState(false);

    // Ví Tua
    const [walletBalance, setWalletBalance] = useState<any>(null);
    const [walletTimeline, setWalletTimeline] = useState<any[]>([]);
    
    // Ví Bonus
    const [bonusBalance, setBonusBalance] = useState<any>(null);
    const [bonusTimeline, setBonusTimeline] = useState<any[]>([]);

    // Ví Tích Lũy
    const [piggyBankBalance, setPiggyBankBalance] = useState<any>(null);
    const [piggyBankTimeline, setPiggyBankTimeline] = useState<any[]>([]);
    const [piggyBankTotalWeeks, setPiggyBankTotalWeeks] = useState<number>(50);

    const [isLoading, setIsLoading] = useState(true);

    const fetchWallet = useCallback(async () => {
        if (!ktvId) return;
        setIsLoading(true);
        try {
            const { data: staffData } = await supabase.from('Staff').select('feature_flags').eq('id', ktvId).single();
            const hasBonusFlag = staffData?.feature_flags?.enable_bonus_wallet === true;
            const hasPiggyFlag = staffData?.feature_flags?.enable_piggy_wallet === true;
            setCanViewBonus(hasBonusFlag);
            setCanViewPiggyBank(hasPiggyFlag);

            if (activeTab === 'TUA') {
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
            } else if (activeTab === 'TICH_LUY' && hasPiggyFlag) {
                const piggyRes = await apiClient.get<any>(API.KTV.WALLET.PIGGY_BANK(ktvId)).catch(() => ({ data: null }));
                if (piggyRes.data) {
                    setPiggyBankBalance(piggyRes.data.bank);
                    setPiggyBankTimeline(piggyRes.data.ledger);
                    setPiggyBankTotalWeeks(piggyRes.data.totalWeeks);
                }
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

    const submitWithdraw = async (amount: number) => {
        if (!walletBalance) return false;
        try {
            await apiClient.post<any>(API.KTV.WALLET.WITHDRAW, { techCode: ktvId, amount, walletType: 'TUA' });
            alert('✅ Yêu cầu rút tiền của bạn đã được duyệt.\nHãy đến quầy Lễ tân/Thu ngân để nhận tiền mặt nhé!');
            fetchWallet();
            return true;
        } catch (e: any) {
            alert('Lỗi: ' + (e.message || 'Hệ thống lỗi khi tạo lệnh rút tiền.'));
            return false;
        }
    };

    const submitRedeemBonus = async (pointsToRedeem: number) => {
        if (!bonusBalance || bonusBalance.points <= 0) return false;
        
        if (pointsToRedeem > bonusBalance.points) {
            alert('Số điểm vượt quá mức khả dụng!');
            return false;
        }
        const vndAmount = pointsToRedeem * 1000;
        const confirmMsg = `XÁC NHẬN QUY ĐỔI\n\nBạn đang yêu cầu quy đổi ${pointsToRedeem} điểm thành ${vndAmount.toLocaleString()} VNĐ.\n\nĐồng ý?`;
        
        if (!window.confirm(confirmMsg)) return false;

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
            
            alert(`✅ Yêu cầu quy đổi ${pointsToRedeem} điểm thành ${vndAmount.toLocaleString()}đ đã được gửi.\nHãy báo với Lễ tân/Thu ngân nhé!`);
            fetchWallet();
            return true;
        } catch (e: any) {
            alert('Lỗi: ' + (e.message || 'Hệ thống lỗi khi tạo lệnh quy đổi.'));
            return false;
        }
    };

    return {
        user,
        canViewWallet,
        activeTab,
        setActiveTab,
        canViewBonus,
        canViewPiggyBank,
        walletBalance,
        walletTimeline,
        bonusBalance,
        bonusTimeline,
        piggyBankBalance,
        piggyBankTimeline,
        piggyBankTotalWeeks,
        isLoading,
        submitWithdraw,
        submitRedeemBonus,
        refresh: fetchWallet
    };
};
