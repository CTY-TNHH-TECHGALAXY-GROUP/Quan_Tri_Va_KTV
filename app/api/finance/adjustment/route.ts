import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { staff_id, amount, reason, type, wallet_type } = body;

        if (!staff_id || !amount || !type || !reason || !wallet_type) {
            return NextResponse.json({ success: false, error: 'Vui lòng nhập đủ thông tin' }, { status: 400 });
        }

        if (!['GIFT', 'PENALTY', 'ADJUST'].includes(type)) {
            return NextResponse.json({ success: false, error: 'Loại điều chỉnh không hợp lệ' }, { status: 400 });
        }

        const numericAmount = Number(amount);
        if (isNaN(numericAmount) || numericAmount === 0) {
            return NextResponse.json({ success: false, error: 'Số tiền không hợp lệ' }, { status: 400 });
        }

        const { error } = await supabase
            .from('WalletAdjustments')
            .insert({
                staff_id,
                amount: type === 'PENALTY' ? -Math.abs(numericAmount) : Math.abs(numericAmount),
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
