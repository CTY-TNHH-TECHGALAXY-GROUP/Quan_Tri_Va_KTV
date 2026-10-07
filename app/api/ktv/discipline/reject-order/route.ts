import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvDisciplineService } from '@/lib/services/KtvDisciplineService';
import { ktvDisplayLabel } from '@/lib/constants/staff.constants';
import { requireActiveStaff, requireStaffMatches } from '@/lib/auth-server';
import { ktvAssignedMinutes, parseKtvSegments, parseKtvOptions, isLiveKtvSegment } from '@/lib/ktvUtils';
import { resolveMyItems, idsOf } from '@/lib/services/KtvOrderTargetService';

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
        // Dịch vụ đã GHÉP đi theo dịch vụ cha: từ chối là gỡ cả cụm. Gỡ mỗi cái
        // cha thì cái con vẫn dính tên KTV, coi như từ chối mà chưa từ chối.
        const affectedIds: string[] = idsOf(resolved.items[0]);

        // 1. Lấy thông tin KTV
        const { data: staffData } = await supabase.from('Staff').select('full_name, work_type').eq('id', staffId).single();
        // Loại A/B/D hiện MÃ để khớp bảng điều phối; loại C ("Nhập tay") mới hiện tên.
        const staffName = ktvDisplayLabel(staffData?.work_type, staffId, staffData?.full_name);
        const isTypeD = staffData?.work_type === 'TYPE_D';

        // Rejecting is only for work the KTV has not started. Check BEFORE any penalty:
        // a started segment keeps real hours and must go through reception's swap/stop.
        const { data: affectedRows, error: affectedError } = await supabase
            .from('BookingItems').select('id, bookingId, segments, technicianCodes, status, options').in('id', affectedIds);
        if (affectedError || !affectedRows?.length) throw affectedError || new Error('Không đọc được dịch vụ.');
        const startedMine = affectedRows.some(row => parseKtvSegments(row.segments).some(seg =>
            isLiveKtvSegment(seg, staffId) && (seg.actualStartTime || seg.actualEndTime)));
        if (startedMine) {
            return NextResponse.json({ success: false,
                error: 'Dịch vụ đã bắt đầu, không thể từ chối. Nhờ quầy đổi KTV hoặc dừng dịch vụ.' }, { status: 409 });
        }

        // Release runs BEFORE the penalty, so a failed release (reception just edited the
        // order) never charges the KTV for an order they still hold.
        let released = false;
        const releaseFromOrder = async (): Promise<NextResponse | null> => {
            if (released) return null;
            const failed = await releaseRejectedItems(supabase, affectedRows, staffId, staffName);
            if (failed) return NextResponse.json({ success: false, error: failed }, { status: 409 });
            released = true;
            return null;
        };

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
                const { data: item, error: itemError } = await supabase
                    .from('BookingItems').select('serviceId, segments').eq('id', itemId).maybeSingle();
                if (itemError || !item) throw itemError || new Error('Không đọc được phân công.');

                const segments = parseKtvSegments(item?.segments, true);
                if (segments.length && !segments.some(seg => isLiveKtvSegment(seg, staffId))) {
                    return NextResponse.json({ success: false, error: 'Lượt phân công đã thay đổi; tải lại trước khi từ chối.' }, { status: 409 });
                }
                let fallback = 60;
                if (!segments.length && item?.serviceId) {
                    const { data: svc, error: svcError } = await supabase
                        .from('Services').select('duration').eq('id', item.serviceId).maybeSingle();
                    if (svcError) throw svcError;
                    fallback = Number(svc?.duration) || 60;
                }
                const mins = ktvAssignedMinutes(item, staffId, fallback);
                if (mins <= 0) return NextResponse.json({ success: false, error: 'Thời lượng lượt phân công chưa hợp lệ; báo quầy kiểm tra.' }, { status: 409 });

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

                const releaseError = await releaseFromOrder();
                if (releaseError) return releaseError;
                hoursDeducted = await KtvTypeDDisciplineService.deductOrderReject(
                    supabase, staffId, workDate, itemId, mins, undefined, multiplier,
                );
                console.log(`[Type D] ${staffId} từ chối tua ${bookingItemId} (${mins}p) → trừ ${hoursDeducted}h`);

                if (notEnough) {
                    await supabase.from('Staff').update({ status: 'KHÓA_TÀI_KHOẢN' }).eq('id', staffId);
                    // Câu này KTV đọc ở màn đăng nhập, nên viết ngắn và không
                    // bày số. Con số chi tiết (`minHours`, `availableHours`) vẫn
                    // nằm đủ trong SecurityAuditLogs ngay bên dưới — quản lý cần
                    // tra thì có, còn người bị khoá không cần nhìn phép tính.
                    const lyDo = 'Từ chối tua khi không đủ giờ khả dụng';
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
                        message: `Tài khoản đã bị khoá. Lý do: ${lyDo}. Liên hệ admin Oria Spa để mở lại.`,
                    });
                    accountLocked = true;
                    console.warn(`[Type D] KHOÁ TÀI KHOẢN ${staffId} — ${lyDo}`);
                }
            }
        } else {
            const releaseError = await releaseFromOrder();
            if (releaseError) return releaseError;
            disciplineResult = await KtvDisciplineService.deductPoints(
                supabase,
                staffId,
                'ORDER_REJECT',
                `Từ chối nhận đơn ${bookingItemId} - Lý do: ${reason}`,
                isExempted
            );
        }

        // 5. Gỡ KTV khỏi dịch vụ (khi chưa gỡ ở bước phạt — VD loại D đang tắt chế tài).
        const releaseError = await releaseFromOrder();
        if (releaseError) return releaseError;

        // TurnQueue: RPC gỡ phân công đã tự đẩy đơn kế tiếp. Chỉ còn dọn dòng vẫn
        // trỏ vào đơn vừa từ chối (VD KTV còn phân công ACTIVE khác nên RPC không đụng).
        // `current_order_id` là id ĐƠN — trước 02/10/2026 chỗ này ghi nhầm id dịch vụ.
        const { getBusinessToday } = await import('@/lib/business-date');
        const dateStr = await getBusinessToday(supabase);
        const rejectedBookingIds = [...new Set(affectedRows.map(r => r.bookingId).filter(Boolean))];
        const { data: turnRows } = await supabase.from('TurnQueue')
            .select('id, status, current_order_id, booking_item_ids')
            .eq('employee_id', staffId).eq('date', dateStr);
        for (const turn of (turnRows || []) as any[]) {
            const pointsHere = rejectedBookingIds.includes(turn.current_order_id) || affectedIds.includes(turn.current_order_id);
            const remaining = (turn.booking_item_ids || []).filter((id: string) => !affectedIds.includes(id));
            if (!pointsHere && remaining.length === (turn.booking_item_ids || []).length) continue;
            if (remaining.length > 0 && pointsHere) {
                const { data: next } = await supabase.from('BookingItems').select('bookingId').eq('id', remaining[0]).maybeSingle();
                await supabase.from('TurnQueue').update({ current_order_id: next?.bookingId || null,
                    booking_item_id: remaining[0], booking_item_ids: remaining }).eq('id', turn.id);
            } else if (remaining.length > 0) {
                await supabase.from('TurnQueue').update({ booking_item_ids: remaining }).eq('id', turn.id);
            } else {
                await supabase.from('TurnQueue').update({
                    status: turn.status === 'off' ? 'off' : 'waiting',
                    current_order_id: null, booking_item_id: null, booking_item_ids: [],
                    room_id: null, bed_id: null, start_time: null, estimated_end_time: null,
                }).eq('id', turn.id);
                await supabase.rpc('promote_next_assignment', { p_employee_id: staffId, p_business_date: dateStr });
            }
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

const sameCode = (a: unknown, b: unknown) =>
    String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Gỡ KTV từ chối khỏi từng dịch vụ bị ảnh hưởng. Trả câu lỗi cho KTV, hoặc null khi xong.
 *
 * Dịch vụ có chặng của KTV → dùng chung RPC "bỏ phân công" của quầy
 * (`dispatch_unassign_unstarted_staff`, `p_reject=true`): void chặng, huỷ
 * KtvAssignments, đẩy phân công kế tiếp, xoá mốc "đã nhận đơn" — trong một
 * transaction. Khác quầy bỏ phân công: từ chối vẫn giữ tua (TurnLedger).
 * Trước 02/10/2026 route chỉ gỡ `technicianCodes` nên chặng, phân công ACTIVE
 * và hàng đợi vẫn trỏ về KTV — đơn kẹt, không nhận được đơn khác.
 *
 * Dịch vụ con đã GHÉP (không có chặng riêng) → chỉ gỡ tên và phân công.
 */
async function releaseRejectedItems(
    supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
    rows: any[], staffId: string, staffName: string,
): Promise<string | null> {
    const actor = { id: staffId, name: staffName, verified: true, source: 'KTV_REJECT_ORDER' };
    for (const row of rows) {
        const mine = parseKtvSegments(row.segments).find(seg => isLiveKtvSegment(seg, staffId));
        if (mine) {
            const revision = Number(parseKtvOptions(row.options).dispatchRevision || 0);
            const { error } = await supabase.rpc('dispatch_unassign_unstarted_staff', {
                p_booking_id: row.bookingId, p_item_id: row.id, p_ktv_id: mine.ktvId,
                p_expected_revision: revision, p_actor: actor, p_reject: true,
            });
            if (error) {
                console.error('[reject-order] unassign failed', { itemId: row.id, staffId, error });
                return /bản lưu mới|chuyển trạng thái/.test(error.message || '')
                    ? 'Quầy vừa cập nhật đơn này; tải lại rồi thử lại.'
                    : (error.message || 'Chưa gỡ được phân công; tải lại rồi thử lại.');
            }
            continue;
        }
        const codes: string[] = row.technicianCodes || [];
        if (!codes.some(code => sameCode(code, staffId))) continue;
        const opts = parseKtvOptions(row.options);
        const acceptedByStaff = { ...(opts.acceptedByStaff || {}) };
        for (const key of Object.keys(acceptedByStaff)) if (sameCode(key, staffId)) delete acceptedByStaff[key];
        const nextOpts: Record<string, any> = { ...opts, acceptedByStaff };
        if (sameCode(nextOpts.acceptedBy, staffId)) { delete nextOpts.acceptedAt; delete nextOpts.acceptedBy; }
        const nextCodes = codes.filter(code => !sameCode(code, staffId));
        const { error } = await supabase.from('BookingItems').update({ technicianCodes: nextCodes,
            status: nextCodes.length === 0 ? 'WAITING' : row.status, options: nextOpts }).eq('id', row.id);
        if (error) return 'Chưa gỡ được phân công; tải lại rồi thử lại.';
        await supabase.from('KtvAssignments').update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
            .eq('booking_item_id', row.id).eq('employee_id', staffId).in('status', ['ACTIVE', 'QUEUED', 'READY']);
    }
    return null;
}
