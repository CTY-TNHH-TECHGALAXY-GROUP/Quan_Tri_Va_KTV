import { SupabaseClient } from '@supabase/supabase-js';

export interface CommissionConfig {
    milestones: Record<string, number>;
    ratePer60: number;
    minDeposit: number;
    isPenaltyEnabled: boolean;
    isBonusWalletEnabled: boolean;
}

export interface BonusConfig {
    s1Bonus: number;
    s2Bonus: number;
    s3Bonus: number;
}

export class KtvCommissionService {
    /**
     * Parse system configs for commission and wallet rules
     */
    static async getCommissionConfig(supabase: SupabaseClient): Promise<CommissionConfig> {
        const { data: configs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', [
                'ktv_commission_milestones',
                'ktv_commission_per_60min',
                'ktv_min_deposit',
                'enable_ktv_penalty',
                'enable_bonus_wallet'
            ]);

        const configMap: Record<string, string> = {};
        (configs || []).forEach(c => { configMap[c.key] = c.value; });

        let milestones = { "1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "100": 165000, "120": 200000, "180": 300000, "300": 500000 };
        let ratePer60 = 100000;
        let minDeposit = 500000;

        if (configMap['ktv_commission_milestones']) {
            try { 
                milestones = typeof configMap['ktv_commission_milestones'] === 'string' 
                    ? JSON.parse(configMap['ktv_commission_milestones']) 
                    : configMap['ktv_commission_milestones']; 
            } catch { }
        }
        
        if (configMap['ktv_commission_per_60min']) {
            const rawRate = String(configMap['ktv_commission_per_60min']).replace(/[^0-9]/g, '');
            if (rawRate) ratePer60 = Number(rawRate);
        }
        
        if (configMap['ktv_min_deposit']) {
            const rawDeposit = String(configMap['ktv_min_deposit']).replace(/[^0-9]/g, '');
            if (rawDeposit) minDeposit = Number(rawDeposit);
        }

        const isPenaltyEnabled = configMap['enable_ktv_penalty'] === 'true';
        const isBonusWalletEnabled = String(configMap['enable_bonus_wallet'] || '').replace(/"/g, '') === 'true';

        return { milestones, ratePer60, minDeposit, isPenaltyEnabled, isBonusWalletEnabled };
    }

    /**
     * Parse system configs for bonus points
     */
    static async getBonusConfig(supabase: SupabaseClient): Promise<BonusConfig> {
        const { data: bonusConfigs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', ['ktv_shift_1_bonus', 'ktv_shift_2_bonus', 'ktv_shift_3_bonus']);
        
        const bonusMap: Record<string, number> = {};
        (bonusConfigs || []).forEach((c: any) => { bonusMap[c.key] = Number(c.value) || 20; });
        
        return {
            s1Bonus: bonusMap['ktv_shift_1_bonus'] || 20,
            s2Bonus: bonusMap['ktv_shift_2_bonus'] || 20,
            s3Bonus: bonusMap['ktv_shift_3_bonus'] || 40
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
    static calcCommission(durationMins: number, milestones: Record<string, number>, ratePer60: number): number {
        const sMins = String(durationMins);
        if (milestones && milestones[sMins] !== undefined) {
            return Number(milestones[sMins]);
        }
        const h = durationMins / 60;
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
                const realMins = this.getMinsFromTimes(seg.startTime, seg.endTime);
                if (realMins > 0) return sum + realMins;
                return sum + (Number(seg.duration) || 0);
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
        // 1. Determine Max Rating for this KTV
        let maxKtvRating = 0;
        for (const item of (booking.BookingItems || [])) {
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
            if (mySegs.length > 0) {
                myTotalDuration += mySegs.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
            } else if (item.technicianCodes && item.technicianCodes.some((tc: string) => tc.toLowerCase() === techCode.toLowerCase())) {
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

        // Penalty for short duration
        if (myTotalDuration < 60) {
            adjustedBasePoints = adjustedBasePoints / 2;
        }

        // 4. Divide by total unique KTVs working on this booking
        const allKtvCodes = new Set<string>();
        for (const item of (booking.BookingItems || [])) {
            if (item.technicianCodes && Array.isArray(item.technicianCodes)) {
                item.technicianCodes.forEach((tc: string) => allKtvCodes.add(tc.toLowerCase()));
            }
        }
        const totalUniqueKTVs = allKtvCodes.size || 1;
        
        return Math.floor(adjustedBasePoints / totalUniqueKTVs);
    }
}
