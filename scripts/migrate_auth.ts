import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually (avoids @next/env ESM/CJS issues with tsx)
const envPath = resolve(process.cwd(), '.env.local');
const envContent = readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase env vars. Make sure SUPABASE_SERVICE_ROLE_KEY is set in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

const DOMAIN_SUFFIX = '@nganhaspa.internal';

// ─── Parse CLI args ──────────────────────────────────────
const args = process.argv.slice(2);
const mode = args.includes('--sync') ? 'sync' : 'dry-run';

async function migrateAuth() {
    console.log(`\n🚀 Auth Sync Script — Mode: ${mode.toUpperCase()}`);
    console.log('='.repeat(50));

    // 1. Fetch all business users
    const { data: users, error: fetchErr } = await supabase
        .from('Users')
        .select('id, username, password, code, role, fullName');

    if (fetchErr) {
        console.error('❌ Error fetching users:', fetchErr);
        return;
    }

    console.log(`📦 Found ${users.length} users in public.Users\n`);

    // 2. Fetch ALL existing auth users (paginated)
    const authUsersMap = new Map<string, any>();
    let page = 1;
    const perPage = 100;

    while (true) {
        const { data: { users: authBatch }, error } = await supabase.auth.admin.listUsers({ page, perPage });
        if (error) {
            console.error('❌ Error fetching auth users:', error);
            return;
        }
        for (const au of authBatch) {
            if (au.email) authUsersMap.set(au.email.toLowerCase(), au);
        }
        if (authBatch.length < perPage) break;
        page++;
    }

    console.log(`🔑 Found ${authUsersMap.size} existing auth accounts\n`);

    // 3. Process each user
    let created = 0, updated = 0, skipped = 0, failed = 0;

    for (const user of users) {
        const email = `${user.username}${DOMAIN_SUFFIX}`.toLowerCase();
        const existingAuth = authUsersMap.get(email);

        // Skip users without password (e.g., OAuth-only accounts)
        if (!user.password || user.password.trim().length === 0) {
            console.log(`⏭️  ${user.username} — No password in DB, skipping`);
            skipped++;
            continue;
        }

        // Auto-upgrade short passwords to '123456' (Supabase minimum is 6 chars)
        const DEFAULT_PASSWORD = '123456';
        let finalPassword = user.password;

        if (user.password.length < 6) {
            console.log(`🔑 ${user.username} — Password too short (${user.password.length} chars), upgrading to '${DEFAULT_PASSWORD}'`);
            finalPassword = DEFAULT_PASSWORD;

            // Update DB password too so it stays in sync
            if (mode === 'sync') {
                const { error: dbErr } = await supabase
                    .from('Users')
                    .update({ password: DEFAULT_PASSWORD })
                    .eq('id', user.id);

                if (dbErr) {
                    console.error(`   ❌ DB password update FAILED: ${dbErr.message}`);
                    failed++;
                    continue;
                }
                console.log(`   ✅ DB password updated to '${DEFAULT_PASSWORD}'`);
            } else {
                console.log(`   📋 [DRY-RUN] Would update DB password to '${DEFAULT_PASSWORD}'`);
            }
        }

        const metadata = {
            business_user_id: user.id,
            techCode: user.code || user.id,
            role: user.role || 'TECHNICIAN',
            fullName: user.fullName || user.username
        };

        if (!existingAuth) {
            // CREATE new auth account
            console.log(`🆕 ${user.username} (${email}) — Will CREATE`);

            if (mode === 'sync') {
                const { data, error } = await supabase.auth.admin.createUser({
                    email,
                    password: finalPassword,
                    email_confirm: true,
                    user_metadata: metadata
                });

                if (error) {
                    console.error(`   ❌ FAILED: ${error.message}`);
                    failed++;
                } else {
                    console.log(`   ✅ Created: ${data.user.id}`);
                    created++;
                }
            } else {
                console.log(`   📋 [DRY-RUN] Would create with role=${user.role}`);
                created++;
            }
        } else {
            // UPDATE existing auth account (sync password + metadata)
            console.log(`🔄 ${user.username} (${email}) — Will UPDATE (auth_id: ${existingAuth.id})`);

            if (mode === 'sync') {
                const { error } = await supabase.auth.admin.updateUserById(existingAuth.id, {
                    password: finalPassword,
                    user_metadata: { ...existingAuth.user_metadata, ...metadata }
                });

                if (error) {
                    console.error(`   ❌ FAILED: ${error.message}`);
                    failed++;
                } else {
                    console.log(`   ✅ Updated password + metadata`);
                    updated++;
                }
            } else {
                console.log(`   📋 [DRY-RUN] Would update password + metadata`);
                updated++;
            }
        }
    }

    // 4. Summary
    console.log('\n' + '='.repeat(50));
    console.log(`🏁 ${mode.toUpperCase()} Complete!`);
    console.log(`   🆕 Created: ${created}`);
    console.log(`   🔄 Updated: ${updated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Failed:  ${failed}`);
    console.log('='.repeat(50));

    if (mode === 'dry-run') {
        console.log('\n💡 To apply changes, run: npx tsx scripts/migrate_auth.ts --sync');
    }
}

migrateAuth();
