import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { maybeAutoRelease } from '@/lib/guest-arrival.logic';
import { requireCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const unauthorized = requireCronAuth(request);
    if (unauthorized) return unauthorized;
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Check if there is an active lock
        const { data: activeLock } = await supabase
            .from('GuestArrivalEvents')
            .select('*')
            .is('released_at', null)
            .maybeSingle();

        if (activeLock) {
            const released = await maybeAutoRelease(supabase, activeLock);
            return NextResponse.json({ success: true, released, reason: released ? null : 'KEPT' });
        }

        return NextResponse.json({ success: true, released: false });
    } catch (error: any) {
        console.error('Error in guest-arrival-sweep:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
