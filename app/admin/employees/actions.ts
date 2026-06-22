'use server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { revalidatePath } from 'next/cache';

const DOMAIN_SUFFIX = '@nganhaspa.internal';

export async function getStaffList() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");
        const { data: staff, error } = await supabase
            .from('Staff')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Fetch user login data to display username, password and role
        const { data: users, error: usersError } = await supabase
            .from('Users')
            .select('id, username, password, role');

        if (usersError) {
            console.warn("Could not fetch Users data", usersError);
        }

        const staffWithAuth = staff.map(s => {
            const authInfo = users?.find(u => u.id === s.id);
            return {
                ...s,
                username: authInfo?.username || s.id,
                password: authInfo?.password || '---',
                userRole: authInfo?.role || 'TECHNICIAN'
            };
        }).filter(s => s.userRole !== 'DEV' && s.id !== 'dev' && s.username !== 'dev');

        return { success: true, data: staffWithAuth };
    } catch (error: any) {
        console.error('Error fetching staff list:', error);
        return { success: false, error: error.message };
    }
}

export async function createStaffMember(formData: any) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");
        // 1. Create entry in custom public."Users" table
        const password = formData.password;
        if (!password) {
            throw new Error("Vui lòng nhập mật khẩu đăng nhập cho nhân viên.");
        }

        const role = formData.role || 'TECHNICIAN';

        const userPayload = {
            id: formData.id,
            username: formData.id, // Ensure username is the Employee ID (NV-001)
            password: password,
            code: formData.id,
            fullName: formData.full_name,
            gender: formData.gender || null,
            role: role,
            // Default KTV permissions mapping based on system defaults
            permissions: role === 'SUPPORT' ? [
                'support_dashboard',
                'ktv_attendance',
                'service_handbook',
                'settings'
            ] : role === 'TECHNICIAN' ? [
                'ktv_dashboard',
                'ktv_attendance',
                'ktv_schedule',
                'ktv_performance',
                'ktv_history',
                'service_handbook',
                'settings'
            ] : role === 'RECEPTION' ? [
                'reception_dispatch',
                'reception_ktv_hub',
                'reception_rooms'
            ] : role === 'ADMIN' ? [
                'role_management',
                'employee_management'
            ] : []
        };

        const { error: userError } = await supabase
            .from('Users')
            .insert(userPayload);

        if (userError) {
            console.error('Error creating user record:', userError);
            throw new Error(`Lỗi tạo tài khoản đăng nhập: ${userError.message}`);
        }

        // 🔄 Sync to Supabase Auth
        const { createAuthUser } = await import('@/lib/auth-sync');
        const authResult = await createAuthUser(supabase, formData.id, password, {
            business_user_id: formData.id,
            techCode: formData.id,
            role: role,
            fullName: formData.full_name
        });
        if (!authResult.success) {
            console.warn(`[Employees] ⚠️ Staff created in DB but Auth sync failed for ${formData.id}: ${authResult.error}`);
        }

        // 2. Insert into Staff Table
        const staffPayload = {
            id: formData.id, // ID gõ tay (e.g. NV-001)
            full_name: formData.full_name,
            status: formData.status || 'ĐANG LÀM',
            birthday: formData.birthday || null,
            gender: formData.gender || null,
            id_card: formData.id_card || null,
            phone: formData.phone || null,
            email: formData.email || null,
            bank_account: formData.bank_account || null,
            bank_name: formData.bank_name || null,
            avatar_url: formData.avatar_url || null,
            position: formData.position || 'Kỹ Thuật Viên',
            experience: formData.experience || null,
            join_date: formData.join_date || new Date().toISOString().split('T')[0],
            height: formData.height ? parseInt(formData.height) : null,
            weight: formData.weight ? parseInt(formData.weight) : null,
            skills: formData.skills || {}
        };

        const { data: staffData, error: staffError } = await supabase
            .from('Staff')
            .insert(staffPayload)
            .select()
            .single();

        if (staffError) {
            // Rollback auth user creation could be handled here if strictly necessary
            console.error('Error creating staff record:', staffError);
            throw new Error(`Lỗi lưu thông tin: ${staffError.message}`);
        }

        revalidatePath('/admin/employees');
        return { success: true, data: staffData };

    } catch (error: any) {
        console.error('Error in createStaffMember action:', error);
        return { success: false, error: error.message };
    }
}

export async function updateStaffMember(id: string, updates: any) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");

        // 1. Map camelCase (from Modal) to snake_case (for DB) if needed
        // The modal might pass Employee type (camelCase)
        const staffPayload: any = {};
        if (updates.name !== undefined) staffPayload.full_name = updates.name;
        if (updates.status !== undefined) staffPayload.status = updates.status === 'active' ? 'ĐANG LÀM' : 'ĐÃ NGHỈ';
        if (updates.dob !== undefined) staffPayload.birthday = updates.dob || null;
        if (updates.gender !== undefined) staffPayload.gender = updates.gender || null;
        if (updates.idCard !== undefined) staffPayload.id_card = updates.idCard || null;
        if (updates.phone !== undefined) staffPayload.phone = updates.phone || null;
        if (updates.email !== undefined) staffPayload.email = updates.email || null;
        if (updates.bankAccount !== undefined) staffPayload.bank_account = updates.bankAccount || null;
        if (updates.bankName !== undefined) staffPayload.bank_name = updates.bankName || null;
        if (updates.photoUrl !== undefined) staffPayload.avatar_url = updates.photoUrl || null;
        if (updates.position !== undefined) staffPayload.position = updates.position || null;
        if (updates.experience !== undefined) staffPayload.experience = updates.experience || null;
        if (updates.joinDate !== undefined) staffPayload.join_date = updates.joinDate || null;
        if (updates.height !== undefined) staffPayload.height = updates.height || null;
        if (updates.weight !== undefined) staffPayload.weight = updates.weight || null;
        if (updates.skills !== undefined) staffPayload.skills = updates.skills;
        if (updates.isActiveVipMenu !== undefined) staffPayload.is_active_vip_menu = updates.isActiveVipMenu;
        if (updates.isHomeSpa !== undefined) staffPayload.is_home_spa = updates.isHomeSpa;

        const { error: staffError } = await supabase
            .from('Staff')
            .update(staffPayload)
            .eq('id', id);

        if (staffError) throw new Error(`Lỗi cập nhật Staff: ${staffError.message}`);

        // 2. If login info provided, update Users table
        if (updates.password || updates.username || updates.name) {
            // Get current username BEFORE updating (needed for Auth lookup)
            const { data: currentUser } = await supabase.from('Users').select('username').eq('id', id).single();
            const oldUsername = currentUser?.username || id;

            const userPayload: any = {};
            if (updates.password) userPayload.password = updates.password;
            if (updates.username) userPayload.username = updates.username;
            if (updates.name) userPayload.fullName = updates.name;

            if (Object.keys(userPayload).length > 0) {
                const { error: userError } = await supabase
                    .from('Users')
                    .update(userPayload)
                    .eq('id', id);

                if (userError) console.warn("Could not update Users login info", userError);
            }

            // 🔄 Sync to Supabase Auth (atomic update)
            const { updateAuthUser } = await import('@/lib/auth-sync');
            const authUpdates: any = {};
            if (updates.password) authUpdates.password = updates.password;
            if (updates.username && updates.username !== oldUsername) {
                authUpdates.newUsername = updates.username;
            }
            if (updates.name) authUpdates.metadata = { fullName: updates.name };

            if (Object.keys(authUpdates).length > 0) {
                const result = await updateAuthUser(supabase, oldUsername, authUpdates);
                if (!result.success) {
                    console.warn(`[Employees] ⚠️ Staff updated in DB but Auth sync failed for ${oldUsername}: ${result.error}`);
                }
            }
        }

        revalidatePath('/admin/employees');
        revalidatePath('/reception/ktv-hub');
        return { success: true };
    } catch (error: any) {
        console.error('Error in updateStaffMember action:', error);
        return { success: false, error: error.message };
    }
}

export async function deleteStaffMember(id: string) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");

        // 0. Get username before deleting (for Auth cleanup)
        const { data: userRecord } = await supabase.from('Users').select('username').eq('id', id).single();

        // 1. Delete from Staff Table
        const { error: staffError } = await supabase
            .from('Staff')
            .delete()
            .eq('id', id);

        if (staffError) {
            console.error('Error deleting staff record:', staffError);
            throw new Error(`Lỗi xoá thông tin: ${staffError.message}`);
        }

        // 2. Delete from Users Table
        const { error: userError } = await supabase
            .from('Users')
            .delete()
            .eq('id', id);

        if (userError) {
            console.error('Error deleting user record:', userError);
            // Non-fatal error
        }

        // 3. 🔄 Delete from Supabase Auth
        if (userRecord?.username) {
            const { deleteAuthUser } = await import('@/lib/auth-sync');
            const result = await deleteAuthUser(supabase, userRecord.username);
            if (!result.success) {
                console.warn(`[Employees] ⚠️ Staff deleted from DB but Auth cleanup failed for ${userRecord.username}: ${result.error}`);
            }
        }

        revalidatePath('/admin/employees');
        return { success: true };
    } catch (error: any) {
        console.error('Error in deleteStaffMember action:', error);
        return { success: false, error: error.message };
    }
}

export async function updateEmployeeRole(employeeId: string, newRole: string) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");

        const { error } = await supabase
            .from('Users')
            .update({ role: newRole })
            .eq('id', employeeId);

        if (error) throw error;

        // 🔄 Sync role to Supabase Auth metadata
        const { data: userRecord } = await supabase.from('Users').select('username').eq('id', employeeId).single();
        if (userRecord?.username) {
            const { updateAuthUser } = await import('@/lib/auth-sync');
            const result = await updateAuthUser(supabase, userRecord.username, { metadata: { role: newRole } });
            if (!result.success) {
                console.warn(`[Employees] ⚠️ Role updated in DB but Auth sync failed for ${userRecord.username}: ${result.error}`);
            }
        }

        revalidatePath('/admin/employees');
        return { success: true };
    } catch (error: any) {
        console.error('Error updating employee role:', error);
        return { success: false, error: error.message };
    }
}
