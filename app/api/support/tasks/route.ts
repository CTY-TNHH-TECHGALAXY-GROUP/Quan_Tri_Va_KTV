import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { SupportTaskPostSchema, SupportTaskPatchSchema } from '@/lib/schemas/support.schema';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { searchParams } = new URL(request.url);
        const assignee_id = searchParams.get('assignee_id');
        const status = searchParams.get('status');

        let query = supabase
            .from('SupportTasks')
            .select('*, SupportAreas(area_name)')
            .order('created_at', { ascending: false });

        if (assignee_id) query = query.eq('assignee_id', assignee_id);
        if (status) query = query.eq('status', status);

        const { data, error } = await query;

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('Error fetching support tasks:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const body = await request.json();
        const parseResult = SupportTaskPostSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        const tasks = Array.isArray(parseResult.data) ? parseResult.data : [parseResult.data];

        const { data, error } = await supabase
            .from('SupportTasks')
            .insert(tasks)
            .select();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('Error creating support task:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const body = await request.json();
        const parseResult = SupportTaskPatchSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        const { id, status, photo_url } = parseResult.data;

        const updateData: any = { status };
        if (status === 'DONE') {
            updateData.completed_at = new Date().toISOString();
        }
        if (photo_url) {
            updateData.photo_url = photo_url;
        }

        const { data, error } = await supabase
            .from('SupportTasks')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('Error updating support task:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
