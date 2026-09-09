import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';
import { KtvTypeDCommissionService } from '@/lib/services/KtvTypeDCommissionService';
import { KtvTypeDBonusService } from '@/lib/services/KtvTypeDBonusService';
import { processMonthlyLedgerSync, processYearlyLedgerSync, processMonthlyMaintenanceFee } from '@/lib/services/KtvLedgerSyncService';
import { SyncDailyLedgerPostSchema } from '@/lib/schemas/finance.schema';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Internal core logic for syncing ledger
async function processLedgerSync(targetDateStr: string) {
    console.log(`[Cron] Syncing Daily Ledger for date: ${targetDateStr}`);

    // Boundaries in VN time
    const startTimeStr = `${targetDateStr}T00:00:00+07:00`;
    const endTimeStr = `${targetDateStr}T23:59:59.999+07:00`;

    // 1. Get configs from centralized service
    const allConfigs = await KtvCommissionService.getAllConfigs(supabase);
    const allBonusConfigs = await KtvCommissionService.getAllBonusConfigs(supabase);

    const TYPE_D_RULE_EFFECTIVE_FROM = '2026-09-01';

    // Fetch System Configs for TYPE_D (since KtvTypeDCommissionService needs raw values)
    const { data: configsData } = await supabase.from('SystemConfigs').select('key, value').ilike('key', '%type_d%');
    const typeDConfigs: Record<string, any> = {};
    (configsData || []).forEach((c: any) => { typeDConfigs[c.key] = c.value; });

    const { data: sysConfigsData } = await supabase.from('SystemConfigs').select('key, value').in('key', ['ktv_bonus_rate_TYPE_D']);
    const sysConfigs: Record<string, any> = {};
    (sysConfigsData || []).forEach((c: any) => { sysConfigs[c.key] = c.value; });

    const rateVIP_D = Number(typeDConfigs['ktv_type_d_vip_rate_per_60m']) || 180000;
    const ratePT_D = Number(typeDConfigs['ktv_type_d_pt_rate_per_60m']) || 100000;
    let ratingDeductions_D = { "0": 0, "1": 0.75, "2": 0.5, "3": 0.25, "4": 0 };
    if (typeDConfigs['ktv_type_d_rating_deduction']) {
        try {
            ratingDeductions_D = typeof typeDConfigs['ktv_type_d_rating_deduction'] === 'string' 
                ? JSON.parse(typeDConfigs['ktv_type_d_rating_deduction']) 
                : typeDConfigs['ktv_type_d_rating_deduction'];
        } catch {}
    }
    const basePoints_D = Number(typeDConfigs['ktv_type_d_bonus_points']) || 20;
    const pointRate_D = Number(sysConfigs['ktv_bonus_rate_TYPE_D']) || 1000;

    // 2. Fetch KTVs
    const { data: ktvs } = await supabase
        .from('Staff')
        .select('id, full_name, work_type, feature_flags')
        .neq('work_type', 'TYPE_D');
    
    if (!ktvs || ktvs.length === 0) return NextResponse.json({ success: true, message: 'No KTVs found' });
    
    const staffWorkTypeMap: Record<string, string> = {};
    const staffBonusMap: Record<string, boolean> = {};
    ktvs.forEach(k => {
        staffWorkTypeMap[k.id.toLowerCase()] = k.work_type || 'TYPE_A';
        const canBonus = k.feature_flags?.enable_bonus ?? true;
        staffBonusMap[k.id.toLowerCase()] = canBonus;
        staffBonusMap[k.id] = canBonus;
    });

    // 2.5 Fetch Shifts
    const { data: shiftsData } = await supabase
        .from('KTVShifts')
        .select('employeeId, shiftType, effectiveFrom')
        .lte('effectiveFrom', targetDateStr)
        .in('status', ['ACTIVE', 'REPLACED'])
        .order('effectiveFrom', { ascending: true })
        .order('createdAt', { ascending: true });
        
    const ktvShiftMap = new Map<string, string>();
    (shiftsData || []).forEach(s => ktvShiftMap.set(s.employeeId, s.shiftType));

    // Lấy config ngày lễ để đè ca 2
    let isHoliday = false;
    const { data: holidayDatesRes } = await supabase.from('SystemConfigs').select('value').eq('key', 'holiday_shift2_dates').single();
    let holidayDates: any = [];
    if (holidayDatesRes?.value) {
        try { holidayDates = typeof holidayDatesRes.value === 'string' ? JSON.parse(holidayDatesRes.value) : holidayDatesRes.value; } catch { }
    }
    
    if (holidayDates && Array.isArray(holidayDates)) {
        const targetMonthDay = targetDateStr.slice(5, 10);
        if (holidayDates.includes(targetMonthDay)) {
            isHoliday = true;
        }
    }
    
    if (isHoliday) {
        ktvs.forEach(ktv => ktvShiftMap.set(ktv.id, 'SHIFT_2'));
    }
    
    // Convert to the array format that calculateBookingBonus expects
    const processedShiftsData = Array.from(ktvShiftMap.entries()).map(([employeeId, shiftType]) => ({
        employeeId,
        shiftType,
        effectiveFrom: targetDateStr
    }));

    // 3. Fetch Bookings for the target date
    const { data: bookings } = await supabase
        .from('Bookings')
        .select(`
            id, timeStart, timeEnd, status, technicianCode, rating, guestCount, createdAt,
            BookingItems:BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, segments, status, tip, itemRating, ktvRatings, options, handover_status, handover_comment ),
            BookingGuests ( id, status )
        `)
        .gte('bookingDate', startTimeStr)
        .lte('bookingDate', endTimeStr)
        .not('status', 'in', '("CANCELLED","NEW")');

    const { data: services } = await supabase.from('Services').select('id, duration, is_utility');
    const svcDurationMap: Record<string, number> = {};
    const svcUtilityMap: Record<string, boolean> = {};
    (services || []).forEach(s => { 
        svcDurationMap[String(s.id)] = s.duration || 60; 
        svcUtilityMap[String(s.id)] = s.is_utility === true;
    });

    // 4. Fetch Adjustments & Withdrawals for the target date
    const { data: adjustments } = await supabase
        .from('WalletAdjustments')
        .select('staff_id, amount')
        .gte('created_at', startTimeStr)
        .lte('created_at', endTimeStr);

    const { data: withdrawals } = await supabase
        .from('KTVWithdrawals')
        .select('staff_id, amount')
        .eq('status', 'APPROVED')
        .gte('request_date', startTimeStr)
        .lte('request_date', endTimeStr);

    // 4.5 [DEPRECATED] Sudden Off penalty now handled directly in attendance API via WalletAdjustments
    // Kept as comment for audit trail. Penalty is deducted per-staff with feature_flags check.

    const validBookings = (bookings || []).filter(b => b.BookingItems && b.BookingItems.length > 0);

    const upsertRows = [];
    const bonusRecords: any[] = []; // kept for compatibility if needed later, but removed insertion

    // 5. Calculate per KTV
    for (const ktv of ktvs) {
        const techCode = ktv.id;
        
        if (ktv.work_type === 'TYPE_D') {
            if (targetDateStr < TYPE_D_RULE_EFFECTIVE_FROM) {
                console.log(`[Cron] Skip TYPE_D KTV ${techCode} for date ${targetDateStr} (before effective date ${TYPE_D_RULE_EFFECTIVE_FROM}). Keeping Option B (GIỮ NGUYÊN).`);
                continue; // Do not calculate and do not push to upsertRows to keep existing data untouched
            }
        }

        const workType = ktv.work_type === 'TYPE_B' ? 'TYPE_B' : ktv.work_type === 'TYPE_C' ? 'TYPE_C' : ktv.work_type === 'TYPE_D' ? 'TYPE_D' : 'TYPE_A';
        const commConfig = allConfigs[workType] || allConfigs['TYPE_A'];
        const bonusConfig = allBonusConfigs[workType] || allBonusConfigs['TYPE_A'];

        let total_commission = 0;
        let total_tip = 0;
        let total_bonus = 0;
        let total_penalty = 0; // Penalty now handled via WalletAdjustments (attendance API)
        const commissionBreakdown: any[] = [];

        for (const b of validBookings) {
            // 🧠 Filter theo ITEM STATUS thay vì Booking cha — tránh kẹt tiền khi Booking cha chưa cập nhật
            const DONE_STATUSES = ['DONE', 'COMPLETED', 'CLEANING', 'FEEDBACK'];
            const relevantItems = (b.BookingItems || []).filter((i: any) =>
                i.technicianCodes && Array.isArray(i.technicianCodes) &&
                i.technicianCodes.some((tc: string) => tc.toLowerCase().includes(techCode.toLowerCase())) &&
                DONE_STATUSES.includes(i.status)
            );

            if (relevantItems.length === 0) continue;

            let bookingCommission = 0;
            let bookingTip = 0;
            let passedItemCount = 0;

            for (const item of relevantItems) {
                const { isPassed } = KtvCommissionService.checkIsItemPassed(item, b, techCode);
                if (isPassed) {
                    passedItemCount++;
                    bookingTip += (Number(item.tip) || 0);
                }
            }

            if (passedItemCount > 0) {
                if (workType === 'TYPE_D') {
                    // Loại D lọc bỏ item tiện ích khi tính hoa hồng
                    let typeDItems = relevantItems.filter((i: any) => !svcUtilityMap[String(i.serviceId)]);
                    if (typeDItems.length === 0 && relevantItems.length > 0) {
                        typeDItems = relevantItems; // Fallback
                    }

                    const vipItems = typeDItems.filter((i: any) => {
                        const svcId = String(i.serviceId).toUpperCase();
                        return svcId.startsWith('NHP') || svcId.startsWith('NHT') || svcId.startsWith('VIP');
                    });
                    const ptItems = typeDItems.filter((i: any) => {
                        const svcId = String(i.serviceId).toUpperCase();
                        return !(svcId.startsWith('NHP') || svcId.startsWith('NHT') || svcId.startsWith('VIP'));
                    });

                    const vipComm = KtvTypeDCommissionService.calculateGuestCommission(vipItems, techCode, b.rating, rateVIP_D, ratingDeductions_D);
                    const ptComm = KtvTypeDCommissionService.calculateGuestCommission(ptItems, techCode, b.rating, ratePT_D, ratingDeductions_D);
                    bookingCommission = vipComm + ptComm;

                    commissionBreakdown.push({
                        bookingId: b.id,
                        itemId: null,
                        serviceId: null,
                        duration: 0,
                        workType,
                        commission: bookingCommission,
                        note: 'TYPE_D calculated via KtvTypeDCommissionService'
                    });
                } else {
                    // Dịch vụ mà KTV đã bị TƯỚC quyền lợi (đổi ra, huỷ không công).
                    // Xem KtvCommissionService.isKtvVoidedOnItem: dòng dự phòng
                    // `itemDuration <= 0 → 60` sinh ra để cứu đơn THIẾU SEGMENT,
                    // nhưng chặng bị tước cũng ra 0 nên bị gộp làm một. Đây là sổ
                    // cái ngày — số sai ở đây đóng cứng vào KTVDailyLedger rồi màn
                    // Lịch sử và Ví đọc lại, sửa sau phải chạy lại cron.
                    const coItemConQuyenLoi = relevantItems.some(
                        (i: any) => !KtvCommissionService.isKtvVoidedOnItem(i, techCode)
                    );

                    for (const item of relevantItems) {
                        const { isPassed } = KtvCommissionService.checkIsItemPassed(item, b, techCode);
                        if (isPassed && !KtvCommissionService.isKtvVoidedOnItem(item, techCode)) {
                            const fallbackDuration = svcDurationMap[String(item.serviceId)] || 60;
                            let itemDuration = KtvCommissionService.calculateItemDuration(item, techCode, fallbackDuration);
                            if (itemDuration <= 0) itemDuration = 60;
                            const itemCommission = KtvCommissionService.calcCommission(itemDuration, allConfigs, workType, item.serviceId);
                            bookingCommission += itemCommission;
                            commissionBreakdown.push({
                                bookingId: b.id,
                                itemId: item.id,
                                serviceId: item.serviceId || null,
                                duration: itemDuration,
                                workType,
                                commission: itemCommission
                            });
                        }
                    }

                    if (bookingCommission === 0 && coItemConQuyenLoi) {
                        bookingCommission = KtvCommissionService.calcCommission(60, allConfigs, workType, '');
                        commissionBreakdown.push({
                            bookingId: b.id,
                            itemId: null,
                            serviceId: null,
                            duration: 60,
                            workType,
                            commission: bookingCommission,
                            fallback: true // ⚠️ Nhánh dự phòng
                        });
                    }
                }
            }


            total_commission += bookingCommission;
            total_tip += bookingTip;
            
            // Bonus calculation via Service
            if (passedItemCount > 0) {
                // TYPE_D đã được tách sang cron riêng (sync-daily-ledger-type-d)
                if (workType !== 'TYPE_D') {
                    const bDate = new Date(b.timeStart || (b as any).createdAt || targetDateStr);
                    const isNewRule = bDate >= new Date('2026-08-05T00:00:00+07:00');
                    let bForBonus = b;
                    if (!isNewRule) {
                        const filteredItemsForBonus = (b.BookingItems || []).filter((i: any) => !svcUtilityMap[String(i.serviceId)]);
                        bForBonus = { ...b, BookingItems: filteredItemsForBonus };
                    }
                    const bookingBonus = KtvCommissionService.calculateBookingBonus(bForBonus, techCode, targetDateStr, processedShiftsData, bonusConfig, staffWorkTypeMap, staffBonusMap, isNewRule);
                    total_bonus += bookingBonus;
                }
            }
        }

        const ktvAdjustments = (adjustments || []).filter(a => a.staff_id === techCode);
        const ktvWithdrawals = (withdrawals || []).filter(w => w.staff_id === techCode);

        const total_adjustment = ktvAdjustments.reduce((sum, a) => sum + Number(a.amount), 0);
        const total_withdrawn = ktvWithdrawals.reduce((sum, w) => sum + Number(w.amount), 0);

        upsertRows.push({
            date: targetDateStr,
            staff_id: techCode,
            total_commission,
            total_tip,
            total_bonus,
            total_penalty,
            total_adjustment,
            total_withdrawn,
            total_tax: 0,
            work_type_snapshot: workType,
            rating_deduction: 0,
            commission_breakdown: commissionBreakdown,
            updated_at: new Date().toISOString()
        });
    }

    // 6. Bulk UPSERT KTVDailyLedger
    if (upsertRows.length > 0) {
        const { error: upsertErr } = await supabase
            .from('KTVDailyLedger')
            .upsert(upsertRows, {
                onConflict: 'date, staff_id'
            });

        if (upsertErr) {
            console.error('Upsert Error:', upsertErr);
            throw upsertErr;
        }
    }
    // 7. Check if targetDate is the last day of the month/year to trigger monthly/yearly sync
    const d = new Date(targetDateStr);
    d.setDate(d.getDate() + 1);
    if (d.getDate() === 1) {
        // It was the last day of the month!
        const month = parseInt(targetDateStr.slice(5, 7), 10);
        const year = parseInt(targetDateStr.slice(0, 4), 10);
        await processMonthlyLedgerSync(supabase, month, year);
        await processMonthlyMaintenanceFee(supabase, month, year);
        
        if (month === 12) {
            // It was also the last day of the year!
            await processYearlyLedgerSync(supabase, year);
        }
    }

    return NextResponse.json({ success: true, message: `Synced ${upsertRows.length} ledgers for ${targetDateStr}` });
}

// API: GET /api/cron/sync-daily-ledger (Used by Vercel Cron)
export async function GET(request: Request) {
    // Security verification for Vercel Cron
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    try {
        const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
        const nowVn = new Date(Date.now() + VN_OFFSET_MS);
        nowVn.setDate(nowVn.getDate() - 1); // Yesterday
        const targetDateStr = nowVn.toISOString().split('T')[0];

        return await processLedgerSync(targetDateStr);
    } catch (err: any) {
        console.error('Exception in GET sync-daily-ledger:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

// API: POST /api/cron/sync-daily-ledger (Used for manual triggers via Admin/Script)
// Body: { targetDate: 'YYYY-MM-DD' } (Optional, defaults to yesterday)
export async function POST(request: Request) {
    try {
        let targetDateStr = '';
        try {
            const body = await request.json();
            const parseResult = SyncDailyLedgerPostSchema.safeParse(body);
            if (parseResult.success && parseResult.data.targetDate) {
                targetDateStr = parseResult.data.targetDate;
            }
        } catch { }

        if (!targetDateStr) {
            const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
            const nowVn = new Date(Date.now() + VN_OFFSET_MS);
            nowVn.setDate(nowVn.getDate() - 1); // Yesterday
            targetDateStr = nowVn.toISOString().split('T')[0];
        }

        return await processLedgerSync(targetDateStr);
    } catch (err: any) {
        console.error('Exception in POST sync-daily-ledger:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
