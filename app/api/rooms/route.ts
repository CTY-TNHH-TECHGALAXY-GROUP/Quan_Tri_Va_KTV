import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { RoomPatchSchema } from '@/lib/schemas/crm.schema';

/**
 * API Quản lý Phòng
 * GET /api/rooms — Lấy danh sách phòng + config + dịch vụ
 * PATCH /api/rooms — Cập nhật config cho 1 phòng
 */

export async function GET() {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        // Fetch all rooms with procedures & allowed services
        const { data: rooms, error } = await supabase
            .from('Rooms')
            .select('id, name, capacity, type, prep_procedure, clean_procedure, allowed_services, default_reminders, created_at')
            .order('name', { ascending: true });

        if (error) throw error;

        // Fetch all active services for the service picker
        const { data: services, error: svcError } = await supabase
            .from('Services')
            .select('id, code, nameVN, nameEN, category, duration, isActive')
            .eq('isActive', true)
            .order('category', { ascending: true });

        if (svcError) console.error('Error fetching services:', svcError);

        // Fetch reminders
        const { data: reminders, error: remError } = await supabase
            .from('Reminders')
            .select('*')
            .eq('is_active', true)
            .order('order_index', { ascending: true });

        if (remError) console.error('Error fetching reminders:', remError);

        return NextResponse.json({
            success: true,
            data: {
                rooms: rooms || [],
                services: services || [],
                reminders: reminders || []
            }
        });
    } catch (error: any) {
        console.error('API Error (GET /api/rooms):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const parseResult = RoomPatchSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        
        const { roomId, prep_procedure, clean_procedure, allowed_services, default_reminders } = parseResult.data;

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // Build update object (only include fields that are provided)
        const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
        if (prep_procedure !== undefined) updateData.prep_procedure = prep_procedure;
        if (clean_procedure !== undefined) updateData.clean_procedure = clean_procedure;
        if (allowed_services !== undefined) updateData.allowed_services = allowed_services;
        if (default_reminders !== undefined) updateData.default_reminders = default_reminders;

        const { data, error } = await supabase
            .from('Rooms')
            .update(updateData)
            .eq('id', roomId)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('API Error (PATCH /api/rooms):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
