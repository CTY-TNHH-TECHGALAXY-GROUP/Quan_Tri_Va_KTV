import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { PushNotificationSchema } from '@/lib/schemas/notification.schema';

// 🔧 VAPID CONFIGURATION
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const GMAIL_ACCOUNT = 'huynhngoctuanhieu2000@gmail.com'; // Contact email for VAPID

// 🏗️ LAZY INITIALIZATION
let isVapidInitialized = false;
const initVapid = () => {
    if (isVapidInitialized) return;
    try {
        if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
            console.warn('⚠️ [Push API] VAPID keys missing — skipping initialization');
            return;
        }
        webpush.setVapidDetails(
            `mailto:${GMAIL_ACCOUNT}`,
            VAPID_PUBLIC_KEY,
            VAPID_PRIVATE_KEY
        );
        isVapidInitialized = true;
    } catch (err) {
        console.error('❌ [Push API] VAPID initialization failed:', err);
    }
};

export async function POST(request: Request) {
    initVapid();
    try {
        // 🔒 SECURITY CHECK
        const authHeader = request.headers.get('x-webhook-secret');
        if (authHeader !== process.env.WEBHOOK_SECRET && process.env.NODE_ENV === 'production') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const parseResult = PushNotificationSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        const { title, message, url, targetStaffIds, targetRoles } = parseResult.data;

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // 1. Fetch subscriptions for target staff or by roles
        
        let query = supabase.from('StaffPushSubscriptions').select(`
            subscription,
            Users:staff_id (
                role
            )
        `);
        
        if (targetStaffIds && targetStaffIds.length > 0) {
            query = query.in('staff_id', targetStaffIds);
        } else if (targetRoles && targetRoles.length > 0) {
            // Target specific roles
            const rolesFilter = targetRoles.map((r: string) => `role.eq.${r.toUpperCase()}`).join(',');
            query = query.or(rolesFilter, { foreignTable: 'Users' });
        } else {
            // Default: Send to all ADMIN and RECEPTIONIST roles
            query = query.or('role.eq.ADMIN,role.eq.RECEPTIONIST', { foreignTable: 'Users' });
        }

        const { data: subs, error } = await query;
        if (error) throw error;

        if (!subs || subs.length === 0) {
            return NextResponse.json({ success: true, message: 'No subscriptions found' });
        }

        // 🔧 Lọc trùng lặp Endpoint (tránh 1 máy nhận chục thông báo)
        const uniqueSubsMap = new Map();
        subs.forEach(item => {
            const endpoint = (item.subscription as any)?.endpoint;
            if (endpoint && !uniqueSubsMap.has(endpoint)) {
                uniqueSubsMap.set(endpoint, item);
            }
        });
        const uniqueSubs = Array.from(uniqueSubsMap.values());

        // 2. Send push to each subscription
        const payload = JSON.stringify({
            title: title || 'Ngân Hà Spa',
            body: message || 'Bạn có thông báo mới!',
            url: url || '/'
        });

        const pushPromises = uniqueSubs.map(item => 
            webpush.sendNotification(item.subscription, payload)
                .catch(err => {
                    console.error('Push error for sub:', err.endpoint, err.statusCode);
                    // If subscription is expired/invalid, we should ideally remove it here
                    return null;
                })
        );

        await Promise.all(pushPromises);

        return NextResponse.json({ success: true, count: uniqueSubs.length });
    } catch (error: any) {
        console.error('❌ [Push API] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
