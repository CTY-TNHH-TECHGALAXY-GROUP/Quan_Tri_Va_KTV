import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { createNotification } from '@/lib/notification-helper';

// 🔧 SHIFT CONFIGURATION
const SHIFT_TYPES = {
    SHIFT_1: { label: 'Ca 1', start: '09:00', end: '17:00' },
    SHIFT_2: { label: 'Ca 2', start: '11:00', end: '19:00' },
    SHIFT_3: { label: 'Ca 3', start: '17:00', end: '00:00' },
    FREE: { label: 'Ca tự do', start: '00:00', end: '23:59' },
    REQUEST: { label: 'Làm khách yêu cầu', start: '00:00', end: '23:59' },
} as const;

/**
 * GET /api/ktv/shift
 * Fetch shift data.
 * Query params:
 *   ?employeeId=xxx  — Get current shift for a specific KTV
 *   ?all=true        — Get all shifts (admin overview)
 *   ?pending=true    — Get only pending shift change requests
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        const { searchParams } = new URL(request.url);
        const employeeId = searchParams.get('employeeId');
        const all = searchParams.get('all');
        const pending = searchParams.get('pending');
        const targetDate = searchParams.get('date');

        // ─── Lấy cấu hình ngày lễ để đè ca 2 ───
        let isHolidayOverride = false;
        try {
            let vnDateStr = '';
            if (targetDate) {
                // targetDate format: YYYY-MM-DD
                vnDateStr = targetDate.slice(5, 10); // MM-DD
            } else {
                const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
                vnDateStr = vnNow.toISOString().slice(5, 10); // Lấy MM-DD
            }
            
            const { data: configData } = await supabase
                .from('SystemConfigs')
                .select('value')
                .eq('key', 'holiday_shift2_dates')
                .maybeSingle();
            
            const holidayDates = configData?.value || ['04-30', '09-02', '12-31']; // Fallback
            if (Array.isArray(holidayDates) && holidayDates.includes(vnDateStr)) {
                isHolidayOverride = true;
            }
        } catch (err) {
            console.error('❌ [Shift GET] Lỗi kiểm tra ngày lễ:', err);
        }

        if (pending === 'true') {
            // Fetch only pending shift change requests (for admin)
            const { data, error } = await supabase
                .from('KTVShifts')
                .select('*')
                .eq('status', 'PENDING')
                .order('createdAt', { ascending: false });

            if (error) {
                console.error('❌ [Shift GET] Pending query error:', error);
                return NextResponse.json({ success: false, error: error.message }, { status: 500 });
            }

            return NextResponse.json({ success: true, data: data || [], shiftTypes: SHIFT_TYPES });
        }

        // ─── Lấy ngày Business Hôm Nay ───
        const { data: configCutoff } = await supabase.from('SystemConfigs').select('value').eq('key', 'spa_day_cutoff_hours').maybeSingle();
        const cutoffHours = (configCutoff?.value != null) ? Number(configCutoff.value) : 6;
        const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const businessNow = new Date(vnNow.getTime() - cutoffHours * 60 * 60 * 1000);
        const businessDateStr = businessNow.toISOString().slice(0, 10);
        
        const fetchDate = targetDate || businessDateStr;

        if (all === 'true') {
            // Fetch ALL shifts (ACTIVE + REPLACED) that started on or before the fetchDate
            const { data, error } = await supabase
                .from('KTVShifts')
                .select('*')
                .lte('effectiveFrom', fetchDate)
                .in('status', ['ACTIVE', 'REPLACED'])
                .order('createdAt', { ascending: false }); // Newest first

            if (error) {
                console.error('❌ [Shift GET] All query error:', error);
                return NextResponse.json({ success: false, error: error.message }, { status: 500 });
            }

            // ─── LỌC CA THEO NGÀY (Lịch sử + Tự động khôi phục ca tạm thời) ───
            const dedupMap = new Map<string, typeof data[0]>();

            // Lọc ưu tiên: lấy các ca ACTIVE trước, sau đó đến REPLACED
            const sortedData = (data || []).sort((a, b) => {
                if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
                if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
                // Nếu cùng status, ưu tiên theo thời gian tạo mới nhất
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });

            for (const shift of sortedData) {
                // Tự động dọn dẹp (revert) ca tạm thời trong DB nếu nó đang ACTIVE và đã qua ngày hôm nay
                const isTempShift = shift.reason === 'Tự chọn ca lúc điểm danh';
                
                if (shift.status === 'ACTIVE' && isTempShift && shift.effectiveFrom < businessDateStr) {
                    await supabase.from('KTVShifts').update({ status: 'REPLACED' }).eq('id', shift.id);
                    await supabase.from('KTVShifts').insert({
                        employeeId: shift.employeeId,
                        employeeName: shift.employeeName,
                        shiftType: shift.previousShift || 'SHIFT_1',
                        effectiveFrom: businessDateStr,
                        previousShift: shift.shiftType,
                        reason: 'Khôi phục ca gốc sau điểm danh',
                        status: 'ACTIVE',
                        reviewedBy: 'SYSTEM',
                        reviewedAt: new Date().toISOString()
                    });
                    console.log(`✅ [Shift] Auto-reverted expired temp shift for ${shift.employeeId}`);
                    
                    // Cập nhật virtual state để hiển thị ngay
                    shift.shiftType = shift.previousShift || 'SHIFT_1';
                    shift.reason = 'Khôi phục ca gốc sau điểm danh';
                    shift.effectiveFrom = businessDateStr;
                }

                // Nếu chưa có trong map, đây là bản ghi mới nhất (đã ưu tiên ACTIVE) trước hoặc bằng fetchDate
                if (!dedupMap.has(shift.employeeId)) {
                    const isTempShift = shift.reason === 'Tự chọn ca lúc điểm danh';
                    const isExpiredForTarget = isTempShift && shift.effectiveFrom < fetchDate;

                    if (isExpiredForTarget) {
                        // Trả về ca gốc ảo nếu ca tạm thời không áp dụng cho ngày đang xem
                        dedupMap.set(shift.employeeId, {
                            ...shift,
                            shiftType: shift.previousShift || 'SHIFT_1',
                            reason: 'Khôi phục ca gốc',
                            effectiveFrom: fetchDate
                        });
                    } else {
                        dedupMap.set(shift.employeeId, shift);
                    }
                }
            }

            // Đè ca làm việc nếu là ngày lễ
            const holidayApplied = Array.from(dedupMap.values()).map(shift => {
                if (isHolidayOverride) {
                    return { ...shift, shiftType: 'SHIFT_2' };
                }
                return shift;
            });

            // 🔧 Filter bỏ nhân viên đã nghỉ việc
            const { data: activeStaff } = await supabase
                .from('Staff')
                .select('id')
                .eq('status', 'ĐANG LÀM');
            const activeStaffIds = new Set(activeStaff?.map(s => s.id) || []);

            const finalData = holidayApplied
                .filter(s => activeStaffIds.has(s.employeeId))
                .sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));

            return NextResponse.json({ success: true, data: finalData, shiftTypes: SHIFT_TYPES });
        }

        if (employeeId) {
            const tomorrow = new Date(businessNow.getTime() + 24 * 60 * 60 * 1000);
            const tomorrowStr = tomorrow.toISOString().slice(0, 10);

            // Fetch current active shift + history for a specific KTV
            let { data: allShifts, error: activeError } = await supabase
                .from('KTVShifts')
                .select('*')
                .eq('employeeId', employeeId)
                .lte('effectiveFrom', tomorrowStr)
                .in('status', ['ACTIVE', 'REPLACED'])
                .order('effectiveFrom', { ascending: false })
                .order('createdAt', { ascending: false });

            if (activeError) {
                console.error('❌ [Shift GET] Active shift query error:', activeError);
            }

            let activeShift = null;
            let tomorrowShift = null;

            if (allShifts && allShifts.length > 0) {
                // Ca cho ngày mai là ca ACTIVE có hiệu lực <= tomorrowStr
                tomorrowShift = allShifts.find(s => s.status === 'ACTIVE') || allShifts[0];

                // Ca cho hôm nay là ca có hiệu lực <= businessDateStr
                const shiftsToday = allShifts.filter(s => s.effectiveFrom <= businessDateStr);
                if (shiftsToday.length > 0) {
                    activeShift = shiftsToday.find(s => s.status === 'ACTIVE') || shiftsToday[0];
                }
            }

            // Tự động dọn dẹp (revert) ca tạm thời trong DB nếu nó đang ACTIVE và đã qua ngày hôm nay
            if (activeShift && activeShift.status === 'ACTIVE') {
                const isTempShift = activeShift.reason === 'Tự chọn ca lúc điểm danh';
                if (isTempShift && activeShift.effectiveFrom < businessDateStr) {
                    await supabase.from('KTVShifts').update({ status: 'REPLACED' }).eq('id', activeShift.id);
                    
                    const { data: newShift } = await supabase.from('KTVShifts').insert({
                        employeeId: activeShift.employeeId,
                        employeeName: activeShift.employeeName,
                        shiftType: activeShift.previousShift || 'SHIFT_1',
                        effectiveFrom: businessDateStr,
                        previousShift: activeShift.shiftType,
                        reason: 'Khôi phục ca gốc sau điểm danh',
                        status: 'ACTIVE',
                        reviewedBy: 'SYSTEM',
                        reviewedAt: new Date().toISOString()
                    }).select().single();

                    if (newShift) {
                        activeShift = newShift;
                        console.log(`✅ [Shift] Auto-reverted expired temp shift for ${employeeId} on personal fetch`);
                    }
                }
            }

            // Also fetch pending request if any
            const { data: pendingShift } = await supabase
                .from('KTVShifts')
                .select('*')
                .eq('employeeId', employeeId)
                .eq('status', 'PENDING')
                .maybeSingle();

            // Fetch recent history (last 10 changes)
            const { data: history } = await supabase
                .from('KTVShifts')
                .select('*')
                .eq('employeeId', employeeId)
                .in('status', ['ACTIVE', 'APPROVED', 'REJECTED', 'REPLACED'])
                .not('previousShift', 'is', null) // Chỉ lấy các bản ghi thực sự là hành động ĐỔI CA
                .order('createdAt', { ascending: false })
                .limit(10);

            // Đè ca làm việc nếu là ngày lễ
            let currentShift = activeShift || null;
            let computedTomorrowShift = tomorrowShift || null;

            if (isHolidayOverride) {
                currentShift = currentShift ? { ...currentShift, shiftType: 'SHIFT_2' } : {
                    id: 'holiday-override',
                    employeeId,
                    shiftType: 'SHIFT_2',
                    status: 'ACTIVE',
                    reason: 'Tự động áp dụng ngày Lễ',
                    effectiveFrom: businessDateStr
                };
                
                // Giả định ngày lễ cũng đè lên ca ngày mai nếu ngày mai cũng là ngày lễ (tạm thời áp dụng cho hôm nay)
                // Để đơn giản, ta chỉ đổi ca hôm nay theo isHolidayOverride.
            }

            // Cut-off time is already calculated at the top as businessDateStr

            // Fetch OFF status for today
            const { data: offData } = await supabase
                .from('KTVLeaveRequests')
                .select('id')
                .eq('employeeId', employeeId)
                .eq('date', businessDateStr)
                .in('status', ['APPROVED', 'PENDING']);

            const isOffToday = offData && offData.length > 0 ? true : false;

            return NextResponse.json({
                success: true,
                data: {
                    currentShift,
                    tomorrowShift: computedTomorrowShift,
                    pendingRequest: pendingShift || null,
                    history: history || [],
                    isOffToday
                },
                shiftTypes: SHIFT_TYPES,
            });
        }

        return NextResponse.json({ success: false, error: 'Missing employeeId or all param' }, { status: 400 });
    } catch (error: any) {
        console.error('❌ [Shift GET] Unhandled error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

/**
 * POST /api/ktv/shift
 * Create a shift assignment or shift change request.
 * Body: { employeeId, employeeName, shiftType, reason?, assignedByAdmin? }
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { employeeId, employeeName, shiftType, reason, assignedByAdmin, adminId, estimatedEndTime } = body;

        if (!employeeId || !shiftType) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields: employeeId, shiftType' },
                { status: 400 }
            );
        }

        if (!['SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'FREE', 'REQUEST'].includes(shiftType)) {
            return NextResponse.json(
                { success: false, error: 'Invalid shiftType. Must be SHIFT_1, SHIFT_2, SHIFT_3, FREE, or REQUEST' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        // Check for existing pending request
        const { data: existingPending } = await supabase
            .from('KTVShifts')
            .select('id')
            .eq('employeeId', employeeId)
            .eq('status', 'PENDING')
            .maybeSingle();

        if (existingPending && !assignedByAdmin) {
            return NextResponse.json(
                { success: false, error: 'Bạn đã có yêu cầu đổi ca đang chờ duyệt.' },
                { status: 409 }
            );
        }

        // Get current active shift
        const { data: currentActive } = await supabase
            .from('KTVShifts')
            .select('shiftType')
            .eq('employeeId', employeeId)
            .eq('status', 'ACTIVE')
            .maybeSingle();

        if (assignedByAdmin) {
            // Admin assigns directly — mark old as REPLACED, create new ACTIVE
            if (currentActive) {
                await supabase
                    .from('KTVShifts')
                    .update({ status: 'REPLACED' })
                    .eq('employeeId', employeeId)
                    .eq('status', 'ACTIVE');
            }

            const { data: record, error: insertError } = await supabase
                .from('KTVShifts')
                .insert({
                    employeeId,
                    employeeName: employeeName || employeeId,
                    shiftType,
                    effectiveFrom: new Date().toISOString().split('T')[0],
                    previousShift: currentActive?.shiftType || null,
                    reason: reason || 'Admin gán ca',
                    estimatedEndTime: estimatedEndTime || null,
                    status: 'ACTIVE',
                    reviewedBy: adminId || null,
                    reviewedAt: new Date().toISOString(),
                })
                .select()
                .single();

            if (insertError) {
                console.error('❌ [Shift POST] Admin insert error:', insertError);
                return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
            }

            // Notify KTV
            const shiftLabel = SHIFT_TYPES[shiftType as keyof typeof SHIFT_TYPES]?.label || shiftType;
            await createNotification({
                type: 'SHIFT_RESPONSE',
                message: `📋 Bạn đã được gán ${shiftLabel} (${SHIFT_TYPES[shiftType as keyof typeof SHIFT_TYPES]?.start} - ${SHIFT_TYPES[shiftType as keyof typeof SHIFT_TYPES]?.end}).`,
                employeeId,
            });

            console.log(`✅ [Shift] Admin assigned ${shiftLabel} to ${employeeName || employeeId}`);
            return NextResponse.json({ success: true, data: record });
        }

        // KTV requests shift change — AUTO APPROVE (no admin review needed)
        if (currentActive?.shiftType === shiftType) {
            return NextResponse.json(
                { success: false, error: 'Bạn đang ở ca này rồi.' },
                { status: 400 }
            );
        }

        const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const tomorrow = new Date(vnNow.getTime() + 24 * 60 * 60 * 1000);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        // 1. Mark old ACTIVE shift as REPLACED
        if (currentActive) {
            await supabase
                .from('KTVShifts')
                .update({ status: 'REPLACED' })
                .eq('employeeId', employeeId)
                .eq('status', 'ACTIVE');
        }

        // 2. Insert new shift as ACTIVE directly (auto-approved)
        const { data: record, error: insertError } = await supabase
            .from('KTVShifts')
            .insert({
                employeeId,
                employeeName: employeeName || employeeId,
                shiftType,
                effectiveFrom: tomorrowStr,
                previousShift: currentActive?.shiftType || null,
                reason: reason || 'Đổi ca từ ngày mai',
                estimatedEndTime: estimatedEndTime || null,
                status: 'ACTIVE',
                reviewedAt: new Date().toISOString(),
            })
            .select()
            .single();

        if (insertError) {
            console.error('❌ [Shift POST] KTV insert error:', insertError);
            return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
        }

        // Notify about shift change (informational)
        const shiftLabel = SHIFT_TYPES[shiftType as keyof typeof SHIFT_TYPES]?.label || shiftType;
        const prevLabel = currentActive?.shiftType
            ? SHIFT_TYPES[currentActive.shiftType as keyof typeof SHIFT_TYPES]?.label
            : 'Chưa có';
        
        await createNotification({
            type: 'SHIFT_CHANGE',
            message: `📋 ${employeeName || employeeId} đã đổi ca: ${prevLabel} → ${shiftLabel}`,
        });

        console.log(`✅ [Shift] ${employeeName} changed shift to ${shiftLabel} (auto-approved)`);
        return NextResponse.json({ success: true, data: record });

    } catch (error: any) {
        console.error('❌ [Shift POST] Unhandled error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

/**
 * PATCH /api/ktv/shift
 * Admin approves or rejects a shift change request.
 * Body: { shiftId, action: 'APPROVE' | 'REJECT', adminId? }
 */
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { shiftId, action, adminId } = body;

        if (!shiftId || !action) {
            return NextResponse.json({ success: false, error: 'Missing shiftId or action' }, { status: 400 });
        }
        if (!['APPROVE', 'REJECT'].includes(action)) {
            return NextResponse.json({ success: false, error: 'action must be APPROVE or REJECT' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        // Fetch the pending request
        const { data: shiftReq, error: fetchError } = await supabase
            .from('KTVShifts')
            .select('*')
            .eq('id', shiftId)
            .eq('status', 'PENDING')
            .maybeSingle();

        if (fetchError || !shiftReq) {
            return NextResponse.json({ success: false, error: 'Shift request not found or already processed' }, { status: 404 });
        }

        if (action === 'APPROVE') {
            // 1. Mark old ACTIVE shift as REPLACED
            await supabase
                .from('KTVShifts')
                .update({ status: 'REPLACED' })
                .eq('employeeId', shiftReq.employeeId)
                .eq('status', 'ACTIVE');

            // 2. Mark this request as ACTIVE (approved and now effective)
            const { error: updateError } = await supabase
                .from('KTVShifts')
                .update({
                    status: 'ACTIVE',
                    effectiveFrom: new Date().toISOString().split('T')[0],
                    reviewedBy: adminId || null,
                    reviewedAt: new Date().toISOString(),
                })
                .eq('id', shiftId);

            if (updateError) {
                console.error('❌ [Shift PATCH] Approve error:', updateError);
                return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
            }

            // Notify KTV
            const shiftLabel = SHIFT_TYPES[shiftReq.shiftType as keyof typeof SHIFT_TYPES]?.label || shiftReq.shiftType;
            await createNotification({
                type: 'SHIFT_RESPONSE',
                message: `✅ Yêu cầu đổi sang ${shiftLabel} đã được duyệt!`,
                employeeId: shiftReq.employeeId,
            });

            console.log(`✅ [Shift PATCH] APPROVED: ${shiftReq.employeeName} → ${shiftLabel}`);
        } else {
            // REJECT
            const { error: updateError } = await supabase
                .from('KTVShifts')
                .update({
                    status: 'REJECTED',
                    reviewedBy: adminId || null,
                    reviewedAt: new Date().toISOString(),
                })
                .eq('id', shiftId);

            if (updateError) {
                console.error('❌ [Shift PATCH] Reject error:', updateError);
                return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
            }

            // Notify KTV
            const shiftLabel = SHIFT_TYPES[shiftReq.shiftType as keyof typeof SHIFT_TYPES]?.label || shiftReq.shiftType;
            await createNotification({
                type: 'SHIFT_RESPONSE',
                message: `❌ Yêu cầu đổi sang ${shiftLabel} đã bị từ chối.`,
                employeeId: shiftReq.employeeId,
            });

            console.log(`✅ [Shift PATCH] REJECTED: ${shiftReq.employeeName} → ${shiftLabel}`);
        }

        return NextResponse.json({ success: true, action });

    } catch (error: any) {
        console.error('❌ [Shift PATCH] Unhandled error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
