import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { StaffFeaturePatchSchema } from '@/lib/schemas/admin.schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/staff-features
 * Returns all staff with their feature_flags for admin management.
 */
export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { data: staff, error } = await supabase
            .from('Staff')
            .select('id, full_name, status, feature_flags')
            .eq('status', 'ĐANG LÀM')
            .ilike('id', 'NH%')
            .order('id', { ascending: true });

        if (error) {
            console.error('❌ [Staff Features GET] Error:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        // Fetch global configs for display
        const { data: configs } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', ['laundry_fee', 'ktv_sudden_off_penalty']);

        const configMap: Record<string, string> = {};
        (configs || []).forEach((c: any) => {
            configMap[c.key] = String(c.value).replace(/"/g, '');
        });

        return NextResponse.json({
            success: true,
            data: staff || [],
            configs: {
                laundry_fee: Number(configMap['laundry_fee'] || 20000),
                sudden_off_penalty: Number(configMap['ktv_sudden_off_penalty'] || 500000),
            }
        });
    } catch (err: any) {
        console.error('❌ [Staff Features GET] Unhandled:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * PATCH /api/admin/staff-features
 * Body: { staffId: string, flagKey: string, value: boolean }
 *   OR  { staffIds: string[], flagKey: string, value: boolean } (bulk)
 * Updates feature_flags for one or more staff members.
 */
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const parseResult = StaffFeaturePatchSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        
        const { staffId, staffIds, flagKey, value } = parseResult.data;

        const targetIds: string[] = staffIds || (staffId ? [staffId] : []);

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        // Update each staff member's feature_flags
        const errors: string[] = [];
        for (const id of targetIds) {
            // Fetch current flags
            const { data: current } = await supabase
                .from('Staff')
                .select('feature_flags')
                .eq('id', id)
                .maybeSingle();

            const currentFlags = (current?.feature_flags || {}) as Record<string, boolean>;
            const updatedFlags = { ...currentFlags, [flagKey]: value };

            const { error: updateError } = await supabase
                .from('Staff')
                .update({ feature_flags: updatedFlags })
                .eq('id', id);

            if (updateError) {
                errors.push(`${id}: ${updateError.message}`);
            }
        }

        if (errors.length > 0) {
            console.error('❌ [Staff Features PATCH] Errors:', errors);
            return NextResponse.json({ success: false, error: errors.join(', ') }, { status: 500 });
        }

        return NextResponse.json({ success: true, updated: targetIds.length });
    } catch (err: any) {
        console.error('❌ [Staff Features PATCH] Unhandled:', err);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
