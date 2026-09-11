import { NextResponse, after } from 'next/server';
import { requireBusinessUser } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvOfficeScoreService, HOURS_PENALTY_VI, currentMonthVn } from '@/lib/services/KtvOfficeScoreService';
import { resolveStaffFlag } from '@/lib/featureFlags';
import { featureMaintenanceBody } from '@/lib/featureMaintenance';

export const dynamic = 'force-dynamic';

/** Cùng cần gạt với bảng xếp hạng — quản lý tắt một lần là ẩn ở mọi màn. */
const FEATURE_KEY = 'ktv_type_d_hours_ranking_enabled';

/**
 * `SystemConfigs.value` là jsonb — cùng một cần gạt có thể về `true`, `"true"`
 * hoặc `'"true"'` tuỳ nó được ghi từ đâu. So `=== true` là hỏng thầm lặng.
 */
function toBool(raw: any, fallback: boolean): boolean {
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof raw === 'boolean') return raw;
    return String(raw).replace(/"/g, '').toLowerCase() === 'true';
}

/**
 * Sổ giờ tích luỹ của CHÍNH KTV đang đăng nhập, theo tháng.
 *
 * Bản rút gọn của /api/ktv/hours-ranking cho trang Lịch Sử: ở đó KTV chỉ cần sổ
 * giờ của mình, không cần bảng của cả nhóm. Gọi thẳng endpoint xếp hạng sẽ kéo
 * theo việc tính giờ cho toàn bộ KTV cùng loại — phí, vì trang Lịch Sử vứt hết.
 *
 * Vẫn dùng đúng `KtvOfficeScoreService.hoursLedger` như trang Xếp Hạng và màn
 * Office của quầy, nên ba nơi không bao giờ ra số khác nhau.
 *
 * ⚠️ KHÔNG nhận `staffId` từ client. Danh tính lấy từ phiên đăng nhập, nếu không
 * KTV chỉ cần sửa query là xem được sổ giờ của người khác.
 */
export async function GET(request: Request) {
    try {
        const bUser = await requireBusinessUser();
        if (!bUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        const { searchParams } = new URL(request.url);
        const monthParam = searchParams.get('month');
        const month = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam! : currentMonthVn();

        const meId = bUser.techCode;
        const { data: me } = await supabase
            .from('Staff')
            .select('id, work_type, feature_flags')
            .eq('id', meId)
            .maybeSingle();

        // Only caller is the History page ("Giờ tích luỹ" tile). History off →
        // same maintenance answer as /api/ktv/history, so the page never shows
        // a half-rendered screen with 0h.
        if (me && !resolveStaffFlag(me.feature_flags, 'history_page')) {
            return NextResponse.json(featureMaintenanceBody(), { status: 403 });
        }

        // Sổ giờ chỉ ghi cho Loại D — loại A/B/C chia tua theo SỐ TUA nên sẽ toàn 0h.
        if (!me || me.work_type !== 'TYPE_D') {
            return NextResponse.json({ success: true, applicable: false, enabled: true, month, rows: [] });
        }

        const { data: cfg } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', FEATURE_KEY)
            .maybeSingle();

        if (!toBool(cfg?.value, true)) {
            return NextResponse.json({ success: true, applicable: true, enabled: false, month, rows: [] });
        }

        // Tua vừa xong còn nằm trong hàng đợi cho tới khi có người rút ra tính.
        // Rút ngay để KTV vừa kết thúc đơn là thấy giờ mình tăng, không phải chờ.
        //
        // Đây là nguồn của ô "Giờ tích luỹ" trên trang Lịch Sử. Trang đó gọi SONG
        // SONG hai API: `/api/ktv/history` rút hàng đợi theo ĐƠN (chính xác), còn
        // route này rút theo KTV. Bản cũ của `drainQueueForStaff` chỉ quét 100 dòng
        // cũ nhất nên hai bên có thể ra hai kết quả khác nhau trên CÙNG một màn:
        // danh sách đơn đã hiện tua mới mà ô giờ thì chưa cộng, tuỳ API nào về
        // trước. Nay cả hai đều quét đủ nên không còn cửa lệch.
        const { drainQueueForStaff, drainQueueBackground } = await import('@/lib/services/KtvDLedgerWriter');
        await drainQueueForStaff(supabase, [meId]);
        after(async () => { await drainQueueBackground(supabase); });

        // orderCode: booking_id đôi khi là UUID nội bộ (đơn cũ), đôi khi là mã đơn
        // đọc được. UUID thì rút gọn cho đỡ chiếm chỗ trên màn điện thoại.
        const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
        const ledger = await KtvOfficeScoreService.hoursLedger(supabase, meId, month);

        return NextResponse.json({
            success: true,
            applicable: true,
            enabled: true,
            month,
            monthEarned: ledger.earnedTotal,
            monthPenalty: ledger.penaltyTotal,
            monthNet: ledger.total,
            rows: ledger.rows.map(r => ({
                id: r.id,
                date: r.date,
                earned: r.earned,
                penalty: r.penalty,
                balance: r.balance,
                note: r.note,
                at: r.at,
                penaltyLabel: r.penaltyType ? (HOURS_PENALTY_VI[r.penaltyType] || r.penaltyType) : null,
                orderCode: r.bookingId
                    ? (isUuid(r.bookingId) ? `#${r.bookingId.slice(0, 8)}` : r.bookingId)
                    : null,
            })),
        });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        console.error('Lỗi khi lấy sổ giờ tích luỹ của KTV:', error);
        return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
}
