import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AdjustmentRequestSchema } from '@/lib/schemas/adjustment.schema';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
    try {
        const body = await request.json();
        
        const parseResult = AdjustmentRequestSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }

        const { staff_id, amount, reason, type, wallet_type } = parseResult.data;

        const { error } = await supabase
            .from('WalletAdjustments')
            .insert({
                staff_id,
                amount: type === 'PENALTY' ? -Math.abs(amount) : Math.abs(amount),
                type,
                wallet_type,
                reason,
                created_by: 'Admin'
            });

        if (error) {
            console.error('Lỗi insert WalletAdjustments:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('Exception POST /api/finance/adjustment:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
