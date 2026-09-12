'use server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function getAllUsers() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");

        const { data: users, error } = await supabase
            .from('Users')
            .select('id, username, password, fullName, role, permissions, isOnShift, isBusy, createdAt, googleId')
            .order('createdAt', { ascending: false });

        if (error) throw error;

        return { success: true, data: users };
    } catch (error: any) {
        console.error('Error fetching users:', error);
        return { success: false, error: error.message };
    }
}

export async function getRolePermissions() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");

        const { data: users, error } = await supabase
            .from('Users')
            .select('role, permissions');

        if (error) throw error;

        // Group by role and take the first valid permissions array found
        const roleMap: Record<string, string[]> = {};
        const DB_ROLE_TO_LOCAL: Record<string, string> = {
            'ADMIN': 'admin',
            'RECEPTIONIST': 'reception',
            'LEAD_RECEPTIONIST': 'reception',
            'TECHNICIAN': 'ktv',
            'KTV': 'ktv',
            'SUPPORT': 'support',
        };

        for (const user of (users || [])) {
            const localRoleId = DB_ROLE_TO_LOCAL[user.role] || user.role?.toLowerCase();
            if (!localRoleId) continue;
            // Only take if permissions is a valid array and we haven't set this role yet
            if (!roleMap[localRoleId] && Array.isArray(user.permissions) && user.permissions.length > 0) {
                roleMap[localRoleId] = user.permissions;
            }
        }

        return { success: true, data: roleMap };
    } catch (error: any) {
        console.error('Error fetching role permissions:', error);
        return { success: false, error: error.message };
    }
}

export async function verifyAdminPassword(inputPassword: string) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");

        const { data, error } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'admin_unlock_password')
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return { success: false, error: 'Chưa cấu hình mật khẩu hệ thống. Vui lòng thêm key "admin_unlock_password" vào bảng SystemConfigs.' };
        }

        const storedPassword = typeof data.value === 'string' ? data.value : data.value?.password;

        if (inputPassword === storedPassword) {
            return { success: true };
        } else {
            return { success: false, error: 'Mật khẩu không chính xác!' };
        }
    } catch (error: any) {
        console.error('Error verifying admin password:', error);
        return { success: false, error: error.message };
    }
}

// Map local role IDs to DB role enum values
const ROLE_ID_TO_DB: Record<string, string[]> = {
    'admin': ['ADMIN'],
    'reception': ['RECEPTIONIST', 'LEAD_RECEPTIONIST'],
    'ktv': ['TECHNICIAN', 'KTV'],
    'support': ['SUPPORT'],
};

export async function saveRolePermissions(roles: { id: string, permissions: string[] }[]) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");

        for (const role of roles) {
            const dbRoles = ROLE_ID_TO_DB[role.id];
            if (!dbRoles) continue;

            for (const dbRole of dbRoles) {
                const { error } = await supabase
                    .from('Users')
                    .update({ permissions: role.permissions })
                    .eq('role', dbRole);

                if (error) {
                    console.error(`Error updating permissions for role ${dbRole}:`, error);
                }
            }
        }

        return { success: true };
    } catch (error: any) {
        console.error('Error saving role permissions:', error);
        return { success: false, error: error.message };
    }
}

export async function updateUserRole(userId: string, newRole: string) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");

        const { error } = await supabase
            .from('Users')
            .update({ role: newRole })
            .eq('id', userId);

        if (error) throw error;

        return { success: true };
} catch (error: any) {
        console.error('Error updating user role:', error);
        return { success: false, error: error.message };
    }
}

export async function updateUserPermissions(userId: string, permissions: string[]) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");

        const { error } = await supabase
            .from('Users')
            .update({ permissions })
            .eq('id', userId);

        if (error) throw error;

        return { success: true };
    } catch (error: any) {
        console.error('Error updating user permissions:', error);
        return { success: false, error: error.message };
    }
}

