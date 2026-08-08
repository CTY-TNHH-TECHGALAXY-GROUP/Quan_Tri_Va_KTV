import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'No supabase' });

        const { data: svcs, error } = await supabase
            .from('Services')
            .select('id, code, nameVN, duration')
            .limit(1000);

        if (error) return NextResponse.json({ error: error.message });

        const keys = svcs.flatMap(s => [
            String(s.id || '').trim().toLowerCase(),
            String(s.code || '').trim().toLowerCase()
        ]).filter(Boolean);

        const nhs0002 = svcs.find(s => s.code === 'NHS0002' || s.id === 'NHS0002');

        return NextResponse.json({
            count: svcs.length,
            nhs0002_found: !!nhs0002,
            nhs0002_data: nhs0002,
            all_keys_sample: keys.slice(0, 20),
            includes_nhs0002_key: keys.includes('nhs0002')
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message });
    }
}
