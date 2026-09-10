import { NextResponse, after } from 'next/server';
import { requireBusinessUser } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvOfficeScoreService, HOURS_PENALTY_VI, monthRange, currentMonthVn, attendedStaffOfMonth, assignRanks } from '@/lib/services/KtvOfficeScoreService';

export const dynamic = 'force-dynamic';

/** Cần gạt cho phép KTV tự xem bảng xếp hạng. Mặc định BẬT. */
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
 * Bảng xếp hạng giờ tích luỹ cho CHÍNH KTV đang đăng nhập xem.
 *
 * Chỉ Loại D: sổ giờ (KTVDTurnLedger + KTVDPenaltyLedger) chỉ ghi cho nhóm này,
 * loại A/B/C chia tua theo SỐ TUA nên bảng giờ với họ sẽ toàn 0h.
 *
 * KTV chỉ thấy đồng nghiệp CÙNG LOẠI, và chỉ thấy tên + giờ thực nhận + số tua
 * của người khác. Giờ làm thực, giờ bị phạt và sổ giờ từng dòng chỉ trả về cho
 * chính người đang xem — giờ phạt là chuyện kỷ luật riêng, không phải thứ để cả
 * nhóm soi nhau.
 *
 * ⚠️ KHÔNG nhận `staffId` từ client. Danh tính lấy từ phiên đăng nhập, nếu không
 * KTV chỉ cần sửa query là xem được của người khác.
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
            .select('id, work_type')
            .eq('id', meId)
            .maybeSingle();

        // Không phải KTV Loại D → UI ẩn hẳn mục này thay vì hiện bảng rỗng.
        if (!me || me.work_type !== 'TYPE_D') {
            return NextResponse.json({ success: true, applicable: false, enabled: true, month, data: [] });
        }

        const { data: cfg } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', FEATURE_KEY)
            .maybeSingle();

        if (!toBool(cfg?.value, true)) {
            return NextResponse.json({ success: true, applicable: true, enabled: false, month, data: [] });
        }

        // Cùng bộ lọc với trang Office (/api/admin/ktv-office/hours-ranking): hai màn
        // hình mà lệch danh sách thì KTV và quầy đọc ra hai thứ hạng khác nhau.
        const { data: staff, error: staffError } = await supabase
            .from('Staff')
            .select('id, full_name, status, avatar_url')
            .eq('work_type', me.work_type)
            .neq('status', 'ĐÃ NGHỈ');
        if (staffError) throw staffError;

        const staffList = staff || [];
        const staffIds = staffList.map((s: any) => s.id);
        if (staffIds.length === 0) {
            return NextResponse.json({ success: true, applicable: true, enabled: true, month, data: [] });
        }

        // Tua vừa xong còn nằm trong hàng đợi cho tới khi có người rút ra tính.
        // Rút ngay để KTV vừa kết thúc đơn là thấy giờ mình tăng, không phải chờ.
        const { drainQueueForStaff, drainQueueBackground } = await import('@/lib/services/KtvDLedgerWriter');
        await drainQueueForStaff(supabase, staffIds);
        after(async () => { await drainQueueBackground(supabase); });

        const hours = await KtvOfficeScoreService.hoursBreakdown(supabase, staffIds, monthRange(month));

        const rows = staffList.map((s: any) => {
            const h = hours.get(s.id)!;
            const isMe = s.id === meId;
            return {
                id: s.id,
                code: s.id,
                name: s.full_name || s.id,
                avatarUrl: s.avatar_url,
                isMe,
                net: h.net,
                turns: h.turns,
                // Chi tiết chỉ mở cho chính chủ.
                earned: isMe ? h.earned : null,
                penalty: isMe ? h.penalty : null,
                days: isMe ? h.days : null,
                lastDate: isMe ? h.lastDate : null,
            };
        });

        // Xếp hạng dùng CHUNG luật với bảng của quầy: hoà giờ thì chốt bằng MÃ
        // nhân viên, và chưa điểm danh trong tháng thì chưa có hạng.
        //
        // ⚠️ Trước đây chỗ này chốt bằng TÊN và xếp hạng cho tất cả loại D, kể cả
        // người chưa đi làm buổi nào. Đầu tháng cả đội cùng 0h nên màn KTV và màn
        // quầy hiện hai thứ tự khác nhau cho cùng một nhóm người.
        const attended = await attendedStaffOfMonth(supabase, staffIds, month);
        const ranked = assignRanks(rows, attended);
        rows.length = 0;
        rows.push(...ranked);

        // Sổ giờ TỪNG DÒNG — chỉ của chính người đang xem. Dùng đúng hàm mà màn
        // Office của quầy đang dùng, để hai bên không bao giờ ra số khác nhau.
        //
        // orderCode: booking_id đôi khi là UUID nội bộ (đơn cũ), đôi khi là mã đơn
        // đọc được. UUID thì rút gọn cho đỡ chiếm chỗ trên màn điện thoại.
        const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
        const ledger = await KtvOfficeScoreService.hoursLedger(supabase, meId, month);
        const myLedger = ledger.rows.map(r => ({
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
        }));

        return NextResponse.json({
            success: true,
            applicable: true,
            enabled: true,
            month,
            workType: me.work_type,
            meId,
            /** Số người đã điểm danh — 0 nghĩa là chưa ai vào bảng xếp hạng. */
            rankedCount: rows.filter((r: any) => r.ranked).length,
            data: rows,
            myLedger,
        });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        console.error('Lỗi khi lấy bảng xếp hạng giờ cho KTV:', error);
        return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
}
