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

        // Upsert is idempotent, so a repeat call (e.g. checking in twice) must not
        // notify twice either — only notify when the ledger actually changes.
        const { data: existing } = await supabase
            .from('KTVDPenaltyLedger')
            .select('hours_penalty')
            .eq('staff_id', staffId)
            .eq('work_date', workDate)
            .eq('penalty_type', violationType)
            .maybeSingle();

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

        const changed = !existing || Number((existing as any).hours_penalty) !== hoursPenalty;
        if (hoursPenalty > 0 && changed) {
            await KtvTypeDDisciplineService.notifyHoursDeducted(
                staffId, workDate, hoursPenalty, note || `Vi phạm: ${violationType}`);
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

        // Every reject deducts more hours, so every reject gets its own notice
        // (with this reject's hours, not the day's running total).
        if (thisPenalty > 0) {
            await KtvTypeDDisciplineService.notifyHoursDeducted(
                staffId, workDate, Math.round(thisPenalty * 100) / 100, `Từ chối tua ${bookingItemId}`);
        }
        return thisPenalty;
    }

    /**
     * Personal notice to the KTV that hours were deducted. Every hours-deduction
     * path goes through this so the wording stays identical everywhere.
     *
     * Never throws: a failed notice must not undo or break the deduction itself.
     */
    private static async notifyHoursDeducted(
        staffId: string,
        workDate: string,
        hours: number,
        reason: string,
    ) {
        try {
            const { createNotification } = await import('../notification-helper');
            const { vnDate } = await import('../vn-time');
            await createNotification({
                type: 'WARNING',
                message: `Bạn bị trừ ${hours} giờ tích lũy ngày ${vnDate(workDate)}. Lý do: ${reason}.`,
                employeeId: staffId,
            });
        } catch (e) {
            console.error('[Type D] Không gửi được thông báo trừ giờ:', e);
        }
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
            /**
             * Tìm đơn KTV còn đang dở (trả mã bill). Có đơn thì KHOÁ được HOÃN tới
             * khi xong đơn. Bỏ trống = `timDonDangLam` thật; mô phỏng truyền vào
             * để khỏi cần DB.
             */
            timDonDangLam?: (staffId: string) => Promise<string[]>;
        },
        dry = false,
    ): Promise<{
        ketQua: 'LOCK' | 'DEDUCT' | 'NONE'; hours: number; netHours: number | null;
        /** Khoá đã quyết nhưng hoãn vì KTV còn đơn — ghi `Staff.pending_lock`. */
        hoan: boolean;
        donDangLam: string[];
    }> {
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

        // Khoá mà KTV còn đơn dở → HOÃN tới khi xong đơn, không đá người ta ra
        // giữa lúc làm / dọn phòng / chờ quầy duyệt bàn giao (plan §9).
        let donDangLam: string[] = [];
        if (ketQua === 'LOCK') {
            donDangLam = opts.timDonDangLam
                ? await opts.timDonDangLam(staffId)
                : await KtvTypeDDisciplineService.timDonDangLam(supabase, staffId);
        }
        const hoan = donDangLam.length > 0;
        const ketQuaDu = { ketQua, hours, netHours, hoan, donDangLam };

        if (dry || ketQua === 'NONE') return ketQuaDu;
        if (!(await KtvTypeDDisciplineService.isEnabled(supabase))) {
            return ketQuaDu;
        }

        if (ketQua === 'LOCK' && hoan) {
            await KtvTypeDDisciplineService.ghiChoKhoa(supabase, {
                staffId, staffName, workDate, caseKey, reason, source, donDangLam,
            });
        } else if (ketQua === 'DEDUCT') {
            await KtvTypeDDisciplineService.ghiPhatGio(supabase, staffId, workDate, caseKey, hours, reason, source);
            await KtvTypeDDisciplineService.notifyHoursDeducted(staffId, workDate, hours, reason);
        } else {
            await KtvTypeDDisciplineService.khoaTaiKhoan(supabase, staffId, staffName, workDate, reason, source, netHours);
        }

        return ketQuaDu;
    }

    /**
     * Mã bill các đơn KTV còn dở trong NGÀY LÀM VIỆC hiện tại, tính cả khúc chờ
     * khách đánh giá và chờ quầy duyệt bàn giao. Qua mốc cắt 06:00 thì đơn đêm
     * qua tự rơi khỏi danh sách — nên khoá hoãn muộn nhất tới đó là áp.
     */
    static async timDonDangLam(supabase: SupabaseClient, staffId: string): Promise<string[]> {
        const { findUnfinishedWorkToday } = await import('../unfinished-work');
        const busy = await findUnfinishedWorkToday(supabase, staffId, { tinhCaChoDuyet: true });
        return Array.from(new Set(busy.map(b => b.billCode)));
    }

    /**
     * Ghi "CHỜ KHOÁ" — KTV còn đơn nên chưa đổi `status`, vẫn làm tiếp bình
     * thường. Cron `type-d-pending-lock` áp khoá khi hết đơn.
     *
     * Không ghi được (VD chưa áp migration `pending_lock`) thì khoá luôn như cũ:
     * thà đá ra giữa đơn còn hơn lặng lẽ bỏ qua hình phạt.
     */
    private static async ghiChoKhoa(
        supabase: SupabaseClient,
        p: {
            staffId: string; staffName?: string | null; workDate: string;
            caseKey: TypeDDisciplineCaseKey; reason: string; source?: string; donDangLam: string[];
        },
    ) {
        const { error } = await supabase
            .from('Staff')
            .update({
                pending_lock: {
                    caseKey: p.caseKey,
                    workDate: p.workDate,
                    reason: p.reason,
                    source: p.source || 'CRON',
                    decidedAt: new Date().toISOString(),
                    billCodes: p.donDangLam,
                },
            })
            .eq('id', p.staffId);

        if (error) {
            console.error('[Type D] Không ghi được chờ khoá — khoá ngay:', error);
            await KtvTypeDDisciplineService.khoaTaiKhoan(supabase, p.staffId, p.staffName, p.workDate, p.reason, p.source, null);
            return;
        }

        const { createNotification } = await import('../notification-helper');
        const { vnDate } = await import('../vn-time');

        await supabase.from('SecurityAuditLogs').insert({
            employee_id: p.staffId,
            employee_name: p.staffName || p.staffId,
            event_type: 'PENDING_LOCK',
            ip_address: '127.0.0.1',
            user_agent: 'CRON',
            details: { source: p.source || 'CRON', violationDate: p.workDate, reason: p.reason, caseKey: p.caseKey, billCodes: p.donDangLam },
        });
        await createNotification({
            type: 'WARNING',
            message: `Tài khoản của bạn sẽ bị khoá ngay khi xong đơn đang làm. Lý do: ${p.reason} ngày ${vnDate(p.workDate)}. Liên hệ quầy để mở lại.`,
            employeeId: p.staffId,
        });
    }

    /**
     * Áp một khoá đang hoãn: khoá thật (đủ vết như khoá thường) rồi xoá
     * `pending_lock`. Bên gọi phải kiểm tra trước là KTV đã hết đơn.
     */
    static async apDungKhoaDangCho(
        supabase: SupabaseClient,
        staffId: string,
        staffName: string | null | undefined,
        pending: { workDate: string; reason: string },
    ) {
        await KtvTypeDDisciplineService.khoaTaiKhoan(
            supabase, staffId, staffName, pending.workDate, pending.reason, 'CRON_PENDING_LOCK', null);
        await supabase.from('Staff').update({ pending_lock: null }).eq('id', staffId);
    }

    /**
     * Thứ tự xử MỘT KTV trong lượt chốt sổ 00:00 — hàm THUẦN, không đọc DB, để
     * mô phỏng được đúng thứ cron chạy.
     *
     * Trả về các lỗi theo thứ tự xét. Cron xử lần lượt và DỪNG ngay khi có một
     * lượt khoá: mỗi người tối đa một lần khoá mỗi đêm, khoá rồi thì không chồng
     * thêm án trừ giờ (plans/plan_khoa_khi_chua_dang_ky_lich_loai_d.md §2.1).
     *
     *   1. Ngày vừa qua không có dòng đăng ký     → NO_REGISTRATION (kể cả có đi làm)
     *   2. Ngày mới chưa có dòng đăng ký          → UNREGISTERED_NEXT_DAY
     *   3. Ngày vừa qua đăng ký làm mà không đến  → 3 luật báo vắng / báo trễ / im lặng
     */
    static xetChotSoDem(input: {
        regNgayVuaQua: { status: string; absent_reported_at?: string | null; penalty_applied?: string | null } | null;
        coRegNgayMoi: boolean;
        coDiLamNgayVuaQua: boolean;
    }): {
        /** Ngày vừa qua đã xong việc (OFF hoặc có đi làm) → đóng sổ dòng đăng ký. */
        dongSoNgayVuaQua: boolean;
        loi: { caseKey: TypeDDisciplineCaseKey; ngay: 'VUA_QUA' | 'MOI'; lyDo: string; danhDauDangKy: boolean }[];
    } {
        const { regNgayVuaQua: reg, coRegNgayMoi, coDiLamNgayVuaQua: coDiLam } = input;
        const loi: { caseKey: TypeDDisciplineCaseKey; ngay: 'VUA_QUA' | 'MOI'; lyDo: string; danhDauDangKy: boolean }[] = [];

        if (!reg) {
            loi.push({ caseKey: 'NO_REGISTRATION', ngay: 'VUA_QUA', lyDo: 'Không đăng ký lịch', danhDauDangKy: false });
        }
        if (!coRegNgayMoi) {
            loi.push({ caseKey: 'UNREGISTERED_NEXT_DAY', ngay: 'MOI', lyDo: 'Chưa đăng ký lịch (đi làm hoặc OFF)', danhDauDangKy: false });
        }

        const dongSoNgayVuaQua = !!reg && (reg.status === 'OFF_REGISTERED' || coDiLam);

        // `penalty_applied` có rồi = lượt trước đã xử, không phạt hai lần.
        if (reg && !dongSoNgayVuaQua && !reg.penalty_applied) {
            if (reg.status === 'ABSENT_REPORTED' && reg.absent_reported_at) {
                loi.push({ caseKey: 'ABSENT_REPORTED_NO_SHOW', ngay: 'VUA_QUA', lyDo: 'Đã báo vắng nhưng không đi làm', danhDauDangKy: true });
            } else if (reg.status === 'LATE_REPORTED') {
                loi.push({ caseKey: 'LATE_REPORTED_NO_SHOW', ngay: 'VUA_QUA', lyDo: 'Đã báo trễ nhưng không đến làm', danhDauDangKy: true });
            } else {
                loi.push({ caseKey: 'NO_SHOW_NO_NOTICE', ngay: 'VUA_QUA', lyDo: 'Đăng ký làm nhưng không đến và không báo', danhDauDangKy: true });
            }
        }

        return { dongSoNgayVuaQua, loi };
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
        await KtvTypeDDisciplineService.markAccountLock(supabase, staffId, workDate, reason, source);

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
        /** Ai ghi dấu. 'CRON...' để sổ giờ hiện "chốt sổ cuối ngày" thay cho mốc 00:00. */
        createdBy?: string,
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
                created_by: createdBy || null,
            }, { onConflict: 'staff_id,work_date,penalty_type' });

        if (error) console.error('[Type D] Lỗi ghi dấu khoá tài khoản:', error);
    }
}
