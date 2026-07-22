import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { AdvancedSettingPostSchema, AdvancedSettingPatchSchema } from '@/lib/schemas/admin.schema';

export async function GET(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'Supabase init failed' }, { status: 500 });

        const { data, error } = await supabase
            .from('SystemConfigs')
            .select('id, key, value, description, updated_at')
            .order('key', { ascending: true });

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'Supabase init failed' }, { status: 500 });

        const body = await request.json();
        const parseResult = AdvancedSettingPostSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        
        const { key, value, description } = parseResult.data;

        const { data, error } = await supabase
            .from('SystemConfigs')
            .insert({
                key,
                value,
                description,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'Supabase init failed' }, { status: 500 });

        const body = await request.json();
        const parseResult = AdvancedSettingPatchSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        
        const { id, key, value, description } = parseResult.data;

        const updateData: any = { updated_at: new Date().toISOString() };
        if (key !== undefined) updateData.key = key;
        if (value !== undefined) updateData.value = value;
        if (description !== undefined) updateData.description = description;

        const { data, error } = await supabase
            .from('SystemConfigs')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) return NextResponse.json({ error: 'Supabase init failed' }, { status: 500 });

        const { error } = await supabase
            .from('SystemConfigs')
            .delete()
            .eq('id', id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
