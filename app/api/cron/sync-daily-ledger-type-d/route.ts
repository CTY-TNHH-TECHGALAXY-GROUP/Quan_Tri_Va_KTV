import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvTypeDCommissionService } from '@/lib/services/KtvTypeDCommissionService';
import { KtvTypeDBonusService } from '@/lib/services/KtvTypeDBonusService';
import { KtvTypeDTurnService } from '@/lib/services/KtvTypeDTurnService';
import { processMonthlyLedgerSync, processYearlyLedgerSync, processMonthlyMaintenanceFee } from '@/lib/services/KtvLedgerSyncService';
import { SyncDailyLedgerPostSchema } from '@/lib/schemas/finance.schema';
import { getDayCutoffHours, businessDayRange, toBusinessDate, previousBusinessDate } from '@/lib/business-date';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const TYPE_D_RULE_EFFECTIVE_FROM = '2026-09-01';

async function processLedgerSyncTypeD(targetDateStr: string) {
    console.log(`[Cron Type D] Syncing Daily Ledger for date: ${targetDateStr}`);

    if (targetDateStr < TYPE_D_RULE_EFFECTIVE_FROM) {
        console.log(`[Cron Type D] Date ${targetDateStr} is before effective date ${TYPE_D_RULE_EFFECTIVE_FROM}. Skipping (Option B).`);
        return NextResponse.json({ success: true, message: 'Skipped - Before effective date' });
    }

    // Cửa sổ theo NGÀY LÀM VIỆC (spa_day_cutoff_hours), không phải nửa đêm lịch.
    //
    // Cách viết cũ `${d}T00:00:00+07:00` không chạy như tên gọi: Bookings.timeStart là
    // `timestamp` KHÔNG timezone (lưu theo giờ UTC), nên Postgres cast chuỗi rồi VỨT phần
    // offset → hoá ra là VN 07:00, tức cutoff 7 cứng và phớt lờ config.
    // businessDayRange() trả .toISOString() nên khớp cả cột naive-UTC (Bookings) lẫn cột
    // timestamptz thật (WalletAdjustments.created_at).
    //
    // ⚠️ Khoảng NỬA MỞ [start, end): dùng .gte(start) + .lt(end), KHÔNG dùng .lte(end)
    // — nếu không, tua đúng mốc cutoff sẽ bị đếm ở cả hai ngày liền kề.
    const cutoffHours = await getDayCutoffHours(supabase);
    const { startIso: startTimeStr, endIso: endTimeStr } = businessDayRange(targetDateStr, cutoffHours);

    // 1. Fetch Configs for Type D
    const { data: configs } = await supabase.from('SystemConfigs').select('key, value');
    const sysConfigs: Record<string, any> = {};
    (configs || []).forEach(c => {
        let val = c.value;
        if (typeof val === 'string') {
            try { val = JSON.parse(val); } catch {}
        }
        sysConfigs[c.key] = val;
    });

    const basePoints_D = Number(sysConfigs['ktv_type_d_bonus_points']) || 20;
    const pointRate_D = Number(sysConfigs['ktv_bonus_rate_TYPE_D']) || 1000;
    // ⚠️ Key phải khớp CHÍNH XÁC với những gì Admin Settings ghi ra
    // (app/admin/settings/system/KtvTypeDSettingsBlock.tsx) và với các consumer khác
    // (history, wallet, timeline). Trước đây file này dùng '..._rate_60m' và
    // 'rating_deductions' (số nhiều) — không key nào tồn tại trong SystemConfigs, nên
    // cron luôn rơi về default và bỏ qua mọi thay đổi đơn giá của Admin.
    const rateVIP = Number(sysConfigs['ktv_type_d_vip_rate_per_60m']) || 180000;
    const ratePT = Number(sysConfigs['ktv_type_d_pt_rate_per_60m']) || 100000;

    let ratingDeductions: Record<string, number> = { '0': 0, '1': 0.75, '2': 0.5, '3': 0.25, '4': 0 };
    if (sysConfigs['ktv_type_d_rating_deduction']) {
        ratingDeductions = sysConfigs['ktv_type_d_rating_deduction'];
    }

    // 2. Fetch KTVs
    const { data: ktvs } = await supabase
        .from('Staff')
        .select('id, full_name, work_type, feature_flags')
        .eq('work_type', 'TYPE_D');
    
    if (!ktvs || ktvs.length === 0) return NextResponse.json({ success: true, message: 'No Type D KTVs found' });
    
    const staffBonusMap: Record<string, boolean> = {};
    const activeStaffIds = ktvs.map(k => {
        const canBonus = k.feature_flags?.enable_bonus ?? true;
        staffBonusMap[k.id.toLowerCase()] = canBonus;
        return k.id;
    });

    // 3. Fetch all Bookings for the day
    const { data: bookings } = await supabase
        .from('Bookings')
        .select('id, timeStart, status, customerId, rating, BookingItems!fk_bookingitems_booking(*), BookingGuests(id, rating, ktv_ratings)')
        .gte('timeStart', startTimeStr)
        .lt('timeStart', endTimeStr)
        .neq('status', 'CANCELLED');

    const validStatuses = ['DONE', 'COMPLETED', 'FEEDBACK', 'CLEANING'];

    // 3b. Fetch Services for utility check (hours_earned excludes utility services)
    const { data: servicesData } = await supabase.from('Services').select('id, is_utility');
    const utilityServiceIds = new Set<string>();
    (servicesData || []).forEach((s: any) => {
        if (s.is_utility) utilityServiceIds.add(String(s.id));
    });

    // 4. Fetch adjustments, withdrawals, and EXISTING LEDGER for conflict check
    const [{ data: adjustments }, { data: withdrawals }, { data: existingLedgers }] = await Promise.all([
        supabase.from('WalletAdjustments').select('amount, staff_id').eq('type', 'ADJUSTMENT').gte('created_at', startTimeStr).lt('created_at', endTimeStr),
        supabase.from('WalletAdjustments').select('amount, staff_id').eq('type', 'WITHDRAWAL').gte('created_at', startTimeStr).lt('created_at', endTimeStr),
        supabase.from('KTVDailyLedger').select('staff_id, work_type_snapshot').eq('date', targetDateStr).in('staff_id', activeStaffIds)
    ]);

    const existingLedgerMap: Record<string, string | null> = {};
    (existingLedgers || []).forEach(l => {
        existingLedgerMap[l.staff_id.toLowerCase()] = l.work_type_snapshot;
    });

    // 5. Calculate per KTV
    const upsertRows: any[] = [];
    const allServiceHoursRows: any[] = []; // Accumulates hours_earned across all KTVs
    
    const { data: allStaff } = await supabase.from('Staff').select('id, work_type');
    const allStaffWorkTypeMap: Record<string, string> = {};
    (allStaff || []).forEach(s => {
        allStaffWorkTypeMap[s.id.toLowerCase()] = s.work_type || 'TYPE_A';
    });

    for (const techId of activeStaffIds) {
        const techCode = techId.toLowerCase();
        
        // Conflict check
        const existingSnapshot = existingLedgerMap[techCode];
        if (existingSnapshot && existingSnapshot !== 'TYPE_D') {
            console.log(`[Cron Type D] KTV ${techId} has existing ledger with snapshot ${existingSnapshot}. Skipping to avoid overwrite.`);
            continue;
        }

        let total_commission = 0;
        let total_bonus = 0;
        let total_tip = 0;
        let commissionBreakdown: any[] = [];
        let lowestRating = 5;
        const serviceHoursRows: any[] = []; // Accumulate hours_earned per booking for KTVServiceHoursLedger

        for (const b of (bookings || [])) {
            const items = (b.BookingItems || []).filter((i: any) => 
                i.technicianCodes && i.technicianCodes.map((t: string) => t.toLowerCase()).includes(techCode)
                && validStatuses.includes(i.status)
            );
            if (items.length === 0) continue;

            // ⚠️ SAO PHẢI LẤY THEO ĐÚNG KHÁCH MÀ KTV NÀY PHỤC VỤ.
            //
            // Trước đây lấy `b.rating` — sao cấp BILL. Một bill nhiều khách:
            // khách A chấm 2, khách B chấm 5 thì người làm cho khách B cũng bị
            // cắt tiền vì lỗi ở khách A, dù hai người không hề đụng nhau.
            // `lowestRating` là thứ quyết định mức TRỪ hoa hồng, nên đây là tiền
            // thật chứ không phải chuyện hiển thị.
            //
            // Phần THƯỞNG ngay bên dưới đã sửa sang lấy theo khách từ trước; phần
            // TRỪ này bị bỏ sót. Nay dùng đúng một cách với nhau.
            const guestIdsOfMine = [...new Set(items.map((i: any) => i.guest_id ?? null))];
            let safeRating = 5;
            for (const gid of guestIdsOfMine) {
                const guest = (b as any).BookingGuests?.find((g: any) => String(g.id) === String(gid));
                const mineOfGuest = items.filter((i: any) =>
                    gid === null ? true : String(i.guest_id) === String(gid));
                // Thứ tự dự phòng khớp với phần thưởng: sao của khách → sao trên
                // item → sao cấp bill → 0 (chưa chấm; bảng mức trừ để 0 là không trừ).
                const r = Number(guest?.rating ?? mineOfGuest[0]?.itemRating ?? b.rating ?? 0);
                if (r < safeRating) safeRating = r;
            }
            if (safeRating < lowestRating) lowestRating = safeRating;

            // Separate items by category — VIP (NHP/NHT/VIP) vs Phổ thông (còn lại).
            // Không có nhóm COMBO: không mã dịch vụ nào bắt đầu bằng 'COMBO'
            // ("Combo King" thực tế là NHS0800 → thuộc nhóm Phổ thông), và Admin Settings
            // cũng chỉ cấu hình 2 đơn giá. Cách chia này khớp history/wallet/timeline.
            const vipItems = items.filter((i: any) => String(i.serviceId).toUpperCase().startsWith('NHP') || String(i.serviceId).toUpperCase().startsWith('NHT') || String(i.serviceId).toUpperCase().startsWith('VIP'));
            const ptItems = items.filter((i: any) => !vipItems.includes(i));

            const vipComm = KtvTypeDCommissionService.calculateGuestCommission(vipItems, techCode, safeRating, rateVIP, ratingDeductions);
            const ptComm = KtvTypeDCommissionService.calculateGuestCommission(ptItems, techCode, safeRating, ratePT, ratingDeductions);

            const bookingComm = vipComm + ptComm;
            total_commission += bookingComm;

            // Extract segments duration for breakdown
            let totalDur = 0;
            items.forEach((i: any) => {
                let segs = [];
                try { segs = typeof i.segments === 'string' ? JSON.parse(i.segments) : (i.segments || []); } catch {}
                segs.filter((s:any) => s.ktvId?.toLowerCase() === techCode).forEach((s:any) => {
                    totalDur += Number(s.duration) || 60;
                });
            });

            commissionBreakdown.push({
                bookingId: b.id,
                duration: totalDur,
                workType: 'TYPE_D',
                commission: bookingComm
            });

            // === SERVICE HOURS LEDGER: Calculate actual minutes (excludes utility) ===
            const nonUtilityItems = items.filter((i: any) => !utilityServiceIds.has(String(i.serviceId)));
            let bookingActualMins = 0;
            nonUtilityItems.forEach((item: any) => {
                const mins = KtvTypeDTurnService.calculateActualMinutes(item, techCode);
                if (mins > 0) bookingActualMins += mins;
            });
            if (bookingActualMins > 0) {
                serviceHoursRows.push({
                    staff_id: techId,
                    date: targetDateStr,
                    booking_id: b.id,
                    hours_earned: bookingActualMins / 60,
                    hours_penalty: 0
                });
            }

            // Tip
            let bookingTip = 0;
            items.forEach((i: any) => {
                if (i.tip && !isNaN(i.tip)) bookingTip += Number(i.tip);
            });
            total_tip += bookingTip;

            // ─── Thưởng ─────────────────────────────────────────────────
            // Thưởng tính THEO KHÁCH, không theo bill.
            //
            // ⚠️ Trước đây gom work_type của TẤT CẢ KTV trong bill (biến tên là
            // `...ForGuest` nhưng thực tế quét cả bill). Hệ quả: một KTV loại
            // khác phục vụ KHÁCH KHÁC trong cùng bill cũng làm KTV loại D mất
            // thưởng, dù hai người không hề làm chung khách.
            // Nay lọc theo `guest_id`, và sao cũng lấy theo khách chứ không
            // phải `Bookings.rating` cấp bill.
            if (staffBonusMap[techCode]) {
                // ⚠️ Điều kiện LOẠI TRỪ xét trên TOÀN ĐƠN CHA: chỉ cần bill có
                // một KTV khác chế độ là mọi KTV loại D đều mất thưởng.
                const ktvWorkTypesInBill: string[] = [];
                (b.BookingItems || []).forEach((i: any) => {
                    (i.technicianCodes || []).forEach((tc: string) => {
                        ktvWorkTypesInBill.push(allStaffWorkTypeMap[tc.toLowerCase()] || 'TYPE_A');
                    });
                });

                // Nhưng SAO thì vẫn theo từng KHÁCH — mỗi khách một suất thưởng.
                const guestIds = [...new Set(items.map((i: any) => i.guest_id ?? null))];
                for (const gid of guestIds) {
                    const itemsOfGuest = (b.BookingItems || []).filter((i: any) =>
                        gid === null ? true : String(i.guest_id) === String(gid));
                    const guest = (b as any).BookingGuests?.find((g: any) => String(g.id) === String(gid));
                    const guestRating = guest?.rating ?? itemsOfGuest[0]?.itemRating ?? b.rating ?? 0;

                    // ⚠️ KHÔNG ghi điểm thưởng cho loại D nữa. Thưởng 4★ nay là
                    // một phần của TIỀN TUA (cột bonus_amount của KTVDTurnLedger).
                    // Ghi thêm điểm ở đây là ví bonus trả lần hai cùng một suất.
                }
            }
        }

        const deductionStr = lowestRating.toString();
        const appliedDeduction = lowestRating === 5 ? 0 : (ratingDeductions[deductionStr] ?? 0);

        const techAdjustments = (adjustments || []).filter((a: any) => a.staff_id.toLowerCase() === techCode);
        const techWithdrawals = (withdrawals || []).filter((w: any) => w.staff_id.toLowerCase() === techCode);
        const total_adjustment = techAdjustments.reduce((sum: number, a: any) => sum + Number(a.amount), 0);
        const total_withdrawn = techWithdrawals.reduce((sum: number, w: any) => sum + Number(w.amount), 0);

        upsertRows.push({
            date: targetDateStr,
            staff_id: techId, // Keep original case
            total_commission,
            total_tip,
            total_bonus,
            total_penalty: 0,
            total_adjustment,
            total_withdrawn,
            total_tax: 0,
            work_type_snapshot: 'TYPE_D',
            rating_deduction: appliedDeduction,
            commission_breakdown: commissionBreakdown,
            updated_at: new Date().toISOString()
        });
        allServiceHoursRows.push(...serviceHoursRows);
    }

    if (upsertRows.length > 0) {
        const { error: upsertErr } = await supabase.from('KTVDailyLedger').upsert(upsertRows, { onConflict: 'date, staff_id' });
        if (upsertErr) {
            console.error('[Cron Type D] Upsert Error:', upsertErr);
            throw upsertErr;
        }
    }

    // === Insert hours_earned into KTVServiceHoursLedger (idempotent via duplicate skip) ===
    // NOTE: Cannot use .upsert() because the unique constraint is a PARTIAL index
    // (WHERE booking_id IS NOT NULL). PostgreSQL rejects ON CONFLICT on partial indexes.
    // Instead, we INSERT each row individually and skip 23505 (duplicate) errors.
    if (allServiceHoursRows.length > 0) {
        let insertedCount = 0;
        for (const row of allServiceHoursRows) {
            const { error: shErr } = await supabase
                .from('KTVServiceHoursLedger')
                .insert(row);
            if (shErr) {
                if (shErr.code === '23505') continue; // Already synced, skip
                console.error(`[Cron Type D] ServiceHoursLedger Insert Error for ${row.staff_id}:`, shErr);
            } else {
                insertedCount++;
            }
        }
        console.log(`[Cron Type D] Synced ${insertedCount} new service hours entries for ${targetDateStr} (${allServiceHoursRows.length - insertedCount} skipped)`);
    }

    const d = new Date(targetDateStr);
    d.setDate(d.getDate() + 1);
    if (d.getDate() === 1) {
        const month = parseInt(targetDateStr.slice(5, 7), 10);
        const year = parseInt(targetDateStr.slice(0, 4), 10);
        await processMonthlyLedgerSync(supabase, month, year);
        await processMonthlyMaintenanceFee(supabase, month, year);
        if (month === 12) await processYearlyLedgerSync(supabase, year);
    }

    return NextResponse.json({ success: true, message: `Synced ${upsertRows.length} TYPE_D ledgers for ${targetDateStr}` });
}

/**
 * Ngày mặc định để chốt sổ = NGÀY LÀM VIỆC liền trước ngày làm việc hiện tại.
 *
 * Phải theo ngày làm việc chứ không phải "hôm qua theo lịch": nếu chạy lúc 02:00
 * (trước cutoff 06:00) thì ngày làm việc hôm qua VẪN ĐANG CHẠY, chốt lúc đó là
 * chốt sớm và bỏ sót tua cuối đêm. Cách tính này tự động lùi thêm 1 ngày trong
 * tình huống đó, nên chạy sớm chỉ bị trễ chứ không bị mất dữ liệu.
 *
 * Lịch chạy khuyến nghị: 06:30 giờ VN (`30 23 * * *` UTC) — 30 phút sau khi
 * ngày làm việc thực sự đóng.
 */
async function resolveDefaultTargetDate(): Promise<string> {
    const cutoffHours = await getDayCutoffHours(supabase);
    return previousBusinessDate(toBusinessDate(new Date(), cutoffHours));
}

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }
    try {
        const targetDateStr = await resolveDefaultTargetDate();
        return await processLedgerSyncTypeD(targetDateStr);
    } catch (err: any) {
        console.error('Exception in GET sync-daily-ledger-type-d:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

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
            targetDateStr = await resolveDefaultTargetDate();
        }
        return await processLedgerSyncTypeD(targetDateStr);
    } catch (err: any) {
        console.error('Exception in POST sync-daily-ledger-type-d:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
