'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

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
                    fetch(`/api/ktv/wallet/balance?techCode=${ktvId}`).then(r => r.json()),
                    fetch(`/api/ktv/wallet/timeline?techCode=${ktvId}`).then(r => r.json())
                ]);
                if (balanceRes.success) setWalletBalance(balanceRes.data);
                if (timelineRes.success) setWalletTimeline(timelineRes.data);
            } else if (activeTab === 'BONUS' && hasBonusFlag) {
                const [bonusBalRes, bonusTimeRes] = await Promise.all([
                    fetch(`/api/ktv/wallet/bonus/balance?techCode=${ktvId}`).then(r => r.json()),
                    fetch(`/api/ktv/wallet/bonus/timeline?techCode=${ktvId}`).then(r => r.json())
                ]);
                if (bonusBalRes.success) setBonusBalance(bonusBalRes.data);
                if (bonusTimeRes.success) setBonusTimeline(bonusTimeRes.data);
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
        // Tắt check hạn mức, cho phép gửi lệnh rút làm thông báo
        // const maxWithdraw = Number(walletBalance.effective_balance) - Number(walletBalance.min_deposit);
        // if (amount > maxWithdraw) {
        //     alert('Số tiền vượt quá mức khả dụng!');
        //     return false;
        // }
        try {
            const res = await fetch('/api/ktv/wallet/withdraw', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ techCode: ktvId, amount, walletType: 'TUA' })
            });
            const json = await res.json();
            if (json.success) {
                alert('✅ Yêu cầu rút tiền của bạn đã được duyệt.\nHãy đến quầy Lễ tân/Thu ngân để nhận tiền mặt nhé!');
                fetchWallet();
                return true;
            } else {
                alert('Lỗi: ' + json.error);
                return false;
            }
        } catch (e) {
            alert('Lỗi hệ thống khi tạo lệnh rút tiền.');
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
            const res = await fetch('/api/ktv/wallet/withdraw', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    techCode: ktvId, 
                    amount: vndAmount,
                    walletType: 'BONUS',
                    note: `[QUY ĐỔI BONUS] ${pointsToRedeem} điểm`
                })
            });
            const json = await res.json();
            if (json.success) {
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
            } else {
                alert('Lỗi: ' + json.error);
                return false;
            }
        } catch (e) {
            alert('Lỗi hệ thống khi tạo lệnh quy đổi.');
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
        isLoading,
        submitWithdraw,
        submitRedeemBonus,
        refresh: fetchWallet
    };
};
