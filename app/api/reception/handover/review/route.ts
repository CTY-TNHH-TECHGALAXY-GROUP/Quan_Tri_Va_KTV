import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { HandoverService, RejectOption } from '@/lib/services/HandoverService';

/**
 * POST /api/reception/handover/review
 * Reception approves or rejects handover.
 * Body: { bookingItemId: string, action: 'APPROVE' | 'REJECT', rejectOption?: 'REDO' | 'PENALIZE_ONLY', reason?: string, ktvCode?: string, deductPoints?: boolean, rejectImages?: string[] }
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { bookingItemId, action, rejectOption, reason, ktvCode, rejectImages, deductPoints } = body;

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

        // REJECT
        if (action === 'REJECT') {
            if (!rejectOption || !['REDO', 'PENALIZE_ONLY'].includes(rejectOption)) {
                return NextResponse.json(
                    { success: false, error: 'rejectOption must be REDO or PENALIZE_ONLY' },
                    { status: 400 }
                );
            }

            let newRejectUrls: string[] = [];
            if (rejectImages && Array.isArray(rejectImages) && rejectImages.length > 0) {
                for (const base64Str of rejectImages) {
                    try {
                        const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, "");
                        const buffer = Buffer.from(base64Data, 'base64');
                        const fileExt = base64Str.match(/^data:image\/(\w+);base64,/)?.[1] || 'jpg';
                        const fileName = `reject_${bookingItemId}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                        
                        const { data: uploadData, error: uploadError } = await supabase.storage
                            .from('attendance')
                            .upload(fileName, buffer, {
                                contentType: `image/${fileExt}`,
                                upsert: false
                            });
                        
                        if (uploadError) {
                            console.error('[API] Reject photo upload error:', uploadError);
                        } else if (uploadData?.path) {
                            const { data: publicUrlData } = supabase.storage.from('attendance').getPublicUrl(uploadData.path);
                            newRejectUrls.push(publicUrlData.publicUrl);
                        }
                    } catch (err) {
                        console.error('[API] Failed to upload reject image:', err);
                    }
                }
            }

            const result = await HandoverService.rejectHandover(
                supabase,
                bookingItemId,
                rejectOption as RejectOption,
                reason || 'Không đạt yêu cầu',
                ktvCode,
                newRejectUrls,
                deductPoints
            );

            if (!result.success) {
                return NextResponse.json({ success: false, error: result.error }, { status: 400 });
            }

            // Remove deductPoints because KTVDisciplinePoints table does not exist
            // if (body.deductPoints) {
            //     const KtvDisciplineService = (await import('@/lib/services/KtvDisciplineService')).KtvDisciplineService;
            //     // Get KTVs assigned to this booking item
            //     const { data: item } = await supabase.from('BookingItems').select('technicianCodes').eq('id', bookingItemId).single();
            //     if (item?.technicianCodes?.length) {
            //         for (const staffId of item.technicianCodes) {
            //             await KtvDisciplineService.deductPoints(supabase, staffId, 'BAD_HANDOVER', `Vi phạm quy chuẩn bàn giao phòng (Đơn #${bookingItemId})`);
            //         }
            //     }
            // }

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
