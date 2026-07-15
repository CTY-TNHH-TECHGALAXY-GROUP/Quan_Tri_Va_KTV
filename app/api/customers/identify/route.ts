import { NextResponse } from 'next/server';
import { CustomerIdentifyService } from './customerIdentify.service';

/**
 * Lấy thông tin nhận dạng khách hàng (Khách cũ/mới, thói quen)
 * GET /api/customers/identify?phone=090...&email=...
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const phone = searchParams.get('phone') || undefined;
        const email = searchParams.get('email') || undefined;

        if (!phone && !email) {
            return NextResponse.json({
                success: false,
                error: "Vui lòng cung cấp số điện thoại hoặc email (phone hoặc email)"
            }, { status: 400 });
        }

        const data = await CustomerIdentifyService.identifyCustomer({ phone, email });

        return NextResponse.json({
            success: true,
            data
        });
    } catch (error: any) {
        console.error('API Error (GET /api/customers/identify):', error.message);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal Server Error'
        }, { status: 500 });
    }
}
