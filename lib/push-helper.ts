import webpush from 'web-push';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// 🔧 VAPID CONFIGURATION
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BNEVJHwVmuU6e7vYPOm1S2hpAWprAhUNl6ew85ktt_HBH2osu4wkrbMXnC8uFj5IZtYXBawvSa1C33bVHTeo6lE';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '8YrwgZmKBy0dv5yOetQklOS36z_pYCRzf52jD8rmvOg';
const GMAIL_ACCOUNT = 'huynhngoctuanhieu2000@gmail.com'; // Contact email for VAPID

// 🏗️ LAZY INITIALIZATION
let isVapidInitialized = false;
const initVapid = () => {
    if (isVapidInitialized) return;
    try {
        if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
            console.warn('⚠️ [Push Helper] VAPID keys missing — skipping initialization');
            return;
        }
        webpush.setVapidDetails(
            `mailto:${GMAIL_ACCOUNT}`,
            VAPID_PUBLIC_KEY,
            VAPID_PRIVATE_KEY
        );
        isVapidInitialized = true;
    } catch (err) {
        console.error('❌ [Push Helper] VAPID initialization failed:', err);
    }
};

export interface PushPayload {
    title: string;
    message: string;
    url?: string;
    targetStaffIds?: string[];
    targetRoles?: string[];
}

export async function sendPushNotification(payload: PushPayload) {
    initVapid();
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const { title, message, url, targetStaffIds, targetRoles } = payload;
        
        let finalStaffIds = new Set<string>(targetStaffIds || []);

        if (targetRoles && targetRoles.length > 0) {
            // 🔧 Role Mapping: Translate settings UI IDs to DB enum values
            const roleMapping: Record<string, string> = {
                'KTV': 'TECHNICIAN',
                'RECEPTION': 'RECEPTIONIST',
                'ADMIN': 'ADMIN'
            };
            const mappedRoles = targetRoles.map((r: string) => roleMapping[r.toUpperCase()] || r.toUpperCase());
            
            // Lấy danh sách nhân viên có role tương ứng
            const { data: usersData, error: usersErr } = await supabase
                .from('Users')
                .select('id, code')
                .in('role', mappedRoles);
                
            if (!usersErr && usersData) {
                usersData.forEach(u => {
                    if (u.id) finalStaffIds.add(u.id);
                    if (u.code && u.code !== u.id) finalStaffIds.add(u.code);
                });
            } else {
                console.warn('⚠️ [Push Helper] Error fetching users by roles:', usersErr);
            }
        }

        // Nếu không có targetStaffIds và targetRoles (fallback cho các push tự động mặc định cũ)
        if (!targetStaffIds && !targetRoles) {
            const { data: defaultUsers } = await supabase
                .from('Users')
                .select('id, code')
                .in('role', ['ADMIN', 'RECEPTIONIST']);
            if (defaultUsers) {
                defaultUsers.forEach(u => {
                    if (u.id) finalStaffIds.add(u.id);
                    if (u.code && u.code !== u.id) finalStaffIds.add(u.code);
                });
            }
        }

        const idsArray = Array.from(finalStaffIds);
        if (idsArray.length === 0) {
            console.log('📡 [Push Helper] No staff targets found to push.');
            return { success: true, count: 0 };
        }

        // Truy vấn subscriptions dựa trên list staff_id (không JOIN bảng Users trực tiếp vì lỗi)
        const { data: subs, error } = await supabase
            .from('StaffPushSubscriptions')
            .select('subscription, staff_id')
            .in('staff_id', idsArray);

        if (error) throw error;

        if (!subs || subs.length === 0) {
            console.log('📡 [Push Helper] No subscriptions found for target');
            return { success: true, count: 0 };
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

        const pushPayload = JSON.stringify({
            title: title || 'Ngân Hà Spa',
            body: message || 'Bạn có thông báo mới!',
            url: url || '/'
        });

        const pushPromises = uniqueSubs.map(item => 
            webpush.sendNotification(item.subscription as any, pushPayload)
                .catch(err => {
                    console.error('Push error for sub:', err.endpoint || 'unknown', err.statusCode);
                    // Could remove expired subscriptions here
                    return null;
                })
        );

        await Promise.all(pushPromises);
        console.log(`📡 [Push Helper] Sent ${uniqueSubs.length} push notifications successfully (Filtered from ${subs.length}).`);

        return { success: true, count: uniqueSubs.length };
    } catch (error: any) {
        console.error('❌ [Push Helper] Error:', error);
        return { success: false, error: error.message };
    }
}
