import { SupabaseClient } from '@supabase/supabase-js';
import { TYPE_D_DISCIPLINE_PENALTIES } from '../constants/staff.constants';

/**
 * ================================================================
 * KỶ LUẬT TRỪ GIỜ TÍCH LŨY — LOẠI D
 * ================================================================
 * Ghi vào `KTVDPenaltyLedger`. `KtvDLedgerReader.netHoursByStaff()` trừ các
 * dòng này khỏi giờ làm:
 *
 *   giờ ròng = Σ KTVDTurnLedger.actual_minutes/60 − Σ hours_penalty
 *
 * Trước đây ghi vào `KTVServiceHoursLedger` — bảng trộn chung dòng làm và
 * dòng phạt, đang được gỡ bỏ (xem plans/plan_ktvd_turn_ledger.md §3.5).
 *
 * Mức phạt lấy từ `TYPE_D_DISCIPLINE_PENALTIES`, khớp với quy chế:
 *   · Bỏ lịch đã đăng ký (không báo / báo trễ)  → −10 giờ
 *   · Báo vắng / chuyển OFF sau hạn miễn phạt   →  −5 giờ
 *   · Đến trễ hơn giờ đã báo trễ                →  −5 giờ
 *   · Từ chối tua đã gán                        → −3× thời lượng gói
 */

export type DailyViolationType = 'ABSENT_NO_NOTICE' | 'ABSENT_EARLY_NOTICE' | 'LATE_NO_UPDATE';

/**
 * Mọi mức phạt Loại D nằm chung trong một ô JSON `ktv_type_d_discipline_rules`
 * của `SystemConfigs` — đúng ô mà trang Cài đặt → Loại D đang ghi.
 */
export const DISCIPLINE_RULES_KEY = 'ktv_type_d_discipline_rules';

/** Hạn mức mặc định: quỹ phải còn 3 giờ tích lũy mới được từ chối tua. */
export const DEFAULT_MIN_HOURS_TO_REJECT = 3;

/**
 * Công tắc tổng của kỷ luật Loại D.
 *
 * ⚠️ Khoá này có từ lâu nhưng CHỈ cron chốt sổ vắng mặt đọc nó. Ba đường trừ
 * giờ còn lại — điểm danh trễ, bỏ ca đã đăng ký, từ chối tua — không hỏi nó lần
 * nào. Nên admin tắt "kỷ luật Loại D" xong thợ vẫn bị trừ giờ như thường: công
 * tắc nói một đằng, hệ thống làm một nẻo.
 *
 * Nay chốt chặn đặt ngay trong service, tức MỌI đường trừ giờ đều đi qua cùng
 * một câu hỏi — không phụ thuộc vào việc người viết route sau này có nhớ kiểm
 * tra hay không.
 */
export const DISCIPLINE_ENABLED_KEY = 'ktv_type_d_discipline_enabled';

/** Đọc ô JSON mức phạt; giá trị có thể là object hoặc chuỗi tuỳ đời dữ liệu. */
async function readRules(supabase: SupabaseClient): Promise<Record<string, any>> {
    try {
        const { data } = await supabase
            .from('SystemConfigs').select('value').eq('key', DISCIPLINE_RULES_KEY).maybeSingle();
        const v = (data as any)?.value;
        if (typeof v === 'string') return JSON.parse(v || '{}');
        return v || {};
    } catch {
        return {};
    }
}

export class KtvTypeDDisciplineService {

    /**
     * Kỷ luật Loại D có đang bật không.
     *
     * Thiếu khoá = TẮT, giữ đúng ngữ nghĩa cron đã dùng từ đầu: đây là công tắc
     * an toàn, mất cấu hình thì không phạt ai còn hơn phạt nhầm cả nhóm.
     */
    static async isEnabled(supabase: SupabaseClient): Promise<boolean> {
        const { data } = await supabase
            .from('SystemConfigs').select('value').eq('key', DISCIPLINE_ENABLED_KEY).maybeSingle();
        const v = (data as any)?.value;
        if (typeof v === 'boolean') return v;
        return String(v ?? '').replace(/"/g, '').trim().toLowerCase() === 'true';
    }

    /**
     * Hệ số phạt khi từ chối tua đã gán: gói 60 phút × hệ số 3 → trừ 3 giờ.
     *
     * Admin chỉnh được ở Cài đặt → Tính năng. Cấu hình hỏng hoặc <= 0 thì lùi
     * về hằng số quy chế, không để hệ số 0 biến hình phạt thành vô hiệu.
     */
    static async getRejectMultiplier(supabase: SupabaseClient): Promise<number> {
        const n = Number((await readRules(supabase)).ORDER_REJECT_MULTIPLIER);
        if (Number.isFinite(n) && n > 0) return n;
        return TYPE_D_DISCIPLINE_PENALTIES.ORDER_REJECT_MULTIPLIER;
    }

    /**
     * Hạn mức giờ tối thiểu phải có trong quỹ tích lũy THÁNG mới được từ chối tua.
     *
     * Đây là CỬA VÀO, không phải mức sàn: chỉ xét ví tại thời điểm bấm. Còn đủ hạn
     * mức thì được từ chối, và vẫn bị trừ phạt bình thường — trừ xong tụt xuống
     * dưới hạn mức cũng không sao, nhưng lần từ chối sau sẽ bị chặn.
     *
     * Đặt 0 nghĩa là bỏ cửa chặn. Cấu hình hỏng thì lùi về mặc định.
     */
    static async getMinHoursToReject(supabase: SupabaseClient): Promise<number> {
        const n = Number((await readRules(supabase)).MIN_HOURS_TO_REJECT);
        if (Number.isFinite(n) && n >= 0) return n;
        return DEFAULT_MIN_HOURS_TO_REJECT;
    }

    /**
     * Phạt trừ giờ theo NGÀY (vắng, trễ) — không gắn với đơn nào.
     *
     * Idempotent: `UNIQUE(staff_id, work_date, penalty_type)` nên gọi lại
     * cùng một loại lỗi trong cùng ngày chỉ cập nhật, không trừ hai lần.
     */
    static async deductDailyViolation(
        supabase: SupabaseClient,
        staffId: string,
        workDate: string,               // YYYY-MM-DD, theo NGÀY LÀM VIỆC
        violationType: DailyViolationType,
        note?: string,
        createdBy?: string,
    ) {
        if (!(await KtvTypeDDisciplineService.isEnabled(supabase))) {
            console.log(`[Type D] Kỷ luật đang TẮT — không trừ giờ ${violationType} cho ${staffId} ngày ${workDate}`);
            return 0;
        }

        const hoursPenalty = TYPE_D_DISCIPLINE_PENALTIES[violationType];

        const { error } = await supabase
            .from('KTVDPenaltyLedger')
            .upsert({
                staff_id: staffId,
                work_date: workDate,
                penalty_type: violationType,
                hours_penalty: hoursPenalty,
                money_penalty: 0,
                note: note || `Vi phạm: ${violationType}`,
                created_by: createdBy || null,
            }, { onConflict: 'staff_id,work_date,penalty_type' });

        if (error) {
            console.error('[Type D] Lỗi ghi phạt ngày:', error);
            throw error;
        }
        return hoursPenalty;
    }

    /**
     * Phạt TỪ CHỐI TUA ĐÃ GÁN — trừ gấp 3 lần thời lượng gói dịch vụ.
     * Gói 60 phút → trừ 3 giờ.
     *
     * ⚠️ Khoá idempotency là `(staff_id, work_date, penalty_type)`, nên KTV từ
     * chối nhiều tua trong CÙNG một ngày thì các lần sau ghi đè lần trước chứ
     * không cộng dồn. Vì vậy phải cộng tay vào dòng đang có.
     */
    static async deductOrderReject(
        supabase: SupabaseClient,
        staffId: string,
        workDate: string,
        bookingItemId: string,
        serviceDurationMins: number,
        createdBy?: string,
        multiplier?: number,
    ) {
        if (!(await KtvTypeDDisciplineService.isEnabled(supabase))) {
            console.log(`[Type D] Kỷ luật đang TẮT — không trừ giờ từ chối tua cho ${staffId}`);
            return 0;
        }

        const factor = Number.isFinite(multiplier as number) && (multiplier as number) > 0
            ? (multiplier as number)
            : await KtvTypeDDisciplineService.getRejectMultiplier(supabase);
        const thisPenalty = (serviceDurationMins / 60) * factor;

        const { data: existing } = await supabase
            .from('KTVDPenaltyLedger')
            .select('hours_penalty, note')
            .eq('staff_id', staffId)
            .eq('work_date', workDate)
            .eq('penalty_type', 'ORDER_REJECT')
            .maybeSingle();

        const total = Number(existing?.hours_penalty || 0) + thisPenalty;
        const note = [existing?.note, `${bookingItemId} (${serviceDurationMins}p → ${thisPenalty}h)`]
            .filter(Boolean).join('; ');

        const { error } = await supabase
            .from('KTVDPenaltyLedger')
            .upsert({
                staff_id: staffId,
                work_date: workDate,
                penalty_type: 'ORDER_REJECT',
                hours_penalty: total,
                money_penalty: 0,
                note: `Từ chối tua: ${note}`.slice(0, 500),
                created_by: createdBy || null,
            }, { onConflict: 'staff_id,work_date,penalty_type' });

        if (error) {
            console.error('[Type D] Lỗi ghi phạt từ chối tua:', error);
            throw error;
        }
        return thisPenalty;
    }

    /**
     * Dấu mốc KHOÁ TÀI KHOẢN — `hours_penalty = 0`, không phải khoản phạt.
     *
     * Để lịch sử ngày-theo-ngày còn vết sau khi tài khoản đã được mở khoá:
     * `lockInfo` ở màn hình điểm danh chỉ hiện lúc đang bị khoá, mở khoá xong
     * là mất dấu.
     */
    static async markAccountLock(
        supabase: SupabaseClient,
        staffId: string,
        workDate: string,
        reason: string,
    ) {
        const { error } = await supabase
            .from('KTVDPenaltyLedger')
            .upsert({
                staff_id: staffId,
                work_date: workDate,
                penalty_type: 'ACCOUNT_LOCK',
                hours_penalty: 0,
                money_penalty: 0,
                note: reason,
            }, { onConflict: 'staff_id,work_date,penalty_type' });

        if (error) console.error('[Type D] Lỗi ghi dấu khoá tài khoản:', error);
    }
}
