/**
 * Auth Sync Helper — Single source of truth for Users DB ↔ Supabase Auth synchronization.
 * All employee CRUD and login operations should use these helpers.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const DOMAIN_SUFFIX = '@nganhaspa.internal';

// ─── Lookup ──────────────────────────────────────────────

export async function findAuthUserByUsername(
    supabaseAdmin: SupabaseClient,
    username: string
) {
    const targetEmail = `${username}${DOMAIN_SUFFIX}`.toLowerCase();
    let page = 1;
    const perPage = 100;

    while (true) {
        const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage
        });

        if (error) {
            console.error(`[AuthSync] Error listing auth users (page ${page}):`, error.message);
            return null;
        }

        const match = users.find(u => u.email?.toLowerCase() === targetEmail);
        if (match) return match;
        if (users.length < perPage) break;
        page++;
    }

    return null;
}

// ─── Create ──────────────────────────────────────────────

export async function createAuthUser(
    supabaseAdmin: SupabaseClient,
    username: string,
    password: string,
    metadata: { business_user_id: string; techCode?: string; role: string; fullName: string }
) {
    const email = `${username}${DOMAIN_SUFFIX}`.toLowerCase();

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: metadata
    });

    if (error) {
        console.error(`[AuthSync] Failed to create auth user for ${username}:`, error.message);
        return { success: false, error: error.message };
    }

    console.log(`[AuthSync] ✅ Created auth user for ${username} (${data.user.id})`);
    return { success: true, authUserId: data.user.id };
}

// ─── Update (atomic — one API call) ─────────────────────

export async function updateAuthUser(
    supabaseAdmin: SupabaseClient,
    currentUsername: string,
    updates: {
        password?: string;
        newUsername?: string;
        metadata?: Record<string, any>;
    }
) {
    const authUser = await findAuthUserByUsername(supabaseAdmin, currentUsername);
    if (!authUser) {
        console.warn(`[AuthSync] Auth user not found for ${currentUsername}`);
        return { success: false, error: 'Auth user not found' };
    }

    const payload: any = {};
    if (updates.password) payload.password = updates.password;
    if (updates.newUsername) {
        payload.email = `${updates.newUsername}${DOMAIN_SUFFIX}`.toLowerCase();
    }
    if (updates.metadata) {
        payload.user_metadata = { ...authUser.user_metadata, ...updates.metadata };
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, payload);

    if (error) {
        console.error(`[AuthSync] Failed to update auth user for ${currentUsername}:`, error.message);
        return { success: false, error: error.message };
    }

    console.log(`[AuthSync] ✅ Updated auth user for ${currentUsername}`);
    return { success: true };
}

// ─── Delete ──────────────────────────────────────────────

export async function deleteAuthUser(
    supabaseAdmin: SupabaseClient,
    username: string
) {
    const authUser = await findAuthUserByUsername(supabaseAdmin, username);
    if (!authUser) {
        console.warn(`[AuthSync] Auth user not found for ${username}, nothing to delete`);
        return { success: true };
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(authUser.id);

    if (error) {
        console.error(`[AuthSync] Failed to delete auth user for ${username}:`, error.message);
        return { success: false, error: error.message };
    }

    console.log(`[AuthSync] ✅ Deleted auth user for ${username}`);
    return { success: true };
}

// ─── Ensure (Auto-Heal: create if missing, update if existing) ───

export async function ensureAuthUser(
    supabaseAdmin: SupabaseClient,
    username: string,
    password: string,
    metadata: { business_user_id: string; techCode?: string; role: string; fullName: string }
) {
    const authUser = await findAuthUserByUsername(supabaseAdmin, username);

    if (!authUser) {
        return createAuthUser(supabaseAdmin, username, password, metadata);
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        password,
        user_metadata: { ...authUser.user_metadata, ...metadata }
    });

    if (error) {
        console.error(`[AuthSync] Failed to ensure auth user for ${username}:`, error.message);
        return { success: false, error: error.message };
    }

    console.log(`[AuthSync] ✅ Ensured auth user for ${username} (updated existing)`);
    return { success: true, authUserId: authUser.id };
}
