import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// ----------------------------------------------------------------------
// GET: Lấy danh sách thành viên tham gia ví tích lũy kèm config
// ----------------------------------------------------------------------
export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        
        // 1. Lấy config số tuần
        const { data: configData } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'ktv_piggy_bank_total_weeks')
            .single();
            
        const totalWeeks = parseInt(configData?.value as string) || 50;

        // 2. Lấy tất cả KTV đang làm việc
        const { data: staffList, error: staffError } = await supabase
            .from('Staff')
            .select('id, full_name, feature_flags')
            .eq('status', 'ĐANG LÀM');

        if (staffError) throw new Error(staffError.message);

        const activeStaffIds = staffList.map((s: any) => s.id);

        if (activeStaffIds.length === 0) {
            return NextResponse.json({ success: true, data: [], totalWeeks });
        }

        // 3. Lấy dữ liệu PiggyBank của các KTV này
        const { data: banks, error: bankError } = await supabase
            .from('KTVPiggyBank')
            .select('*')
            .in('staff_id', activeStaffIds);

        if (bankError) throw new Error(bankError.message);

        // 4. Merge Data (Nếu KTV bật flag nhưng chưa có bảng DB thì trả về default)
        const resultData = activeStaffIds.map((staffId: string) => {
            const staff = staffList.find((s: any) => s.id === staffId);
            const bankData = banks.find((b: any) => b.staff_id === staffId);
            
            return {
                staff_id: staffId,
                full_name: staff?.full_name || 'N/A',
                piggy_bank_id: bankData?.id || null,
                weekly_amount: bankData?.weekly_amount || 0,
                contributed_weeks: bankData?.contributed_weeks || 0,
                status: bankData?.status || 'NOT_STARTED'
            };
        });

        return NextResponse.json({ success: true, data: resultData, totalWeeks });
    } catch (error: any) {
        console.error('[Admin PiggyBank GET]', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

// ----------------------------------------------------------------------
// POST: Cập nhật weekly_amount cho 1 KTV (Tạo record nếu chưa có)
// ----------------------------------------------------------------------
export async function POST(request: Request) {
    try {
        const { staff_id, weekly_amount, contributed_weeks, status } = await request.json();
        if (!staff_id || weekly_amount === undefined || contributed_weeks === undefined) {
            return NextResponse.json({ success: false, error: 'Thiếu dữ liệu' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');
        
        // Kiểm tra xem đã có record chưa
        const { data: existing } = await supabase
            .from('KTVPiggyBank')
            .select('id')
            .eq('staff_id', staff_id)
            .single();

        if (existing) {
            // Update
            const { error: updateError } = await supabase
                .from('KTVPiggyBank')
                .update({ 
                    weekly_amount, 
                    contributed_weeks,
                    status: status || 'ACTIVE',
                    updated_at: new Date().toISOString() 
                })
                .eq('id', existing.id);
            if (updateError) throw new Error(updateError.message);
        } else {
            // Insert
            const { error: insertError } = await supabase
                .from('KTVPiggyBank')
                .insert({
                    staff_id,
                    weekly_amount,
                    contributed_weeks,
                    status: status || 'ACTIVE'
                });
            if (insertError) throw new Error(insertError.message);
        }

        return NextResponse.json({ success: true, message: 'Đã cập nhật số tiền tích lũy hàng tuần.' });
    } catch (error: any) {
        console.error('[Admin PiggyBank POST]', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
