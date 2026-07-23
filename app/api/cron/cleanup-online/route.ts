import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvOnlineService } from '@/lib/services/KtvOnlineService';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * CRON: Cleanup expired online KTVs
 * ──────────────────────────────────
 * Schedule (Vercel Cron): "0 2,4,8,10,12,14,17 * * *" (UTC)
 * = 09:00, 11:00, 15:00, 17:00, 19:00, 21:00, 00:00 Vietnam time (UTC+7)
 * 
 * This endpoint is called automatically by Vercel Cron.
 * It cleans up "zombie" records: KTVs who registered as online but
 * whose availability window has expired by more than 1 hour.
 * 
 * Protected by CRON_SECRET to prevent unauthorized access.
 */
export async function GET(request: Request) {
    try {
        // Verify cron secret (Vercel automatically sends this header)
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;
        
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized' }, 
                { status: 401 }
            );
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const result = await KtvOnlineService.cleanupExpiredOnline(supabase);

        return NextResponse.json({
            success: result.success,
            data: {
                offlinedCount: result.offlinedCount,
                offlinedIds: result.offlinedIds,
                timestamp: new Date().toISOString(),
            },
            ...(result.error && { error: result.error }),
        });

    } catch (err: any) {
        console.error('[CRON] cleanup-online error:', err);
        return NextResponse.json(
            { success: false, error: 'Internal Server Error' }, 
            { status: 500 }
        );
    }
}
