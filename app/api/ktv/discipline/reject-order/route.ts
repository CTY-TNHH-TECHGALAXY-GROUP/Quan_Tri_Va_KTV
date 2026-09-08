import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvDisciplineService } from '@/lib/services/KtvDisciplineService';
import { ktvDisplayLabel } from '@/lib/constants/staff.constants';
import { requireActiveStaff, requireStaffMatches } from '@/lib/auth-server';
import { resolveMyItems } from '@/lib/services/KtvOrderTargetService';

export async function POST(request: Request) {
    try {
        // Tài khoản bị khoá thì không thao tác được nữa, kể cả khi phiên
        // đăng nhập đã cấp từ trước lúc khoá.
        const lockedError = await requireActiveStaff();
        if (lockedError) return lockedError;

        const body = await request.json();
        // `confirmLock`: KTV đã đọc cảnh báo thiếu giờ mà vẫn muốn từ chối,
        // chấp nhận bị khoá tài khoản.
        const { staffId, bookingItemId, reason, confirmLock } = body;

        if (!staffId || !bookingItemId || !reason) {
            return NextResponse.json({ success: false, error: 'Thiếu thông tin bắt buộc (staffId, bookingItemId, reason)' }, { status: 400 });
        }

        // Từ chối tua trừ giờ tích lũy và có thể khoá tài khoản — không cho ai
        // bấm dưới danh nghĩa người khác.
        const wrongStaff = await requireStaffMatches(staffId);
        if (wrongStaff) return wrongStaff;

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase init failed' }, { status: 500 });
        }

        // Màn hình KTV từng gửi nhầm BOOKING id vào đây (nextBookingId). Chấp nhận
        // cả hai: nếu id không khớp BookingItem nào thì coi như booking id và tìm
        // đơn con đang gán cho chính KTV này.
        //
        // ⚠️ Một đơn có thể gồm NHIỀU dịch vụ cùng gán cho KTV này. Từ chối là
        // hành vi CÓ CHẾ TÀI — mức phạt bằng 3 lần thời lượng của đúng gói bị từ
        // chối — nên tuyệt đối không được bốc đại một dịch vụ. Trước đây `.find`
        // lấy phần tử đầu theo thứ tự DB trả về: cùng một cú bấm, trúng gói 30
        // phút thì phạt 1,5 giờ, trúng gói 90 phút thì phạt 4,5 giờ, và hai dịch
        // vụ còn lại vẫn dính tên KTV. Nhiều hơn một thì bắt gọi đích danh.
        const resolved = await resolveMyItems(supabase, staffId, bookingItemId);
        if (resolved.items.length === 0) {
            return NextResponse.json(
                { success: false, error: 'Không tìm thấy đơn đang gán cho bạn.' }, { status: 404 });
        }
        if (resolved.items.length > 1) {
            return NextResponse.json({
                success: false,
                needsItemPick: true,
                items: resolved.items.map(i => ({ id: i.id, serviceId: i.serviceId, status: i.status })),
                error: `Đơn này có ${resolved.items.length} dịch vụ đang gán cho bạn. Hãy chọn đúng dịch vụ muốn từ chối — mức phạt tính theo thời lượng của dịch vụ đó.`,
            }, { status: 400 });
        }
        const itemId: string = resolved.items[0].id;

        // 1. Lấy thông tin KTV
        const { data: staffData } = await supabase.from('Staff').select('full_name, work_type').eq('id', staffId).single();
        // Loại A/B/D hiện MÃ để khớp bảng điều phối; loại C ("Nhập tay") mới hiện tên.
        const staffName = ktvDisplayLabel(staffData?.work_type, staffId, staffData?.full_name);
        const isTypeD = staffData?.work_type === 'TYPE_D';

        // 2. Tính thời gian làm việc liên tục
        const { totalMins } = await KtvDisciplineService.calculateContinuousWorkMins(supabase, staffId);
        
        // 3. Lấy cấu hình miễn phạt
        const { data: exemptData } = await supabase.from('SystemConfigs').select('value').eq('key', 'ktv_continuous_work_exempt_hours').single();
        const exemptHours = exemptData?.value ? Number(exemptData.value) : 4;
        
        const isExempted = totalMins >= (exemptHours * 60);

        // 4. Thực hiện phạt (hoặc miễn phạt nếu đạt)
        //
        // Loại D KHÔNG dùng hệ điểm kỷ luật của A/B/C. Quy chế loại D: từ chối
        // tua đã gán → trừ GẤP 3 LẦN thời lượng gói dịch vụ vào giờ tích lũy
        // (gói 60 phút → trừ 3 giờ). Hàm deductOrderReject() có sẵn từ lâu
        // nhưng chưa nơi nào gọi, nên luật này chưa từng được áp dụng.
        let disciplineResult: any = null;
        let hoursDeducted = 0;

        let accountLocked = false;

        // Ngưỡng miễn phạt theo giờ làm liên tục thuộc hệ ĐIỂM CHUYÊN CẦN của
        // A/B/C. Loại D không dùng hệ đó — quy chế loại D chỉ có giờ tích lũy và
        // hạn mức tối thiểu, nên làm liên tục bao lâu cũng không miễn được.
        if (isTypeD) {
            const { KtvTypeDDisciplineService } = await import('@/lib/services/KtvTypeDDisciplineService');

            // Công tắc TẮT thì tắt TOÀN BỘ: không chặn cửa, không trừ giờ, không
            // khoá tài khoản. Làm nửa vời — vẫn chặn nhưng không phạt — thì công
            // tắc lại nói dối một lần nữa, đúng thứ đang đi sửa.
            if (await KtvTypeDDisciplineService.isEnabled(supabase)) {
                const { data: item } = await supabase
                    .from('BookingItems').select('serviceId, segments').eq('id', itemId).maybeSingle();

                // Thời lượng gói: ưu tiên phút đã gán cho chính KTV này, không
                // có thì lấy thời lượng chuẩn của dịch vụ.
                let mins = 0;
                try {
                    const segs = typeof item?.segments === 'string' ? JSON.parse(item.segments) : (item?.segments || []);
                    for (const sg of (Array.isArray(segs) ? segs : [])) {
                        if (sg?.ktvId && String(sg.ktvId).toLowerCase() === String(staffId).toLowerCase()) {
                            mins += Number(sg.duration) || 0;
                        }
                    }
                } catch { /* dùng thời lượng chuẩn bên dưới */ }

                if (mins <= 0 && item?.serviceId) {
                    const { data: svc } = await supabase
                        .from('Services').select('duration').eq('id', item.serviceId).maybeSingle();
                    mins = Number(svc?.duration) || 60;
                }
                if (mins <= 0) mins = 60;

                const { getBusinessToday } = await import('@/lib/business-date');
                const workDate = await getBusinessToday(supabase);

                // ─── Cửa chặn: quỹ giờ phải còn trên hạn mức tối thiểu ───
                //
                // Quy chế: muốn từ chối tua thì quỹ giờ tích lũy THÁNG phải LỚN HƠN
                // `minHours` (mặc định 3 giờ) tại thời điểm bấm — bằng đúng hạn mức
                // là chưa được. Đây là cửa vào, không phải mức sàn: trừ phạt xong
                // tụt xuống dưới hạn mức vẫn được, nhưng lần từ chối sau bị chặn.
                //
                // Dưới hạn mức mà vẫn từ chối thì quỹ gần như không còn gì để trừ,
                // nên chế tài chuyển thành KHOÁ TÀI KHOẢN.
                //
                // Lần gọi đầu chỉ CẢNH BÁO rồi dừng; KTV đọc xong, muốn tiếp thì
                // gọi lại với confirmLock. Không tự khoá sau một cú chạm nhầm.
                const multiplier = await KtvTypeDDisciplineService.getRejectMultiplier(supabase);
                const minHours = await KtvTypeDDisciplineService.getMinHoursToReject(supabase);
                const penaltyHours = Math.round((mins / 60) * multiplier * 100) / 100;

                // Cùng nguồn với ô "Thời gian" trên dashboard KTV và với thứ tự nhận
                // tua — KTV nhìn số nào thì bị chặn theo đúng số đó.
                const { KtvTypeDTurnService } = await import('@/lib/services/KtvTypeDTurnService');
                const now = new Date();
                const netMap = await KtvTypeDTurnService.getMonthlyNetHours(
                    supabase, [staffId], now.getMonth() + 1, now.getFullYear());
                const availableHours = Math.round((netMap[staffId] || 0) * 100) / 100;

                const notEnough = minHours > 0 && availableHours <= minHours;

                if (notEnough && !confirmLock) {
                    return NextResponse.json({
                        success: false,
                        needsLockConfirm: true,
                        minHours,
                        availableHours,
                        penaltyHours,
                        multiplier,
                        serviceMins: mins,
                        error: `Quỹ giờ phải NHIỀU HƠN ${minHours} giờ mới được từ chối tua, hiện chỉ còn ${availableHours} giờ.`,
                    });
                }

                hoursDeducted = await KtvTypeDDisciplineService.deductOrderReject(
                    supabase, staffId, workDate, itemId, mins, undefined, multiplier,
                );
                console.log(`[Type D] ${staffId} từ chối tua ${bookingItemId} (${mins}p) → trừ ${hoursDeducted}h`);

                if (notEnough) {
                    await supabase.from('Staff').update({ status: 'KHÓA_TÀI_KHOẢN' }).eq('id', staffId);
                    const lyDo = `Từ chối tua khi quỹ giờ chỉ còn ${availableHours} giờ, không vượt hạn mức tối thiểu ${minHours} giờ`;
                    await KtvTypeDDisciplineService.markAccountLock(supabase, staffId, workDate, lyDo);
                    await supabase.from('SecurityAuditLogs').insert({
                        employee_id: staffId,
                        employee_name: staffData?.full_name || staffId,
                        event_type: 'AUTO_LOCK_REJECT_NO_HOURS',
                        ip_address: '127.0.0.1',
                        user_agent: 'API',
                        details: { source: 'REJECT_ORDER', bookingItemId: itemId, minHours, availableHours, penaltyHours, reason },
                    });
                    // Tin cá nhân gửi chính chủ. Quầy vẫn biết chuyện qua tin
                    // KTV_REJECT_ORDER bắn ngay sau đó ở cuối route này.
                    await supabase.from('StaffNotifications').insert({
                        employeeId: staffId,
                        type: 'ACCOUNT_LOCK',
                        message: `Tài khoản của bạn đã bị khoá: ${lyDo}.`,
                    });
                    accountLocked = true;
                    console.warn(`[Type D] KHOÁ TÀI KHOẢN ${staffId} — ${lyDo}`);
                }
            }
        } else {
            disciplineResult = await KtvDisciplineService.deductPoints(
                supabase,
                staffId,
                'ORDER_REJECT',
                `Từ chối nhận đơn ${bookingItemId} - Lý do: ${reason}`,
                isExempted
            );
        }

        // 5. Gỡ KTV khỏi BookingItem và TurnQueue
        // Lấy BookingItem hiện tại
        const { data: itemData } = await supabase
            .from('BookingItems').select('technicianCodes, status, options').eq('id', itemId).maybeSingle();
        if (itemData && itemData.technicianCodes) {
            // So khớp KHÔNG phân biệt hoa thường — chỗ tra đơn phía trên cũng vậy.
            // Trước đây so bằng `!==` thuần: lệch một chữ hoa là không gỡ được, KTV
            // từ chối xong vẫn dính đơn.
            const me = String(staffId).toLowerCase();
            const newTechCodes = itemData.technicianCodes.filter((id: string) => String(id).toLowerCase() !== me);
            // Nếu không còn KTV nào thì đưa về PREPARING để Lễ tân điều phối lại
            const newStatus = newTechCodes.length === 0 ? 'PREPARING' : itemData.status;

            // Xoá mốc "đã nhận đơn" CỦA RIÊNG người từ chối. Không xoá thì lúc quầy
            // điều phối lại chính đơn này cho họ, màn KTV coi như đã xác nhận rồi và
            // bỏ luôn bước nhận/từ chối. Mốc của đồng nghiệp giữ nguyên.
            const opts = typeof (itemData as any).options === 'string'
                ? JSON.parse((itemData as any).options || '{}')
                : ((itemData as any).options || {});
            const acceptedByStaff = { ...(opts.acceptedByStaff || {}) };
            delete acceptedByStaff[String(staffId).toUpperCase()];
            const nextOpts: Record<string, any> = { ...opts, acceptedByStaff };
            if (String(nextOpts.acceptedBy || '').toLowerCase() === me) {
                delete nextOpts.acceptedAt;
                delete nextOpts.acceptedBy;
            }

            await supabase.from('BookingItems').update({ 
                technicianCodes: newTechCodes,
                status: newStatus,
                options: nextOpts
            }).eq('id', itemId);
        }

        // Cập nhật TurnQueue của KTV này (gỡ đơn đang làm)
        const { getBusinessToday } = await import('@/lib/business-date');
        const dateStr = await getBusinessToday(supabase);
        const { data: turnData } = await supabase.from('TurnQueue')
            .select('id, booking_item_ids')
            .eq('employee_id', staffId)
            .eq('date', dateStr)
            .single();

        if (turnData) {
            let newBookingItemIds = turnData.booking_item_ids || [];
            if (newBookingItemIds.includes(itemId)) {
                newBookingItemIds = newBookingItemIds.filter((id: string) => id !== itemId);
            }
            
            await supabase.from('TurnQueue').update({
                current_order_id: newBookingItemIds.length > 0 ? newBookingItemIds[0] : null,
                booking_item_ids: newBookingItemIds,
                status: newBookingItemIds.length > 0 ? 'assigned' : 'waiting'
            }).eq('id', turnData.id);
        }

        // 6. Gửi thông báo cho Lễ tân
        //
        // Type PHẢI có rule trong SystemConfigs.notification_rules. Trước đây dùng
        // 'WARNING' — type không có rule — mà mọi bộ lọc trong NotificationProvider
        // đều là `if (rule && ...)`, nên thông báo lọt qua hết và phát cho TẤT CẢ
        // vai trò: một KTV từ chối thì cả spa cùng nhận.
        const { data: bookingRow } = await supabase
            .from('BookingItems').select('bookingId').eq('id', itemId).maybeSingle();
        const { data: bk } = (bookingRow as any)?.bookingId
            ? await supabase.from('Bookings').select('billCode').eq('id', (bookingRow as any).bookingId).maybeSingle()
            : { data: null };
        const billLabel = (bk as any)?.billCode || itemId;

        await supabase.from('StaffNotifications').insert({
            employeeId: null,           // không nhắm riêng ai — lọc theo vai trò
            type: 'KTV_REJECT_ORDER',
            message: `⛔ KTV ${staffName} vừa TỪ CHỐI đơn ${billLabel}. Lý do: ${reason}`,
            bookingId: (bookingRow as any)?.bookingId || null,
        });

        return NextResponse.json({
            success: true,
            // Loại D không có cơ chế miễn phạt — luôn trả false để màn KTV không
            // hiện thông báo "bạn được miễn phạt" sai sự thật.
            isExempted: isTypeD ? false : isExempted,
            // Loại D trừ GIỜ tích lũy, A/B/C trừ ĐIỂM kỷ luật — hai hệ khác nhau.
            hoursDeducted: isTypeD ? hoursDeducted : 0,
            penaltyPoints: disciplineResult?.penaltyPoints ?? 0,
            newTotal: disciplineResult?.newTotal ?? null,
            totalMins,
            accountLocked
        });

    } catch (error: any) {
        console.error('Lỗi API reject order:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
