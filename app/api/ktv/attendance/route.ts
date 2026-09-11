import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { AttendanceSchema } from '@/lib/schemas/ktv.schema';
import { createNotification } from '@/lib/notification-helper';
import { KtvOnlineService } from '@/lib/services/KtvOnlineService';
import { KtvTypeDOnlineService } from '@/lib/services/KtvTypeDOnlineService';
import { KtvTypeDDisciplineService } from '@/lib/services/KtvTypeDDisciplineService';
import sharp from 'sharp';
import { requireActiveStaff } from '@/lib/auth-server';
import { WalletAccessService } from '@/lib/services/WalletAccessService';
import { FEATURE_MAINTENANCE_MESSAGE } from '@/lib/constants/featureMaintenance.i18n';

// 🔧 CONFIG
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;



export async function POST(request: Request) {
    try {
        const lockedError = await requireActiveStaff();
        if (lockedError) return lockedError;

        const body = await request.json();
        const parseResult = AttendanceSchema.safeParse(body);
        
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        
        const { 
            employeeId, 
            employeeName: empNameInput, 
            checkType, 
            latitude, 
            longitude, 
            locationText, 
            photoBase64, 
            reason, 
            selectedShiftType, 
            estimatedEndTime, 
            wantsToWithdraw 
        } = parseResult.data;

        // Lấy IP của người dùng từ headers
        const forwardedFor = request.headers.get('x-forwarded-for');
        const realIp = request.headers.get('x-real-ip');
        const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || 'unknown');

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase not initialized' }, { status: 500 });
        }

        // ─── Step 0: Resolve Staff Code and Real Name ─────────────
        const { data: userData, error: userError } = await supabase
            .from('Users')
            .select('code, fullName, role')
            .eq('id', employeeId)
            .single();

        if (userError || !userData) {
            console.error('❌ [Attendance] User lookup error:', userError);
            return NextResponse.json({ success: false, error: 'Không tìm thấy thông tin nhân viên' }, { status: 404 });
        }

        const staffCode = userData.code; // Mã như NH016
        // Fallback: nếu không có mã thì dùng tên tạm, nhưng ưu tiên Mã NV theo yêu cầu
        const displayName = staffCode || userData.fullName || empNameInput || 'KTV';

        // Lấy thông tin Staff để biết work_type (Loại A hay Loại B)
        const { data: staffData } = await supabase
            .from('Staff')
            .select('work_type')
            .eq('id', staffCode)
            .maybeSingle();
        const isTypeB = staffData?.work_type === 'TYPE_B';

        const { data: configData, error: configError } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'spa_wifi_ips')
            .single();

        // Nếu có cấu hình dải IP (dạng array) thì mới kiểm tra
        if (!configError && configData?.value && Array.isArray(configData.value) && configData.value.length > 0) {
            const allowedIps: string[] = configData.value.map((item: any) => typeof item === 'string' ? item : item.ip).filter(Boolean);
            // Compare by first 2 octets only (e.g. "14.191") to tolerate dynamic IP changes within the same network
            const getIpPrefix = (ip: string) => ip.split('.').slice(0, 2).join('.');
            const clientPrefix = getIpPrefix(clientIp);
            const allowedPrefixes = [...new Set(allowedIps.map(getIpPrefix))];
            // Cho phép localhost (cho môi trường dev) hoặc IP prefix phải nằm trong dải cấu hình
            if (clientIp !== '::1' && clientIp !== '127.0.0.1' && clientIp !== 'unknown') {
                if (checkType !== 'SUDDEN_OFF' && !allowedPrefixes.includes(clientPrefix)) {
                    console.error(`❌ [Attendance] IP prefix mismatch: clientIp=${clientIp} (prefix=${clientPrefix}), allowedPrefixes=${allowedPrefixes}`);
                    
                    // LOG TO SECURITY AUDIT LOGS & SYSTEM CONFIG
                    const rejectedName = displayName || staffCode || employeeId;
                    try {
                        const userAgent = request.headers.get('user-agent') || 'unknown';
                        await supabase.from('SecurityAuditLogs').insert({
                            employee_id: employeeId,
                            employee_name: rejectedName,
                            event_type: 'INVALID_WIFI_IP',
                            ip_address: clientIp,
                            user_agent: userAgent,
                            details: { checkType, expected_prefixes: allowedPrefixes }
                        });
                        
                        // Upsert vào SystemConfigs để hiển thị trên UI Quản lý Wi-Fi của Admin/Quầy
                        await supabase.from('SystemConfigs').upsert({
                            key: 'spa_wifi_last_rejected_ip',
                            value: { ip: clientIp, name: rejectedName, time: new Date().toISOString() }
                        }, { onConflict: 'key' });
                    } catch (e) {
                        console.error('Lỗi khi lưu SecurityAuditLog / SystemConfigs:', e);
                    }

                    return NextResponse.json({ 
                        success: false, 
                        error: `Vui lòng kết nối vào mạng Wi-Fi của Spa để điểm danh! (IP của bạn: ${clientIp})` 
                    }, { status: 403 });
                }
            }
        }

        // ─── Step 0.5: Check pending tasks before checkout ─────────────
        if (checkType === 'CHECK_OUT' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT') {
            const { data: staffRow } = await supabase
                .from('Staff')
                .select('work_type')
                .eq('id', staffCode)
                .single();

            let shouldBlock = false;
            if (staffRow?.work_type) {
                const { data: config } = await supabase
                    .from('SystemConfigs')
                    .select('value')
                    .eq('key', `block_checkout_incomplete_tasks_${staffRow.work_type}`)
                    .maybeSingle();
                shouldBlock = !!config?.value;
            }

            if (shouldBlock) {
                const nowUtc = new Date();
                const vnNow = new Date(nowUtc.getTime() + VN_OFFSET_MS);
                const vnDateStr = vnNow.toISOString().slice(0, 10);
                const todayStartIso = new Date(`${vnDateStr}T00:00:00+07:00`).toISOString();

                const { data: incompleteTasks, error: taskErr } = await supabase
                    .from('Tasks')
                    .select('id')
                    .eq('assignee_id', staffCode)
                    .gte('created_at', todayStartIso)
                    .neq('inspection_status', 'PASSED');

                if (incompleteTasks && incompleteTasks.length > 0) {
                    return NextResponse.json({ 
                        success: false, 
                        error: `Bạn còn ${incompleteTasks.length} công việc trong ngày chưa được Admin nghiệm thu. Vui lòng hoàn thành và chờ Admin xác nhận trước khi tan ca!` 
                    }, { status: 403 });
                }
            }

            // Validation riêng cho TYPE_D khi checkout
            if (staffRow?.work_type === 'TYPE_D') {
                const { isGuestArrivalEnabled } = await import('@/lib/guest-arrival.logic');
                const isEnabled = await isGuestArrivalEnabled(supabase);
                
                if (isEnabled) {
                    const { data: activeLock } = await supabase
                        .from('GuestArrivalEvents')
                        .select('id, note')
                        .is('released_at', null)
                        .maybeSingle();

                    if (activeLock) {
                        const { hasPendingDispatch } = await import('@/lib/guest-arrival.logic');
                        const isPending = await hasPendingDispatch(supabase);
                        
                        if (isPending) {
                            return NextResponse.json({ 
                                success: false, 
                                error: activeLock.note || 'Quầy vừa báo có khách. Vui lòng giữ máy, chưa thể tan ca lúc này.'
                            }, { status: 403 });
                        } else {
                            const { vnNow } = await import('@/lib/vn-time');
                            await supabase
                                .from('GuestArrivalEvents')
                                .update({ released_at: vnNow().toISOString(), released_by: 'AUTO' })
                                .eq('id', activeLock.id);
                        }
                    }
                }
            }
        }

        // ─── Step 0.6: Validation for TYPE_D (Check In) ─────────────
        const { data: staffTypeData } = await supabase.from('Staff').select('work_type').eq('id', staffCode).maybeSingle();
        const workType = staffTypeData?.work_type;
        const isTypeD = workType === 'TYPE_D';

        if (isTypeD && (checkType === 'CHECK_IN' || checkType === 'LATE_CHECKIN')) {
            const { vnNow } = await import('@/lib/vn-time');
            const { format } = await import('date-fns');
            // Ngày phạt phải theo NGÀY LÀM VIỆC (cutoff), không phải ngày lịch —
            // để khớp với sổ giờ tích lũy khi trừ giờ.
            const { getBusinessToday } = await import('@/lib/business-date');
            const todayStr = await getBusinessToday(supabase);
            const { data: registration } = await supabase
                .from('KTVTypeDDailyRegistration')
                .select('id, status, expected_time, late_expected_time')
                .eq('staff_id', staffCode)
                .eq('work_date', todayStr)
                .single();

            if (registration && registration.status === 'OFF_REGISTERED') {
                await supabase.from('KTVTypeDDailyRegistration')
                  .update({ status: 'REGISTERED', expected_time: format(vnNow(), 'HH:mm') })
                  .eq('id', registration.id);
            }

            // Phạt trễ (§4.4 - đã chốt 2026-09-08):
            //  - LATE_REPORTED: so với late_expected_time (giờ đã báo trễ)
            //  - REGISTERED  : so với expected_time (giờ đăng ký gốc) — đến trễ mà KHÔNG báo
            if (registration) {
                const now = vnNow();
                const actualMinutes = now.getHours() * 60 + now.getMinutes();
                let deadline: string | null = null;
                let noteContext = '';

                if (registration.status === 'LATE_REPORTED' && registration.late_expected_time) {
                    deadline = registration.late_expected_time;
                    noteContext = `Trễ hơn giờ đã báo trễ (${deadline})`;
                } else if (registration.status === 'REGISTERED' && registration.expected_time) {
                    deadline = registration.expected_time;
                    noteContext = `Đến trễ không báo — đăng ký ${String(deadline).slice(0, 5)}`;
                }

                if (deadline) {
                    const [h, m] = String(deadline).split(':').map(Number);
                    const expectedMinutes = h * 60 + m;
                    if (actualMinutes > expectedMinutes) {
                        await KtvTypeDDisciplineService.deductDailyViolation(
                          supabase, staffCode, todayStr, 'LATE_NO_UPDATE', noteContext
                        );
                    }
                }
            }
        }


        // ─── Step 1: Prepare Watermark Info ─────────────
        const nowUtc = new Date();
        const nowVn = new Date(nowUtc.getTime() + VN_OFFSET_MS);
        const dateStr = nowVn.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); // 15 Apr 2026
        const timeStr = nowVn.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        
        // ─── Step 2: Upload Photo if exists ────────────
        let photoUrl = null;
        if (photoBase64) {
            try {
                const processImage = async (base64Str: string, index?: number) => {
                    const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, "");
                    let buffer: any = Buffer.from(base64Data, 'base64');
                    const fileExt = base64Str.match(/^data:image\/(\w+);base64,/)?.[1] || 'jpg';
                    const fileName = `${staffCode || 'UNKNOWN'}_${Date.now()}${index !== undefined ? `_${index}` : ''}.${fileExt}`;


                    
                    const { data: uploadData, error: uploadError } = await supabase.storage
                        .from('attendance')
                        .upload(fileName, buffer as any, {
                            contentType: `image/${fileExt}`,
                            upsert: false
                        });
                        
                    if (uploadError) {
                        console.error(`❌ [Attendance] Photo upload error:`, uploadError);
                        return null;
                    } else if (uploadData?.path) {
                        const { data: publicUrlData } = supabase.storage.from('attendance').getPublicUrl(uploadData.path);
                        return publicUrlData.publicUrl;
                    }
                    return null;
                };

                if (Array.isArray(photoBase64)) {
                    const urls: string[] = [];
                    for (let i = 0; i < photoBase64.length; i++) {
                        const url = await processImage(photoBase64[i], i);
                        if (url) urls.push(url);
                    }
                    if (urls.length > 0) photoUrl = JSON.stringify(urls);
                } else {
                    photoUrl = await processImage(photoBase64);
                }
            } catch (err) {
                 console.error('❌ [Attendance] Image processing error:', err);
            }
        }

        // ─── Step 3: Auto-Approve Logic ─────────────────
        // Chỉnh sửa: Spa có chính sách "thoáng", mọi yêu cầu điểm danh, xin đi trễ, nghỉ đột xuất đều được đồng ý tự động
        const isAutoApprove = true;
        const finalStatus = 'CONFIRMED';

        // Fetch day cutoff to determine the exact Business Date
        const { data: cutoffConfig } = await supabase
            .from('SystemConfigs')
            .select('value')
            .eq('key', 'spa_day_cutoff_hours')
            .maybeSingle();
        
        const cutoffHours = (cutoffConfig?.value != null) ? Number(cutoffConfig.value) : 6;
        
        // Calculate Business Date based on cutoff
        const businessNow = new Date(nowVn.getTime() - cutoffHours * 60 * 60 * 1000);
        const today = businessNow.toISOString().split('T')[0];

        const { data: record, error: insertError } = await supabase
            .from('KTVAttendance')
            .insert({
                employeeId,
                employeeName: displayName, // Chống dùng Tên => Dùng Mã NV
                date: today,
                checkType,
                latitude: latitude ?? null,
                longitude: longitude ?? null,
                locationText: locationText ?? null,
                photoUrl: photoUrl,
                reason: reason ?? null,
                estimatedEndTime: estimatedEndTime ?? null,
                is_live_capture: parseResult.data.isLiveCapture,
                status: finalStatus,
                confirmedBy: isAutoApprove ? 'SYSTEM' : null,
                confirmedAt: isAutoApprove ? nowUtc.toISOString() : null,
            })
            .select()
            .single();

        if (insertError) {
            return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
        }

        // ─── Step 4: TurnQueue & User Shift Update (if auto-approved) ─────
        if (isAutoApprove) {
            if (isTypeB) {
                if (checkType === 'CHECK_IN' || checkType === 'LATE_CHECKIN') {
                    const res = await KtvOnlineService.arriveAtVenue(supabase, staffCode);
                    if (!res.success) {
                        return NextResponse.json({ success: false, error: res.error }, { status: 500 });
                    }
                } else if (checkType === 'CHECK_OUT' || checkType === 'SUDDEN_OFF' || checkType === 'OFF_REQUEST') {
                    const res = await KtvOnlineService.goOffline(supabase, staffCode);
                    if (!res.success) {
                        return NextResponse.json({ success: false, error: res.error }, { status: 500 });
                    }

                    // Ghi nhận "Nghỉ đột xuất" vào bảng Lịch OFF (KTVLeaveRequests) theo đúng Business Date
                    if (checkType === 'SUDDEN_OFF' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT') {
                        const leaveReason = reason || (checkType === 'SUDDEN_OFF' ? 'Xin nghỉ đột xuất ngay đầu ca' : 'Tan ca sớm (Nghỉ đột xuất)');
                        const { error: leaveErr } = await supabase.from('KTVLeaveRequests').insert({
                            employeeId,
                            employeeName: displayName,
                            date: today, // Sử dụng Business Date chuẩn
                            reason: leaveReason,
                            status: 'APPROVED',
                            is_sudden_off: true,
                            is_extension: false,
                        });
                        if (leaveErr) console.error('❌ [KTVLeaveRequests] Insert Error:', leaveErr);
                    }
                }
            } else if (isTypeD) {
                if (checkType === 'CHECK_IN' || checkType === 'LATE_CHECKIN') {
                    const res = await KtvTypeDOnlineService.arriveAtVenue(supabase, staffCode);
                    if (!res.success) {
                        return NextResponse.json({ success: false, error: res.error }, { status: 500 });
                    }
                } else if (checkType === 'CHECK_OUT' || checkType === 'SUDDEN_OFF' || checkType === 'OFF_REQUEST') {
                    // KHÔNG đóng KTVShifts ở đây. Bảng này lưu BẢN PHÂN CA, không lưu buổi làm việc.
                    // status ACTIVE = phân ca đang hiệu lực, phải giữ qua ngày.
                    // Set COMPLETED sẽ làm ca biến mất khỏi /api/ktv/shift và bảng lương
                    // (cả hai đều lọc .in('status', ['ACTIVE','REPLACED'])).

                    // Go offline AFTER closing shift
                    const res = await KtvTypeDOnlineService.goOffline(supabase, staffCode);
                    if (!res.success) {
                        return NextResponse.json({ success: false, error: res.error }, { status: 500 });
                    }

                    if (checkType === 'SUDDEN_OFF' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT') {
                        const leaveReason = reason || (checkType === 'SUDDEN_OFF' ? 'Xin nghỉ đột xuất ngay đầu ca' : 'Tan ca sớm (Nghỉ đột xuất)');
                        const { error: leaveErr } = await supabase.from('KTVLeaveRequests').insert({
                            employeeId,
                            employeeName: displayName,
                            date: today,
                            reason: leaveReason,
                            status: 'APPROVED',
                            is_sudden_off: true,
                            is_extension: false,
                        });
                        if (leaveErr) console.error('❌ [KTVLeaveRequests] Insert Error:', leaveErr);
                    }
                }
            } else {
                if (checkType === 'CHECK_IN' || checkType === 'LATE_CHECKIN') {
                    // 🔹 Tự động tắt trạng thái nhận đơn ngoài giờ (nếu có)
                    if (staffCode) {
                        await KtvOnlineService.goOffline(supabase, staffCode);
                    }
                    
                    // 🔹 Active shift for User
                    await supabase.from('Users').update({ isOnShift: true }).eq('id', employeeId);

                    // 🔹 Update KTVShifts if selectedShiftType is provided (Tạm thời cho hôm nay)
                    if (selectedShiftType) {
                        const { data: currentActive } = await supabase
                            .from('KTVShifts')
                            .select('shiftType')
                            .eq('employeeId', employeeId)
                            .eq('status', 'ACTIVE')
                            .maybeSingle();

                        if (currentActive?.shiftType !== selectedShiftType) {
                            if (currentActive) {
                                const { error: oldErr } = await supabase
                                    .from('KTVShifts')
                                    .update({ status: 'REPLACED' })
                                    .eq('employeeId', employeeId)
                                    .eq('status', 'ACTIVE');
                                
                                if (oldErr) {
                                    console.error('[attendance/route] KTVShifts close old shift failed:', oldErr.message, oldErr.code);
                                }
                            }

                            const { error: newErr } = await supabase
                                .from('KTVShifts')
                                .insert({
                                    employeeId,
                                    employeeName: displayName,
                                    shiftType: selectedShiftType,
                                    effectiveFrom: today,
                                    previousShift: currentActive?.shiftType || null,
                                    reason: 'Tự chọn ca lúc điểm danh',
                                    estimatedEndTime: estimatedEndTime ?? null,
                                    status: 'ACTIVE',
                                    reviewedBy: 'SYSTEM',
                                    reviewedAt: nowUtc.toISOString(),
                                });
                            
                            if (newErr) {
                                console.error('[attendance/route] KTVShifts insert failed:', newErr.message, newErr.code);
                                return NextResponse.json({ success: false, error: 'Không thể tạo ca làm việc mới.' }, { status: 500 });
                            }
                        }
                    }

                    if (staffCode && userData.role === 'TECHNICIAN') {
                        // 🔹 UPSERT into TurnQueue (using staffCode)
                        // 🔹 Check if KTV is already in TurnQueue today
                        const { data: existingTurn } = await supabase
                            .from('TurnQueue')
                            .select('id, status')
                            .eq('employee_id', staffCode)
                            .eq('date', today)
                            .maybeSingle();

                        if (existingTurn) {
                            // Đã tồn tại trong hàng đợi
                            // Nếu đang 'off' (vd: xin nghỉ đột xuất rồi quay lại điểm danh) thì đổi thành waiting
                            if (existingTurn.status === 'off') {
                                await supabase
                                    .from('TurnQueue')
                                    .update({ status: 'waiting' })
                                    .eq('id', existingTurn.id);
                            }
                        } else {
                            // Chưa có, cấp vị trí mới
                            const { data: maxPosRow } = await supabase
                                .from('TurnQueue')
                                .select('queue_position')
                                .eq('date', today)
                                .order('queue_position', { ascending: false })
                                .limit(1)
                                .maybeSingle();

                            const { data: maxCheckInRow } = await supabase
                                .from('TurnQueue')
                                .select('check_in_order')
                                .eq('date', today)
                                .order('check_in_order', { ascending: false })
                                .limit(1)
                                .maybeSingle();

                            const nextPosition = (maxPosRow?.queue_position ?? 0) + 1;
                            const nextCheckIn = (maxCheckInRow?.check_in_order ?? 0) + 1;

                            const { error: turnQueueError } = await supabase
                                .from('TurnQueue')
                                .insert({
                                    employee_id: staffCode,
                                    date: today,
                                    queue_position: nextPosition,
                                    check_in_order: nextCheckIn,
                                    status: 'waiting',
                                    turns_completed: 0,
                                });

                            if (turnQueueError) {
                                console.error('❌ [TurnQueue Insert Error]:', turnQueueError);
                            }
                        }
                    }
                } else if (checkType === 'CHECK_OUT' || checkType === 'SUDDEN_OFF' || checkType === 'OFF_REQUEST') {
                    // 🔸 Deactivate shift for User
                    await supabase.from('Users').update({ isOnShift: false }).eq('id', employeeId);

                    // KHÔNG đóng KTVShifts ở đây. Bảng này lưu BẢN PHÂN CA, không lưu buổi làm việc.
                    // status ACTIVE = phân ca đang hiệu lực, phải giữ qua ngày.
                    // Set COMPLETED sẽ làm ca biến mất khỏi /api/ktv/shift và bảng lương
                    // (cả hai đều lọc .in('status', ['ACTIVE','REPLACED'])).

                    if (staffCode && userData.role === 'TECHNICIAN') {
                        // 🔸 Set status = off trong TurnQueue (hiển thị mờ ở cuối danh sách màu xám)
                        await supabase
                            .from('TurnQueue')
                            .upsert({ 
                                employee_id: staffCode, 
                                date: today, 
                                status: 'off' 
                            }, { onConflict: 'employee_id,date' });

                        // 🔸 KHÔNG ĐỤNG ĐẾN is_active_vip_menu (cờ này do Quầy quản lý thủ công)
                    }
                    
                    // 🔸 Ghi nhận "Nghỉ đột xuất" vào bảng Lịch OFF (KTVLeaveRequests) theo đúng Business Date
                    if (checkType === 'SUDDEN_OFF' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT') {
                        const leaveReason = reason || (checkType === 'SUDDEN_OFF' ? 'Xin nghỉ đột xuất ngay đầu ca' : 'Tan ca sớm (Nghỉ đột xuất)');
                        const { error: leaveErr } = await supabase.from('KTVLeaveRequests').insert({
                            employeeId,
                            employeeName: displayName,
                            date: today, // Sử dụng Business Date chuẩn
                            reason: leaveReason,
                            status: 'APPROVED',
                            is_sudden_off: true,
                            is_extension: false,
                        });
                        if (leaveErr) console.error('❌ [KTVLeaveRequests] Insert Error:', leaveErr);
                    }
                } else if (checkType === 'OVERTIME') {
                    if (estimatedEndTime) {
                        await supabase
                            .from('KTVShifts')
                            .update({ estimatedEndTime })
                            .eq('employeeId', employeeId)
                            .eq('status', 'ACTIVE');
                    }
                }
            }
        }

        // ─── Step 4.5: Feature-Flagged Deductions (Giặt đồ & Phạt nghỉ ĐX) ────
        if (isAutoApprove && staffCode) {
            try {
                // Fetch feature_flags for this KTV
                const { data: staffRow } = await supabase
                    .from('Staff')
                    .select('feature_flags, work_type')
                    .eq('id', staffCode)
                    .maybeSingle();

                const featureFlags = (staffRow?.feature_flags || {}) as Record<string, boolean>;
                const workType = staffRow?.work_type || 'TYPE_A';

                // 🧦 Laundry Deduction: on CHECK_IN / LATE_CHECKIN, once per day
                if ((checkType === 'CHECK_IN' || checkType === 'LATE_CHECKIN') && featureFlags.laundry_deduction === true) {
                    // Fetch laundry_fee from SystemConfigs
                    const { data: laundryConf } = await supabase
                        .from('SystemConfigs')
                        .select('value')
                        .eq('key', 'laundry_fee')
                        .maybeSingle();
                    const laundryFee = Number(String(laundryConf?.value || '20000').replace(/"/g, ''));

                    // Một lần cho mỗi NGÀY LÀM VIỆC — nhận diện bằng chính chuỗi
                    // lý do, vì nó đã mang sẵn ngày làm việc.
                    //
                    // ⚠️ Trước đây dò bằng `reason ILIKE 'Giặt đồ ngày%'` (khớp
                    // BẤT KỲ ngày nào) trong cửa sổ `created_at` của NGÀY LỊCH
                    // `today`. Mà `today` là ngày LÀM VIỆC (cutoff 6h), nên hai
                    // thứ lệch nhau mỗi khi KTV điểm danh sau nửa đêm — loại D
                    // làm ca đêm nên chuyện này có thật:
                    //
                    //   · BỎ SÓT: T001 điểm danh 09/09 00:11 → dòng "ngày 08/09"
                    //     nhưng created_at nằm ngày 09/09. Hôm sau điểm danh
                    //     ngày làm việc 09/09, cửa sổ 09/09 thấy đúng dòng đó
                    //     rồi tưởng đã trừ → quán mất 20k.
                    //   · TRỪ HAI LẦN: nếu lần điểm danh ĐẦU của ngày làm việc X
                    //     rơi sau nửa đêm, dòng vừa ghi nằm ngoài cửa sổ của
                    //     chính nó; lần điểm danh kế tiếp trong cùng ngày làm
                    //     việc sẽ trừ thêm một lần nữa.
                    const laundryReason = `Giặt đồ ngày ${today.split('-').reverse().join('/')}`;
                    const { data: existingLaundry } = await supabase
                        .from('WalletAdjustments')
                        .select('id')
                        .eq('staff_id', staffCode)
                        .eq('type', 'PENALTY')
                        .eq('reason', laundryReason)
                        .limit(1);

                    if (!existingLaundry || existingLaundry.length === 0) {
                        const { error: laundryErr } = await supabase
                            .from('WalletAdjustments')
                            .insert({
                                staff_id: staffCode,
                                amount: -Math.abs(laundryFee),
                                type: 'PENALTY',
                                reason: laundryReason,
                                created_by: 'SYSTEM',
                                work_type_snapshot: workType,
                            });
                        if (laundryErr) console.error('❌ [Laundry Deduction] Insert Error:', laundryErr);
                        else console.log(`🧦 [Laundry] Trừ ${laundryFee}đ cho ${staffCode} ngày ${today}`);
                    }
                }

                // ⚠️ Sudden Leave Penalty: on SUDDEN_OFF or SUDDEN_OFF_CHECKOUT
                if ((checkType === 'SUDDEN_OFF' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT') && featureFlags.sudden_leave_penalty === true) {
                    if (workType === 'TYPE_D') {
                        try {
                            const { KtvTypeDDisciplineService } = await import('@/lib/services/KtvTypeDDisciplineService');
                            await KtvTypeDDisciplineService.deductDailyViolation(supabase, staffCode, today, 'ABSENT_NO_NOTICE', 'Nghỉ đột xuất');
                            console.log(`⚠️ [Penalty D] Trừ 10 giờ cho ${staffCode} ngày ${today}`);
                        } catch (e) {
                            console.error('❌ [Penalty D] Error:', e);
                        }
                    } else {
                        // Fetch penalty amount from SystemConfigs
                        const { data: penaltyConf } = await supabase
                            .from('SystemConfigs')
                            .select('value')
                            .eq('key', 'ktv_sudden_off_penalty')
                            .maybeSingle();
                        const penaltyAmount = Number(String(penaltyConf?.value || '500000').replace(/"/g, ''));

                        const { error: penaltyErr } = await supabase
                            .from('WalletAdjustments')
                            .insert({
                                staff_id: staffCode,
                                amount: -Math.abs(penaltyAmount),
                                type: 'PENALTY',
                                reason: `Phạt nghỉ đột xuất ngày ${today.split('-').reverse().join('/')}`,
                                created_by: 'SYSTEM',
                                work_type_snapshot: workType,
                            });
                        if (penaltyErr) console.error('❌ [Sudden Off Penalty] Insert Error:', penaltyErr);
                        else console.log(`⚠️ [Penalty] Trừ ${penaltyAmount}đ cho ${staffCode} ngày ${today}`);
                    }
                }
            } catch (deductionErr) {
                // Non-blocking: log error but don't fail the attendance request
                console.error('❌ [Feature Deductions] Error:', deductionErr);
            }
        }

        // ─── Step 5: Notifications ──────────────────────
        const mapsLink = latitude && longitude
            ? ` — https://maps.google.com/?q=${latitude},${longitude}`
            : '';

        let actionText = 'yêu cầu điểm danh';
        if (checkType === 'CHECK_OUT') {
            actionText = selectedShiftType === 'SUDDEN_OFF_CHECKOUT' ? 'vừa bấm TAN CA SỚM (Ghi nhận là Nghỉ đột xuất)' : 'yêu cầu tan ca';
        }
        else if (checkType === 'LATE_CHECKIN') actionText = 'điểm danh bổ sung';
        else if (checkType === 'OFF_REQUEST') actionText = 'gửi yêu cầu OFF';
        else if (checkType === 'SUDDEN_OFF') actionText = 'xin NGHỈ ĐỘT XUẤT nguyên ngày hôm nay';
        else if (checkType === 'OVERTIME') actionText = `đăng ký làm thêm giờ đến ${estimatedEndTime}`;

        const autoSuffix = isAutoApprove ? ' [AUTO]' : '';
        
        let notifMessage = `📍 ${displayName} ${actionText}${mapsLink} [AID:${record.id}]${autoSuffix}`;

        // The withdrawal intent is a TUA-wallet action. With the TUA wallet
        // switched off (per-staff flag or type-wide switch) it used to go
        // through anyway and the cashier got "chuẩn bị tiền mặt". Now: skip the
        // intent, keep the check-in itself successful, and tell the KTV.
        let withdrawIntentBlocked = false;
        if (wantsToWithdraw && staffCode) {
            const { ok } = await WalletAccessService.isEnabled(supabase, staffCode, 'TUA');
            withdrawIntentBlocked = !ok;
        }

        if (wantsToWithdraw && staffCode && !withdrawIntentBlocked) {
            notifMessage += `\n💰 Báo Thu ngân chuẩn bị tiền mặt.`;
            
            // Chỉ là TÍN HIỆU báo Thu ngân chuẩn bị tiền mặt, không phải số tiền.
            // `intent_date` + unique index đảm bảo mỗi KTV chỉ báo 1 lần/ngày —
            // trước đây tan ca rồi điểm danh lại là tích được lần nữa (T016 từng
            // tích 3 lần trong ngày 02/09).
            const { error: withdrawErr } = await supabase.from('KTVWithdrawals').insert({
                staff_id: staffCode,
                amount: 1, // Dùng số 1 thay vì 0 để vượt qua CHECK constraint KTVWithdrawals_amount_check
                status: 'PENDING',
                note: 'Báo trước lúc điểm danh (Chưa chốt số tiền)',
                wallet_type: 'TUA',
                intent_date: today,
            });
            if (withdrawErr) {
                if (withdrawErr.code === '23505') {
                    console.log(`[Withdrawal Intent] ${staffCode} đã báo rút tiền hôm nay rồi — bỏ qua.`);
                } else {
                    console.error('❌ [Withdrawal Intent] Insert Error:', withdrawErr);
                }
            }
        }

        await createNotification({
            type: 'ATTENDANCE_REQUEST',
            message: notifMessage,
        });

        // ─── Step 5b: Báo lại cho chính KTV ─────────────────────────────
        // `ATTENDANCE_RESPONSE` xưa nay chỉ được tạo ở route `attendance/confirm`
        // — nơi Admin bấm duyệt tay. Nhưng Step 3 đã chốt cứng `isAutoApprove =
        // true`, nên route đó không bao giờ chạy: từ trước tới nay bảng
        // StaffNotifications KHÔNG có lấy một dòng ATTENDANCE_RESPONSE nào, và
        // KTV bấm tan ca xong không nhận được xác nhận gì cả — im lặng y như
        // lúc bấm hụt. Giờ tự duyệt thì tự báo luôn tại đây.
        if (isAutoApprove) {
            let confirmText = 'Đã ghi nhận điểm danh của bạn';
            if (checkType === 'CHECK_OUT') {
                confirmText = selectedShiftType === 'SUDDEN_OFF_CHECKOUT'
                    ? 'Đã ghi nhận tan ca sớm (tính là nghỉ đột xuất)'
                    : 'Đã ghi nhận tan ca của bạn';
            }
            else if (checkType === 'LATE_CHECKIN') confirmText = 'Đã ghi nhận điểm danh bổ sung của bạn';
            else if (checkType === 'OFF_REQUEST') confirmText = 'Đã ghi nhận yêu cầu OFF của bạn';
            else if (checkType === 'SUDDEN_OFF') confirmText = 'Đã ghi nhận yêu cầu nghỉ đột xuất của bạn';
            else if (checkType === 'OVERTIME') confirmText = `Đã ghi nhận đăng ký làm thêm giờ đến ${estimatedEndTime}`;

            await createNotification({
                type: 'ATTENDANCE_RESPONSE',
                message: `✅ ${confirmText}.`,
                employeeId: staffCode || employeeId,
            });
        }

        return NextResponse.json({
            success: true,
            data: record,
            status: finalStatus,
            ...(withdrawIntentBlocked
                ? { withdrawIntentBlocked: true, withdrawIntentMessage: FEATURE_MAINTENANCE_MESSAGE }
                : {}),
        });

    } catch (error: any) {
        console.error('❌ [Attendance POST] Unhandled error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
