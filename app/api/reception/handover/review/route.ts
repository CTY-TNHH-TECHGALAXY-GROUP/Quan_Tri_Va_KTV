import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { HandoverService, RejectOption } from '@/lib/services/HandoverService';

/**
 * POST /api/reception/handover/review
 * Reception approves or rejects handover with 3 options.
 * Body: { bookingItemId: string, action: 'APPROVE' | 'REJECT', rejectOption?: 'REDO' | 'DEDUCT' | 'CONFISCATE', reason?: string, ktvCode?: string }
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { bookingItemId, action, rejectOption, reason, ktvCode } = body;

        if (!bookingItemId || !action) {
            return NextResponse.json(
                { success: false, error: 'bookingItemId and action are required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // APPROVE
        if (action === 'APPROVE') {
            const result = await HandoverService.approveHandover(supabase, bookingItemId);
            if (!result.success) {
                return NextResponse.json({ success: false, error: result.error }, { status: 400 });
            }
            return NextResponse.json({ success: true, message: 'Đã duyệt bàn giao.' });
        }

        // REJECT with 3 options
        if (action === 'REJECT') {
            if (!rejectOption || !['REDO', 'DEDUCT', 'CONFISCATE'].includes(rejectOption)) {
                return NextResponse.json(
                    { success: false, error: 'rejectOption must be REDO, DEDUCT, or CONFISCATE' },
                    { status: 400 }
                );
            }

            // Option 2 & 3 require reason (2-step confirmation)
            if ((rejectOption === 'DEDUCT' || rejectOption === 'CONFISCATE') && !reason) {
                return NextResponse.json(
                    { success: false, error: 'Vui lòng nhập lý do cho hành động này.' },
                    { status: 400 }
                );
            }

            const result = await HandoverService.rejectHandover(
                supabase,
                bookingItemId,
                rejectOption as RejectOption,
                reason || 'Không đạt yêu cầu',
                ktvCode
            );

            if (!result.success) {
                return NextResponse.json({ success: false, error: result.error }, { status: 400 });
            }

            const messages: Record<string, string> = {
                REDO: 'Đã yêu cầu KTV dọn lại.',
                DEDUCT: 'Đã trừ tiền tua.',
                CONFISCATE: 'Đã tước tiền tua đơn này.',
            };

            return NextResponse.json({ success: true, message: messages[rejectOption] });
        }

        return NextResponse.json(
            { success: false, error: 'action must be APPROVE or REJECT' },
            { status: 400 }
        );
    } catch (error: any) {
        console.error('API Error (POST /api/reception/handover/review):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
