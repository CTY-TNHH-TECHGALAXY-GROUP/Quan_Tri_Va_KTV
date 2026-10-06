import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizePromotion, promotionInternalError } from '@/lib/promotion-route';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/promotions/campaigns/[id]/webbooking-instruction
 * Lấy câu hướng dẫn Web Booking riêng được ghi đè cho chiến dịch này (nếu có).
 */
export async function GET(_req: Request, context: RouteContext) {
    const auth = await authorizePromotion('campaign.manage');
    if (auth instanceof Response) return auth;

    try {
        const { id } = await context.params;
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ success: false, error: 'Database init error' }, { status: 500 });

        const { data, error } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', `voucher_wb_inst_campaign_${id}`)
            .single();

        if (error && error.code !== 'PGRST116') {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        let instruction = null;
        if (data?.value) {
            instruction = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        }

        return NextResponse.json({
            success: true,
            data: instruction,
        });
    } catch (e) {
        return promotionInternalError(e);
    }
}

/**
 * PATCH /api/admin/promotions/campaigns/[id]/webbooking-instruction
 * Lưu hoặc xóa câu hướng dẫn Web Booking riêng cho chiến dịch này.
 */
export async function PATCH(req: Request, context: RouteContext) {
    const auth = await authorizePromotion('campaign.manage');
    if (auth instanceof Response) return auth;

    try {
        const { id } = await context.params;
        const body = await req.json();
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ success: false, error: 'Database init error' }, { status: 500 });

        const key = `voucher_wb_inst_campaign_${id}`;

        if (!body || Object.keys(body).length === 0 || Object.values(body).every(v => !v)) {
            // Xóa cấu hình override nếu để trống, trả về dùng theo cấu hình hệ thống
            await supabase.from('SystemConfigs').delete().eq('key', key);
            return NextResponse.json({ success: true, data: null });
        }

        const { error } = await supabase
            .from('SystemConfigs')
            .upsert({
                key,
                value: JSON.stringify(body),
                description: `Câu hướng dẫn Web Booking ghi đè cho chiến dịch ${id}`,
                updated_at: new Date().toISOString(),
            });

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, data: body });
    } catch (e) {
        return promotionInternalError(e);
    }
}
