import { NextResponse } from 'next/server';
import { requireBusinessUser } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvOfficeScoreService } from '@/lib/services/KtvOfficeScoreService';
import { canSeeOfficePoints, dedupePhotosWithinDay } from '@/lib/services/KtvOfficeBonusService';
import { vnToday } from '@/lib/vn-time';

export const dynamic = 'force-dynamic';

/**
 * Điểm Office của CHÍNH KTV đang đăng nhập — điểm hôm nay + điểm tháng.
 * Trừ điểm mà KTV không tra cứu được thì sẽ khiếu nại liên tục, nên phải
 * cho họ tự xem. KTV chỉ đọc được của mình, không truyền staffId từ client.
 *
 * `?month=YYYY-MM` để tra tháng cũ (mặc định tháng hiện tại). Trả luôn cả mảng
 * `days` để lịch trong modal chọn ngày nào cũng có sẵn số, khỏi gọi lại API mỗi
 * lần bấm một ngày.
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

        const staffId = bUser.techCode;
        const { data: staff } = await supabase
            .from('Staff')
            .select('id, work_type')
            .eq('id', staffId)
            .maybeSingle();

        // Chỉ Loại D có điểm Office, VÀ phải là người đang dùng Ví Điểm theo
        // Office. Cùng một cửa với trang Ví — xem `canSeeOfficePoints`. Không
        // qua cửa thì trả null để Dashboard ẩn hẳn ô này, thay vì hiện một nút
        // dẫn tới thứ mà trang Ví lại không có.
        if (!staff || staff.work_type !== 'TYPE_D' || !(await canSeeOfficePoints(supabase, staffId))) {
            return NextResponse.json({ success: true, applicable: false, data: null });
        }

        const today = vnToday();
        const { searchParams } = new URL(request.url);
        const monthParam = searchParams.get('month');
        const month = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam! : today.slice(0, 7);

        const scores = await KtvOfficeScoreService.computeMonth(supabase, [staffId], month);
        const m = scores.get(staffId)!;

        const todayEntry = m.days.find(d => d.workDate === today);

        // Trả luôn link ảnh minh chứng. Trước đây chỉ trả số lượng và bắt KTV lên
        // gặp quầy để xem — nhưng đây là ảnh chụp chính họ, bị trừ điểm mà không
        // được nhìn bằng chứng thì cãi nhau ở quầy còn lâu hơn. Route này chỉ đọc
        // dữ liệu của người đang đăng nhập nên không lộ sang KTV khác.
        // Bỏ ảnh trùng trong cùng ngày — phiếu cũ dùng chung một rổ ảnh cho mọi
        // lỗi, xem `dedupePhotosWithinDay`.
        const mapHits = (hits: typeof m.days[number]['hits']) => dedupePhotosWithinDay(hits.map(h => ({
            label: h.label,
            points: h.points,
            note: h.note,
            photoCount: h.photoUrls.length,
            photoUrls: h.photoUrls,
        })));

        return NextResponse.json({
            success: true,
            applicable: true,
            data: {
                today,
                month,
                // Mỗi ngày mặc định 100đ, chỉ giảm khi có phiếu trừ. Không có phiếu nào
                // thì vẫn là 100 — đúng nguyên tắc "bắt đầu từ 100, trừ dần".
                todayScore: todayEntry ? todayEntry.dayScore : 100,
                todayHits: todayEntry ? mapHits(todayEntry.hits) : [],
                // Toàn bộ ngày ĐI LÀM trong tháng — lịch chọn ngày dựa vào đây để
                // biết ngày nào có chấm công, ngày nào bị trừ lỗi.
                days: m.days.map(d => ({
                    workDate: d.workDate,
                    dayScore: d.dayScore,
                    hits: mapHits(d.hits),
                })),
                monthScore: m.final,
                /**
                 * `false` = tháng này chưa có ngày công nào. `monthScore` khi đó
                 * rơi về 100 chỉ vì trung bình cộng không có mẫu số — KHÔNG phải
                 * điểm tuyệt đối. Màn hình phải hiện "chưa có dữ liệu".
                 */
                hasData: m.hasData,
                workDays: m.workDays,
                repeats: m.repeats,
                repeatPenalty: m.repeatPenalty,
                exemptPct: m.exemptPct,
                fundDue: m.fundDue,
            },
        });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        const status = msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('Lỗi khi lấy điểm Office của KTV:', error);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}
