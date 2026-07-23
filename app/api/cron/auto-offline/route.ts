import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvOnlineService } from '@/lib/services/KtvOnlineService';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const res = await KtvOnlineService.autoOffline(supabase);
        
        if (!res.success) {
            return NextResponse.json({ success: false, error: res.error }, { status: 500 });
        }

        return NextResponse.json({ success: true, offlinedCount: res.offlinedCount });
    } catch (e: any) {
        console.error('Exception in auto-offline cron:', e);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
