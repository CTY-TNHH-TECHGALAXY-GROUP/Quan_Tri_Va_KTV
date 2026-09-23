import { createClient } from '@supabase/supabase-js';

/**
 * Supabase admin client for use in SERVER ENVIRONMENTS ONLY (e.g., Next.js API Routes).
 * This bypasses Row Level Security (RLS) policies.
 * Build-safe: returns null when env vars are missing during Vercel build.
 */
export const getSupabaseAdmin = () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        console.warn('⚠️ [SupabaseAdmin] Missing env vars (SUPABASE_SECRET_KEY). This is expected during build.');
        return null;
    }

    return createClient(supabaseUrl, supabaseServiceKey);
};
