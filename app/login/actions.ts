'use server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { FEATURE_MAINTENANCE_MESSAGE } from '@/lib/constants/featureMaintenance.i18n';

const DOMAIN_SUFFIX = '@nganhaspa.internal';

export async function authenticateUser(username: string, password?: string) {
    try {
        const supabaseAdmin = getSupabaseAdmin();
        if (!supabaseAdmin) throw new Error("Supabase admin client not initialized");

        // 1. JWT Cookie Login (The New Way)
        let jwtOk = false;
        if (password) {
            const supabaseAuth = await createClient();
            const email = `${username}${DOMAIN_SUFFIX}`.toLowerCase();

            const { error: authErr } = await supabaseAuth.auth.signInWithPassword({
                email,
                password
            });

            if (authErr) {
                console.warn(`[Login] Supabase Auth failed for ${email}: ${authErr.message}`);
            } else {
                console.log(`[Login] ✅ JWT cookie issued for ${email}`);
                jwtOk = true;
            }
        }

        // 2. Legacy DB Lookup — still needed because frontend depends on the Users shape
        const query = supabaseAdmin
            .from('Users')
            .select('*')
            .eq('username', username);

        if (password) {
            query.eq('password', password);
        }

        const { data: user, error } = await query.single();

        if (error || !user) {
            console.error("Login failed or user not found in public.Users", error);
            
            // LOG TO SECURITY AUDIT LOGS
            try {
                const headersList = await headers();
                const forwardedFor = headersList.get('x-forwarded-for');
                const realIp = headersList.get('x-real-ip');
                const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || 'unknown');
                const userAgent = headersList.get('user-agent') || 'unknown';

                await supabaseAdmin.from('SecurityAuditLogs').insert({
                    employee_name: username,
                    event_type: 'INVALID_LOGIN',
                    ip_address: clientIp,
                    user_agent: userAgent,
                    details: { error: error?.message || 'Sai mật khẩu' }
                });
            } catch (e) {
                console.error('Lỗi khi lưu SecurityAuditLog (INVALID_LOGIN):', e);
            }

            return { success: false, error: 'Sai tài khoản hoặc mật khẩu' };
        }

        if (user.is_active === false) {
            return { success: false, error: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản lý.' };
        }

        // 3. Auto-Heal: DB login OK but no JWT → sync Auth then retry
        if (!jwtOk && password) {
            console.log(`[Login] 🔄 Auto-heal: Syncing Auth for ${username}...`);

            const { ensureAuthUser } = await import('@/lib/auth-sync');
            const healResult = await ensureAuthUser(supabaseAdmin, username, password, {
                business_user_id: user.id,
                techCode: user.code || user.id,
                role: user.role || 'TECHNICIAN',
                fullName: user.fullName || username
            });

            if (healResult.success) {
                // Retry JWT login
                const supabaseAuth = await createClient();
                const email = `${username}${DOMAIN_SUFFIX}`.toLowerCase();
                const { error: retryErr } = await supabaseAuth.auth.signInWithPassword({
                    email,
                    password
                });

                if (retryErr) {
                    // 🛡️ Safety Net: Allow login but log CRITICAL warning
                    console.error(`[Login] 🚨 CRITICAL: Auto-heal retry FAILED for ${username}: ${retryErr.message}. Allowing legacy login.`);
                } else {
                    console.log(`[Login] ✅ Auto-heal SUCCESS: JWT cookie issued for ${username}`);
                }
            } else {
                console.error(`[Login] 🚨 CRITICAL: ensureAuthUser FAILED for ${username}: ${healResult.error}. Allowing legacy login.`);
            }
        }

        // 4. Fetch avatar and feature_flags from Staff table (for profile display and permissions)
        let staffAvatarUrl = null;
        let featureFlags = undefined;
        let workType = undefined;
        let staffStatus: string | null = null;
        let lockSource: string | null = null;
        let staffLookupFailed = false;
        try {
            const { data: staffData, error: staffErr } = await supabaseAdmin
                .from('Staff')
                .select('avatar_url, feature_flags, work_type, status, lock_source')
                .eq('id', user.code || user.id)
                .maybeSingle();
            if (staffErr) staffLookupFailed = true;
            if (staffData) {
                staffAvatarUrl = staffData.avatar_url;
                featureFlags = staffData.feature_flags;
                workType = staffData.work_type;
                staffStatus = staffData.status;
                lockSource = (staffData as any).lock_source ?? null;
            }
        } catch (e) {
            staffLookupFailed = true;
        }

        // 4b. Tài khoản bị khoá thì CHẶN NGAY TỪ ĐÂY.
        //
        // Trước đây màn "Tài khoản bị khoá" chỉ là một lớp che phía client, dựng lên
        // sau khi đã đăng nhập xong. Đăng xuất rồi đăng nhập lại là vào được như
        // thường — khoá tài khoản gần như không có tác dụng.
        //
        // Tra hỏng (mất mạng, DB lỗi) thì KHÔNG chặn: thà cho vào rồi lớp che phía
        // trong bắt lại, còn hơn khoá nhầm cả tiệm vì một lỗi mạng.
        // Admin switched "Hoạt động" off → only the maintenance sentence; no
        // disciplinary reason (the penalty ledger may hold an OLD one).
        if (!staffLookupFailed && staffStatus === 'KHÓA_TÀI_KHOẢN' && lockSource === 'MANUAL') {
            return { success: false, error: 'ACCOUNT_LOCKED', message: FEATURE_MAINTENANCE_MESSAGE, lockDate: null };
        }

        if (!staffLookupFailed && staffStatus === 'KHÓA_TÀI_KHOẢN') {
            let lockReason: string | null = null;
            let lockDate: string | null = null;
            try {
                const { data: lockRow } = await supabaseAdmin
                    .from('KTVDPenaltyLedger')
                    .select('work_date, note')
                    .eq('staff_id', user.code || user.id)
                    .eq('penalty_type', 'ACCOUNT_LOCK')
                    .order('work_date', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                lockReason = (lockRow as any)?.note ?? null;
                lockDate = (lockRow as any)?.work_date ?? null;
            } catch { /* không có ghi chú thì thôi, vẫn chặn */ }

            return {
                success: false,
                error: 'ACCOUNT_LOCKED',
                message: lockReason
                    ? `Tài khoản đã bị khoá. Lý do: ${lockReason}. Liên hệ admin Oria Spa để mở lại.`
                    : 'Tài khoản đã bị khoá. Liên hệ admin Oria Spa để mở lại.',
                lockDate,
            };
        }

        return { success: true, user: { ...user, staffAvatarUrl, featureFlags, work_type: workType } };
    } catch (error: any) {
        console.error('Login action error:', error);
        return { success: false, error: error.message };
    }
}

export async function updateProfileInDB(userId: string, name: string, avatarUrl: string) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");

        const { error } = await supabase
            .from('Users')
            .update({ fullName: name }) // Assuming Users table uses fullName
            .eq('id', userId);

        if (error) throw error;

        // Also check if we need to update Staff table
        const { error: staffError } = await supabase
            .from('Staff')
            .update({ full_name: name, avatar_url: avatarUrl })
            .eq('id', userId);

        if (staffError) {
            console.warn("Could not update Staff profile, might not be a staff member", staffError.message);
        }

        // Sync fullName to Auth metadata
        const { data: dbUser } = await supabase.from('Users').select('username').eq('id', userId).single();
        if (dbUser?.username) {
            const { updateAuthUser } = await import('@/lib/auth-sync');
            await updateAuthUser(supabase, dbUser.username, { metadata: { fullName: name } }).catch(err =>
                console.warn(`[Login] Auth metadata sync failed for ${dbUser.username}:`, err)
            );
        }

        return { success: true };
    } catch (error: any) {
        console.error('Update profile error:', error);
        return { success: false, error: error.message };
    }
}

export async function updatePasswordInDB(userId: string, newPassword: string) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error("Supabase admin client not initialized");

        // 1. Update in Users table
        const { error } = await supabase
            .from('Users')
            .update({ password: newPassword })
            .eq('id', userId);

        if (error) throw error;

        // 2. Sync to Supabase Auth
        const { data: dbUser } = await supabase.from('Users').select('username').eq('id', userId).single();
        if (dbUser?.username) {
            const { updateAuthUser } = await import('@/lib/auth-sync');
            const result = await updateAuthUser(supabase, dbUser.username, { password: newPassword });
            if (!result.success) {
                console.warn(`[Login] ⚠️ Password updated in DB but Auth sync failed for ${dbUser.username}: ${result.error}`);
            }
        }

        return { success: true };
    } catch (error: any) {
        console.error('Update password error:', error);
        return { success: false, error: error.message };
    }
}
