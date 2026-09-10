import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvTypeDTurnService } from '@/lib/services/KtvTypeDTurnService';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * GET /api/ktv/type-d/service-hours?month=YYYY-MM[&techCode=T079]
 *
 * Giờ tích luỹ tháng của KTV loại D. Dùng bởi màn giờ tích luỹ và bởi cron
 * chốt tháng `/api/cron/reset-type-d-hours` (ghi vào KTVMonthlyServiceHours).
 *
 * ⚠️ Route này TỪNG tự quét lại Bookings và tính lấy một công thức riêng. Đo
 * trên tháng 9/2026 thì lệch với bảng xếp hạng tua ở 4/13 KTV, riêng T016 chênh
 * 9,16 giờ. Ba nguyên nhân:
 *
 *   · lấy giờ GÁN (`KtvCommissionService.calculateItemDuration`) thay vì giờ
 *     làm THẬT — đã trừ tạm dừng, đã bỏ chặng bị tước quyền lợi;
 *   · đọc phạt từ `KTVServiceHoursLedger`, bảng nay chỉ còn 3 dòng test cũ;
 *     phạt thật (từ chối tua, khoá tài khoản) nằm ở `KTVDPenaltyLedger`;
 *   · kẹp sàn `Math.max(0, …)` nên phần phạt vượt quá số giờ đang có bốc hơi.
 *
 * Số sai đó không chỉ hiện lên màn hình — cron chốt tháng ĐÓNG DẤU nó vào
 * `KTVMonthlyServiceHours`. Nay cả ba nơi dùng chung
 * `KtvTypeDTurnService.getMonthlyHoursBreakdown`, tức đúng phép tính quyết định
 * thứ tự nhận tua.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const techCode = searchParams.get('techCode');
        const monthParam = searchParams.get('month'); // YYYY-MM

        const now = new Date();
        let year = now.getFullYear();
        let month = now.getMonth() + 1;

        if (monthParam) {
            // ⚠️ Trước đây `parseInt(split('-')[1])` với `month=9` ra NaN, rồi
            // khoảng ngày thành chuỗi rác và route trả 0 giờ cho TẤT CẢ mà
            // không báo lỗi gì. Cron đọc số 0 đó rồi ghi đè sổ tháng.
            const m = /^(\d{4})-(\d{2})$/.exec(monthParam.trim());
            if (!m) {
                return NextResponse.json(
                    { success: false, error: `Tham số month phải dạng YYYY-MM, nhận được '${monthParam}'` },
                    { status: 400 }
                );
            }
            year = Number(m[1]);
            month = Number(m[2]);
            if (month < 1 || month > 12) {
                return NextResponse.json(
                    { success: false, error: `Tháng không hợp lệ: ${monthParam}` },
                    { status: 400 }
                );
            }
        }

        let staffIds: string[] = [];
        if (techCode) {
            staffIds = [techCode];
        } else {
            const { data } = await supabase.from('Staff').select('id').eq('work_type', 'TYPE_D');
            staffIds = (data || []).map(s => s.id);
        }

        const breakdown = await KtvTypeDTurnService.getMonthlyHoursBreakdown(
            supabase as any, staffIds, month, year
        );

        const monthStr = `${year}-${String(month).padStart(2, '0')}`;
        const results = staffIds.map(staffId => {
            const b = breakdown[staffId];
            return {
                staff_id: staffId,
                month: monthStr,
                total_hours_earned: b?.hours_earned ?? 0,
                total_hours_penalty: b?.hours_penalty ?? 0,
                net_hours: b?.net_hours ?? 0,
                penalty_history: b?.penalties ?? [],
            };
        });

        return NextResponse.json({ success: true, data: techCode ? results[0] : results });
    } catch (err: any) {
        console.error('Exception /api/ktv/type-d/service-hours:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
