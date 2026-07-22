import { NextResponse } from 'next/server';
import { PiggyBankService } from './PiggyBank.service';

export const dynamic = 'force-dynamic';
// Vercel serverless max duration
export const maxDuration = 300; 

export async function GET(request: Request) {
    try {
        // Tùy chọn bảo mật: Có thể check authorization header cho cron của Vercel
        // const authHeader = request.headers.get('authorization');
        // if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        //     return new Response('Unauthorized', { status: 401 });
        // }

        const result = await PiggyBankService.executeWeeklyDeduction();
        
        if (result.success) {
            return NextResponse.json(result);
        } else {
            return NextResponse.json({ error: result.error }, { status: 500 });
        }
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    // Cho phép gọi bằng POST nếu admin muốn kích hoạt thủ công
    return await GET(request);
}
