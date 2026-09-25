import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { StorageCleanupService } from '@/lib/services/StorageCleanupService';

/**
 * POST /api/cron/cleanup-storage
 * Cron job: Delete expired images from handover-images and attendance buckets.
 * Should be called daily at 3:00 AM by a scheduled task.
 */
export async function POST() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const result = await StorageCleanupService.cleanupExpiredImages(supabase);

        console.log(`🧹 [Cron Cleanup] Deleted ${result.handoverDeleted} handover + ${result.attendanceDeleted} attendance images.`);
        return NextResponse.json({ success: true, ...result });
    } catch (error: any) {
        console.error('API Error (POST /api/cron/cleanup-storage):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
