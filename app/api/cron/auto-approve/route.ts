import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { HandoverService } from '@/lib/services/HandoverService';

/**
 * POST /api/cron/auto-approve
 * Cron job: Auto-approve handovers that have been PENDING for more than X minutes.
 * Should be called by a scheduled task (pg_cron, Edge Function, or Vercel Cron).
 */
export async function POST() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const result = await HandoverService.autoApproveExpired(supabase);

        console.log(`⏰ [Cron Auto-Approve] Approved ${result.approved} expired handovers.`);
        return NextResponse.json({ success: true, approved: result.approved });
    } catch (error: any) {
        console.error('API Error (POST /api/cron/auto-approve):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
