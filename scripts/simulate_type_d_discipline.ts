import assert from 'assert';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { KtvTypeDDisciplineService } from '../lib/services/KtvTypeDDisciplineService';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
);

/**
 * ⚠️ SCRIPT NÀY GHI THẲNG VÀO DATABASE THẬT bằng service role key.
 *
 * Nó seed phiếu phạt cho T001 ngày 2026-09-01 rồi tự dọn ở `finally`. Bảng đọc,
 * bảng ghi và bảng dọn PHẢI cùng là `KTVDPenaltyLedger` — trước đây dọn nhầm sang
 * `KTVServiceHoursLedger` (sổ cũ, từ đợt refactor sổ cái đã thôi dùng) nên dọn
 * không trúng gì: 16 giờ phạt ảo nằm lại trong DB, T001 tụt xuống −16h trên bảng
 * xếp hạng giờ và trông y như một vụ kỷ luật thật.
 */
const PENALTY_TABLE = 'KTVDPenaltyLedger';

async function clearSeed(staffId: string, date: string) {
    await supabase.from(PENALTY_TABLE).delete().eq('staff_id', staffId).eq('work_date', date);
}

async function runTest() {
    const staffId = 'T001';
    const date = '2026-09-01';

    try {
        console.log("Running discipline assertions...");
        await clearSeed(staffId, date);

        // Phạt theo NGÀY: idempotent thật — khoá UNIQUE(staff_id, work_date,
        // penalty_type) nên gọi lại chỉ ghi đè, không cộng dồn.
        await KtvTypeDDisciplineService.deductDailyViolation(supabase, staffId, date, 'ABSENT_NO_NOTICE');
        await KtvTypeDDisciplineService.deductDailyViolation(supabase, staffId, date, 'ABSENT_NO_NOTICE');

        // Từ chối tua thì NGƯỢC LẠI: cố ý CỘNG DỒN. Cùng khoá UNIQUE nên hàm phải
        // tự cộng tay vào dòng đang có, nếu không KTV từ chối 5 tua trong ngày chỉ
        // bị trừ đúng một lần. Hai lần gọi 60 phút ⇒ 3h + 3h = 6h.
        await KtvTypeDDisciplineService.deductOrderReject(supabase, staffId, date, 'BKG-001', 60);
        await KtvTypeDDisciplineService.deductOrderReject(supabase, staffId, date, 'BKG-002', 60);

        const { data } = await supabase
            .from(PENALTY_TABLE)
            .select('*')
            .eq('staff_id', staffId)
            .eq('work_date', date)
            .order('penalty_type');

        assert.ok(data);
        assert.strictEqual(data.length, 2);

        const absentViolation = data.find(d => d.penalty_type === 'ABSENT_NO_NOTICE');
        assert.ok(absentViolation);
        assert.strictEqual(Number(absentViolation.hours_penalty), 10);

        const rejectViolation = data.find(d => d.penalty_type === 'ORDER_REJECT');
        assert.ok(rejectViolation);
        assert.strictEqual(Number(rejectViolation.hours_penalty), 6);
        // Mã đơn nay nằm trong `note` — KTVDPenaltyLedger không có cột booking_id.
        assert.ok(rejectViolation.note.includes('BKG-001'));
        assert.ok(rejectViolation.note.includes('BKG-002'));

        console.log("All discipline assertions passed.");
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        // LUÔN dọn — kể cả khi assert fail ở trên, nếu không rác nằm lại trong DB thật.
        await clearSeed(staffId, date);
    }
}

runTest();
