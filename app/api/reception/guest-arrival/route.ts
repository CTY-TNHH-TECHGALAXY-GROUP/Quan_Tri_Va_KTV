import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requirePermission, requireBusinessUser } from '@/lib/auth-server';
import { createNotification } from '@/lib/notification-helper';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const { isGuestArrivalEnabled } = await import('@/lib/guest-arrival.logic');
        const isEnabled = await isGuestArrivalEnabled(supabase);

        const { data, error } = await supabase
            .from('GuestArrivalEvents')
            .select('*')
            .is('released_at', null)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching guest arrival lock:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }
        
        // Tự tắt khi hết đơn chờ — nhưng ƯU TIÊN THỦ CÔNG: khóa vừa bật tay mà chưa từng
        // có đơn chờ nào thì giữ nguyên, chờ quầy tắt. Chi tiết ở maybeAutoRelease().
        if (data) {
            const { maybeAutoRelease } = await import('@/lib/guest-arrival.logic');
            if (await maybeAutoRelease(supabase, data)) {
                return NextResponse.json({ success: true, active: false, enabled: isEnabled, data: null });
            }
        }

        return NextResponse.json({
            success: true,
            active: !!data,
            enabled: isEnabled,
            data: data || null
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        let createdBy = 'SYSTEM';
        let createdByName = 'Hệ thống';

        try {
            await requirePermission('dispatch_board');
            const bUser = await requireBusinessUser();
            if (bUser) {
                createdBy = bUser.businessUserId;
                createdByName = bUser.techCode; // fallback

                // Fetch real name
                const { data: userRow } = await supabase
                    .from('Users')
                    .select('fullName')
                    .eq('id', bUser.businessUserId)
                    .maybeSingle();

                if (userRow?.fullName) {
                    createdByName = userRow.fullName;
                } else if (bUser.techCode) {
                    const { data: staffRow } = await supabase
                        .from('Staff')
                        .select('full_name')
                        .eq('id', bUser.techCode)
                        .maybeSingle();
                    if (staffRow?.full_name) createdByName = staffRow.full_name;
                }
            }
        } catch (e) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        if (body.adminId) createdBy = body.adminId;
        if (body.adminName) createdByName = body.adminName;
        const note = body.note || null;

        const { isGuestArrivalEnabled } = await import('@/lib/guest-arrival.logic');
        const isEnabled = await isGuestArrivalEnabled(supabase);
        if (!isEnabled) {
            return NextResponse.json({ success: false, error: 'Tính năng Báo Khách đang bị tắt.' }, { status: 400 });
        }

        // Check if there is an active lock
        const { data: existing } = await supabase
            .from('GuestArrivalEvents')
            .select('*')
            .is('released_at', null)
            .maybeSingle();

        if (existing) {
            return NextResponse.json({ success: true, data: existing });
        }

        // Insert new lock
        const { data: newLock, error: insertError } = await supabase
            .from('GuestArrivalEvents')
            .insert({
                created_by: createdBy,
                created_by_name: createdByName,
                note
            })
            .select()
            .single();

        if (insertError) {
            if (insertError.code === '23505') {
                 const { data: existing2 } = await supabase
                     .from('GuestArrivalEvents')
                     .select('*')
                     .is('released_at', null)
                     .maybeSingle();
                 if (existing2) {
                     return NextResponse.json({ success: true, data: existing2 });
                 }
            }
            console.error('Error creating guest arrival event:', insertError);
            return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
        }

        // Create notification
        await createNotification({
            type: 'GUEST_ARRIVAL',
            message: 'Quầy vừa thông báo có khách. Cb đón khách nhé'
        });

        return NextResponse.json({ success: true, data: newLock });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        let releasedBy = 'SYSTEM';

        try {
            // Require either dispatch_board or admin.
            // requirePermission checks if the user has the permission. Let's just check dispatch_board, and if it fails, check admin
            try {
                await requirePermission('dispatch_board');
            } catch {
                await requirePermission('dashboard'); // Admin has dashboard permission
            }
            
            const bUser = await requireBusinessUser();
            if (bUser) {
                releasedBy = bUser.businessUserId;
            }
        } catch (e) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        
        if (body.adminId === 'AUTO') {
            releasedBy = 'AUTO';
        } else if (body.adminId) {
            releasedBy = body.adminId;
        }

        // Find active lock
        const { data: activeLock } = await supabase
            .from('GuestArrivalEvents')
            .select('id')
            .is('released_at', null)
            .maybeSingle();

        if (!activeLock) {
            return NextResponse.json({ success: true, message: 'No active lock to release' });
        }

        const { error: updateError } = await supabase
            .from('GuestArrivalEvents')
            .update({
                released_at: new Date().toISOString(),
                released_by: releasedBy
            })
            .eq('id', activeLock.id);

        if (updateError) {
            console.error('Error releasing guest arrival lock:', updateError);
            return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: 'Lock released' });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
