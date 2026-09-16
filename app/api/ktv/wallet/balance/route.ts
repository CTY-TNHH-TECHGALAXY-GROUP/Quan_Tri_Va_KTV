import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { KtvWalletService } from '@/lib/services/KtvWalletService';
import { WalletAccessService } from '@/lib/services/WalletAccessService';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const techCode = searchParams.get('techCode');

        if (!techCode) {
            return NextResponse.json({ success: false, error: 'Thiếu mã KTV' }, { status: 400 });
        }

        // Ví Tua switched off (type-wide or per staff) → 403 maintenance, no balance.
        const denied = await WalletAccessService.denyIfDisabled(supabase, techCode, 'TUA');
        if (denied) return denied;

        const balanceData = await KtvWalletService.getBalance(supabase, techCode);

        return NextResponse.json({
            success: true,
            data: balanceData
        });

    } catch (err: any) {
        console.error('Exception in /api/ktv/wallet/balance:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
