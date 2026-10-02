import { SupabaseClient } from '@supabase/supabase-js';
import { STAFF_STATUS } from '@/lib/constants/staffStatus';

/**
 * ====================================================================
 * KtvRosterService — "ai là KTV" cho các bảng tiền
 * ====================================================================
 * Một chỗ duy nhất trả lời câu hỏi: bảng lương / bảng ví / bảng thu ngân
 * phải liệt kê những ai.
 *
 * ⚠️ Trước đây mỗi route tự lọc `ilike('id', 'NH%')`. Bộ lọc đó chặn đúng
 * đám placeholder nhưng chặn luôn **toàn bộ KTV loại D** mang mã `T001`,
 * `T016`, `T069`… — nên trang Thu Ngân KTV không có dòng nào cho họ, trong
 * khi lệnh rút tiền của chính họ vẫn nhảy lên khối "chờ ra quầy lấy tiền".
 * Cùng một lỗi đã xảy ra ở bảng Tính năng KTV (`/api/admin/staff-features`)
 * và được chữa bằng đúng tiêu chí dưới đây.
 *
 * Tiêu chí bền hơn tiền tố mã:
 *   1. `Staff.status` = ĐANG LÀM (ĐÃ NGHỈ / KHOÁ / HỆ THỐNG rơi ra)
 *   2. có tài khoản đăng nhập trong `Users`, vai trò không phải lễ tân /
 *      admin / dev (mấy vai đó không có ví tua)
 *   3. mã không phải placeholder `EXT…` / `C_…` — chỗ giữ tên khi lễ tân gõ
 *      tay KTV ngoài hoặc gộp nhiều người vào một ô trên bảng điều phối.
 */

/**
 * Vai trò KHÔNG thuộc bảng tiền KTV.
 *
 * Dùng danh sách loại trừ chứ không phải danh sách cho phép — y như
 * `/api/admin/staff-features`. Lý do rất cụ thể: `NH099` (Daisy) mang vai trò
 * `SUPPORT` nhưng vẫn là KTV có ví, đang hiện trên bảng thu ngân. Allowlist
 * `TECHNICIAN` sẽ âm thầm xoá đúng dòng đó — sửa lỗi loại D mà làm mất một
 * người khác thì tệ hơn lỗi ban đầu.
 *
 * `RECEPTIONIST` nằm ở đây vì lễ tân không có tiền tua; hiện chưa tài khoản
 * lễ tân nào trùng mã `Staff`, nhưng chặn sẵn để mai này thêm người thì bảng
 * tiền không tự mọc thêm dòng.
 */
const NON_KTV_ROLES = new Set(['DEV', 'ADMIN', 'RECEPTIONIST']);

/** Mã KHÔNG phải người thật — chỗ giữ tên trên bảng điều phối. */
const PLACEHOLDER_ID = /^(EXT|C_)/i;

export interface KtvRosterRow {
    id: string;
    full_name: string;
    position: string | null;
    work_type: string;
    feature_flags: any;
}

/** Các loại KTV hợp lệ — dùng cho bộ lọc hiển thị. */
export const KTV_WORK_TYPES = ['TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'] as const;
export type KtvWorkType = typeof KTV_WORK_TYPES[number];

export class KtvRosterService {
    /**
     * Danh sách KTV đang làm, đủ cả 4 loại, sắp theo mã.
     *
     * Trả về mảng rỗng nếu không đọc được `Users` — KHÔNG âm thầm rơi về
     * "lấy tất cả Staff", vì như thế bảng tiền sẽ mọc thêm lễ tân và admin.
     */
    static async getActiveKtvs(supabase: SupabaseClient): Promise<KtvRosterRow[]> {
        const [{ data: staffRaw, error: staffErr }, { data: users, error: userErr }] = await Promise.all([
            supabase
                .from('Staff')
                .select('id, full_name, position, work_type, feature_flags')
                .eq('status', STAFF_STATUS.WORKING)
                .order('id', { ascending: true }),
            supabase.from('Users').select('code, role'),
        ]);

        if (staffErr) throw staffErr;
        if (userErr) throw userErr;

        const ktvCodes = new Set(
            (users || [])
                .filter((u: any) => !NON_KTV_ROLES.has(String(u.role || '').toUpperCase()))
                .map((u: any) => String(u.code || '').toLowerCase())
                .filter(Boolean)
        );

        return (staffRaw || [])
            .filter((s: any) => !PLACEHOLDER_ID.test(String(s.id || '')))
            .filter((s: any) => ktvCodes.has(String(s.id).toLowerCase()))
            .map((s: any) => ({
                id: s.id,
                full_name: s.full_name,
                position: s.position ?? null,
                work_type: s.work_type || 'TYPE_A',
                feature_flags: s.feature_flags,
            }));
    }
}
