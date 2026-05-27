import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireBusinessUser } from '@/lib/auth-server';
import { createNotification } from '@/lib/notification-helper';

/**
 * POST /api/ktv/review
 * Lưu đánh giá của KTV về khách hàng và ghi nhận trạng thái đã review.
 * Body: { bookingId: string, techCode?: string, notes?: string }
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { bookingId, notes } = body;
        
        // Compatibility Phase: KTV app hasn't fully migrated to Supabase Auth yet.
        // We attempt to get session, but don't hard-block if it fails.
        let bUser = null;
        try {
            bUser = await requireBusinessUser();
        } catch (e) {
            // Ignore auth errors during compatibility phase
        }
        
        // Lấy techCode từ payload trước để tiện test/chuyển đổi (tránh lỗi kẹt session trên cùng trình duyệt).
        // Fallback về session bUser nếu payload không truyền.
        const techCode = body.techCode || (bUser ? (bUser.techCode || bUser.businessUserId) : null);

        if (!bookingId || !techCode) {
            return NextResponse.json({ success: false, error: 'bookingId and techCode are required' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');



        // 2. Ghi nhận KTV này đã hoàn tất khâu Review vào segments của BookingItems (Source of truth)
        const { data: allItems, error: itemsErr } = await supabase
            .from('BookingItems')
            .select('id, segments, "technicianCodes"')
            .eq('bookingId', bookingId);

        if (itemsErr) {
            console.error('[KTV Review API] Error fetching booking items:', itemsErr);
            return NextResponse.json({ success: false, error: 'Error fetching booking items' }, { status: 500 });
        }
        
        console.log(`[KTV Review API] Check assignment for techCode: ${techCode}, bookingId: ${bookingId}`);
        console.log(`[KTV Review API] allItems fetched:`, JSON.stringify(allItems));

        const normalizedTechCode = techCode.trim().toUpperCase();
        const ktvItems = (allItems || []).filter(item => {
            const hasTechnicianCode = Array.isArray(item.technicianCodes) &&
                item.technicianCodes.some(c => c.trim().toUpperCase() === normalizedTechCode);

            if (hasTechnicianCode) {
                return true;
            }

            let segs: any[] = [];
            try {
                segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (Array.isArray(item.segments) ? item.segments : []);
            } catch {
                segs = [];
            }

            return segs.some((seg: any) =>
                seg?.ktvId && String(seg.ktvId).trim().toUpperCase() === normalizedTechCode
            );
        });

        if (!ktvItems || ktvItems.length === 0) {
            // [Lỗ hổng P2]: KTV không có trong technicianCodes của bất kỳ item nào
            console.error(`[KTV Review API] FAILED ASSIGNMENT CHECK. `);
            console.error(`- techCode resolved to: "${techCode}"`);
            console.error(`- normalizedTechCode: "${normalizedTechCode}"`);
            // Trả về false nhưng KHÔNG văng lỗi 500, để KTV có thể thoát màn hình
            return NextResponse.json({ success: false, error: 'KTV is not assigned to any items in this booking' }, { status: 403 });
        }
        console.log(`[KTV Review API] ASSIGNMENT CHECK PASSED. ktvItems count:`, ktvItems.length);

        // 2. Cập nhật ghi chú vào bảng Bookings nếu có (chỉ lưu và gửi thông báo nếu đã pass check assignment)
        if (notes) {
            const { data: currentB, error: getBookingErr } = await supabase
                .from('Bookings')
                .select('timeStart, notes, billCode')
                .eq('id', bookingId)
                .single();
                
            if (getBookingErr) {
                return NextResponse.json({ success: false, error: 'Cannot find booking: ' + getBookingErr.message }, { status: 404 });
            }
                
            const oldNotes = currentB?.notes || '';
            if (!oldNotes.includes(notes)) {
                const newNotes = oldNotes ? `${oldNotes} | ${notes}` : notes;
                const { error: updateNoteErr } = await supabase.from('Bookings').update({ notes: newNotes }).eq('id', bookingId);
                
                if (updateNoteErr) {
                    return NextResponse.json({ success: false, error: 'Failed to update booking notes' }, { status: 500 });
                }
                
                await createNotification({
                    type: 'KTV_REVIEW',
                    message: `📢 KTV ${techCode} vừa đánh giá khách hàng đơn ${currentB?.billCode || bookingId}: ${notes}`,
                    bookingId
                });
            }
        }

        let atLeastOneUpdated = false;

        for (const item of ktvItems) {
            let segs: any[] = [];
            
            // [Lỗ hổng P1 - Auto-heal Data Loss]: Kiểm tra parse JSON an toàn
            if (item.segments) {
                try { 
                    segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : item.segments;
                    if (!Array.isArray(segs)) {
                        // Nếu database trả về 1 object không phải mảng, ép kiểu thành mảng
                        segs = [segs];
                    }
                } catch (e) { 
                    // Parse thất bại -> Data bị corrupt. Báo lỗi ra thay vì xóa đè
                    return NextResponse.json({ success: false, error: 'Corrupt segments data in item ' + item.id }, { status: 500 });
                }
            } else {
                segs = []; // Mảng thực sự rỗng
            }
            
            let updated = false;
            let foundMySeg = false;

            segs.forEach((seg: any) => {
                if (seg.ktvId && seg.ktvId.toLowerCase() === techCode.toLowerCase()) {
                    foundMySeg = true;
                    if (!seg.reviewTime) {
                        seg.reviewTime = new Date().toISOString();
                        updated = true;
                    }
                }
            });

            // Nếu rỗng HOẶC không có segment của KTV này -> Tạo fallback an toàn
            if (!foundMySeg) {
                segs.push({
                    ktvId: techCode,
                    reviewTime: new Date().toISOString(),
                    fallbackCreated: true
                });
                updated = true;
            }

            if (updated) {
                const { error: updateItemsErr } = await supabase
                    .from('BookingItems')
                    .update({ segments: JSON.stringify(segs) })
                    .eq('id', item.id);
                    
                if (updateItemsErr) {
                    return NextResponse.json({ success: false, error: 'Failed to update segments in item ' + item.id }, { status: 500 });
                }
                
                atLeastOneUpdated = true;
            } else if (foundMySeg) {
                // Đã có reviewTime từ trước
                atLeastOneUpdated = true;
            }
        }

        if (!atLeastOneUpdated) {
            // Trường hợp không có gì được cập nhật hoặc tìm thấy
            return NextResponse.json({ success: false, error: 'Failed to mark review state in any items' }, { status: 500 });
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('API Error (POST /api/ktv/review):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
