import { SupabaseClient } from '@supabase/supabase-js';
import {
    TYPE_D_DISCIPLINE_PENALTIES,
    TYPE_D_DISCIPLINE_CASES,
    type TypeDDisciplineAction,
    type TypeDDisciplineCaseKey,
} from '../constants/staff.constants';

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

        // ⚠️ Trước đây dòng này lấy thẳng hằng số, KHÔNG đọc cấu hình. Nghĩa là
        // ba ô "Giờ" trên trang Cài đặt → Loại D chỉ để trang trí: quản lý sửa
        // 10 thành 8 thì hệ thống vẫn trừ 10. Nay cấu hình có tiếng nói thật.
        const hoursPenalty = await KtvTypeDDisciplineService.getPenaltyHours(supabase, violationType);

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
     * Số giờ bị trừ cho một loại lỗi ngày. Cấu hình trước, hằng số quy chế sau.
     *
     * Đặt 0 là bỏ hẳn hình phạt đó — cố ý cho phép, vì quản lý có thể muốn tắt
     * riêng một lỗi mà không tắt cả hệ kỷ luật.
     */
    static async getPenaltyHours(
        supabase: SupabaseClient,
        violationType: DailyViolationType,
    ): Promise<number> {
        const n = Number((await readRules(supabase))[violationType]);
        if (Number.isFinite(n) && n >= 0) return n;
        return TYPE_D_DISCIPLINE_PENALTIES[violationType];
    }

    /**
     * Chế tài đang áp cho một tình huống vắng mặt.
     *
     * Cấu hình nằm ở `ktv_type_d_discipline_rules.CASES`; thiếu hoặc hỏng thì
     * lùi về mặc định quy chế. Không bao giờ ném lỗi — cấu hình rác không được
     * phép làm sập cron chốt sổ.
     */
    static async getCasePolicy(
        supabase: SupabaseClient,
        caseKey: TypeDDisciplineCaseKey,
    ): Promise<{ action: TypeDDisciplineAction; hours: number }> {
        const mac_dinh = TYPE_D_DISCIPLINE_CASES[caseKey];
        const raw = (await readRules(supabase))?.CASES?.[caseKey];

        const HOP_LE: TypeDDisciplineAction[] = ['NONE', 'DEDUCT', 'LOCK', 'DEDUCT_OR_LOCK'];
        const action: TypeDDisciplineAction =
            HOP_LE.includes(raw?.action) ? raw.action : mac_dinh.action;

        const hours = Number(raw?.hours);
        return {
            action,
            hours: Number.isFinite(hours) && hours >= 0 ? hours : mac_dinh.hours,
        };
    }

    /**
     * ⭐ MỘT CỬA DUY NHẤT để xử một tình huống vắng mặt.
     *
     * Trước đây mỗi nhánh trong cron tự quyết "khoá hay trừ giờ", tự ghi
     * SecurityAuditLogs, tự đổi `Staff.status`, tự gửi thông báo — bốn bản sao
     * của cùng một thủ tục, và chế tài thì viết cứng nên muốn đổi phải deploy.
     *
     * Nay mọi nhánh gọi vào đây. Muốn biết hệ thống xử thế nào thì đọc đúng một
     * hàm, và quản lý đổi được chế tài ngay trên trang Cài đặt.
     *
     * `dry = true` → chỉ trả về QUYẾT ĐỊNH, không ghi một dòng nào. Dùng cho
     * `?dry=1` và cho lúc kỷ luật đang tắt.
     */
    static async applyCasePenalty(
        supabase: SupabaseClient,
        opts: {
            staffId: string;
            staffName?: string | null;
            /** Ngày bị ghi sổ, 'YYYY-MM-DD'. */
            workDate: string;
            caseKey: TypeDDisciplineCaseKey;
            reason: string;
            /** Ghi vào SecurityAuditLogs.details.source. */
            source?: string;
        },
        dry = false,
    ): Promise<{ ketQua: 'LOCK' | 'DEDUCT' | 'NONE'; hours: number; netHours: number | null }> {
        const { staffId, staffName, workDate, caseKey, reason, source } = opts;
        const policy = await KtvTypeDDisciplineService.getCasePolicy(supabase, caseKey);

        // Quyết định khoá hay trừ.
        let ketQua: 'LOCK' | 'DEDUCT' | 'NONE' = 'NONE';
        let netHours: number | null = null;

        if (policy.action === 'NONE') {
            ketQua = 'NONE';
        } else if (policy.action === 'LOCK') {
            ketQua = 'LOCK';
        } else if (policy.hours <= 0) {
            // Cấu hình 0 giờ = tắt riêng lỗi này. Trừ 0 giờ thì chỉ tạo rác trong sổ.
            ketQua = 'NONE';
        } else if (policy.action === 'DEDUCT') {
            ketQua = 'DEDUCT';
        } else {
            // DEDUCT_OR_LOCK — quỹ giờ không đủ để gánh mức phạt thì khoá, và
            // KHÔNG trừ (chốt 12/09). Trừ để quỹ âm rồi vẫn khoá là phạt hai lần.
            //
            // Đọc đúng nguồn mà KTV đang nhìn trên dashboard và mà thứ tự nhận
            // tua đang dùng, để không có chuyện "app ghi còn 12h mà hệ thống bảo
            // không đủ 10h".
            netHours = await KtvTypeDDisciplineService.quyGioThang(supabase, staffId, workDate);
            ketQua = netHours < policy.hours ? 'LOCK' : 'DEDUCT';
        }

        const hours = ketQua === 'DEDUCT' ? policy.hours : 0;

        if (dry || ketQua === 'NONE') return { ketQua, hours, netHours };
        if (!(await KtvTypeDDisciplineService.isEnabled(supabase))) {
            return { ketQua, hours, netHours };
        }

        if (ketQua === 'DEDUCT') {
            await KtvTypeDDisciplineService.ghiPhatGio(supabase, staffId, workDate, caseKey, hours, reason, source);
            const { createNotification } = await import('../notification-helper');
            const { vnDate } = await import('../vn-time');
            await createNotification({
                type: 'WARNING',
                message: `Bạn bị trừ ${hours} giờ tích lũy ngày ${vnDate(workDate)}. Lý do: ${reason}.`,
                employeeId: staffId,
            });
        } else {
            await KtvTypeDDisciplineService.khoaTaiKhoan(supabase, staffId, staffName, workDate, reason, source, netHours);
        }

        return { ketQua, hours, netHours };
    }

    /**
     * Quỹ giờ tích luỹ của KTV trong THÁNG của `workDate`.
     *
     *     giờ ròng = Σ KTVDTurnLedger.actual_minutes/60 − Σ KTVDPenaltyLedger.hours_penalty
     *
     * Đúng công thức mà bảng xếp hạng giờ và thứ tự nhận tua đang dùng, nên KTV
     * nhìn con số nào trên app thì bị xử theo đúng con số đó.
     *
     * Dòng `entry_status = 'VOID'` là tua đã bị gỡ (huỷ, đổi KTV) — không tính.
     *
     * 📌 Khi `KtvDLedgerReader` được đưa lên main, hàm này nên gọi thẳng
     * `netHoursByStaff()` thay vì tự truy vấn, để chỉ còn MỘT chỗ giữ công thức.
     */
    static async quyGioThang(
        supabase: SupabaseClient,
        staffId: string,
        workDate: string,
    ): Promise<number> {
        const [y, m] = workDate.split('-').map(Number);
        const dauThang = `${y}-${String(m).padStart(2, '0')}-01`;
        const cuoiThang = `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;

        const [turns, penalties] = await Promise.all([
            supabase.from('KTVDTurnLedger')
                .select('actual_minutes')
                .eq('staff_id', staffId)
                .gte('work_date', dauThang).lte('work_date', cuoiThang)
                .neq('entry_status', 'VOID'),
            supabase.from('KTVDPenaltyLedger')
                .select('hours_penalty')
                .eq('staff_id', staffId)
                .gte('work_date', dauThang).lte('work_date', cuoiThang),
        ]);

        const gioLam = (turns.data || []).reduce((t: number, r: any) => t + (Number(r.actual_minutes) || 0), 0) / 60;
        const gioPhat = (penalties.data || []).reduce((t: number, r: any) => t + (Number(r.hours_penalty) || 0), 0);
        return Math.round((gioLam - gioPhat) * 100) / 100;
    }

    /**
     * Ghi phiếu trừ giờ với số giờ do CHẾ TÀI quyết, không lấy theo hằng số của
     * loại lỗi — cùng một tình huống mà quản lý đặt mức khác nhau thì phải theo
     * mức đó.
     */
    private static async ghiPhatGio(
        supabase: SupabaseClient,
        staffId: string,
        workDate: string,
        caseKey: TypeDDisciplineCaseKey,
        hours: number,
        reason: string,
        createdBy?: string,
    ) {
        // Sổ phạt phân loại theo `penalty_type` cũ để báo cáo và màn Office đang
        // đọc không phải sửa theo.
        const violationType: DailyViolationType =
            caseKey === 'ABSENT_REPORTED_NO_SHOW' ? 'ABSENT_EARLY_NOTICE' : 'ABSENT_NO_NOTICE';

        const { error } = await supabase
            .from('KTVDPenaltyLedger')
            .upsert({
                staff_id: staffId,
                work_date: workDate,
                penalty_type: violationType,
                hours_penalty: hours,
                money_penalty: 0,
                note: reason,
                created_by: createdBy || 'CRON',
            }, { onConflict: 'staff_id,work_date,penalty_type' });

        if (error) console.error('[Type D] Lỗi ghi phạt giờ:', error);
    }

    /** Khoá tài khoản + để lại đủ vết: nhật ký bảo mật, dấu mốc trong sổ, thông báo. */
    private static async khoaTaiKhoan(
        supabase: SupabaseClient,
        staffId: string,
        staffName: string | null | undefined,
        workDate: string,
        reason: string,
        source?: string,
        netHours?: number | null,
    ) {
        const { createNotification } = await import('../notification-helper');
        const { vnDate } = await import('../vn-time');

        await supabase.from('SecurityAuditLogs').insert({
            employee_id: staffId,
            employee_name: staffName || staffId,
            event_type: 'AUTO_LOCK_ABSENCE',
            ip_address: '127.0.0.1',
            user_agent: 'CRON',
            details: { source: source || 'CRON', violationDate: workDate, reason, netHours },
        });
        await supabase.from('Staff').update({ status: 'KHÓA_TÀI_KHOẢN' }).eq('id', staffId);
        await KtvTypeDDisciplineService.markAccountLock(supabase, staffId, workDate, reason);

        // Khoá tài khoản là tin CÁ NHÂN gửi chính chủ, không phải tin khẩn của quầy.
        await createNotification({
            type: 'ACCOUNT_LOCK',
            message: `Tài khoản đã bị khoá. Lý do: ${reason} ngày ${vnDate(workDate)}. Liên hệ admin Oria Spa để mở lại.`,
            employeeId: staffId,
        });
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
