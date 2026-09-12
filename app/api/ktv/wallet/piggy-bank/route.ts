import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const techCode = searchParams.get('techCode');
        
        if (!techCode) {
            return NextResponse.json({ success: false, error: 'Thiếu techCode' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        
        // 1. Config tổng số tuần
        const { data: configData } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'ktv_piggy_bank_total_weeks')
            .single();
        const totalWeeks = parseInt(configData?.value as string) || 50;

        // 2. Data hiện tại
        const { data: bank, error: bankError } = await supabase
            .from('KTVPiggyBank')
            .select('*')
            .eq('staff_id', techCode)
            .single();
            
        // 3. Lịch sử giao dịch (Ledger)
        const { data: ledger } = await supabase
            .from('KTVPiggyBankLedger')
            .select('*')
            .eq('staff_id', techCode)
            .order('created_at', { ascending: false })
            .limit(50);

        return NextResponse.json({
            success: true,
            data: {
                bank: bank || null,
                ledger: ledger || [],
                totalWeeks
            }
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
