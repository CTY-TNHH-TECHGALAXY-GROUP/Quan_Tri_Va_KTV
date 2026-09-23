import { createBrowserClient } from '@supabase/ssr'
import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase client for use in the browser (CSR).
 * Only call this at runtime in 'use client' components.
 */
export const createClient = () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    return createBrowserClient(supabaseUrl, supabaseAnonKey)
}

/**
 * Build-safe Supabase singleton for server-side usage (API routes, services).
 * During Vercel build (prerendering), env vars may be missing.
 * In that case, the proxy returns safe no-op values instead of throwing.
 */
let _supabase: SupabaseClient | null = null

const createSafeClient = (): SupabaseClient | null => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
        console.warn('⚠️ [Supabase] Missing env vars — returning no-op client (build-time)')
        return null
    }

    return createSupabaseClient(supabaseUrl, supabaseAnonKey)
}

/**
 * Lazy singleton — safe during build.
 * At build time (no env vars): returns a no-op proxy that won't crash.
 * At runtime (env vars present): returns the real Supabase client.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
        if (!_supabase) {
            _supabase = createSafeClient()
        }
        // If client is null (build-time), return a safe no-op function
        if (!_supabase) {
            return () => ({ data: null, error: { message: 'Supabase not available at build time' } })
        }
        return (_supabase as any)[prop]
    }
})
