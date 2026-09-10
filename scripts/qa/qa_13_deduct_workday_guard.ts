/**
 * QA #13 — Không đi làm thì không trừ điểm được.
 *
 * Xét CÙNG LÚC hai nguồn bằng chứng, vì mỗi cái một mình đều bỏ sót:
 *   · chỉ nhìn LỊCH   → bỏ sót người đăng ký OFF mà vẫn vào làm;
 *   · chỉ nhìn CHẤM CÔNG → bỏ sót người có lịch mà không tới, trong khi chính
 *     sự vắng mặt đó là lỗi cần trừ (T4 Chuyên cần, T1 Bật app đúng giờ).
 *
 * Ma trận 6 tình huống (W1–W6), rồi chạy thật trên DB (W7) và đối chiếu dữ
 * liệu đang có (W8).
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register \
 *       scripts/qa/qa_13_deduct_workday_guard.ts
 *
 * CÓ GHI DB — chấm công + đăng ký ngày 2019-04-0x, xoá ở finally.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { workdayEvidence, evidenceLabel } from '../../lib/services/KtvOfficeWorkdayService';
import { finish, fatal } from './_exit';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

/** Ngày test nằm ở 2019 — trước khi hệ thống tồn tại, không đụng dữ liệu thật. */
const D = (n: number) => `2019-04-0${n}`;

async function main() {
    console.log('\n=== QA #13 · Khong di lam thi khong tru diem duoc ===\n');

    const { data: staffRows } = await supabase
        .from('Staff').select('id').eq('work_type', 'TYPE_D').neq('status', 'ĐÃ NGHỈ').order('id').limit(1);
    if (!staffRows?.length) { console.log('  (khong co KTV loai D)'); return finish(1); }
    const ktv = staffRows[0].id;
    console.log(`KTV: ${ktv}\n`);

    const days = [1, 2, 3, 4, 5, 6].map(D);

    const clean = async () => {
        await supabase.from('KTVAttendance').delete().eq('employeeId', ktv).in('date', days);
        await supabase.from('KTVTypeDDailyRegistration').delete().eq('staff_id', ktv).in('work_date', days);
    };

    const addAttendance = async (date: string) => {
        const { error } = await supabase.from('KTVAttendance').insert({
            employeeId: ktv, employeeName: 'QA', date, checkType: 'CHECK_IN',
        });
        if (error) throw new Error(`Khong ghi duoc cham cong: ${error.message}`);
    };
    const addReg = async (date: string, status: string, checkIn = false) => {
        const { error } = await supabase.from('KTVTypeDDailyRegistration').insert({
            staff_id: ktv, work_date: date, status,
            expected_time: '09:00:00',
            check_in_at: checkIn ? `${date}T09:05:00+07:00` : null,
        });
        if (error) throw new Error(`Khong ghi duoc dang ky: ${error.message}`);
    };

    try {
        await clean();

        // ── Dựng 6 tình huống ──────────────────────────────────────────
        // 1. Có lịch làm + có điểm danh          → CHO
        await addReg(D(1), 'REGISTERED'); await addAttendance(D(1));
        // 2. Có lịch làm, KHONG diem danh (vang) → CHO (chinh su vang la loi)
        await addReg(D(2), 'REGISTERED');
        // 3. Dang ky NGHI nhung VAN DI LAM       → CHO  ← ca ban neu ra
        await addReg(D(3), 'OFF_REGISTERED'); await addAttendance(D(3));
        // 4. Dang ky NGHI, khong den              → CHAN
        await addReg(D(4), 'OFF_REGISTERED');
        // 5. Khong co lich, nhung co diem danh    → CHO
        await addAttendance(D(5));
        // 6. Khong co gi ca                       → CHAN
        //    (khong ghi gi cho D(6))

        const MONG_DOI: Array<[string, boolean, string]> = [
            [D(1), true,  'Co lich + co diem danh'],
            [D(2), true,  'Co lich, vang mat (chinh su vang la loi can tru)'],
            [D(3), true,  'Dang ky NGHI nhung VAN DI LAM'],
            [D(4), false, 'Dang ky NGHI va khong den'],
            [D(5), true,  'Khong co lich nhung CO diem danh'],
            [D(6), false, 'Khong lich, khong diem danh'],
        ];

        console.log('--- W1..W6: ma tran hai nguon bang chung ---');
        const rows: any[] = [];
        for (const [date, expect, moTa] of MONG_DOI) {
            const e = await workdayEvidence(supabase, ktv, date);
            rows.push({
                ngay: date.slice(5), tinh_huong: moTa.slice(0, 42),
                cham_cong: e.attended ? 'co' : '-',
                lich: e.scheduled ? 'lam' : (e.registeredOff ? 'NGHI' : '-'),
                ket_qua: e.canDeduct ? 'CHO' : 'CHAN',
                mong_doi: expect ? 'CHO' : 'CHAN',
            });
            check(e.canDeduct === expect, `${moTa}`,
                `${e.canDeduct ? 'CHO' : 'CHAN'} · ${evidenceLabel(e)}`);
        }
        console.table(rows);

        // Trường hợp bạn nêu phải nói rõ ra, không im lặng cho qua.
        const off = await workdayEvidence(supabase, ktv, D(3));
        check(off.registeredOff && off.attended && off.canDeduct,
            'W3b. Dang ky nghi + co diem danh: he thong NHAN RA ca hai',
            evidenceLabel(off));
        check(evidenceLabel(off).includes('vẫn đi làm'),
            'W3c. Nhan hien thi noi ro "dang ky nghi nhung van di lam"',
            evidenceLabel(off));

        // Ngày bị chặn phải kèm lý do đọc được, và gợi ý đường xử lý.
        const blocked = await workdayEvidence(supabase, ktv, D(4));
        check(!!blocked.reason && blocked.reason.includes('điểm danh'),
            'W4b. Ngay bi chan co ly do va goi y cach xu ly',
            blocked.reason || '(khong co ly do)');

        // ── W7: cửa chặn có thật sự nằm ở SERVER không ─────────────────
        console.log('\n--- W7: cua chan nam o tang server ---');
        const fs = await import('fs');
        const path = await import('path');
        const route = fs.readFileSync(
            path.join(__dirname, '../../app/api/admin/ktv-office/deduct/route.ts'), 'utf8');
        check(/NOT_A_WORKDAY/.test(route) && /workdayEvidence/.test(route),
            'POST tu choi khi khong co bang chung di lam (khong chi an nut)');
        check(/workday:\s*\{\s*\.\.\.workday/.test(route),
            'GET tra bang chung ra de sheet canh bao TRUOC khi dien');

    } finally {
        await clean();
        console.log('\n  (da don du lieu QA)');
    }

    // ── W8: đối chiếu dữ liệu đang có ─────────────────────────────────
    console.log('\n--- W8: luat nay ap vao du lieu dang co thi sao ---');
    const { data: logs } = await supabase
        .from('KTVOfficeScoreLog').select('staff_id, work_date').is('revoked_at', null);
    const uniq = [...new Set((logs || []).map(l => `${l.staff_id}|${l.work_date}`))];
    let chan = 0;
    const chanList: string[] = [];
    for (const k of uniq) {
        const [id, date] = k.split('|');
        const e = await workdayEvidence(supabase, id, date);
        if (!e.canDeduct) { chan++; chanList.push(`${id}/${date.slice(5)}`); }
    }
    console.log(`  ${uniq.length} ngay dang co phieu tru · luat moi se CHAN ${chan} ngay`);
    if (chan > 0) console.log(`  ${chanList.join(', ')}`);
    console.log('  (Phieu cu KHONG bi xoa — luat chi ap cho phieu ghi tu bay gio.)');
    check(true, 'Da do anh huong len du lieu dang co');

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
