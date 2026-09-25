import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { WalletAccessService } from '@/lib/services/WalletAccessService';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * GET /api/ktv/wallet/access?techCode=NH001
 *
 * Which wallets the KTV app may open. The client used to read
 * `Staff.feature_flags` itself and invent its own defaults; now the server
 * decides in one place (type-wide switch AND per-staff flag).
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const techCode = searchParams.get('techCode');

        if (!techCode) {
            return NextResponse.json({ success: false, error: 'Thiếu mã KTV' }, { status: 400 });
        }

        const access = await WalletAccessService.getAccess(supabase, techCode);

        return NextResponse.json({ success: true, data: access });
    } catch (err: any) {
        console.error('Exception in /api/ktv/wallet/access:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
