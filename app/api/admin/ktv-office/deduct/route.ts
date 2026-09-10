import { NextResponse } from 'next/server';
import { requirePermission, requireBusinessUser } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { vnDate } from '@/lib/vn-time';
import { createNotification } from '@/lib/notification-helper';
import { getBusinessToday, shiftBusinessDate } from '@/lib/business-date';
import { isOfficeManager } from '@/lib/services/KtvOfficeScoreService';
import {
    resolvePhotosPerCriteria, resolveNotesPerCriteria, buildDeductRows, MAX_PHOTOS_PER_CRITERIA,
} from '@/lib/services/KtvOfficeEvidenceService';
import { workdayEvidence, evidenceLabel } from '@/lib/services/KtvOfficeWorkdayService';

export const dynamic = 'force-dynamic';


const MAX_PHOTOS = 5;

/**
 * "Hôm nay" và "hôm qua" của trang chấm điểm phải là NGÀY LÀM VIỆC (mốc cắt
 * 06:00), không phải ngày lịch.
 *
 * Spa chạy qua nửa đêm. Ca đêm 04/09 kết thúc lúc 01:30 ngày 05/09 vẫn thuộc
 * ngày làm việc 04/09 — `KTVAttendance.date` và sổ cái tua đều ghi như vậy.
 * Nếu chỗ này lấy ngày lịch thì mọi phiếu trừ trong khung 00:00–06:00 rơi sang
 * 05/09: mẫu số "số ngày đi làm" của điểm tháng mọc thêm một ngày ma, ngày làm
 * thật thì hiện sạch 100đ, và luật "mỗi lỗi chỉ trừ 1 lần/ngày" bị lách được —
 * trừ lúc 23:00 rồi trừ lại đúng lỗi đó lúc 01:00 cùng ca vẫn lọt.
 */
async function officeToday(supabase: any): Promise<string> {
    return getBusinessToday(supabase);
}

/**
 * Đẩy ảnh minh chứng lên bucket `attendance` và trả về link công khai.
 * Ném lỗi nếu có ảnh hỏng — thà dừng còn hơn ghi phiếu thiếu bằng chứng.
 */
async function uploadEvidence(
    supabase: any,
    staffId: string,
    workDate: string,
    photos: string[]
): Promise<string[]> {
    const urls: string[] = [];
    for (let i = 0; i < photos.length; i++) {
        const raw = photos[i];
        if (typeof raw !== 'string' || !raw.startsWith('data:image/')) continue;
        const ext = raw.match(/^data:image\/(\w+);base64,/)?.[1] || 'jpg';
        const buffer = Buffer.from(raw.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const path = `office-evidence/${staffId}/${workDate}/${Date.now()}_${i}.${ext}`;

        const { data: up, error: upErr } = await supabase.storage
            .from('attendance')
            .upload(path, buffer as any, { contentType: `image/${ext}`, upsert: false });
        if (upErr) {
            console.error('❌ [Office] Lỗi upload ảnh minh chứng:', upErr);
            throw new Error('Không tải được ảnh minh chứng lên. Vui lòng thử lại.');
        }
        const { data: pub } = supabase.storage.from('attendance').getPublicUrl(up.path);
        urls.push(pub.publicUrl);
    }
    return urls;
}

/**
 * Các lỗi ĐÃ trừ của 1 KTV trong 1 ngày — để sheet chấm điểm hiện sẵn dấu tích
 * và khoá lại, thay vì để người chấm bấm rồi mới báo lỗi trùng.
 */
export async function GET(request: Request) {
    try {
        await requirePermission('ktv_office_scoring');

        const { searchParams } = new URL(request.url);
        const staffId = searchParams.get('staffId');
        const workDate = searchParams.get('workDate');
        if (!staffId || !workDate || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
            return NextResponse.json({ success: false, error: 'Thiếu staffId hoặc workDate.' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        const { data, error } = await supabase
            .from('KTVOfficeScoreLog')
            .select('id, criteria_id, criteria_label, points_deducted, created_by_name, created_at, note, photo_urls, created_by')
            .eq('staff_id', staffId)
            .eq('work_date', workDate)
            .is('revoked_at', null);
        if (error) throw error;

        // Kèm bằng chứng đi làm của ngày đó — sheet chấm điểm cần biết TRƯỚC khi
        // lễ tân tích lỗi, chứ để họ điền xong rồi mới báo "không trừ được" là
        // mất công và dễ bị hiểu là hệ thống hỏng.
        const workday = await workdayEvidence(supabase, staffId, workDate);

        return NextResponse.json({
            success: true,
            workday: { ...workday, label: evidenceLabel(workday) },
            existing: (data || []).map((r: any) => ({
                logId: r.id,
                createdBy: r.created_by,
                criteriaId: r.criteria_id,
                label: r.criteria_label,
                points: Number(r.points_deducted) || 0,
                byName: r.created_by_name,
                at: r.created_at,
                note: r.note,
                photoUrls: Array.isArray(r.photo_urls) ? r.photo_urls : [],
                photoCount: Array.isArray(r.photo_urls) ? r.photo_urls.length : 0,
            })),
        });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('Lỗi khi tra phiếu trừ điểm đã có:', error);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}

export async function POST(request: Request) {
    try {
        await requirePermission('ktv_office_scoring');
        const bUser = await requireBusinessUser();
        if (!bUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        const body = await request.json().catch(() => ({}));
        const { staffId, workDate, criteriaIds, note, photosBase64, photosByCriteria, notesByCriteria } = body as {
            staffId?: string;
            workDate?: string;
            criteriaIds?: string[];
            note?: string;
            /** Đường CŨ — rổ ảnh dùng chung. Chỉ còn nhận khi tích đúng 1 lỗi. */
            photosBase64?: string[];
            /** Đường MỚI — ảnh của riêng từng lỗi: { criteriaId: base64[] }. */
            photosByCriteria?: Record<string, string[]>;
            /** Ghi chú của riêng từng lỗi: { criteriaId: text }. */
            notesByCriteria?: Record<string, string>;
        };

        if (!staffId || !workDate || !Array.isArray(criteriaIds) || criteriaIds.length === 0) {
            return NextResponse.json({ success: false, error: 'Thiếu KTV, ngày vi phạm hoặc danh sách lỗi.' }, { status: 400 });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
            return NextResponse.json({ success: false, error: 'Ngày vi phạm không hợp lệ.' }, { status: 400 });
        }
        const today = await officeToday(supabase);
        if (workDate > today) {
            return NextResponse.json({ success: false, error: 'Không thể trừ điểm cho ngày ở tương lai.' }, { status: 400 });
        }

        // Lễ tân chỉ được trừ hôm nay và hôm qua — không giới hạn thì dễ trừ bù
        // cả tuần trước, KTV không còn cách nào phản hồi. Quản lý trừ được mọi ngày.
        if (!isOfficeManager(bUser.role) && workDate < shiftBusinessDate(today, -1)) {
            return NextResponse.json(
                { success: false, error: 'Chỉ Quản lý mới trừ điểm được cho ngày cũ hơn hôm qua.' },
                { status: 403 }
            );
        }

        // KTV phải tồn tại và đúng Loại D.
        const { data: staff, error: staffErr } = await supabase
            .from('Staff')
            .select('id, full_name, work_type')
            .eq('id', staffId)
            .maybeSingle();
        if (staffErr) throw staffErr;
        if (!staff) {
            return NextResponse.json({ success: false, error: 'Không tìm thấy KTV.' }, { status: 404 });
        }
        if (staff.work_type !== 'TYPE_D') {
            return NextResponse.json({ success: false, error: 'Chỉ áp dụng cho KTV Loại D.' }, { status: 400 });
        }

        // ─── Cửa vào: ngày đó KTV có đi làm không? ───
        //
        // Xét CÙNG LÚC hai nguồn — chấm công và lịch đăng ký. Chỉ nhìn lịch thì
        // bỏ sót người đăng ký nghỉ mà vẫn vào làm; chỉ nhìn chấm công thì bỏ
        // sót người có lịch mà không tới (chính sự vắng đó là lỗi cần trừ).
        // Xem KtvOfficeWorkdayService.
        const workday = await workdayEvidence(supabase, staffId, workDate);
        if (!workday.canDeduct) {
            return NextResponse.json({
                success: false,
                error: workday.reason,
                code: 'NOT_A_WORKDAY',
                workday,
            }, { status: 422 });
        }

        // Lấy tiêu chí từ DB — KHÔNG tin điểm do client gửi lên.
        const { data: criteria, error: critErr } = await supabase
            .from('KTVOfficeCriteria')
            .select('id, label, points, requires_photo')
            .in('id', criteriaIds)
            .eq('is_active', true);
        if (critErr) throw critErr;

        if (!criteria || criteria.length !== criteriaIds.length) {
            return NextResponse.json({ success: false, error: 'Có tiêu chí không tồn tại hoặc đã ngừng áp dụng.' }, { status: 400 });
        }

        // Ảnh minh chứng gắn THEO TỪNG LỖI — xem KtvOfficeEvidenceService.
        const resolvedPhotos = resolvePhotosPerCriteria(
            criteria as any, photosByCriteria, photosBase64, MAX_PHOTOS_PER_CRITERIA);
        if (!resolvedPhotos.ok) {
            return NextResponse.json(
                { success: false, error: resolvedPhotos.error, code: resolvedPhotos.code },
                { status: 400 });
        }
        const perCriteria = resolvedPhotos.perCriteria;

        // Chặn trừ trùng trong ngày (DB cũng có unique index, đây là lớp báo lỗi thân thiện).
        const { data: existing } = await supabase
            .from('KTVOfficeScoreLog')
            .select('criteria_id, criteria_label')
            .eq('staff_id', staffId)
            .eq('work_date', workDate)
            .in('criteria_id', criteriaIds)
            .is('revoked_at', null);
        if (existing && existing.length > 0) {
            const names = existing.map((e: any) => e.criteria_label).join(', ');
            return NextResponse.json(
                { success: false, error: `Ngày ${workDate} đã trừ các lỗi này rồi: ${names}. Mỗi lỗi chỉ trừ 1 lần/ngày.` },
                { status: 409 }
            );
        }

        // Upload ảnh trước khi ghi log — có ảnh hỏng thì dừng, không ghi nửa vời.
        // Mỗi lỗi upload riêng để link ảnh không dùng chung giữa các lỗi.
        const urlsOf: Record<string, string[]> = {};
        for (const c of criteria) {
            urlsOf[c.id] = await uploadEvidence(supabase, staffId, workDate, perCriteria[c.id]);
        }
        const photoUrls = Object.values(urlsOf).flat();

        // bUser.techCode có thể là UUID (tài khoản admin không gắn mã NV) — tra tên thật
        // để KTV nhìn lịch sử biết ai chấm, chứ không phải một chuỗi UUID vô nghĩa.
        const { data: actor } = await supabase
            .from('Staff')
            .select('full_name')
            .eq('id', bUser.techCode)
            .maybeSingle();
        const createdByName = actor?.full_name
            || (bUser.role ? `Quản lý (${bUser.role})` : null)
            || bUser.techCode
            || 'Không rõ';
        // Ghi chú cũng gắn THEO TỪNG LỖI, không dùng chung — xem
        // `resolveNotesPerCriteria`.
        const notesOf = resolveNotesPerCriteria(criteria as any, notesByCriteria, note);

        const rows = buildDeductRows({
            staffId, workDate, criteria: criteria as any, urlsOf, notesOf,
            createdBy: bUser.techCode, createdByName,
        });

        const { data: inserted, error: insErr } = await supabase
            .from('KTVOfficeScoreLog')
            .insert(rows)
            .select('id');
        if (insErr) {
            // 23505 = đụng unique index chặn trừ trùng 1 lỗi/ngày.
            if ((insErr as any).code === '23505') {
                return NextResponse.json(
                    { success: false, error: 'Một trong các lỗi này vừa được người khác trừ. Vui lòng tải lại trang.' },
                    { status: 409 }
                );
            }
            throw insErr;
        }

        const totalPoints = criteria.reduce((a: number, c: any) => a + (Number(c.points) || 0), 0);
        const detail = criteria.map((c: any) => `${c.label} (−${c.points}đ)`).join(', ');

        // Báo cho KTV biết ngay, kèm lý do — không để họ cuối tháng mới ngã ngửa.
        await createNotification({
            type: 'WARNING',
            message: `Bạn bị trừ ${totalPoints} điểm Office ngày ${vnDate(workDate)}: ${detail}.${photoUrls.length ? ` Có ${photoUrls.length} ảnh minh chứng.` : ''}`,
            employeeId: staffId,
        }).catch(err => console.error('❌ [Office] Không gửi được thông báo:', err));

        // Nhật ký để truy vết khi lễ tân và KTV tranh chấp.
        // Bọc try/catch: nhật ký hỏng không được chặn nghiệp vụ đã ghi thành công.
        try {
            await supabase.from('SecurityAuditLogs').insert({
                employee_id: staffId,
                employee_name: staff.full_name || staffId,
                event_type: 'OFFICE_SCORE_DEDUCT',
                ip_address: '127.0.0.1',
                user_agent: 'API',
                details: {
                    workDate,
                    criteriaIds,
                    totalPoints,
                    photoCount: photoUrls.length,
                    by: bUser.techCode,
                    note: note?.trim() || null,
                },
            });
        } catch (logErr) {
            console.error('❌ [Office] Không ghi được nhật ký:', logErr);
        }

        return NextResponse.json({
            success: true,
            inserted: inserted?.length || 0,
            totalPoints,
            photoUrls,
        });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('Lỗi khi trừ điểm Office:', error);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}

/**
 * Sửa một phiếu đã gửi: đổi tiêu chí bị chấm nhầm, sửa ghi chú, thêm/bớt ảnh.
 *
 * Sửa TẠI CHỖ chứ không thu hồi rồi chấm lại, vì thu hồi + chấm lại làm timeline
 * của KTV rối và mất mốc thời gian gốc. Mọi thay đổi đều vào SecurityAuditLogs.
 * Quản lý sửa được mọi phiếu; người chấm chỉ sửa phiếu của chính mình, trong
 * đúng khung ngày họ được phép chấm (hôm nay + hôm qua).
 */
export async function PATCH(request: Request) {
    try {
        await requirePermission('ktv_office_scoring');
        const bUser = await requireBusinessUser();
        if (!bUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        const body = await request.json().catch(() => ({}));
        const { logId, criteriaId, note, addPhotosBase64, removePhotoUrls } = body as {
            logId?: string;
            criteriaId?: string;
            note?: string;
            addPhotosBase64?: string[];
            removePhotoUrls?: string[];
        };

        if (!logId) {
            return NextResponse.json({ success: false, error: 'Thiếu mã phiếu cần sửa.' }, { status: 400 });
        }

        const { data: log, error: logErr } = await supabase
            .from('KTVOfficeScoreLog')
            .select('id, staff_id, work_date, criteria_id, criteria_label, points_deducted, note, photo_urls, created_by, revoked_at')
            .eq('id', logId)
            .maybeSingle();
        if (logErr) throw logErr;
        if (!log) {
            return NextResponse.json({ success: false, error: 'Không tìm thấy phiếu này.' }, { status: 404 });
        }
        if (log.revoked_at) {
            return NextResponse.json({ success: false, error: 'Phiếu đã bị thu hồi, không sửa được nữa.' }, { status: 409 });
        }

        const manager = isOfficeManager(bUser.role);
        if (!manager) {
            if (log.created_by !== bUser.techCode) {
                return NextResponse.json(
                    { success: false, error: 'Chỉ Quản lý mới sửa được phiếu do người khác chấm.' },
                    { status: 403 }
                );
            }
            if (log.work_date < shiftBusinessDate(await officeToday(supabase), -1)) {
                return NextResponse.json(
                    { success: false, error: 'Chỉ Quản lý mới sửa được phiếu cũ hơn hôm qua.' },
                    { status: 403 }
                );
            }
        }

        const patch: any = {};
        const changes: any = {};

        // Đổi tiêu chí — lấy điểm từ DB, không tin điểm client gửi lên.
        let newCriteria: any = null;
        if (criteriaId && criteriaId !== log.criteria_id) {
            const { data: c, error: cErr } = await supabase
                .from('KTVOfficeCriteria')
                .select('id, label, points, requires_photo')
                .eq('id', criteriaId)
                .eq('is_active', true)
                .maybeSingle();
            if (cErr) throw cErr;
            if (!c) {
                return NextResponse.json({ success: false, error: 'Tiêu chí mới không tồn tại hoặc đã ngừng áp dụng.' }, { status: 400 });
            }

            // Quy chế: mỗi lỗi chỉ trừ 1 lần/ngày — đổi sang lỗi đã có trong ngày là trùng.
            const { data: dup } = await supabase
                .from('KTVOfficeScoreLog')
                .select('id')
                .eq('staff_id', log.staff_id)
                .eq('work_date', log.work_date)
                .eq('criteria_id', criteriaId)
                .is('revoked_at', null)
                .neq('id', logId)
                .maybeSingle();
            if (dup) {
                return NextResponse.json(
                    { success: false, error: `Ngày ${log.work_date} đã trừ lỗi "${c.label}" rồi. Mỗi lỗi chỉ trừ 1 lần/ngày.` },
                    { status: 409 }
                );
            }

            newCriteria = c;
            patch.criteria_id = c.id;
            patch.criteria_label = c.label;
            patch.points_deducted = Number(c.points) || 0;
            changes.criteria = {
                from: log.criteria_label,
                to: c.label,
                points: { from: Number(log.points_deducted), to: Number(c.points) },
            };
        }

        if (note !== undefined) {
            patch.note = String(note).trim() || null;
            changes.note = { from: log.note, to: patch.note };
        }

        // Ảnh: bỏ link cũ trước, thêm ảnh mới sau, rồi cắt theo trần MAX_PHOTOS.
        const currentPhotos: string[] = Array.isArray(log.photo_urls) ? log.photo_urls : [];
        let photoUrls = currentPhotos;
        const removing = Array.isArray(removePhotoUrls) ? removePhotoUrls : [];
        const adding = Array.isArray(addPhotosBase64) ? addPhotosBase64 : [];
        if (removing.length > 0 || adding.length > 0) {
            const kept = currentPhotos.filter(u => !removing.includes(u));
            const room = Math.max(0, MAX_PHOTOS - kept.length);
            const uploaded = await uploadEvidence(supabase, log.staff_id, log.work_date, adding.slice(0, room));
            photoUrls = [...kept, ...uploaded];
            patch.photo_urls = photoUrls;
            changes.photos = { from: currentPhotos.length, to: photoUrls.length };
        }

        // Tiêu chí bắt buộc ảnh mà sửa xong lại không còn ảnh nào thì phiếu mất bằng chứng.
        if (newCriteria?.requires_photo === true && photoUrls.length === 0) {
            return NextResponse.json(
                { success: false, error: `Lỗi "${newCriteria.label}" bắt buộc có ảnh minh chứng.` },
                { status: 400 }
            );
        }

        if (Object.keys(patch).length === 0) {
            return NextResponse.json({ success: false, error: 'Không có gì thay đổi.' }, { status: 400 });
        }

        const { error: updErr } = await supabase.from('KTVOfficeScoreLog').update(patch).eq('id', logId);
        if (updErr) {
            if ((updErr as any).code === '23505') {
                return NextResponse.json(
                    { success: false, error: 'Lỗi này vừa được người khác trừ cho ngày đó. Vui lòng tải lại trang.' },
                    { status: 409 }
                );
            }
            throw updErr;
        }

        // Chỉ báo KTV khi tiêu chí/điểm đổi — sửa ghi chú hay thêm ảnh mà cũng bắn
        // thông báo thì KTV bị làm phiền vì thay đổi không ảnh hưởng tới điểm của họ.
        if (newCriteria) {
            await createNotification({
                type: 'WARNING',
                message: `Phiếu trừ điểm Office ngày ${vnDate(log.work_date)} đã được sửa: "${log.criteria_label}" (−${log.points_deducted}đ) → "${newCriteria.label}" (−${newCriteria.points}đ).`,
                employeeId: log.staff_id,
            }).catch(err => console.error('❌ [Office] Không gửi được thông báo sửa phiếu:', err));
        }

        try {
            await supabase.from('SecurityAuditLogs').insert({
                employee_id: log.staff_id,
                employee_name: log.staff_id,
                event_type: 'OFFICE_SCORE_EDIT',
                ip_address: '127.0.0.1',
                user_agent: 'API',
                details: { logId, workDate: log.work_date, changes, by: bUser.techCode },
            });
        } catch (auditErr) {
            console.error('❌ [Office] Không ghi được nhật ký sửa phiếu:', auditErr);
        }

        return NextResponse.json({ success: true, logId, photoUrls });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('Lỗi khi sửa phiếu trừ điểm Office:', error);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}

/**
 * Thu hồi một phiếu đã gửi — KHÔNG xoá cứng.
 * Điểm hoàn lại ngay (mọi phép tính đều lọc `revoked_at IS NULL`), nhưng dòng vẫn
 * nằm đó kèm người thu hồi và lý do, để tranh chấp sau này còn tra được.
 * Chỉ Quản lý: thu hồi là quyết định quản lý, không phải thao tác của người chấm.
 */
export async function DELETE(request: Request) {
    try {
        await requirePermission('ktv_office_scoring');
        const bUser = await requireBusinessUser();
        if (!bUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        if (!isOfficeManager(bUser.role)) {
            return NextResponse.json({ success: false, error: 'Chỉ Quản lý mới thu hồi được phiếu trừ điểm.' }, { status: 403 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase admin chưa được cấu hình' }, { status: 500 });
        }

        const { searchParams } = new URL(request.url);
        const logId = searchParams.get('logId');
        const reason = (searchParams.get('reason') || '').trim();

        if (!logId) {
            return NextResponse.json({ success: false, error: 'Thiếu mã phiếu cần thu hồi.' }, { status: 400 });
        }
        // Bắt buộc lý do: thu hồi mà không ghi lý do thì tháng sau không ai nhớ vì sao.
        if (reason.length < 5) {
            return NextResponse.json({ success: false, error: 'Cần ghi lý do thu hồi (ít nhất 5 ký tự).' }, { status: 400 });
        }

        const { data: log, error: logErr } = await supabase
            .from('KTVOfficeScoreLog')
            .select('id, staff_id, work_date, criteria_label, points_deducted, revoked_at')
            .eq('id', logId)
            .maybeSingle();
        if (logErr) throw logErr;
        if (!log) {
            return NextResponse.json({ success: false, error: 'Không tìm thấy phiếu này.' }, { status: 404 });
        }
        if (log.revoked_at) {
            return NextResponse.json({ success: false, error: 'Phiếu này đã được thu hồi trước đó.' }, { status: 409 });
        }

        const { error: updErr } = await supabase
            .from('KTVOfficeScoreLog')
            .update({
                revoked_at: new Date().toISOString(),
                revoked_by: bUser.techCode,
                revoke_reason: reason,
            })
            .eq('id', logId)
            .is('revoked_at', null);
        if (updErr) throw updErr;

        await createNotification({
            type: 'SUCCESS',
            message: `Đã hoàn lại ${log.points_deducted} điểm Office ngày ${vnDate(log.work_date)}: phiếu "${log.criteria_label}" được thu hồi. Lý do: ${reason}`,
            employeeId: log.staff_id,
        }).catch(err => console.error('❌ [Office] Không gửi được thông báo thu hồi:', err));

        try {
            await supabase.from('SecurityAuditLogs').insert({
                employee_id: log.staff_id,
                employee_name: log.staff_id,
                event_type: 'OFFICE_SCORE_REVOKE',
                ip_address: '127.0.0.1',
                user_agent: 'API',
                details: {
                    logId,
                    workDate: log.work_date,
                    criteriaLabel: log.criteria_label,
                    points: Number(log.points_deducted) || 0,
                    reason,
                    by: bUser.techCode,
                },
            });
        } catch (auditErr) {
            console.error('❌ [Office] Không ghi được nhật ký thu hồi:', auditErr);
        }

        return NextResponse.json({ success: true, restoredPoints: Number(log.points_deducted) || 0 });
    } catch (error: any) {
        const msg = error?.message || 'Lỗi không xác định';
        const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403 : msg === 'Unauthorized' ? 401 : 500;
        if (status === 500) console.error('Lỗi khi thu hồi phiếu trừ điểm Office:', error);
        return NextResponse.json({ success: false, error: msg }, { status });
    }
}
