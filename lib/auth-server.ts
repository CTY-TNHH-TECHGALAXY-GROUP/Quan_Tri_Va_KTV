import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { MODULES } from './constants';

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
    if (rawRole === 'RECEPTIONIST' || rawRole === 'LEAD_RECEPTIONIST') return 'reception';
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

    return {
        techCode: finalTechCode,
        businessUserId,
        role: finalRole,
        permissions: finalPermissions
    };
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
        // 🔄 Compatibility Phase: No JWT session detected.
        // This happens when the user logged in via legacy DB lookup
        // but signInWithPassword failed (password mismatch with Supabase Auth).
        // Allow through with warning — matches middleware.ts behavior.
        // TODO: Remove this fallback once all users have synced Supabase Auth accounts.
        console.warn(`[AuthServer] ⚠️ Compatibility Phase: No JWT session for permission '${permissionId}'. Allowing through.`);
        return true;
    }

    const roleId = resolveRoleId(bUser.role);
    const permissions = bUser.permissions.length > 0
        ? bUser.permissions
        : getFallbackPermissions(roleId);

    if (!permissions.includes(permissionId)) {
        throw new Error('Forbidden');
    }

    return true;
}
