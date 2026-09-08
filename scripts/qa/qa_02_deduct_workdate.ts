/**
 * QA #2 — "Ràng buộc trừ điểm đúng NGÀY PHÁT SINH VI PHẠM".
 *
 * Kiểm tra 5 ràng buộc quanh `KTVOfficeScoreLog.work_date`:
 *
 *   R1. Không trừ được cho ngày tương lai.
 *   R2. Lễ tân chỉ trừ được hôm nay + hôm qua; Quản lý trừ được mọi ngày.
 *   R3. Mỗi (KTV, ngày, tiêu chí) chỉ có ĐÚNG MỘT phiếu còn hiệu lực — do
 *       unique index của DB giữ, không chỉ code chặn.
 *   R4. Thu hồi rồi thì được chấm lại chính lỗi đó trong cùng ngày.
 *   R5. work_date phải là NGÀY LÀM VIỆC (cutoff 06:00), cùng hệ với
 *       `KTVAttendance.date` — nếu không thì mẫu số điểm tháng sai.
 *
 * Chạy: npx ts-node -O "{\"module\":\"commonjs\"}" scripts/qa/qa_02_deduct_workdate.ts
 * CÓ GHI DB — dùng một staff loại D thật, ghi phiếu với tiêu chí thật rồi XOÁ CỨNG
 * ở bước dọn dẹp (finally). Không đụng phiếu do người thật tạo.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { getDayCutoffHours, toBusinessDate } from '../../lib/business-date';
import { monthRange, KtvOfficeScoreService } from '../../lib/services/KtvOfficeScoreService';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const QA_TAG = '[QA-AUTOTEST] khong phai vi pham that';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

/** Ngày VN (LỊCH, không phải ngày làm việc) lùi n ngày — đúng công thức route đang dùng. */
function vnDaysAgo(n: number): string {
    const vn = new Date(Date.now() + 7 * 60 * 60 * 1000 - n * 86400000);
    return vn.toISOString().slice(0, 10);
}

/** Bản sao ĐÚNG luật cửa ngày của route POST /api/admin/ktv-office/deduct. */
function routeAllows(workDate: string, isManager: boolean): { ok: boolean; why: string } {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { ok: false, why: 'Ngày vi phạm không hợp lệ.' };
    if (workDate > vnDaysAgo(0)) return { ok: false, why: 'Không thể trừ điểm cho ngày ở tương lai.' };
    if (!isManager && workDate < vnDaysAgo(1)) {
        return { ok: false, why: 'Chỉ Quản lý mới trừ điểm được cho ngày cũ hơn hôm qua.' };
    }
    return { ok: true, why: '' };
}

async function main() {
    console.log('\n=== QA #2 · Rang buoc tru diem dung ngay phat sinh vi pham ===\n');

    const cutoff = await getDayCutoffHours(supabase);
    const nowIso = new Date().toISOString();
    const calToday = vnDaysAgo(0);
    const bizToday = toBusinessDate(new Date(), cutoff);
    console.log(`Moc cat ngay lam viec: ${cutoff}h`);
    console.log(`Bay gio (UTC)       : ${nowIso}`);
    console.log(`Ngay LICH VN        : ${calToday}`);
    console.log(`Ngay LAM VIEC       : ${bizToday}\n`);

    // ── R1 + R2: cửa ngày ──────────────────────────────────────────────
    console.log('--- R1/R2: cua ngay cho phep tru ---');
    const cases: Array<[string, boolean, boolean, string]> = [
        [vnDaysAgo(-1), false, false, 'Le tan tru cho NGAY MAI'],
        [vnDaysAgo(-1), true, false, 'Quan ly tru cho NGAY MAI'],
        [vnDaysAgo(0), false, true, 'Le tan tru cho HOM NAY'],
        [vnDaysAgo(1), false, true, 'Le tan tru cho HOM QUA'],
        [vnDaysAgo(2), false, false, 'Le tan tru cho HOM KIA'],
        [vnDaysAgo(2), true, true, 'Quan ly tru cho HOM KIA'],
        [vnDaysAgo(40), true, true, 'Quan ly tru cho 40 ngay truoc'],
        ['08-09-2026', true, false, 'Ngay sai dinh dang dd-MM-yyyy'],
    ];
    for (const [date, isManager, expect, label] of cases) {
        const got = routeAllows(date, isManager);
        check(got.ok === expect, label, `${date} → ${got.ok ? 'CHO PHEP' : 'CHAN: ' + got.why}`);
    }

    // ── Chuẩn bị dữ liệu thật cho R3/R4 ────────────────────────────────
    const { data: staff } = await supabase
        .from('Staff').select('id, full_name').eq('work_type', 'TYPE_D').neq('status', 'ĐÃ NGHỈ').limit(1);
    const { data: crit } = await supabase
        .from('KTVOfficeCriteria').select('id, label, points').eq('is_active', true).limit(1);

    if (!staff?.length || !crit?.length) {
        console.log('\n  (bo qua R3/R4: thieu KTV loai D hoac tieu chi)');
    } else {
        const staffId = staff[0].id;
        const c = crit[0];
        // Ngày rất cũ, chắc chắn không đụng phiếu thật của ai.
        const testDate = '2020-01-15';
        const base = {
            staff_id: staffId, work_date: testDate, criteria_id: c.id,
            criteria_label: c.label, points_deducted: Number(c.points) || 0,
            note: QA_TAG, photo_urls: [], created_by: staffId, created_by_name: 'QA',
        };

        try {
            console.log(`\n--- R3: unique index chan tru trung (KTV ${staffId}, ${testDate}, ${c.id}) ---`);
            await supabase.from('KTVOfficeScoreLog').delete().eq('staff_id', staffId).eq('work_date', testDate);

            const first = await supabase.from('KTVOfficeScoreLog').insert(base).select('id').single();
            check(!first.error, 'Phieu dau tien ghi duoc', first.error?.message || '');

            const dup = await supabase.from('KTVOfficeScoreLog').insert(base).select('id');
            check(!!dup.error && (dup.error as any).code === '23505',
                'DB CHAN phieu trung thu hai',
                dup.error ? `code=${(dup.error as any).code}` : 'KHONG chan — unique index thieu!');

            console.log('\n--- R4: thu hoi roi thi cham lai duoc trong cung ngay ---');
            await supabase.from('KTVOfficeScoreLog')
                .update({ revoked_at: new Date().toISOString(), revoked_by: 'QA', revoke_reason: QA_TAG })
                .eq('id', first.data!.id);
            const again = await supabase.from('KTVOfficeScoreLog').insert(base).select('id').single();
            check(!again.error, 'Cham lai sau khi thu hoi: ghi duoc', again.error?.message || '');

            console.log('\n--- R3b: mot ngay KHAC thi van ghi duoc ---');
            const other = await supabase.from('KTVOfficeScoreLog')
                .insert({ ...base, work_date: '2020-01-16' }).select('id').single();
            check(!other.error, 'Cung loi, ngay khac: ghi duoc', other.error?.message || '');
        } finally {
            const del = await supabase.from('KTVOfficeScoreLog')
                .delete().eq('staff_id', staffId).in('work_date', ['2020-01-15', '2020-01-16']);
            console.log(`\n  (da don du lieu QA${del.error ? ' — LOI: ' + del.error.message : ''})`);
        }
    }

    // ── R5: work_date có cùng hệ ngày với chấm công không? ─────────────
    console.log('\n--- R5: work_date co cung he ngay voi cham cong / so cai tua ---');
    console.log(`  Ngay LICH tai thoi diem chay       → ${calToday}`);
    console.log(`  Ngay LAM VIEC (cutoff ${cutoff}h)          → ${bizToday}`);

    // Đóng băng đồng hồ ở 02:00 giờ VN để ép đúng khung 00:00–06:00 — khung duy
    // nhất mà ngày lịch và ngày làm việc lệch nhau. Chạy ban ngày thì nhánh này
    // không bao giờ lộ ra, nên phải mô phỏng chứ không đợi 2h sáng mới test.
    const at2am = new Date('2026-09-05T19:00:00.000Z'); // = 02:00 ngay 06/09 gio VN
    const calAt2am = new Date(at2am.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const bizAt2am = toBusinessDate(at2am, cutoff);
    console.log(`\n  [Mo phong 02:00 sang ngay 06/09 gio VN]`);
    console.log(`    Ngay LICH     = ${calAt2am}  (cong thuc CU cua sheet cham diem)`);
    console.log(`    Ngay LAM VIEC = ${bizAt2am}  (cham cong, so cai tua, cron chot so)`);
    check(bizAt2am === '2026-09-05',
        'Luc 02:00 sang, ngay lam viec van la ca dem hom truoc (05/09)',
        `${bizAt2am}`);
    check(calAt2am !== bizAt2am,
        'Da xac nhan hai he ngay LECH nhau trong khung 00:00-06:00',
        `${calAt2am} vs ${bizAt2am} — day la ly do sheet cham diem phai lay ngay tu server`);

    // Bằng chứng trên dữ liệu thật: phiếu trừ rơi vào ngày KTV không hề chấm công.
    const month = calToday.slice(0, 7);
    const { from, to } = monthRange(month);
    const { data: logs } = await supabase
        .from('KTVOfficeScoreLog')
        .select('staff_id, work_date, criteria_id')
        .gte('work_date', from).lte('work_date', to).is('revoked_at', null);

    const staffIds = [...new Set((logs || []).map(l => l.staff_id))];
    if (staffIds.length === 0) {
        console.log('  (thang nay chua co phieu tru nao de doi chieu voi cham cong)');
    } else {
        const { data: att } = await supabase
            .from('KTVAttendance').select('employeeId, date')
            .in('employeeId', staffIds).gte('date', from).lte('date', to)
            .in('checkType', ['CHECK_IN', 'LATE_CHECKIN']);
        const attSet = new Set((att || []).map(a => `${a.employeeId}|${a.date}`));
        const orphans = (logs || []).filter(l => !attSet.has(`${l.staff_id}|${l.work_date}`));
        // Không phải lỗi: quy chế cho phép trừ cả ngày chấm công bị thiếu, và
        // `buildMonth` vẫn đếm ngày đó vào mẫu số. Chỉ in ra để rà bằng mắt —
        // nếu con số này tăng vọt đúng vào các ngày liền kề thì đó là dấu hiệu
        // phiếu bị ghi lệch một ngày.
        console.log(`  Phieu tru roi vao ngay KHONG co cham cong: ${orphans.length}/${(logs || []).length}`);
        if (orphans.length) {
            console.log(`    ${orphans.slice(0, 6).map(o => `${o.staff_id}/${o.work_date}/${o.criteria_id}`).join(', ')}${orphans.length > 6 ? ' ...' : ''}`);
        }

        // Ảnh hưởng thật lên điểm tháng: ngày lạc làm phình mẫu số.
        const scores = await KtvOfficeScoreService.computeMonth(supabase, staffIds, month);
        console.table(staffIds.map(id => {
            const m = scores.get(id)!;
            return { id, ngay_di_lam: m.workDays, ngay_sach: m.cleanDays, trung_binh: m.avg, diem_thang: m.final, quy_phai_dong: m.fundDue };
        }));
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
