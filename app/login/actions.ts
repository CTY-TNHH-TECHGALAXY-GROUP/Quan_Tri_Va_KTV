'use server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';

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
        try {
            const { data: staffData } = await supabaseAdmin
                .from('Staff')
                .select('avatar_url, feature_flags')
                .eq('id', user.code || user.id)
                .maybeSingle();
            if (staffData) {
                staffAvatarUrl = staffData.avatar_url;
                featureFlags = staffData.feature_flags;
            }
        } catch (e) {
            // Non-critical: staff avatar lookup failed
        }

        return { success: true, user: { ...user, staffAvatarUrl, featureFlags } };
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
