import { SupabaseClient } from '@supabase/supabase-js';

export interface CommissionConfig {
    milestones: Record<string, number>;
    ratePer60: number;
    minDeposit: number;
    isPenaltyEnabled: boolean;
    isBonusWalletEnabled: boolean;
    fixedOrderBonus?: number;
}

export interface BonusConfig {
    s1Bonus: number;
    s2Bonus: number;
    s3Bonus: number;
}

export class KtvCommissionService {
    static async getCommissionConfig(
        supabase: SupabaseClient, 
        workType: 'TYPE_A' | 'TYPE_B' | 'TYPE_C' = 'TYPE_A'
    ): Promise<CommissionConfig> {
        const typeSuffix = `_TYPE_${workType.replace('TYPE_', '')}`;
        
        // Cần fetch cả key theo Type và key chung (fallback)
        const keysToFetch = [
            `ktv_commission_milestones${typeSuffix}`,
            `ktv_commission_milestones`,
            `ktv_commission_milestones_type_b`, // Legacy
            `ktv_deposit_amount${typeSuffix}`,
            `ktv_deposit_amount`,
            `ktv_min_deposit`, // Legacy
            `ktv_sudden_off_penalty${typeSuffix}`,
            `ktv_sudden_off_penalty`,
            `enable_ktv_penalty`, // Legacy
            `ktv_instant_reward_enabled${typeSuffix}`,
            `ktv_instant_reward_enabled`,
            `enable_bonus_wallet`, // Legacy
            `ktv_type_b_fixed_order_bonus`
        ];
        
        const { data: configs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', keysToFetch);

        const configMap: Record<string, any> = {};
        (configs || []).forEach(c => { configMap[c.key] = c.value; });

        // Resolve Milestones
        let milestoneKey = `ktv_commission_milestones${typeSuffix}`;
        if (!configMap[milestoneKey]) milestoneKey = workType === 'TYPE_B' ? 'ktv_commission_milestones_type_b' : 'ktv_commission_milestones';
        
        let milestones = { "1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "100": 165000, "120": 200000, "180": 300000, "300": 500000 };
        if (configMap[milestoneKey]) {
            try { 
                milestones = typeof configMap[milestoneKey] === 'string' 
                    ? JSON.parse(configMap[milestoneKey]) 
                    : configMap[milestoneKey]; 
            } catch { }
        }
        
        // Rate (Không dùng theo Loại nữa vì mỗi mốc đã là VNĐ, nhưng giữ lại fallback)
        let ratePer60 = 100000;
        let rateKey = `ktv_commission_per_60min${typeSuffix}`;
        if (configMap[rateKey] !== undefined) {
            ratePer60 = Number(configMap[rateKey]);
        } else if (workType === 'TYPE_B') {
            ratePer60 = 180000;
        }
        
        // Deposit
        let minDeposit = 500000;
        let depositKey = configMap[`ktv_deposit_amount${typeSuffix}`] !== undefined ? `ktv_deposit_amount${typeSuffix}` 
                         : configMap['ktv_deposit_amount'] !== undefined ? 'ktv_deposit_amount' : 'ktv_min_deposit';
        if (configMap[depositKey] !== undefined) {
            const rawDeposit = String(configMap[depositKey]).replace(/[^0-9]/g, '');
            if (rawDeposit) minDeposit = Number(rawDeposit);
        }

        // Penalty
        let penaltyAmount = 50000;
        let penaltyKey = configMap[`ktv_sudden_off_penalty${typeSuffix}`] !== undefined ? `ktv_sudden_off_penalty${typeSuffix}` 
                         : configMap['ktv_sudden_off_penalty'] !== undefined ? 'ktv_sudden_off_penalty' : null;
        if (penaltyKey && configMap[penaltyKey] !== undefined) {
             penaltyAmount = Number(configMap[penaltyKey]) || 50000;
        }
        const isPenaltyEnabled = penaltyAmount > 0 || configMap['enable_ktv_penalty'] === 'true'; // Nếu phạt > 0 thì bật

        // Instant Reward (Bonus Wallet)
        let instantRewardKey = configMap[`ktv_instant_reward_enabled${typeSuffix}`] !== undefined ? `ktv_instant_reward_enabled${typeSuffix}` 
                             : configMap['ktv_instant_reward_enabled'] !== undefined ? 'ktv_instant_reward_enabled' : 'enable_bonus_wallet';
        const isBonusWalletEnabled = String(configMap[instantRewardKey] || '').replace(/"/g, '') === 'true';
        
        // Fixed Order Bonus (chủ yếu cho B)
        let fixedOrderBonus = 20000;
        if (configMap['ktv_type_b_fixed_order_bonus']) {
            fixedOrderBonus = Number(configMap['ktv_type_b_fixed_order_bonus']) || 20000;
        }

        return { milestones, ratePer60, minDeposit, isPenaltyEnabled, isBonusWalletEnabled, fixedOrderBonus };
    }

    /**
     * Fetch all configs for A, B, C at once to optimize batch reporting
     */
    static async getAllConfigs(supabase: SupabaseClient): Promise<Record<string, CommissionConfig>> {
        const [configA, configB, configC] = await Promise.all([
            this.getCommissionConfig(supabase, 'TYPE_A'),
            this.getCommissionConfig(supabase, 'TYPE_B'),
            this.getCommissionConfig(supabase, 'TYPE_C')
        ]);
        return {
            'TYPE_A': configA,
            'TYPE_B': configB,
            'TYPE_C': configC
        };
    }

    /**
     * Fetch all bonus configs for A, B, C at once
     */
    static async getAllBonusConfigs(supabase: SupabaseClient): Promise<Record<string, BonusConfig>> {
        const [bonusA, bonusB, bonusC] = await Promise.all([
            this.getBonusConfig(supabase, 'TYPE_A'),
            this.getBonusConfig(supabase, 'TYPE_B'),
            this.getBonusConfig(supabase, 'TYPE_C')
        ]);
        return {
            'TYPE_A': bonusA,
            'TYPE_B': bonusB,
            'TYPE_C': bonusC
        };
    }

    /**
     * Parse system configs for bonus points
     */
    static async getBonusConfig(
        supabase: SupabaseClient,
        workType: 'TYPE_A' | 'TYPE_B' | 'TYPE_C' = 'TYPE_A'
    ): Promise<BonusConfig> {
        const typeSuffix = `_TYPE_${workType.replace('TYPE_', '')}`;
        
        const keysToFetch = [
            `ktv_shift_1_bonus${typeSuffix}`,
            `ktv_shift_1_bonus`,
            `ktv_shift_2_bonus${typeSuffix}`,
            `ktv_shift_2_bonus`,
            `ktv_shift_3_bonus${typeSuffix}`,
            `ktv_shift_3_bonus`
        ];
        
        const { data: bonusConfigs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', keysToFetch);
        
        const bonusMap: Record<string, number> = {};
        (bonusConfigs || []).forEach((c: any) => { bonusMap[c.key] = Number(c.value) || 20; });
        
        return {
            s1Bonus: bonusMap[`ktv_shift_1_bonus${typeSuffix}`] ?? bonusMap['ktv_shift_1_bonus'] ?? 20,
            s2Bonus: bonusMap[`ktv_shift_2_bonus${typeSuffix}`] ?? bonusMap['ktv_shift_2_bonus'] ?? 20,
            s3Bonus: bonusMap[`ktv_shift_3_bonus${typeSuffix}`] ?? bonusMap['ktv_shift_3_bonus'] ?? 30
        };
    }

    /**
     * Calculate duration in minutes between two HH:mm strings
     */
    static getMinsFromTimes(start: string, end: string): number {
        if (!start || !end) return 0;
        const [h1, m1] = start.split(':').map(Number);
        const [h2, m2] = end.split(':').map(Number);
        if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return 0;
        let mins1 = h1 * 60 + m1;
        let mins2 = h2 * 60 + m2;
        // Handle next day boundary
        if (mins2 < mins1) mins2 += 24 * 60;
        return mins2 - mins1;
    }

    /**
     * Calculate basic commission based on duration using milestone map or flat rate fallback
     */
    static calcCommission(
        durationMins: number, 
        commConfigs: Record<string, CommissionConfig>, 
        workType: string, 
        serviceId: string = ''
    ): number {
        let activeConfig = commConfigs[workType] || commConfigs['TYPE_A'];
        
        if (workType === 'TYPE_B') {
            const sId = String(serviceId || '').toUpperCase();
            const isPremiumService = sId.startsWith('NHP') || sId.startsWith('NHT');
            if (!isPremiumService) {
                // If it's not premium, Type B falls back to Type A rates (e.g. NHS)
                activeConfig = commConfigs['TYPE_A'];
            }
        }

        const sMins = String(durationMins);
        if (activeConfig && activeConfig.milestones && activeConfig.milestones[sMins] !== undefined) {
            return Number(activeConfig.milestones[sMins]);
        }
        
        const h = durationMins / 60;
        const ratePer60 = activeConfig ? activeConfig.ratePer60 : 100000;
        const comm = Math.round(h * ratePer60);
        return Math.round(comm / 1000) * 1000;
    }

    /**
     * Parse segments to find the total working time for a specific KTV in a booking item
     */
    static calculateItemDuration(item: any, techCode: string, fallbackDuration: number): number {
        let segs: any[] = [];
        try { 
            segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); 
        } catch { }

        const mySegs = segs.filter((seg: any) => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase()));

        if (mySegs.length > 0) {
            return mySegs.reduce((sum: number, seg: any) => {
                if (seg.customCommissionDuration) return sum + Number(seg.customCommissionDuration);
                const baseMins = Number(seg.duration) || fallbackDuration || 60;
                const realMins = this.getMinsFromTimes(seg.startTime, seg.endTime);
                if (realMins > 0) return sum + Math.max(realMins, baseMins);
                return sum + baseMins;
            }, 0);
        } else {
            return fallbackDuration;
        }
    }

    /**
     * Calculate total bonus points for a specific KTV in a given booking
     */
    static calculateBookingBonus(
        booking: any, 
        techCode: string, 
        todayStr: string, 
        shiftsData: any[], 
        bonusConfig: BonusConfig
    ): number {
        // Compute all unique technicians in this booking for dividing points
        const allKtvCodes = new Set<string>();
        for (const item of (booking.BookingItems || [])) {
            if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                item.technicianCodes.forEach((tc: string) => allKtvCodes.add(tc.toLowerCase()));
            }
        }
        if (allKtvCodes.size === 0 && booking.technicianCode) {
            const codes = typeof booking.technicianCode === 'string' ? booking.technicianCode.split(',') : [];
            codes.forEach((c: string) => {
                if (c.trim()) allKtvCodes.add(c.trim().toLowerCase());
            });
        }

        // 1. Determine Max Rating for this KTV
        let maxKtvRating = 0;
        for (const item of (booking.BookingItems || [])) {
            let isTechInvolved = false;
            if (item.technicianCodes && Array.isArray(item.technicianCodes) && item.technicianCodes.length > 0) {
                isTechInvolved = item.technicianCodes.some((tc: string) => tc.toLowerCase() === techCode.toLowerCase());
            } else {
                const codes = typeof booking.technicianCode === 'string' ? booking.technicianCode.split(',') : [];
                isTechInvolved = codes.some((tc: string) => tc.trim().toLowerCase() === techCode.toLowerCase());
            }
                
            if (!isTechInvolved) continue;

            let ktvRating = 0;
            // Priority 1: ktvRatings map
            let parsedKtvRatings = item.ktvRatings;
            if (typeof parsedKtvRatings === 'string') {
                try { parsedKtvRatings = JSON.parse(parsedKtvRatings); } catch { parsedKtvRatings = {}; }
            }
            if (parsedKtvRatings && typeof parsedKtvRatings === 'object') {
                const key = Object.keys(parsedKtvRatings).find((k: string) => k.toLowerCase() === techCode.toLowerCase());
                if (key) ktvRating = Number(parsedKtvRatings[key]) || 0;
            }
            // Priority 2: itemRating
            if (ktvRating === 0) ktvRating = Number(item.itemRating) || 0;
            // Priority 3: booking rating
            if (ktvRating === 0) ktvRating = Number(booking.rating) || 0;
            
            if (ktvRating > maxKtvRating) maxKtvRating = ktvRating;
        }

        // Must be >= 4 to receive bonus
        if (maxKtvRating < 4) return 0;

        // 2. Calculate working duration for THIS KTV specifically
        let myTotalDuration = 0;
        for (const item of (booking.BookingItems || [])) {
            let segs: any[] = [];
            try { segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); } catch { }
            const mySegs = segs.filter((seg: any) => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase()));
            
            let isTechInvolved = false;
            if (item.technicianCodes && Array.isArray(item.technicianCodes) && item.technicianCodes.length > 0) {
                isTechInvolved = item.technicianCodes.some((tc: string) => tc.toLowerCase() === techCode.toLowerCase());
            } else {
                const codes = typeof booking.technicianCode === 'string' ? booking.technicianCode.split(',') : [];
                isTechInvolved = codes.some((tc: string) => tc.trim().toLowerCase() === techCode.toLowerCase());
            }

            if (mySegs.length > 0) {
                myTotalDuration += mySegs.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
            } else if (isTechInvolved) {
                myTotalDuration += 60; // Fallback
            }
        }

        // 3. Determine Shift Bonus Points
        const bookingDateStr = booking.timeStart ? booking.timeStart.slice(0, 10) : todayStr;
        let currentShift = 'SHIFT_1';
        const ktvShifts = (shiftsData || []).filter(s => s.employeeId === techCode);
        for (const s of ktvShifts) {
            const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
            if (effDate && effDate <= bookingDateStr) {
                currentShift = s.shiftType;
            }
        }

        let adjustedBasePoints = bonusConfig.s1Bonus;
        if (currentShift === 'SHIFT_2') adjustedBasePoints = bonusConfig.s2Bonus;
        else if (currentShift === 'SHIFT_3') adjustedBasePoints = bonusConfig.s3Bonus;

        // 4. Calculate points based on guestCount and total unique KTVs in the booking
        const totalUniqueKTVs = allKtvCodes.size || 1;
        const guestCount = booking.guestCount || 1;
        
        let calculatedPoints = adjustedBasePoints * (guestCount / totalUniqueKTVs);

        // Cap points to max adjustedBasePoints (Max ứng 1 Khách chỉ là Base)
        calculatedPoints = Math.min(calculatedPoints, adjustedBasePoints);

        // Penalty for short duration
        if (myTotalDuration < 60) {
            calculatedPoints = calculatedPoints / 2;
        }

        return Math.floor(calculatedPoints);
    }

    /**
     * Checks if a BookingItem has passed all conditions to release the salary (Hold Salary Feature).
     * @param item BookingItems record
     * @param booking Bookings record (for fallback rating)
     * @param ktvId Technician ID to check against
     * @returns { isPassed: boolean, reasons: string[] }
     */
    static checkIsItemPassed(item: any, booking: any, ktvId: string): { isPassed: boolean, reasons: string[] } {
        const reasons: string[] = [];

        // 🔧 YÊU CẦU TỪ KHÁCH: Chỉ áp dụng 3 bước duyệt Hold Salary cho đơn từ tháng 8/2026 trở đi.
        // Đơn tháng 7/2026 trở về trước (tức < 2026-07-31T17:00:00Z - giờ VN là 00:00 01/08/2026) tự động pass 100%.
        const bookingDate = booking?.timeStart || booking?.createdAt;
        if (bookingDate) {
            const bd = new Date(bookingDate);
            if (bd.getTime() < 1785517200000) {
                return { isPassed: true, reasons: [] };
            }
        }
        
        // 1. Duyệt phòng
        if (item.handover_status !== 'APPROVED') {
            reasons.push('Phòng chưa được duyệt (hoặc bị từ chối)');
        }
        
        // 2. Khách đánh giá (Rating == 1 thì hold, null hoặc >= 2 thì pass)
        // Check KTV's specific rating first, then item rating, then booking rating
        let finalRating: number | null = null;
        if (item.ktvRatings && typeof item.ktvRatings === 'object' && item.ktvRatings[ktvId]) {
            finalRating = Number(item.ktvRatings[ktvId]);
        } else if (item.itemRating != null) {
            finalRating = Number(item.itemRating);
        } else if (booking && booking.rating != null) {
            finalRating = Number(booking.rating);
        }

        if (finalRating === 1) {
            reasons.push('Khách hàng đánh giá 1 sao');
        }

        // 3. Quầy đánh giá KTV (reception_ktv_notes trong options)
        if (item.options && item.options.reception_ktv_notes && item.options.reception_ktv_notes[ktvId]) {
            const note = item.options.reception_ktv_notes[ktvId].trim();
            if (note.length > 0) {
                reasons.push(`Quầy nhận xét: ${note}`);
            }
        }

        return {
            isPassed: reasons.length === 0,
            reasons
        };
    }
}
