/* 
=============================================================================================
🤖 AI AGENT WARNING (ZERO-TOUCH OLD DATA POLICY) - DO NOT REMOVE
=============================================================================================
1. BACKWARD COMPATIBILITY: The 'calculateBookingBonus' method uses a DUAL-LOGIC architecture.
   - For NEW bookings (with BookingGuests), it counts actual guests: `booking.BookingGuests.length`.
   - For OLD bookings (without BookingGuests), it falls back to `booking.guestCount`.
2. DO NOT modify this fallback logic. It is a protective fence to ensure historical financial 
   reports and KTV bonuses prior to August 18, 2026 are not corrupted or set to zero.
3. If you add new parameters or modify the scoring logic, ALWAYS ensure it works for both 
   data structures.
=============================================================================================
*/

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
    enableBonus: boolean;
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
        
        // 🛡️ Retry + throw thay vì âm thầm rơi về bảng giá mặc định (bảng mặc định trùng giá Loại A,
        // nên nếu fetch lỗi thoáng qua mà không throw, KTV Loại B sẽ bị tính nhầm như Loại A mà không ai biết).
        let configs: { key: string; value: any }[] | null = null;
        let fetchError: any = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            const { data, error } = await supabase
                .from('SystemConfigs')
                .select('key, value')
                .in('key', keysToFetch);
            if (!error) { configs = data; fetchError = null; break; }
            fetchError = error;
            if (attempt < 3) await new Promise(r => setTimeout(r, 300 * attempt));
        }
        if (fetchError) {
            console.error(`[KtvCommissionService] Fetch SystemConfigs that bai sau 3 lan cho workType=${workType}:`, fetchError);
            throw new Error(`Khong the lay cau hinh bang gia (${workType}) tu SystemConfigs: ${fetchError.message}`);
        }

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
        } else if (configMap['ktv_commission_per_60min'] !== undefined) {
            ratePer60 = Number(configMap['ktv_commission_per_60min']);
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
            `ktv_shift_3_bonus`,
            `enable_ktv_bonus${typeSuffix}`,
            `enable_ktv_bonus`
        ];
        
        const { data: bonusConfigs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', keysToFetch);
        const bonusMap: Record<string, any> = {};
        (bonusConfigs || []).forEach((c: any) => { bonusMap[c.key] = c.value; });
        
        let enableBonus = false;
        if (bonusMap[`enable_ktv_bonus${typeSuffix}`] !== undefined) {
            enableBonus = bonusMap[`enable_ktv_bonus${typeSuffix}`] === 'true' || bonusMap[`enable_ktv_bonus${typeSuffix}`] === true;
        } else if (bonusMap[`enable_ktv_bonus`] !== undefined) {
            enableBonus = bonusMap[`enable_ktv_bonus`] === 'true' || bonusMap[`enable_ktv_bonus`] === true;
        } else {
            // Default: TYPE_B is true, others are false
            enableBonus = workType === 'TYPE_B';
        }

        return {
            s1Bonus: Number(bonusMap[`ktv_shift_1_bonus${typeSuffix}`] ?? bonusMap['ktv_shift_1_bonus'] ?? 20),
            s2Bonus: Number(bonusMap[`ktv_shift_2_bonus${typeSuffix}`] ?? bonusMap['ktv_shift_2_bonus'] ?? 20),
            s3Bonus: Number(bonusMap[`ktv_shift_3_bonus${typeSuffix}`] ?? bonusMap['ktv_shift_3_bonus'] ?? 30),
            enableBonus
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
     * Parse segments to find the expected total duration for a specific KTV in a booking item
     * This prevents KTVs from exploiting actual working time (realMins) to get bonus.
     */
    static calculateItemExpectedDuration(item: any, techCode: string, fallbackDuration: number): number {
        let segs: any[] = [];
        try { 
            segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []); 
        } catch { }

        const mySegs = segs.filter((seg: any) => seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase()));

        if (mySegs.length > 0) {
            return mySegs.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || fallbackDuration), 0);
        }
        return 0; // Trả về 0 nếu KTV không có chặng nào trong dịch vụ này (Fix Duration Inflation)
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
                const baseMins = Number(seg.duration) || 0;
                
                let realMins = 0;
                if (seg.actualStartTime && seg.actualEndTime) {
                    const t1 = new Date(seg.actualStartTime).getTime();
                    const t2 = new Date(seg.actualEndTime).getTime();
                    if (!isNaN(t1) && !isNaN(t2)) {
                        realMins = Math.round((t2 - t1) / 60000);
                    }
                }
                
                if (realMins <= 0) {
                    realMins = this.getMinsFromTimes(seg.startTime, seg.endTime);
                }

                // 🔥 Fix: Return baseMins (which is the actual duration assigned on UI)
                // to match the exact behavior of KTV Dashboard. 
                // Do not use realMins (Math.max) to prevent overpaying for slow work.
                return sum + baseMins;
            }, 0);
        } else {
            return 0; // Trả về 0 để các hàm gọi (như Admin hay KPI) tự quyết định việc có Fallback chia đều hay không!
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
        bonusConfig: BonusConfig,
        staffWorkTypeMap: Record<string, string> = {},
        staffBonusMap: Record<string, boolean> = {},
        isNewRule: boolean = true,
        targetGuestId?: string // <--- NEW PARAMETER
    ): number {
        if (!bonusConfig.enableBonus) return 0;
        // Kiểm tra cờ cấp độ cá nhân (nếu được truyền vào và set là false)
        if (staffBonusMap[techCode.toLowerCase()] === false) return 0;
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
        
        let validUniqueKTVs = allKtvCodes.size;

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

        // 2 & 3. Calculate points per item and sum them up
        let totalDurationForBonus = 0;
        let ktvGuestIds = new Set<string>();
        
        for (const item of (booking.BookingItems || [])) {
            // Kiểm tra KTV có tham gia item này không
            let isTechInvolved = false;
            if (item.technicianCodes && Array.isArray(item.technicianCodes) && item.technicianCodes.length > 0) {
                isTechInvolved = item.technicianCodes.some((tc: string) => tc.toLowerCase() === techCode.toLowerCase());
            }

            if (!isTechInvolved) continue;
            
            // Nếu có targetGuestId, BỎ QUA các item không thuộc guest này
            if (targetGuestId && item.guest_id !== targetGuestId) continue;

            if (item.guest_id) ktvGuestIds.add(item.guest_id);

            // Tính tổng thời lượng của KTV này
            const fallbackMins = Number(item.options?.duration) || Number(item.duration) || 60;
            const itemExpectedDuration = this.calculateItemExpectedDuration(item, techCode, fallbackMins);
            totalDurationForBonus += itemExpectedDuration;
        }

        // ĐIỀU LUẬT TÍNH ĐIỂM:
        // Cả trước và sau 06/08 đều áp dụng công thức: Base * (Guest / KTV)
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
        
        const totalUniqueKTVs = validUniqueKTVs > 0 ? validUniqueKTVs : 1;

        // 🚀 DUAL-LOGIC HÀNG RÀO BẢO VỆ (Zero-Touch Old Data)
        let actualGuestCount = booking.guestCount || 1;
        if (booking.BookingGuests && Array.isArray(booking.BookingGuests) && booking.BookingGuests.length > 0) {
            const activeGuests = booking.BookingGuests.filter((g: any) => g.status !== 'CANCELLED');
            actualGuestCount = activeGuests.length > 0 ? activeGuests.length : 1;
        } else if (booking.BookingItems && Array.isArray(booking.BookingItems) && booking.BookingItems.length > 0) {
            const uniqueGuestIds = new Set<string>();
            booking.BookingItems.forEach((i: any) => {
                if (i.guest_id) uniqueGuestIds.add(i.guest_id);
            });
            if (uniqueGuestIds.size > 0) {
                actualGuestCount = Math.max(actualGuestCount, uniqueGuestIds.size);
            }
        }
        const guestCount = actualGuestCount;
        
        let calculatedPoints = 0;

        if (isNewRule) {
            // TỪ NGÀY 06/08 TRỞ ĐI: Công thức mới (Tính theo số Khách)
            // ⚠️ BUSINESS POLICY NOTE: Điểm thưởng (Bonus) được cấp dựa trên SỐ KHÁCH.
            // Nếu 2 KTV phục vụ chung 1 khách (Dù là gộp dịch vụ hay nối tiếp nhau), tổng Bonus CỦA KHÁCH ĐÓ vẫn chỉ là 1 suất.
            // Cả 2 KTV sẽ bị chia điểm (0.5). Đây là chính sách công ty (Company Policy) - tuyệt đối không thay đổi.
            
            // Tìm số khách mà KTV này thực tế có phục vụ
            const servedGuestCount = ktvGuestIds.size > 0 ? ktvGuestIds.size : 1;
            
            // LUẬT MỚI: Dưới 60 phút / 1 khách thì mất trắng (0 điểm)
            // Tính trung bình thời gian KTV phục vụ mỗi khách (chỉ tính những khách KTV NÀY CÓ LÀM)
            if ((totalDurationForBonus / servedGuestCount) < 60) {
                return 0;
            }

            // XÉT Ở ĐƠN CẤP 2 (SUB-ORDER): Tính tỷ lệ điểm cho từng khách riêng biệt
            let ratio = 0;
            const uniqueGuestIds = Array.from(ktvGuestIds);

            if (uniqueGuestIds.length === 0) {
                // Fallback nếu không có guest_id (Dữ liệu cũ - xét cấp 1)
                ratio = Math.min(guestCount / totalUniqueKTVs, 1);
            } else {
                // Xét theo từng ĐƠN CẤP 2 (Sub-order)
                for (const gId of uniqueGuestIds) {
                    const ktvsForThisGuest = new Set<string>();
                    for (const item of (booking.BookingItems || [])) {
                        if (item.guest_id === gId && item.technicianCodes && Array.isArray(item.technicianCodes)) {
                            item.technicianCodes.forEach((tc: string) => ktvsForThisGuest.add(tc.toLowerCase()));
                        }
                    }
                    const ktvsCount = ktvsForThisGuest.size || 1;
                    
                    // Áp dụng đúng quy tắc Company Policy nhưng ở level đơn cấp 2:
                    // Số suất của 1 khách = 1 (guestCount của khách này là 1)
                    // Tỷ lệ = 1 khách / Số KTV phục vụ khách đó
                    ratio += Math.min(1 / ktvsCount, 1);
                }
            }

            calculatedPoints = adjustedBasePoints * ratio;
        } else {
            // TRƯỚC NGÀY 06/08: Công thức cũ (1 đơn chỉ có BasePoints, chia cho KTV)
            calculatedPoints = adjustedBasePoints / totalUniqueKTVs;

            // LUẬT CŨ: Dưới 60 phút thì bị chia đôi điểm
            if (totalDurationForBonus < 60) {
                calculatedPoints = calculatedPoints / 2;
            }
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
        // 🔧 YÊU CẦU TỪ KHÁCH: Hủy bỏ hoàn toàn phương án giữ tiền hoặc bonus của nhân viên.
        // Mọi đơn hàng đều được trả lương và thưởng đầy đủ.
        return {
            isPassed: true,
            reasons: []
        };
    }
}
