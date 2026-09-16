import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { WifiIpPostSchema } from '@/lib/schemas/admin.schema';

export async function GET(request: Request) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase không được khởi tạo.' }, { status: 500 });
        }

        const forwardedFor = request.headers.get('x-forwarded-for');
        const realIp = request.headers.get('x-real-ip');
        const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || 'unknown');

        const { data: configData, error: configError } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', ['spa_wifi_ips', 'spa_wifi_last_rejected_ip']);

        let currentIps = [];
        let lastRejected = null;
        
        if (!configError && configData) {
            const ipsConfig = configData.find(c => c.key === 'spa_wifi_ips');
            if (ipsConfig?.value && Array.isArray(ipsConfig.value)) {
                currentIps = ipsConfig.value.map((item: any) => {
                    if (typeof item === 'string') return { ip: item, addedAt: new Date().toISOString() };
                    return item;
                });
            }
            
            const rejectedConfig = configData.find(c => c.key === 'spa_wifi_last_rejected_ip');
            if (rejectedConfig?.value) {
                lastRejected = rejectedConfig.value;
            }
        }

        return NextResponse.json({ success: true, clientIp, currentIps, lastRejected });
    } catch (error: any) {
        console.error('❌ [GET Wifi IP] Unhandled error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const parseResult = WifiIpPostSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        
        const { action, ipToRemove, rejectedIp } = parseResult.data; // action: 'overwrite' | 'append' | 'remove' | 'append_rejected'

        const forwardedFor = request.headers.get('x-forwarded-for');
        const realIp = request.headers.get('x-real-ip');
        const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || 'unknown');

        if ((action === 'overwrite' || action === 'append') && clientIp === 'unknown') {
            return NextResponse.json({ success: false, error: 'Không thể xác định địa chỉ IP mạng của bạn.' }, { status: 400 });
        }
        
        if (action === 'append_rejected' && !rejectedIp) {
            return NextResponse.json({ success: false, error: 'Không tìm thấy IP để thêm.' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase không được khởi tạo.' }, { status: 500 });
        }

        // Fetch current list
        const { data: configData } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'spa_wifi_ips')
            .single();

        let currentIps: any[] = [];
        if (configData?.value && Array.isArray(configData.value)) {
            currentIps = configData.value.map(item => {
                if (typeof item === 'string') return { ip: item, addedAt: new Date().toISOString() };
                return item;
            });
        }

        let newIps = [...currentIps];
        const now = new Date().toISOString();

        if (action === 'overwrite') {
            newIps = [{ ip: clientIp, addedAt: now }];
        } else if (action === 'append') {
            if (!newIps.find(item => item.ip === clientIp)) {
                newIps.push({ ip: clientIp, addedAt: now });
            }
        } else if (action === 'append_rejected') {
            if (!newIps.find(item => item.ip === rejectedIp)) {
                newIps.push({ ip: rejectedIp, addedAt: now });
            }
        } else if (action === 'remove' && ipToRemove) {
            newIps = newIps.filter(item => item.ip !== ipToRemove);
        }

        // Nếu là append_rejected, xóa record rejected
        if (action === 'append_rejected') {
            await supabase.from('SystemConfigs').delete().eq('key', 'spa_wifi_last_rejected_ip');
        }

        // Cập nhật cấu hình IP vào DB
        const { error: updateError } = await supabase
            .from('SystemConfigs')
            .update({ value: newIps })
            .eq('key', 'spa_wifi_ips');

        if (updateError) {
            console.error('❌ [Update Wifi IP] Lỗi cập nhật Supabase:', updateError);
            return NextResponse.json({ success: false, error: 'Lỗi cập nhật cấu hình: ' + updateError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            message: 'Cập nhật IP Wi-Fi thành công!',
            clientIp,
            currentIps: newIps
        });

    } catch (error: any) {
        console.error('❌ [Update Wifi IP] Unhandled error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
