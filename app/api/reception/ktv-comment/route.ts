import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { bookingItemId, ktvId, note } = body;

        if (!bookingItemId || !ktvId) {
            return NextResponse.json({ success: false, error: 'Thiếu tham số bắt buộc' }, { status: 400 });
        }

        // Fetch current options
        const { data: itemData, error: fetchError } = await supabase
            .from('BookingItems')
            .select('options')
            .eq('id', bookingItemId)
            .single();

        if (fetchError || !itemData) {
            return NextResponse.json({ success: false, error: 'Không tìm thấy BookingItem' }, { status: 404 });
        }

        const currentOptions = itemData.options || {};
        const ktvNotes = currentOptions.reception_ktv_notes || {};

        if (note && note.trim().length > 0) {
            ktvNotes[ktvId] = note.trim();
        } else {
            // Remove the note if empty (meaning they want to un-hold)
            delete ktvNotes[ktvId];
        }

        const newOptions = {
            ...currentOptions,
            reception_ktv_notes: ktvNotes
        };

        const { error: updateError } = await supabase
            .from('BookingItems')
            .update({ options: newOptions })
            .eq('id', bookingItemId);

        if (updateError) {
            return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, options: newOptions });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
