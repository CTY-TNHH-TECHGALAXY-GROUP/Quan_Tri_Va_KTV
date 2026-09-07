import { NextResponse } from 'next/server';
import { requirePermission, requireBusinessUser } from '@/lib/auth-server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { isOfficeManager } from '@/lib/services/KtvOfficeScoreService';

export const dynamic = 'force-dynamic';

/** Ba nhóm của quy chế Loại D. Không cho tạo nhóm mới — quy chế chỉ có 3 nhóm. */
const GROUPS = ['I', 'II', 'III'] as const;

/** Tiền tố mã tiêu chí theo nhóm: Quy trình / Thời gian / Thái độ. */
const ID_PREFIX: Record<string, string> = { I: 'P', II: 'T', III: 'A' };

async function requireManager() {
    await requirePermission('ktv_office_scoring');
    const bUser = await requireBusinessUser();
    if (!bUser) throw new Error('Unauthorized');
    if (!isOfficeManager(bUser.role)) {
        throw new Error('Chỉ Quản lý mới sửa được bộ tiêu chí chấm điểm.');
    }
    return bUser;
}

/** Bỏ đuôi .0 cho gọn khi ghép vào câu thông báo. */
function num(n: number): string {
    return String(Math.round(n * 100) / 100);
}

/**
 * Trần điểm của nhóm và tổng điểm các tiêu chí ĐANG áp dụng trong nhóm đó.
 * `exclude` — bỏ một tiêu chí ra khỏi tổng, dùng khi đang sửa chính nó.
 */
async function groupState(supabase: any, grp: string, exclude?: string) {
    const { data, error } = await supabase
        .from('KTVOfficeCriteria')
        .select('id, points, is_active, grp_max, grp_label')
        .eq('grp', grp);
    if (error) throw error;
    const rows = data || [];
    const used = rows
        .filter((c: any) => c.is_active && c.id !== exclude)
        .reduce((a: number, c: any) => a + (Number(c.points) || 0), 0);
    return {
        cap: Number(rows[0]?.grp_max ?? 0),
        used: Math.round(used * 100) / 100,
        grpLabel: rows[0]?.grp_label || '',
        exists: rows.length > 0,
    };
}

function fail(error: string, status = 400) {
    return NextResponse.json({ success: false, error }, { status });
}

function caught(error: any, where: string) {
    const msg = error?.message || 'Lỗi không xác định';
    const status = msg === 'Forbidden' || msg === 'ACCOUNT_LOCKED' ? 403
        : msg === 'Unauthorized' ? 401
        : msg.startsWith('Chỉ Quản lý') ? 403
        : 500;
    if (status === 500) console.error(where, error);
    return NextResponse.json({ success: false, error: msg }, { status });
}

/** Ghi nhật ký sửa quy chế — đổi điểm một tiêu chí ảnh hưởng tiền quỹ của cả đội. */
async function audit(supabase: any, actorId: string, eventType: string, details: any) {
    try {
        await supabase.from('SecurityAuditLogs').insert({
            employee_id: actorId,
            employee_name: actorId,
            event_type: eventType,
            ip_address: '127.0.0.1',
            user_agent: 'API',
            details,
        });
    } catch (logErr) {
        console.error('❌ [Office] Không ghi được nhật ký sửa tiêu chí:', logErr);
    }
}

/**
 * Danh sách tiêu chí gom theo 3 nhóm của quy chế Loại D.
 * `?all=1` — kèm cả tiêu chí đã ngừng áp dụng và số lần đã dùng, cho màn Cài đặt.
 */
export async function GET(request: Request) {
    try {
        await requirePermission('ktv_office_scoring');
        const { searchParams } = new URL(request.url);
        const includeInactive = searchParams.get('all') === '1';

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return fail('Supabase admin chưa được cấu hình', 500);
        }

        let query = supabase
            .from('KTVOfficeCriteria')
            .select('id, grp, grp_label, grp_max, label, points, requires_photo, sort_order, is_active')
            .order('sort_order', { ascending: true });
        if (!includeInactive) query = query.eq('is_active', true);

        const { data, error } = await query;
        if (error) throw error;

        // Số phiếu đã dùng mỗi tiêu chí — để màn Cài đặt cảnh báo trước khi xoá.
        const usage = new Map<string, number>();
        if (includeInactive) {
            const { data: logs } = await supabase
                .from('KTVOfficeScoreLog')
                .select('criteria_id')
                .is('revoked_at', null);
            (logs || []).forEach((l: any) => usage.set(l.criteria_id, (usage.get(l.criteria_id) || 0) + 1));
        }

        // Gom nhóm sẵn để UI khỏi phải tự group, và tính luôn điểm tối đa mỗi nhóm.
        const groups: any[] = [];
        for (const c of data || []) {
            let g = groups.find(x => x.grp === c.grp);
            if (!g) {
                // `max` là TRẦN do Quản lý đặt; `used` là tổng điểm đang thực dùng.
                // Hai số này khác nhau: trần 40 mà mới dùng 35 nghĩa là còn 5đ để thêm tiêu chí.
                g = { grp: c.grp, grpLabel: c.grp_label, label: `${c.grp}. ${c.grp_label}`, max: Number(c.grp_max) || 0, used: 0, items: [] };
                groups.push(g);
            }
            // Tiêu chí đã tắt không tính vào tổng đang dùng.
            if (c.is_active) g.used += Number(c.points) || 0;
            g.items.push({
                id: c.id,
                label: c.label,
                points: Number(c.points) || 0,
                requiresPhoto: c.requires_photo,
                isActive: c.is_active,
                sortOrder: c.sort_order,
                usageCount: usage.get(c.id) || 0,
            });
        }

        groups.forEach(g => { g.used = Math.round(g.used * 100) / 100; });

        return NextResponse.json({
            success: true,
            groups,
            // Quy chế: 1 ngày đủ 100 điểm. Tổng trần 3 nhóm lệch 100 là cơ cấu đã sai.
            capTotal: Math.round(groups.reduce((a, g) => a + g.max, 0) * 100) / 100,
        });
    } catch (error: any) {
        return caught(error, 'Lỗi khi lấy tiêu chí Office:');
    }
}

/** Thêm một tiêu chí mới vào nhóm. Mã tự sinh theo nhóm (P7, T5, A9…). */
export async function POST(request: Request) {
    try {
        const bUser = await requireManager();

        const supabase = getSupabaseAdmin();
        if (!supabase) return fail('Supabase admin chưa được cấu hình', 500);

        const body = await request.json().catch(() => ({}));
        const grp = String(body.grp || '').trim().toUpperCase();
        const label = String(body.label || '').trim();
        const points = Number(body.points);
        const requiresPhoto = body.requiresPhoto === true;

        if (!GROUPS.includes(grp as any)) return fail('Nhóm không hợp lệ. Chỉ có nhóm I, II, III.');
        if (!label) return fail('Chưa nhập tên tiêu chí.');
        if (!Number.isFinite(points) || points <= 0) return fail('Điểm trừ phải là số lớn hơn 0.');

        const { data: all, error: allErr } = await supabase
            .from('KTVOfficeCriteria')
            .select('id, grp, grp_label, sort_order');
        if (allErr) throw allErr;

        // Nhãn nhóm lấy theo tiêu chí sẵn có cùng nhóm, để không phải nhập lại mỗi lần.
        const sameGroup = (all || []).filter((c: any) => c.grp === grp);
        const grpLabel = String(body.grpLabel || sameGroup[0]?.grp_label || '').trim();
        if (!grpLabel) return fail('Nhóm này chưa có tên nhóm, cần nhập tên nhóm.');

        // Mã kế tiếp trong nhóm: lấy số lớn nhất đang dùng +1, tránh trùng khi đã xoá giữa chừng.
        const prefix = ID_PREFIX[grp];
        const maxNum = sameGroup.reduce((m: number, c: any) => {
            const n = Number(String(c.id).replace(prefix, ''));
            return Number.isFinite(n) && n > m ? n : m;
        }, 0);
        const id = `${prefix}${maxNum + 1}`;

        // Tổng điểm trong nhóm không được vượt trần — nếu không thì điểm ngày của
        // KTV có thể tụt quá mức quy chế cho phép ở một nhóm.
        const { cap, used } = await groupState(supabase, grp);
        if (used + points > cap) {
            return fail(
                `Nhóm ${grp} đang dùng ${num(used)}/${num(cap)}đ, thêm ${num(points)}đ nữa là vượt trần ${num(used + points - cap)}đ. `
                + 'Hạ điểm tiêu chí khác hoặc nâng trần của nhóm trước.'
            );
        }

        const maxSort = (all || []).reduce((m: number, c: any) => Math.max(m, Number(c.sort_order) || 0), 0);

        const { error: insErr } = await supabase.from('KTVOfficeCriteria').insert({
            id,
            grp,
            grp_label: grpLabel,
            grp_max: cap,          // trần là thuộc tính của nhóm, mọi dòng cùng nhóm giữ cùng giá trị
            label,
            points,
            requires_photo: requiresPhoto,
            sort_order: maxSort + 1,
            is_active: true,
        });
        if (insErr) {
            if ((insErr as any).code === '23505') return fail('Mã tiêu chí này đã tồn tại, vui lòng thử lại.', 409);
            throw insErr;
        }

        await audit(supabase, bUser.techCode, 'OFFICE_CRITERIA_CREATE', { id, grp, label, points, requiresPhoto });

        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        return caught(error, 'Lỗi khi thêm tiêu chí Office:');
    }
}

/**
 * Sửa một tiêu chí, hoặc đổi tên cả một nhóm (gửi `grp` + `grpLabel`, không gửi `id`).
 *
 * Sửa điểm KHÔNG làm sai lịch sử: mỗi phiếu đã ghi giữ bản sao nhãn và điểm tại
 * thời điểm chấm (`criteria_label`, `points_deducted`), nên chỉ phiếu mới dùng giá trị mới.
 */
export async function PUT(request: Request) {
    try {
        const bUser = await requireManager();

        const supabase = getSupabaseAdmin();
        if (!supabase) return fail('Supabase admin chưa được cấu hình', 500);

        const body = await request.json().catch(() => ({}));

        // Nhánh 1 — sửa cả nhóm: đổi tên và/hoặc đặt lại trần điểm.
        if (!body.id && body.grp) {
            const grp = String(body.grp).trim().toUpperCase();
            if (!GROUPS.includes(grp as any)) return fail('Nhóm không hợp lệ.');

            const groupPatch: any = {};
            const { cap, used, exists } = await groupState(supabase, grp);
            if (!exists) return fail('Nhóm này chưa có tiêu chí nào.', 404);

            if (body.grpLabel !== undefined) {
                const grpLabel = String(body.grpLabel).trim();
                if (!grpLabel) return fail('Chưa nhập tên nhóm.');
                groupPatch.grp_label = grpLabel;
            }

            if (body.grpMax !== undefined) {
                const grpMax = Number(body.grpMax);
                if (!Number.isFinite(grpMax) || grpMax < 0) return fail('Trần điểm của nhóm phải là số không âm.');
                // Hạ trần xuống dưới tổng đang dùng thì nhóm sai ngay lập tức — chặn,
                // và nói rõ phải hạ điểm tiêu chí nào trước.
                if (grpMax < used) {
                    return fail(
                        `Nhóm ${grp} đang dùng ${num(used)}đ nên không hạ trần xuống ${num(grpMax)}đ được. `
                        + `Hạ bớt ${num(used - grpMax)}đ ở các tiêu chí trong nhóm trước.`
                    );
                }
                groupPatch.grp_max = grpMax;
            }

            if (Object.keys(groupPatch).length === 0) return fail('Không có gì để sửa.');

            const { error } = await supabase
                .from('KTVOfficeCriteria')
                .update(groupPatch)
                .eq('grp', grp);
            if (error) throw error;

            await audit(supabase, bUser.techCode, 'OFFICE_CRITERIA_UPDATE', {
                grp, before: { cap, used }, after: groupPatch,
            });
            return NextResponse.json({ success: true });
        }

        // Nhánh 2 — sửa một tiêu chí.
        const id = String(body.id || '').trim();
        if (!id) return fail('Thiếu mã tiêu chí.');

        const { data: current, error: curErr } = await supabase
            .from('KTVOfficeCriteria')
            .select('id, grp, label, points, requires_photo, is_active')
            .eq('id', id)
            .maybeSingle();
        if (curErr) throw curErr;
        if (!current) return fail('Không tìm thấy tiêu chí này.', 404);

        const patch: any = {};
        if (body.label !== undefined) {
            const label = String(body.label).trim();
            if (!label) return fail('Tên tiêu chí không được để trống.');
            patch.label = label;
        }
        if (body.points !== undefined) {
            const points = Number(body.points);
            if (!Number.isFinite(points) || points <= 0) return fail('Điểm trừ phải là số lớn hơn 0.');
            patch.points = points;
        }
        if (body.requiresPhoto !== undefined) patch.requires_photo = body.requiresPhoto === true;
        if (body.isActive !== undefined) patch.is_active = body.isActive === true;
        if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
            patch.sort_order = Number(body.sortOrder);
        }
        if (body.grp !== undefined) {
            const grp = String(body.grp).trim().toUpperCase();
            if (!GROUPS.includes(grp as any)) return fail('Nhóm không hợp lệ.');
            patch.grp = grp;
        }

        if (Object.keys(patch).length === 0) return fail('Không có gì để sửa.');

        // Kiểm trần với giá trị SAU khi sửa. Tiêu chí đang tắt thì không tính vào tổng,
        // nên bật lại một tiêu chí cũng phải qua cửa này.
        const nextPoints = patch.points ?? (Number(current.points) || 0);
        const nextActive = patch.is_active ?? current.is_active;
        const nextGrp = patch.grp ?? current.grp;
        if (nextActive) {
            const { cap, used } = await groupState(supabase, nextGrp, id);
            if (used + nextPoints > cap) {
                return fail(
                    `Nhóm ${nextGrp} có trần ${num(cap)}đ. Các tiêu chí khác đã chiếm ${num(used)}đ, `
                    + `đặt tiêu chí này ${num(nextPoints)}đ là vượt ${num(used + nextPoints - cap)}đ. `
                    + 'Hạ điểm tiêu chí khác hoặc nâng trần của nhóm trước.'
                );
            }
        }

        const { error } = await supabase.from('KTVOfficeCriteria').update(patch).eq('id', id);
        if (error) throw error;

        await audit(supabase, bUser.techCode, 'OFFICE_CRITERIA_UPDATE', {
            id,
            before: { label: current.label, points: current.points, requiresPhoto: current.requires_photo, isActive: current.is_active },
            after: patch,
        });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return caught(error, 'Lỗi khi sửa tiêu chí Office:');
    }
}

/**
 * Xoá một tiêu chí.
 * Đã có phiếu trừ tham chiếu thì KHÔNG xoá cứng (khoá ngoại + mất dấu lịch sử) —
 * chuyển sang ngừng áp dụng: tiêu chí biến mất khỏi bảng chấm điểm, phiếu cũ giữ nguyên.
 */
export async function DELETE(request: Request) {
    try {
        const bUser = await requireManager();

        const supabase = getSupabaseAdmin();
        if (!supabase) return fail('Supabase admin chưa được cấu hình', 500);

        const { searchParams } = new URL(request.url);
        const id = (searchParams.get('id') || '').trim();
        if (!id) return fail('Thiếu mã tiêu chí.');

        const { data: current, error: curErr } = await supabase
            .from('KTVOfficeCriteria')
            .select('id, label')
            .eq('id', id)
            .maybeSingle();
        if (curErr) throw curErr;
        if (!current) return fail('Không tìm thấy tiêu chí này.', 404);

        const { count, error: cntErr } = await supabase
            .from('KTVOfficeScoreLog')
            .select('id', { count: 'exact', head: true })
            .eq('criteria_id', id);
        if (cntErr) throw cntErr;

        if ((count || 0) > 0) {
            const { error } = await supabase
                .from('KTVOfficeCriteria')
                .update({ is_active: false })
                .eq('id', id);
            if (error) throw error;

            await audit(supabase, bUser.techCode, 'OFFICE_CRITERIA_DEACTIVATE', { id, label: current.label, usage: count });
            return NextResponse.json({
                success: true,
                mode: 'deactivated',
                usage: count,
                message: `Đã ngừng áp dụng "${current.label}". Tiêu chí này đang gắn với ${count} phiếu đã chấm nên phải giữ lại để lịch sử không sai.`,
            });
        }

        const { error } = await supabase.from('KTVOfficeCriteria').delete().eq('id', id);
        if (error) throw error;

        await audit(supabase, bUser.techCode, 'OFFICE_CRITERIA_DELETE', { id, label: current.label });
        return NextResponse.json({
            success: true,
            mode: 'deleted',
            message: `Đã xoá tiêu chí "${current.label}".`,
        });
    } catch (error: any) {
        return caught(error, 'Lỗi khi xoá tiêu chí Office:');
    }
}

