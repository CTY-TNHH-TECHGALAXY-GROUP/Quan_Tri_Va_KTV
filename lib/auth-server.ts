import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { MODULES } from './constants';
import { FEATURE_MAINTENANCE_MESSAGE } from '@/lib/constants/featureMaintenance.i18n';

// Cùng cờ với middleware.ts. Tắt = hành vi cũ (không có session thì cho qua,
// chỉ ghi log). Bật = fail-closed. Xem plans/plan_bit_lo_hong_phase1_dot2_20260930.md.
const AUTH_ENFORCE = process.env.AUTH_ENFORCE_API === '1';

const unauthorizedJson = () => Response.json(
    { success: false, error: 'Unauthorized' }, { status: 401 }
);
const lockedJson = () => Response.json(
    { success: false, error: 'ACCOUNT_LOCKED' }, { status: 423 }
);

/**
 * Đổi lỗi do các hàm require* ném ra thành Response đúng mã HTTP.
 * Trả `null` nếu không phải lỗi xác thực — bên gọi tự xử lý tiếp.
 */
export function authErrorResponse(e: unknown): Response | null {
    const msg = (e as any)?.message;
    if (msg === 'Unauthorized') return unauthorizedJson();
    if (msg === 'ACCOUNT_LOCKED') return lockedJson();
    if (msg === 'Forbidden') return Response.json({ success: false, error: 'Forbidden' }, { status: 403 });
    return null;
}

type BusinessUserRecord = {
    id: string;
    username?: string | null;
    role?: string | null;
    permissions?: string[] | null;
};

const PERMISSION_RENAMES: Record<string, string> = {
    ktv_leave: 'ktv_schedule'
};

function resolveRoleId(role?: string | null) {
    const rawRole = typeof role === 'string' ? role.toUpperCase() : '';

    if (rawRole === 'ADMIN') return 'admin';
    if (rawRole === 'DEV') return 'dev';
    if (rawRole === 'MANAGER') return 'branch_manager';
    // 'RECEPTION' là giá trị enum cũ còn trong DB (ORIA000 tạo 03/10) — vẫn là lễ tân.
    if (rawRole === 'RECEPTIONIST' || rawRole === 'LEAD_RECEPTIONIST' || rawRole === 'RECEPTION') return 'reception';
    if (rawRole === 'TECHNICIAN' || rawRole === 'KTV') return 'ktv';

    return 'ktv';
}

function normalizePermissions(permissions: unknown): string[] {
    if (!Array.isArray(permissions)) {
        return [];
    }

    return permissions
        .filter((permission): permission is string => typeof permission === 'string' && permission.trim().length > 0)
        .map(permission => PERMISSION_RENAMES[permission] || permission);
}

function getFallbackPermissions(roleId: string) {
    if (roleId === 'admin' || roleId === 'dev' || roleId === 'branch_manager') {
        return MODULES.map(module => module.id);
    }

    if (roleId === 'reception') {
        return [
            'dashboard',
            'dispatch_board',
            'order_management',
            'customer_management',
            'ktv_hub',
            'room_management',
            'leave_management',
            'turn_tracking',
            'service_handbook',
            'staff_notifications',
            'settings'
        ];
    }

    if (roleId === 'ktv') {
        return [
            'ktv_dashboard',
            'ktv_attendance',
            'ktv_schedule',
            'ktv_performance',
            'ktv_history',
            'ktv_hours_ranking',
            'service_handbook',
            'settings'
        ];
    }

    return [];
}

async function resolveBusinessUserFromDb(user: any): Promise<BusinessUserRecord | null> {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        throw new Error('Supabase admin not initialized');
    }

    const emailPrefix = typeof user.email === 'string' ? user.email.split('@')[0] : null;
    const candidateValues = Array.from(new Set(
        [
            user.user_metadata?.business_user_id,
            user.user_metadata?.techCode,
            emailPrefix
        ]
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .flatMap(value => {
                const trimmed = value.trim();
                return [trimmed, trimmed.toUpperCase(), trimmed.toLowerCase()];
            })
    ));

    if (candidateValues.length === 0) {
        return null;
    }

    const findInField = async (field: 'id' | 'username') => {
        const { data, error } = await supabase
            .from('Users')
            .select('id, username, role, permissions')
            .in(field, candidateValues)
            .limit(1);

        if (error) {
            throw error;
        }

        return data && data.length > 0 ? (data[0] as BusinessUserRecord) : null;
    };

    return (await findInField('id')) || (await findInField('username'));
}

export async function requireApiUser() {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
        return null;
    }

    return user;
}

/**
 * Danh sách nhân viên đang bị khoá, nhớ tạm 20 giây.
 *
 * Không có cache thì mỗi lượt gọi API tốn thêm một vòng tới DB (~90ms đo được
 * trên máy này) — đắt hơn cả việc mà API đó định làm. Bảng khoá gần như luôn
 * rỗng và thay đổi rất thưa, nên nhớ tạm 20 giây là đủ nhanh mà vẫn kịp thời:
 * quản lý khoá xong, chậm nhất 20 giây là mọi API đều chặn.
 */
let lockedCache: { at: number; ids: Set<string> } | null = null;
const LOCK_CACHE_MS = 20_000;

async function fetchLockedStaffIds(): Promise<Set<string> | null> {
    if (lockedCache && Date.now() - lockedCache.at < LOCK_CACHE_MS) return lockedCache.ids;
    const supabase = getSupabaseAdmin();
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('Staff').select('id').eq('status', 'KHÓA_TÀI_KHOẢN');
    // Tra hỏng thì trả null = "không biết" → bên gọi CHO QUA. Thà lọt vài request
    // còn hơn cả tiệm đứng hình vì một lỗi mạng.
    if (error) {
        console.error('[AuthServer] Không đọc được danh sách tài khoản bị khoá:', error);
        return null;
    }
    const ids = new Set((data || []).map((r: any) => String(r.id).toUpperCase()));
    lockedCache = { at: Date.now(), ids };
    return ids;
}

/** Gọi sau khi khoá/mở khoá để lần kiểm tra kế tiếp không đọc bản nhớ cũ. */
export function invalidateLockedStaffCache() {
    lockedCache = null;
}

/**
 * Tài khoản bị khoá thì chặn ở TẦNG XÁC THỰC, không chỉ ở màn hình.
 *
 * Trước đây khoá tài khoản chỉ dựng một lớp che phía client: phiên đã cấp trước
 * lúc khoá vẫn gọi API bình thường cho tới khi người đó tự đăng xuất.
 *
 * KHÔNG áp cho admin / dev / lễ tân: họ là người đi mở khoá, tự khoá mình ra
 * ngoài là hỏng cả đường cứu.
 */
async function assertNotLocked(techCode: string | undefined, role: string | undefined) {
    if (!techCode) return;
    const roleId = resolveRoleId(role);
    if (roleId === 'admin' || roleId === 'dev' || roleId === 'reception') return;

    const locked = await fetchLockedStaffIds();
    if (!locked) return;                       // không tra được → cho qua
    if (locked.has(String(techCode).toUpperCase())) {
        throw new Error('ACCOUNT_LOCKED');
    }
}

export async function requireBusinessUser() {
    const user = await requireApiUser();
    if (!user) {
        return null;
    }

    const dbUser = await resolveBusinessUserFromDb(user);
    const businessUserId = dbUser?.id || user.user_metadata?.business_user_id;
    const finalTechCode = dbUser?.id || user.user_metadata?.techCode || businessUserId;
    const finalRole = dbUser?.role || user.user_metadata?.role;
    const finalPermissions = normalizePermissions(dbUser?.permissions ?? user.user_metadata?.permissions);

    if (!businessUserId) {
        throw new Error('User does not have a mapped business user');
    }

    await assertNotLocked(finalTechCode, finalRole);

    return {
        techCode: finalTechCode,
        businessUserId,
        // Tên đăng nhập ('admin', 'dev'...). `businessUserId` của tài khoản văn
        // phòng là một cuid dài, không đọc được — chỗ nào cần HIỂN THỊ người
        // thao tác thì dùng trường này (xem lib/counter-action-log.ts).
        username: dbUser?.username || user.user_metadata?.username || null,
        role: finalRole,
        permissions: finalPermissions
    };
}

/**
 * Chặn thao tác nhân danh NGƯỜI KHÁC.
 *
 * Nhiều route của app KTV nhận `ktvCode` thẳng từ body rồi tin luôn. Đổi một
 * ký tự trong request là thao tác trên hạn mức, sổ giờ và món nợ của đồng
 * nghiệp — ví dụ gửi mã người khác vào `/api/ktv/handover/skip` thì lượt bỏ
 * qua trừ vào quỹ của họ, còn mình vẫn còn nguyên lượt.
 *
 * Trả `null` khi hợp lệ, hoặc `Response` 403 khi lệch.
 *
 * ⚠️ Không có JWT: khi AUTH_ENFORCE_API tắt vẫn cho qua (giống `requirePermission`),
 * bật thì trả 401. Tài khoản bị khoá luôn bị chặn (423), không phụ thuộc cờ —
 * trước đây lỗi ACCOUNT_LOCKED bị nuốt chung với lỗi map nên KTV bị khoá vẫn
 * gọi được handover/skip, accept-order.
 */
export async function requireStaffMatches(claimedStaffId: string) {
    return requireStaffOrPermission(claimedStaffId, null);
}

/**
 * Như `requireStaffMatches`, nhưng người có `permissionId` (VD kế toán xem ví
 * KTV với quyền `finance_management`) cũng được qua dù không khớp mã.
 * `permissionId = null` → chỉ chấp nhận đúng chủ tài khoản.
 */
export async function requireStaffOrPermission(claimedStaffId: string, permissionId: string | null) {
    let bUser: Awaited<ReturnType<typeof requireBusinessUser>> = null;
    try {
        bUser = await requireBusinessUser();
    } catch (e: any) {
        if (e?.message === 'ACCOUNT_LOCKED') return lockedJson();
        if (AUTH_ENFORCE) return unauthorizedJson();
        return null;   // cờ tắt: chưa map được business user → cho qua
    }

    const sessionId = bUser?.techCode || bUser?.businessUserId;
    if (!sessionId) return AUTH_ENFORCE ? unauthorizedJson() : null;

    if (String(sessionId).trim().toLowerCase() === String(claimedStaffId || '').trim().toLowerCase()) {
        return null;
    }

    if (permissionId && bUser && hasPermissionOf(bUser, permissionId)) {
        return null;
    }

    console.warn(`[AuthServer] ⛔ ${sessionId} thao tác dưới danh nghĩa ${claimedStaffId}`);
    return Response.json(
        { success: false, error: 'Bạn chỉ thao tác được trên tài khoản của chính mình.' },
        { status: 403 }
    );
}

function hasPermissionOf(
    bUser: NonNullable<Awaited<ReturnType<typeof requireBusinessUser>>>,
    permissionId: string
): boolean {
    const roleId = resolveRoleId(bUser.role);
    const permissions = bUser.permissions.length > 0
        ? bUser.permissions
        : getFallbackPermissions(roleId);
    return permissions.includes(permissionId);
}

export async function requireRole(requiredRoles: string[]) {
    const bUser = await requireBusinessUser();

    if (!bUser) {
        throw new Error('Unauthorized');
    }

    const normalizedRole = typeof bUser.role === 'string' ? bUser.role.toUpperCase() : '';
    const normalizedRequiredRoles = requiredRoles.map(role => role.toUpperCase());

    if (!normalizedRole || !normalizedRequiredRoles.includes(normalizedRole)) {
        throw new Error('Forbidden');
    }

    return true;
}

export async function requirePermission(permissionId: string) {
    const bUser = await requireBusinessUser();

    if (!bUser) {
        // Không có JWT. Cờ bật → chặn. Cờ tắt → cho qua và ghi log (hành vi cũ,
        // giữ cho phiên đăng nhập trước khi có auto-heal ở app/login/actions.ts).
        if (AUTH_ENFORCE) throw new Error('Unauthorized');
        console.warn(`[AuthServer] ⚠️ No JWT session for permission '${permissionId}' (AUTH_ENFORCE_API off - allowed)`);
        return true;
    }

    const roleId = resolveRoleId(bUser.role);
    const permissions = bUser.permissions.length > 0
        ? bUser.permissions
        : getFallbackPermissions(roleId);

    // Admin/dev luôn có Office; lễ tân theo bảng Phân quyền (bỏ cấp cứng 03/10/2026,
    // khớp hasPermission phía client — hai bên phải cùng một luật).
    if (permissionId === 'ktv_office_scoring' || permissionId === 'ktv_office_hours') {
        if (roleId === 'admin' || roleId === 'dev') {
            return true;
        }
    }

    if (!permissions.includes(permissionId)) {
        throw new Error('Forbidden');
    }

    return true;
}

/**
 * Như `requirePermission` nhưng qua được khi có BẤT KỲ một quyền trong danh sách.
 * Dùng cho route phục vụ một màn mà chính màn đó mở bằng nhiều quyền (VD ktv-hub
 * mở bằng `ktv_attendance` hoặc `turn_tracking`) — guard phải khớp đúng bộ id
 * của màn, không được đòi một id khác mà tài khoản quầy có thể không có.
 */
export async function requirePermissionAny(permissionIds: string[]) {
    const bUser = await requireBusinessUser();

    if (!bUser) {
        if (AUTH_ENFORCE) throw new Error('Unauthorized');
        console.warn(`[AuthServer] ⚠️ No JWT session for permissions [${permissionIds.join(', ')}] (AUTH_ENFORCE_API off - allowed)`);
        return true;
    }

    if (!permissionIds.some(id => hasPermissionOf(bUser, id))) {
        throw new Error('Forbidden');
    }
    return true;
}

export async function requireActiveStaff() {
    const bUser = await requireBusinessUser();
    if (!bUser) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const staffId = bUser.techCode || bUser.businessUserId;
    if (!staffId) return null;

    const supabase = getSupabaseAdmin();
    if (!supabase) {
        return Response.json({ error: 'Supabase admin not initialized' }, { status: 500 });
    }

    const { data: staff, error } = await supabase
        .from('Staff')
        .select('status, lock_source')
        .eq('id', staffId)
        .single();

    if (error || !staff) {
         return Response.json({ error: 'Không tìm thấy thông tin nhân viên' }, { status: 404 });
    }

    if (staff.status === 'KHÓA_TÀI_KHOẢN') {
        // Admin switched "Hoạt động" off → maintenance sentence, never the
        // discipline wording. Disciplinary locks keep their message.
        const manual = (staff as any).lock_source === 'MANUAL';
        return Response.json({
            error: 'ACCOUNT_LOCKED',
            lockKind: manual ? 'MANUAL' : 'DISCIPLINE',
            message: manual ? FEATURE_MAINTENANCE_MESSAGE : 'Tài khoản của bạn đã bị khóa kỷ luật.',
        }, { status: 403 });
    }

    return null; 
}
